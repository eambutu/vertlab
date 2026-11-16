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
} from "./types";
import { localDay } from "./local-store";

const BUCKET = "clips";
const SIGNED_URL_SECONDS = 60 * 60;
/**
 * Must match the bucket's file_size_limit (supabase/migrations/…_clips_and_shares.sql)
 * and stay under the project's global upload limit (50 MB on the Free plan).
 */
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const log = (...args: unknown[]) => console.info("[vertlab upload]", ...args);

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

function extOf(file: File) {
  const fromName = file.name.split(".").pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  return file.type.split("/")[1] ?? "mp4";
}

export class SupabaseClipStore implements ClipStore {
  private listeners = new Set<() => void>();
  /** Videos picked on this device, kept until (and after) their upload. */
  private localVideos = new Map<string, File>();
  private uploading = new Set<string>();
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
          this.localVideos.clear();
          this.uploading.clear();
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
        : this.uploading.has(r.id)
          ? "uploading"
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
    const { data } = await this.sb
      .from("clips")
      .select(CLIP_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    return data ? this.toClip(data as ClipRow) : undefined;
  }

  async createClip(file: File): Promise<Clip> {
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
    this.localVideos.set(row.id, file);
    this.uploading.add(row.id);
    this.upload(userId, row.id, file);
    this.emit();
    return this.toClip(row);
  }

  hasLocalVideo(clipId: string) {
    return this.localVideos.has(clipId);
  }

  async retryUpload(clipId: string, file?: File) {
    const userId = await this.session;
    const video = file ?? this.localVideos.get(clipId);
    if (!video) return false;
    if (this.uploading.has(clipId)) return true;
    log("retry", { clipId, fromPicker: !!file });
    this.localVideos.set(clipId, video);
    this.uploading.add(clipId);
    this.emit();
    void this.upload(userId, clipId, video);
    return true;
  }

  private async upload(userId: string, clipId: string, file: File) {
    const path = `${userId}/${clipId}/video.${extOf(file)}`;
    const started = performance.now();
    const info = { clipId, path, name: file.name, type: file.type, size: mb(file.size) };
    log("start", info);
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          `File is ${mb(file.size)}; the upload limit is ${mb(MAX_UPLOAD_BYTES)}`,
        );
      }
      const { error } = await this.sb.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || "video/mp4", upsert: true });
      if (error) throw error;
      log("stored", { clipId, seconds: ((performance.now() - started) / 1000).toFixed(1) });
      const { error: updateError } = await this.sb
        .from("clips")
        .update({ video_path: path })
        .eq("id", clipId);
      if (updateError) throw updateError;
      log("done", { clipId });
    } catch (e) {
      // StorageApiError carries the HTTP status (413 = too large, 403 = policy).
      const err = e as { message?: string; status?: number; statusCode?: string };
      console.error("[vertlab upload] failed", {
        ...info,
        seconds: ((performance.now() - started) / 1000).toFixed(1),
        status: err.status ?? err.statusCode,
        message: err.message,
        error: e,
      });
      toast.error("Video didn't upload", {
        description:
          file.size > MAX_UPLOAD_BYTES
            ? `It's ${mb(file.size)}; videos can be up to ${mb(MAX_UPLOAD_BYTES)}. Trim it and retry from the ••• menu.`
            : `${err.message ?? "Check your connection."} Retry from the ••• menu.`,
        duration: 10_000,
      });
    } finally {
      this.uploading.delete(clipId);
      this.emit();
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
    const { data } = await this.sb
      .from("clips")
      .select("video_path")
      .eq("id", id)
      .maybeSingle();
    const { error } = await this.sb.from("clips").delete().eq("id", id);
    if (error) throw error;
    if (data?.video_path) await this.sb.storage.from(BUCKET).remove([data.video_path]);
    // Links left with no clips stop working; mark them stopped.
    const empty = await this.emptyShareIds();
    if (empty.length) {
      await this.sb
        .from("shares")
        .update({ revoked_at: new Date().toISOString() })
        .in("id", empty);
    }
    this.localVideos.delete(id);
    this.signedUrls.delete(id);
    this.emit();
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
    const local = this.localVideos.get(id);
    if (local) return URL.createObjectURL(local);

    const cached = this.signedUrls.get(id);
    if (cached && cached.expires > Date.now() + 60_000) return cached.url;

    await this.session;
    const { data } = await this.sb
      .from("clips")
      .select("video_path")
      .eq("id", id)
      .maybeSingle();
    if (!data?.video_path) return undefined;
    const { data: signed, error } = await this.sb.storage
      .from(BUCKET)
      .createSignedUrl(data.video_path, SIGNED_URL_SECONDS);
    if (error || !signed) return undefined;
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
