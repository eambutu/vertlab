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
