// IndexedDB implementation of ClipStore. Everything stays in this browser, so
// share links only open here — the Supabase store (see
// plans/2-clip-library-and-sharing.md) makes them public.
import type {
  Clip,
  ClipPatch,
  ClipStore,
  Share,
  SharedClip,
  SharedView,
} from "./types";
import { validateVideo } from "./upload";

const DB_NAME = "vertlab";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("clips", { keyPath: "id" });
      db.createObjectStore("videos"); // key: clip id, value: Blob
      db.createObjectStore("shares", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Browser storage transaction aborted"));
  });
}

const ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomToken(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function localDay(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function newLocalClip(file: File, videoStatus: Clip["videoStatus"]): Clip {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    createdAt: now.getTime(),
    day: localDay(now),
    title: file.name,
    mode: "compare",
    keyframes: [],
    summary: null,
    starred: false,
    videoStatus,
  };
}

export class LocalClipStore implements ClipStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private listeners = new Set<() => void>();

  private db() {
    this.dbPromise ??= openDb();
    return this.dbPromise;
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

  async listClips(): Promise<Clip[]> {
    const db = await this.db();
    const clips = await reqToPromise<Clip[]>(
      db.transaction("clips").objectStore("clips").getAll(),
    );
    return clips.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getClip(id: string) {
    const db = await this.db();
    return reqToPromise<Clip | undefined>(
      db.transaction("clips").objectStore("clips").get(id),
    );
  }

  async createClip(file: File): Promise<Clip> {
    const contentType = validateVideo(file);
    const db = await this.db();
    const clip = newLocalClip(file, "ready");
    const tx = db.transaction(["clips", "videos"], "readwrite");
    tx.objectStore("clips").put(clip);
    const video = file.type === contentType ? file : file.slice(0, file.size, contentType);
    tx.objectStore("videos").put(video, clip.id);
    await txDone(tx);
    this.emit();
    return clip;
  }

  /** Videos are saved with the clip here, so there's never anything to resend. */
  async retryUpload() {
    return true;
  }

  async storageUsage() {
    const db = await this.db();
    const blobs = await reqToPromise<Blob[]>(
      db.transaction("videos").objectStore("videos").getAll(),
    );
    return { bytes: blobs.reduce((s, b) => s + b.size, 0), videos: blobs.length };
  }

  hasLocalVideo() {
    return true;
  }

  async updateClip(id: string, patch: ClipPatch) {
    const db = await this.db();
    const tx = db.transaction("clips", "readwrite");
    const store = tx.objectStore("clips");
    const clip = await reqToPromise<Clip | undefined>(store.get(id));
    if (clip) store.put({ ...clip, ...patch });
    await txDone(tx);
    this.emit();
  }

  async deleteClip(id: string) {
    const db = await this.db();
    const tx = db.transaction(["clips", "videos", "shares"], "readwrite");
    tx.objectStore("clips").delete(id);
    tx.objectStore("videos").delete(id);
    // Drop the clip from any share; remove shares left empty.
    const shares = tx.objectStore("shares");
    const all = await reqToPromise<Share[]>(shares.getAll());
    for (const s of all) {
      if (!s.clipIds.includes(id)) continue;
      const clipIds = s.clipIds.filter((c) => c !== id);
      if (clipIds.length) shares.put({ ...s, clipIds });
      else shares.delete(s.id);
    }
    await txDone(tx);
    this.emit();
  }

  async getVideoUrl(id: string) {
    const db = await this.db();
    const blob = await reqToPromise<Blob | undefined>(
      db.transaction("videos").objectStore("videos").get(id),
    );
    return blob ? URL.createObjectURL(blob) : undefined;
  }

  async listShares(): Promise<Share[]> {
    const db = await this.db();
    const shares = await reqToPromise<Share[]>(
      db.transaction("shares").objectStore("shares").getAll(),
    );
    return shares.sort((a, b) => b.createdAt - a.createdAt);
  }

  private async putShare(share: Share) {
    const db = await this.db();
    const tx = db.transaction("shares", "readwrite");
    tx.objectStore("shares").put(share);
    await txDone(tx);
    this.emit();
    return share;
  }

  async shareClip(clipId: string) {
    const existing = (await this.listShares()).find(
      (s) => s.kind === "clip" && s.clipIds[0] === clipId,
    );
    if (existing) return existing;
    return this.putShare({
      id: crypto.randomUUID(),
      token: randomToken(),
      kind: "clip",
      clipIds: [clipId],
      createdAt: Date.now(),
    });
  }

  async shareDay(day: string, clipIds: string[]) {
    const existing = (await this.listShares()).find(
      (s) => s.kind === "day" && s.day === day,
    );
    if (existing) return this.putShare({ ...existing, clipIds });
    return this.putShare({
      id: crypto.randomUUID(),
      token: randomToken(),
      kind: "day",
      day,
      clipIds,
      createdAt: Date.now(),
    });
  }

  async stopSharing(shareId: string) {
    const db = await this.db();
    const tx = db.transaction("shares", "readwrite");
    tx.objectStore("shares").delete(shareId);
    await txDone(tx);
    this.emit();
  }

  async openShare(token: string, day?: string): Promise<SharedView | undefined> {
    const shares = await this.listShares();
    const root = shares.find((s) => s.token === token ||
      (s.kind === "day" && token === s.token + "." + s.id));
    if (!root) return undefined;
    const library = token !== root.token;
    const share = library && day
      ? shares.find((s) => s.kind === "day" && s.day === day)
      : root;
    if (day && !library) return undefined;
    if (!share) return undefined;
    const clips: SharedClip[] = [];
    for (const id of share.clipIds) {
      const clip = await this.getClip(id);
      const videoUrl = await this.getVideoUrl(id);
      if (!clip || !videoUrl) continue;
      clips.push({
        id: clip.id,
        createdAt: clip.createdAt,
        day: clip.day,
        mode: clip.mode,
        keyframes: clip.keyframes,
        fps: clip.fps,
        duration: clip.duration,
        width: clip.width,
        height: clip.height,
        summary: clip.summary,
        poster: clip.poster,
        videoUrl,
      });
    }
    if (!clips.length) return undefined;
    let partOf: SharedView["partOf"];
    if (share.kind === "clip") {
      const day = shares.find(
        (s) => s.kind === "day" && s.clipIds.includes(share.clipIds[0]),
      );
      if (day?.day)
        partOf = { token: day.token, day: day.day, count: day.clipIds.length };
    }
    return { kind: share.kind, day: share.day, clips, partOf,
      sharedDays: library ? shares.flatMap(s => s.kind === "day" && s.day && s.clipIds.length ? [s.day] : []).sort().reverse() : undefined,
    };
  }
}
