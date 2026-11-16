// IndexedDB implementation of ClipStore. Everything stays in this browser, so
// share links only open here — the Supabase store (see
// plans/2-clip-library-and-sharing.md) makes them public.
import type {
  Clip,
  ClipPatch,
  ClipStore,
  Share,
  SharedView,
} from "./types";

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

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
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
    const db = await this.db();
    const now = new Date();
    const clip: Clip = {
      id: crypto.randomUUID(),
      createdAt: now.getTime(),
      day: localDay(now),
      title: file.name,
      mode: "compare",
      keyframes: [],
      summary: null,
      starred: false,
      videoStatus: "ready",
    };
    const tx = db.transaction(["clips", "videos"], "readwrite");
    tx.objectStore("clips").put(clip);
    tx.objectStore("videos").put(file, clip.id);
    await txDone(tx);
    this.emit();
    return clip;
  }

  /** Videos are saved with the clip here, so there's never anything to resend. */
  async retryUpload() {
    return true;
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

  async openShare(token: string): Promise<SharedView | undefined> {
    const shares = await this.listShares();
    const share = shares.find((s) => s.token === token);
    if (!share) return undefined;
    const clips = [];
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
    return { kind: share.kind, day: share.day, clips, partOf };
  }
}
