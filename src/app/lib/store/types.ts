import type { ClipSummary } from "../metrics";

/** A saved, analyzed video. Mirrors the `clips` table in the Supabase plan. */
export interface Clip {
  id: string;
  createdAt: number; // epoch ms
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  title: string;
  mode: string;
  /** Keyframe times in seconds, sorted. */
  keyframes: number[];
  fps?: number;
  duration?: number;
  width?: number;
  height?: number;
  summary: ClipSummary | null;
  starred: boolean;
  /** Small JPEG data URL used for list thumbnails. */
  poster?: string;
  /**
   * Whether the video is stored. "uploading" while it's still being sent;
   * "failed" if this device lost it before the upload finished.
   */
  videoStatus: "ready" | "uploading" | "failed";
}

export type ClipPatch = Partial<
  Pick<
    Clip,
    | "mode"
    | "keyframes"
    | "fps"
    | "duration"
    | "width"
    | "height"
    | "summary"
    | "starred"
    | "poster"
  >
>;

export interface StorageUsage {
  bytes: number;
  videos: number;
}

export interface Share {
  id: string;
  token: string;
  kind: "clip" | "day";
  day?: string;
  clipIds: string[];
  createdAt: number;
}

/** What a share link resolves to for an anonymous viewer. */
export interface SharedClip
  extends Pick<
    Clip,
    | "id"
    | "createdAt"
    | "day"
    | "mode"
    | "keyframes"
    | "fps"
    | "duration"
    | "width"
    | "height"
    | "summary"
    | "poster"
  > {
  videoUrl: string;
}

export interface SharedView {
  kind: "clip" | "day";
  day?: string;
  clips: SharedClip[];
  /** For a single-jump link: an active day link from the same owner that includes it. */
  partOf?: { token: string; day: string; count: number };
}

export interface ClipStore {
  listClips(): Promise<Clip[]>;
  getClip(id: string): Promise<Clip | undefined>;
  createClip(file: File): Promise<Clip>;
  updateClip(id: string, patch: ClipPatch): Promise<void>;
  deleteClip(id: string): Promise<void>;
  /**
   * Re-sends a clip's video after a failed upload, using `file` or the copy
   * this device still holds. False when there's no copy and no `file`.
   */
  retryUpload(id: string, file?: File): Promise<boolean>;
  /** Whether this device still holds the clip's video (sync, so a file picker can open on tap). */
  hasLocalVideo(id: string): boolean;
  /** Space the account's videos take up, and how many. Null if it can't be read. */
  storageUsage(): Promise<StorageUsage | null>;
  /** A URL the analyzer can play. Caller revokes it when done if it's a blob: URL. */
  getVideoUrl(id: string): Promise<string | undefined>;

  listShares(): Promise<Share[]>;
  /** Returns the active link for a clip, creating one if needed. */
  shareClip(clipId: string): Promise<Share>;
  /** Returns the active link for a day, creating or updating its clip list. */
  shareDay(day: string, clipIds: string[]): Promise<Share>;
  stopSharing(shareId: string): Promise<void>;
  /** Anonymous lookup by token. Undefined if missing or stopped. */
  openShare(token: string): Promise<SharedView | undefined>;

  /** Called after any change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}
