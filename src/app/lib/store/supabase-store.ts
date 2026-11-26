// Supabase implementation of ClipStore. Schema, RLS and the share-view
// function live in supabase/; see plans/2-clip-library-and-sharing.md.
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import type { ClipSummary } from "../metrics";
import type {
  Clip,
  ClipPatch,
  ClipStore,
  Share,
  SharedView,
  StorageUsage,
} from "./types";
import { getAuth, subscribeAuth } from "../auth";
import { changeJob, getJob, getJobVideo, listJobs, type ClipJob, type PendingVideo } from "./clip-outbox";
import { newLocalClip } from "./local-store";
import {
  describeUploadError,
  logUpload,
  validateVideo,
  videoExtension,
  VideoUploadError,
} from "./upload";

const BUCKET = "clips";
const SIGNED_URL_SECONDS = 60 * 60;
const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;

function checkCloudError(result: { error: object | null; status: number }) {
  if (result.error) throw Object.assign(result.error, { status: result.status });
}

function shouldRetry(error: unknown, status?: number) {
  return status === undefined
    ? !(error instanceof VideoUploadError)
    : status >= 500 || [0, 401, 408, 409, 423, 429].includes(status);
}

interface ClipRow {
  id: string;
  user_id: string;
  created_at: string;
  day: string;
  title: string;
  mode: string;
  keyframes: number[];
  fps: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  summary: ClipSummary | null;
  starred: boolean;
  poster: string | null;
  video_path: string | null;
}

interface ShareRow {
  id: string;
  token: string;
  kind: "clip" | "day";
  day: string | null;
  created_at: string;
  share_clips?: { clip_id: string; position: number }[];
}

const CLIP_COLUMNS =
  "id, user_id, created_at, day, title, mode, keyframes, fps, duration, width, height, summary, starred, poster, video_path";

function videoPath(userId: string, clipId: string, file: File) {
  return `${userId}/${clipId}/video.${videoExtension(file) ?? "mp4"}`;
}

export class SupabaseClipStore implements ClipStore {
  private listeners = new Set<() => void>();
  private userId: string | undefined;
  private localVideoIds = new Set<string>();
  private cloudClips = new Map<string, Clip>();
  private libraryLoaded = false;
  private libraryRequest?: Promise<void>;
  private libraryRevision = 0;
  private activeClipId?: string;
  private syncController?: AbortController;
  private syncTimer?: number;
  private syncRequested = false;
  private retryDelay = 5_000;
  private signedUrls = new Map<string, { url: string; expires: number }>();
  private channel = typeof BroadcastChannel === "undefined"
    ? undefined
    : new BroadcastChannel("vertlab-cloud-outbox");

