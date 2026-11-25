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
import { localDay } from "./local-store";
import {
  describeUploadError,
  logUpload,
  validateVideo,
  videoContentType,
  videoExtension,
} from "./upload";

const BUCKET = "clips";
const SIGNED_URL_SECONDS = 60 * 60;
const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;

interface PendingUpload {
  userId: string;
  clipId: string;
  file: File;
  contentType: string;
  path: string;
  queuedAt: number;
  controller: AbortController;
  deleted?: boolean;
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
  /** Local playback while sending, and a retry source if sending fails. */
  private localVideos = new Map<string, { file: File; path: string }>();
  private uploads = new Map<string, PendingUpload>();
  private activeUpload: PendingUpload | undefined;
  private signedUrls = new Map<string, { url: string; expires: number }>();

  constructor(
    private sb: SupabaseClient,
    private url: string,
    private anonKey: string,
  ) {
    // A different account means a different library: drop this device's
    // caches and let every screen reload.
    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        if (event === "SIGNED_OUT") {
          this.activeUpload?.controller.abort();
          this.localVideos.clear();
          this.uploads.clear();
          this.signedUrls.clear();
        }
        // Outside the auth callback, so queries don't wait on its lock.
        setTimeout(() => this.emit(), 0);
      }
    });
  }

  /** The signed-in user's id. Library screens are only shown when signed in. */
  private get session(): Promise<string> {
    return this.sb.auth.getSession().then(({ data }) => {
      if (!data.session) throw new Error("Not signed in");
      return data.session.user.id;
    });
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
      videoStatus: r.video_path
        ? "ready"
        : this.activeUpload?.clipId === r.id && this.uploads.has(r.id)
          ? "uploading"
          : this.uploads.has(r.id)
            ? "queued"
            : "failed",
    };
  }

  async listClips(): Promise<Clip[]> {
    await this.session;
    const { data, error } = await this.sb
      .from("clips")
      .select(CLIP_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as ClipRow[]).map((r) => this.toClip(r));
  }

  async getClip(id: string) {
    await this.session;
    const { data, error } = await this.sb
      .from("clips")
      .select(CLIP_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? this.toClip(data as ClipRow) : undefined;
  }

  async createClip(file: File): Promise<Clip> {
    const contentType = validateVideo(file, true);
    const userId = await this.session;
    const now = new Date();
    const { data, error } = await this.sb
      .from("clips")
      .insert({ day: localDay(now), title: file.name })
      .select(CLIP_COLUMNS)
      .single();
    if (error) throw error;
    const row = data as ClipRow;

    // The analyzer plays the local file right away; the upload runs behind it.
    this.queueUpload(userId, row.id, file, contentType);
    return this.toClip(row);
  }

  async storageUsage(): Promise<StorageUsage | null> {
    await this.session;
    const { data, error } = await this.sb.rpc("storage_usage");
    if (error) {
      // e.g. the storage_usage migration isn't applied yet; Settings shows "—".
      console.warn("[vertlab] storage usage unavailable", error);
      return null;
    }
    const row = (data as { bytes: number | string; videos: number | string }[])[0];
    return { bytes: Number(row?.bytes ?? 0), videos: Number(row?.videos ?? 0) };
  }

  hasLocalVideo(clipId: string) {
    return this.localVideos.has(clipId);
  }

  async retryUpload(clipId: string, file?: File) {
    const userId = await this.session;
    const video = file ?? this.localVideos.get(clipId)?.file;
    if (!video) return false;
    if (this.uploads.has(clipId)) return true;
    const contentType = validateVideo(video, true);
    logUpload("retry selected", { clipId, fromPicker: !!file });
    this.queueUpload(userId, clipId, video, contentType);
    return true;
  }

  private queueUpload(userId: string, clipId: string, file: File, contentType: string) {
    // A replacement can have a different extension. Keep the original object
    // key in this tab so retrying a failed link can't leave a second object.
    const path = this.localVideos.get(clipId)?.path ?? videoPath(userId, clipId, file);
    this.localVideos.set(clipId, { file, path });
    this.signedUrls.delete(clipId);
    this.uploads.set(clipId, {
      userId,
      clipId,
      file,
      contentType,
      path,
      queuedAt: performance.now(),
      controller: new AbortController(),
    });
    logUpload("queued", { clipId, bytes: file.size, pending: this.uploads.size });
    this.startNextUpload();
    this.emit();
  }

  private startNextUpload() {
    if (this.activeUpload) return;
    const next = this.uploads.values().next().value;
    if (!next) return;
    this.activeUpload = next;
    void this.upload(next).finally(() => {
      if (this.uploads.get(next.clipId) === next) this.uploads.delete(next.clipId);
      this.activeUpload = undefined;
      this.startNextUpload();
      this.emit();
    });
  }

  private async upload(task: PendingUpload) {
    const { userId, clipId, file, contentType, path, controller } = task;
    const { signal } = controller;
    const resumable = file.size >= RESUMABLE_THRESHOLD_BYTES;
    const started = performance.now();
    const info = { clipId, bytes: file.size, contentType, transfer: resumable ? "resumable" : "standard" };
    const elapsed = () => Math.round(performance.now() - started);
    let stage = "transfer";
    logUpload("transfer started", { ...info, queueMs: Math.round(started - task.queuedAt) });
    try {
      if (resumable) {
        const { uploadResumableVideo } = await import("./resumable-upload");
        await uploadResumableVideo({
          projectUrl: this.url, anonKey: this.anonKey, bucket: BUCKET,
          path, clipId, file, contentType, signal,
          getAccessToken: async () => {
            const { data, error } = await this.sb.auth.getSession();
            if (error) throw error;
            if (data.session?.user.id !== userId) throw new Error("Upload session changed");
            return data.session.access_token;
          },
        });
      } else {
        // The SDK uses the Blob's MIME type for multipart uploads.
        const video = file.type === contentType ? file : file.slice(0, file.size, contentType);
        const { error } = await this.sb.storage.from(BUCKET).upload(path, video, { upsert: true });
        if (error) throw error;
      }
      signal.throwIfAborted();
      logUpload("transfer finished", { clipId, elapsedMs: elapsed() });
      stage = "link clip";
      const { data, error } = await this.sb
        .from("clips")
        .update({ video_path: path })
        .eq("id", clipId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        await this.removeVideos(clipId, [path]);
        throw new Error("Clip row no longer exists");
      }
      signal.throwIfAborted();
      this.localVideos.delete(clipId);
      logUpload("clip linked", { clipId, elapsedMs: elapsed() });
    } catch (error) {
      if (signal.aborted) {
        logUpload("transfer canceled", { clipId, stage, elapsedMs: elapsed() });
        if (task.deleted) await this.removeVideos(clipId, [path]);
        return;
      }
      const details = describeUploadError(error);
      logUpload("upload failed", { ...info, stage, elapsedMs: elapsed(), ...details }, "error");
      toast.error(`Couldn't upload ${file.name}`, {
        description: details.reason ?? (stage === "link clip"
          ? "The video reached storage, but couldn't be linked to the clip. Retry from the library."
          : "Check your connection, then retry from the library."),
        duration: 10_000,
      });
    } finally {
      // A retry uses a fresh URL if the same object was previously signed.
      this.signedUrls.delete(clipId);
    }
  }

  async updateClip(id: string, patch: ClipPatch) {
    await this.session;
    const { error } = await this.sb.from("clips").update(patch).eq("id", id);
    if (error) throw error;
    this.emit();
  }

  async deleteClip(id: string) {
    await this.session;
    const { data, error } = await this.sb
      .from("clips")
      .delete()
      .eq("id", id)
      .select("video_path")
      .maybeSingle();
    if (error) throw error;
    const pending = this.uploads.get(id);
    if (pending) {
      pending.deleted = true;
      pending.controller.abort();
      this.uploads.delete(id);
    }
    const paths = new Set<string>();
    if (data?.video_path) paths.add(data.video_path);
    const local = this.localVideos.get(id);
    // A failed link may have already left an object in Storage.
    if (local && (!pending || pending !== this.activeUpload)) {
      paths.add(local.path);
    }
    this.localVideos.delete(id);
    this.signedUrls.delete(id);
    if (paths.size) await this.removeVideos(id, [...paths]);
    // Links left with no clips stop working; mark them stopped.
    const empty = await this.emptyShareIds();
    if (empty.length) {
      await this.sb
        .from("shares")
        .update({ revoked_at: new Date().toISOString() })
        .in("id", empty);
    }
    this.emit();
  }

  private async removeVideos(clipId: string, paths: string[]) {
    try {
      const { error } = await this.sb.storage.from(BUCKET).remove(paths);
      if (error) throw error;
    } catch (error) {
      logUpload("storage cleanup failed", { clipId, ...describeUploadError(error) }, "warn");
    }
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
    const local = this.localVideos.get(id)?.file;
    if (local) {
      const type = videoContentType(local);
      const video = type === local.type ? local : local.slice(0, local.size, type);
      return URL.createObjectURL(video);
    }

    const cached = this.signedUrls.get(id);
    if (cached && cached.expires > Date.now() + 60_000) return cached.url;

    await this.session;
    const { data, error: lookupError } = await this.sb
      .from("clips")
      .select("video_path")
      .eq("id", id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!data?.video_path) return undefined;
    const { data: signed, error } = await this.sb.storage
      .from(BUCKET)
      .createSignedUrl(data.video_path, SIGNED_URL_SECONDS);
    if (error) throw error;
    if (!signed) return undefined;
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
    await this.session;
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
    await this.session;
    const { data, error } = await this.sb.rpc("share_clip", { p_clip_id: clipId });
    if (error) throw error;
    this.emit();
    return this.toShare(data as ShareRow, [clipId]);
  }

  async shareDay(day: string, clipIds: string[]) {
    await this.session;
    const { data, error } = await this.sb.rpc("share_day", {
      p_day: day,
      p_clip_ids: clipIds,
    });
    if (error) throw error;
    this.emit();
    return this.toShare(data as ShareRow, clipIds);
  }

  async stopSharing(shareId: string) {
    await this.session;
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