  constructor(
    private sb: SupabaseClient,
    private url: string,
    private anonKey: string,
  ) {
    const resume = () => {
      this.scheduleSync();
      void this.refreshLibrary();
      this.emit();
    };
    const accountChanged = () => {
      const auth = getAuth();
      const userId = auth.status === "signed-in" ? auth.userId : undefined;
      if (userId === this.userId) return;
      this.syncController?.abort();
      this.userId = userId;
      this.localVideoIds.clear();
      this.cloudClips.clear();
      this.libraryLoaded = false;
      this.libraryRevision++;
      this.libraryRequest = undefined;
      this.activeClipId = undefined;
      this.signedUrls.clear();
      this.retryDelay = 5_000;
      resume();
    };
    subscribeAuth(accountChanged);
    this.channel?.addEventListener("message", ({ data }) => {
      if (!this.userId || data?.scope !== this.scope(this.userId)) return;
      if (data.runSync) this.scheduleSync();
      else void this.refreshLibrary();
      this.emit();
    });
    window.addEventListener("online", resume);
    window.addEventListener("offline", () => this.emit());
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") resume();
    });
    accountChanged();
  }

  /** Device account for the outbox. Supabase verifies the session for cloud I/O. */
  private localUser() {
    if (!this.userId) throw new Error("Not signed in");
    return this.userId;
  }

  private scope(userId: string) {
    return `${this.url}|${userId}`;
  }

  private async accessToken(userId: string) {
    const { data, error } = await this.sb.auth.getSession();
    if (error) throw error;
    if (this.userId !== userId || data.session?.user.id !== userId) {
      throw Object.assign(new Error("Sign in to sync"), { status: 401 });
    }
    return data.session.access_token;
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private changed(scope: string, runSync = false) {
    this.emit();
    this.channel?.postMessage({ scope, runSync });
    if (runSync) this.scheduleSync();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private toClip(r: ClipRow): Clip {
    return {
      id: r.id,
      createdAt: Date.parse(r.created_at),
      day: r.day,
      title: r.title,
      mode: r.mode,
      keyframes: r.keyframes ?? [],
      fps: r.fps ?? undefined,
      duration: r.duration ?? undefined,
      width: r.width ?? undefined,
      height: r.height ?? undefined,
      summary: r.summary,
      starred: r.starred,
      poster: r.poster ?? undefined,
      videoStatus: r.video_path ? "ready" : "failed",
    };
  }

  private refreshLibrary() {
    const userId = this.userId;
    if (!userId || !navigator.onLine) return;
    if (this.libraryRequest) return this.libraryRequest;
    const revision = this.libraryRevision;
    const request = (async () => {
      const { data, error } = await this.sb.from("clips").select(CLIP_COLUMNS)
        .eq("user_id", userId).order("created_at", { ascending: false });
      if (error) throw error;
      if (this.userId !== userId || revision !== this.libraryRevision) return;
      this.cloudClips = new Map((data as ClipRow[]).map((row) => [row.id, this.toClip(row)]));
      this.libraryLoaded = true;
      this.emit();
    })().catch((error) => {
      logUpload("cloud library unavailable", describeUploadError(error), "warn");
    }).finally(() => {
      if (this.libraryRequest === request) this.libraryRequest = undefined;
    });
    this.libraryRequest = request;
    return request;
  }

  private localClip(job: ClipJob): Clip | undefined {
    if (job.deletePaths || !job.clip) return undefined;
    let videoStatus = job.clip.videoStatus;
    if (job.video) {
      videoStatus = this.activeClipId === job.id ? "uploading" : "queued";
      if (job.failed) videoStatus = "failed";
    }
    const clip = job.create ? job.clip : this.cloudClips.get(job.id) ?? job.clip;
    return { ...clip, ...job.patch, videoStatus };
  }

  async listClips() {
    const userId = this.localUser();
    const jobs = await listJobs(this.scope(userId)).catch((error) => {
      logUpload("local library unavailable", describeUploadError(error), "warn");
      return [] as ClipJob[];
    });
    if (this.userId !== userId) return [];
    this.localVideoIds = new Set(jobs.filter((job) => job.video && !job.video.missing).map((job) => job.id));
    const clips = new Map(this.cloudClips);
    for (const job of jobs) {
      const clip = this.localClip(job);
      if (clip) clips.set(job.id, clip);
      else if (job.deletePaths) clips.delete(job.id);
    }
    return [...clips.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async getClip(id: string) {
    const userId = this.localUser();
    const job = await getJob(this.scope(userId), id).catch(() => undefined);
    if (this.userId !== userId) return undefined;
    if (job) {
      if (job.video && !job.video.missing) this.localVideoIds.add(id);
      return this.localClip(job);
    }
    if (!this.libraryLoaded) await this.refreshLibrary();
    return this.userId === userId ? this.cloudClips.get(id) : undefined;
  }

  private videoFor(userId: string, clipId: string, file: File, contentType: string, path?: string): PendingVideo {
    return {
      id: crypto.randomUUID(),
      size: file.size,
      contentType,
      path: path ?? videoPath(userId, clipId, file),
    };
  }

  async createClip(file: File): Promise<Clip> {
    const contentType = validateVideo(file, true);
    const userId = this.localUser();
    const scope = this.scope(userId);
    const clip = newLocalClip(file, "queued");
    await changeJob(scope, clip.id, () => ({
      id: clip.id, scope, clip, create: true, revision: crypto.randomUUID(),
      queuedAt: clip.createdAt, video: this.videoFor(userId, clip.id, file, contentType),
    }), file);
    if (this.userId === userId) this.localVideoIds.add(clip.id);
    logUpload("saved on device", { clipId: clip.id, bytes: file.size });
    this.changed(scope, true);
    return clip;
  }

  async storageUsage(): Promise<StorageUsage | null> {
    if (!navigator.onLine) return null;
    const { data, error } = await this.sb.rpc("storage_usage");
    if (error) {
      console.warn("[vertlab] storage usage unavailable", error);
      return null;
    }
    const row = (data as { bytes: number | string; videos: number | string }[])[0];
    return { bytes: Number(row?.bytes ?? 0), videos: Number(row?.videos ?? 0) };
  }

  async pendingStorageUsage(): Promise<StorageUsage> {
    const userId = this.localUser();
    const jobs = await listJobs(this.scope(userId));
    if (this.userId !== userId) return { bytes: 0, videos: 0 };
    const videos = jobs.flatMap((job) => job.video && !job.video.missing ? [job.video] : []);
    return { bytes: videos.reduce((total, video) => total + video.size, 0), videos: videos.length };
  }

  hasLocalVideo(clipId: string) {
    return this.localVideoIds.has(clipId);
  }

  async retryUpload(clipId: string, file?: File) {
    const userId = this.localUser();
    const scope = this.scope(userId);
    const clip = await this.getClip(clipId);
    if (!clip) return false;
    const contentType = file ? validateVideo(file, true) : undefined;
    const job = await changeJob(scope, clipId, (current) => {
      if (current?.deletePaths || (!file && (!current?.video || current.video.missing))) return current;
      return {
        id: clipId, scope, clip, queuedAt: Date.now(), ...current,
        revision: crypto.randomUUID(), failed: false,
        video: file && contentType
          ? this.videoFor(userId, clipId, file, contentType, current?.video?.path)
          : current?.video,
      };
    }, file);
    if (!job?.video || job.video.missing) return false;
    this.localVideoIds.add(clipId);
    this.changed(scope, true);
    return true;
  }

  private scheduleSync(delay = 0) {
    window.clearTimeout(this.syncTimer);
    if (!this.userId || !navigator.onLine) return;
    this.syncTimer = window.setTimeout(() => this.startSync(), delay);
  }

  private startSync() {
    if (!this.userId || !navigator.onLine) return;
    if (this.syncController) {
      this.syncRequested = true;
      return;
    }
    const userId = this.userId;
    const controller = new AbortController();
    this.syncController = controller;
    const run = () => this.drain(userId, controller.signal);
    // Serialise cloud writes for the same account across open tabs.
    const work = navigator.locks
      ? navigator.locks.request(`vertlab-sync:${this.scope(userId)}`, { signal: controller.signal }, run)
      : run();
    void work.catch((error) => {
      if (!controller.signal.aborted) logUpload("sync unavailable", describeUploadError(error), "warn");
    }).finally(() => {
      this.syncController = undefined;
      if (this.syncRequested) {
        this.syncRequested = false;
        this.scheduleSync();
      }
    });
  }

  private async drain(userId: string, signal: AbortSignal) {
    const scope = this.scope(userId);
    const jobs = (await listJobs(scope)).sort((a, b) => a.queuedAt - b.queuedAt);
    let retry = false;
    for (const queued of jobs) {
      if (signal.aborted || !navigator.onLine) break;
      const job = await getJob(scope, queued.id);
      if (!job || job.failed) continue;
      try {
        await this.accessToken(userId);
        signal.throwIfAborted();
        this.activeClipId = job.id;
        this.emit();
        await this.syncJob(job, userId, signal);
      } catch (error) {
        if (signal.aborted) return;
        const details = describeUploadError(error);
        const again = !navigator.onLine || shouldRetry(error, details.status);
        retry ||= again;
        logUpload("sync failed", { clipId: job.id, retry: again, ...details }, again ? "warn" : "error");
        if (!again) {
          await changeJob(scope, job.id, (current) => current?.revision === job.revision
            ? { ...current, failed: true } : current);
          toast.error(job.video ? `Couldn't upload ${job.clip?.title ?? "video"}` : "Couldn't sync a clip", {
            description: details.reason ?? "Your changes are still saved on this device.",
          });
        }
      } finally {
        if (this.activeClipId === job.id) this.activeClipId = undefined;
        this.emit();
      }
    }
    if (retry && !signal.aborted) {
      this.scheduleSync(this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
    } else {
      this.retryDelay = 5_000;
    }
  }

  private async syncJob(job: ClipJob, userId: string, signal: AbortSignal) {
    const { scope, id, video } = job;
    if (job.deletePaths) {
      await this.syncDeletion(job, userId, signal);
      await this.finishJob(job);
      if (this.userId === userId) {
        this.cloudClips.delete(id);
        this.libraryRevision++;
      }
      this.changed(scope);
      return;
    }
    if (job.create && job.clip) {
      const { createdAt, day, title } = job.clip;
      const result = await this.sb.from("clips").upsert({
        id, user_id: userId, created_at: new Date(createdAt).toISOString(), day, title,
      }, { onConflict: "id", ignoreDuplicates: true }).abortSignal(signal);
      checkCloudError(result);
      await changeJob(scope, id, (current) => current?.create && !current.deletePaths
        ? { ...current, create: false } : current);
    }
    if (video && !video.transferred) {
      const current = await getJob(scope, id);
      if (!current || current.deletePaths || current.video?.id !== video.id) return;
      const file = await getJobVideo(scope, id, video.id);
      if (!file) {
        const latest = await changeJob(scope, id, (entry) => entry?.video?.id === video.id
          ? { ...entry, video: { ...entry.video, missing: true } } : entry);
        if (latest?.video?.id !== video.id) return;
        this.localVideoIds.delete(id);
        throw new VideoUploadError("missing video", "The browser removed the saved video. Select it again to retry.");
      }
      await this.transfer(job, video, file, userId, signal);
      await changeJob(scope, id, (entry) => entry?.video?.id === video.id
        ? { ...entry, video: { ...entry.video, transferred: true, uploadUrl: undefined } } : entry);
    }
    signal.throwIfAborted();
    const current = await getJob(scope, id);
    if (!current || current.deletePaths || current.video?.id !== video?.id) return;

    const patch = { ...current.patch, ...(video ? { video_path: video.path } : {}) };
    const query = Object.keys(patch).length
      ? this.sb.from("clips").update(patch).eq("id", id).eq("user_id", userId).select(CLIP_COLUMNS)
      : this.sb.from("clips").select(CLIP_COLUMNS).eq("id", id).eq("user_id", userId);
    const result = await query.abortSignal(signal).maybeSingle();
    checkCloudError(result);
    if (!result.data && video) await this.removeVideos([video.path]);
    await this.finishJob(current);
    if (this.userId === userId) {
      if (result.data) this.cloudClips.set(id, this.toClip(result.data as ClipRow));
      else this.cloudClips.delete(id);
      this.libraryRevision++;
      this.signedUrls.delete(id);
    }
    logUpload("clip synced", { clipId: id });
    this.changed(scope);
  }

  private async finishJob(job: ClipJob) {
    await changeJob(job.scope, job.id, (current) => current?.revision === job.revision ? undefined : current);
  }

  private async transfer(job: ClipJob, video: PendingVideo, file: Blob, userId: string, signal: AbortSignal) {
    const { id: clipId, scope } = job;
    const { path, contentType } = video;
    const resumable = file.size >= RESUMABLE_THRESHOLD_BYTES;
    logUpload("transfer started", { clipId, bytes: file.size, resumable });
    if (resumable) {
      const { uploadResumableVideo } = await import("./resumable-upload");
      await uploadResumableVideo({
        projectUrl: this.url, anonKey: this.anonKey, bucket: BUCKET,
        clipId, path, file, contentType, signal, uploadUrl: video.uploadUrl,
        getAccessToken: () => this.accessToken(userId),
        saveUploadUrl: async (uploadUrl) => {
          await changeJob(scope, clipId, (current) => current?.video?.id === video.id
            ? { ...current, video: { ...current.video, uploadUrl } } : current);
        },
      });
    } else {
      signal.throwIfAborted();
      const body = file.type === contentType ? file : file.slice(0, file.size, contentType);
      const { error } = await this.sb.storage.from(BUCKET).upload(path, body, { upsert: true });
      if (error) throw error;
    }
  }

  async updateClip(id: string, patch: ClipPatch) {
    const userId = this.localUser();
    const scope = this.scope(userId);
    const clip = await this.getClip(id);
    if (!clip) return;
    const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    await changeJob(scope, id, (current) => current?.deletePaths ? current : ({
      scope, id, clip, queuedAt: Date.now(), ...current, revision: crypto.randomUUID(),
      patch: { ...current?.patch, ...changes },
      failed: current?.video ? current.failed : false,
    }));
    this.changed(scope, true);
  }

  async deleteClip(id: string) {
    const userId = this.localUser();
    const scope = this.scope(userId);
    await changeJob(scope, id, (current) => ({
      id, scope, queuedAt: Date.now(), revision: crypto.randomUUID(),
      deletePaths: current?.deletePaths ?? (current?.video ? [current.video.path] : []),
    }));
    this.localVideoIds.delete(id);
    this.signedUrls.delete(id);
    this.changed(scope, true);
  }

  private async syncDeletion(job: ClipJob, userId: string, signal: AbortSignal) {
    const { id, scope } = job;
    const result = await this.sb.from("clips").select("video_path")
      .eq("id", id).eq("user_id", userId).abortSignal(signal).maybeSingle();
    checkCloudError(result);
    const paths = new Set(job.deletePaths);
    if (result.data?.video_path) paths.add(result.data.video_path);
    if (paths.size !== job.deletePaths?.length) {
      await changeJob(scope, id, (entry) => entry?.deletePaths
        ? { ...entry, deletePaths: [...paths] } : entry);
    }
    const deletion = await this.sb.from("clips").delete()
      .eq("id", id).eq("user_id", userId).abortSignal(signal);
    checkCloudError(deletion);
    if (paths.size) await this.removeVideos([...paths]);
    const empty = await this.emptyShareIds();
    if (empty.length) await this.sb.from("shares").update({ revoked_at: new Date().toISOString() })
      .in("id", empty).abortSignal(signal);
  }

  private async removeVideos(paths: string[]) {
    const { error } = await this.sb.storage.from(BUCKET).remove(paths);
    if (error) throw error;
  }

  private async emptyShareIds(): Promise<string[]> {
    const { data } = await this.sb
      .from("shares")
      .select("id, share_clips(count)")
      .is("revoked_at", null);
    return ((data ?? []) as { id: string; share_clips: { count: number }[] }[])
      .filter((s) => (s.share_clips[0]?.count ?? 0) === 0)
      .map((s) => s.id);
  }

  async getVideoUrl(id: string) {
    const userId = this.localUser();
    const scope = this.scope(userId);
    const job = await getJob(scope, id).catch(() => undefined);
    if (this.userId !== userId || job?.deletePaths) return undefined;
    if (job?.video) {
      const local = await getJobVideo(scope, id, job.video.id);
      if (this.userId !== userId) return undefined;
      if (local) {
        const type = job.video.contentType;
        const playable = type === local.type ? local : local.slice(0, local.size, type);
        return URL.createObjectURL(playable);
      }
    }

    if (!navigator.onLine) return undefined;
    const cached = this.signedUrls.get(id);
    if (cached && cached.expires > Date.now() + 60_000) return cached.url;

    const { data, error: lookupError } = await this.sb.from("clips").select("video_path")
      .eq("id", id).eq("user_id", userId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!data?.video_path || this.userId !== userId) return undefined;
    const { data: signed, error } = await this.sb.storage
      .from(BUCKET)
      .createSignedUrl(data.video_path, SIGNED_URL_SECONDS);
    if (error) throw error;
    if (!signed || this.userId !== userId) return undefined;
    this.signedUrls.set(id, {
      url: signed.signedUrl,
      expires: Date.now() + SIGNED_URL_SECONDS * 1000,
    });
    return signed.signedUrl;
  }

  private toShare(r: ShareRow, clipIds?: string[]): Share {
    return {
      id: r.id,
      token: r.token,
      kind: r.kind,
      day: r.day ?? undefined,
      clipIds:
        clipIds ??
        [...(r.share_clips ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((c) => c.clip_id),
      createdAt: Date.parse(r.created_at),
    };
  }

  async listShares(): Promise<Share[]> {
    await this.accessToken(this.localUser());
    const { data, error } = await this.sb
      .from("shares")
      .select("id, token, kind, day, created_at, share_clips(clip_id, position)")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as ShareRow[])
      .map((r) => this.toShare(r))
      .filter((s) => s.clipIds.length > 0);
  }

  async shareClip(clipId: string) {
    await this.accessToken(this.localUser());
    const { data, error } = await this.sb.rpc("share_clip", { p_clip_id: clipId });
    if (error) throw error;
    this.emit();
    return this.toShare(data as ShareRow, [clipId]);
  }

  async shareDay(day: string, clipIds: string[]) {
    await this.accessToken(this.localUser());
    const { data, error } = await this.sb.rpc("share_day", {
      p_day: day,
      p_clip_ids: clipIds,
    });
    if (error) throw error;
    this.emit();
    return this.toShare(data as ShareRow, clipIds);
  }

  async stopSharing(shareId: string) {
    await this.accessToken(this.localUser());
    const { error } = await this.sb
      .from("shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", shareId);
    if (error) throw error;
    this.emit();
  }

  /** Works without an account: goes through the public share-view function. */
  async openShare(token: string): Promise<SharedView | undefined> {
    const res = await fetch(
      `${this.url}/functions/v1/share-view?token=${encodeURIComponent(token)}`,
      { headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}` } },
    );
    if (!res.ok) return undefined;
    return (await res.json()) as SharedView;
  }
}
