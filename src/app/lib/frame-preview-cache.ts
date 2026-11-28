// Preview images are disposable. The clip record remains the source of its timestamps.
import { reqToPromise, txDone } from "./indexed-db";

// Bound disk use on devices that cycle through many annotated sessions.
const MAX_IMAGES = 512;
let connection: Promise<IDBDatabase> | undefined;
function openCache() {
  if (!connection) {
    const request = indexedDB.open("vertlab-frame-previews", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("frames").createIndex("savedAt", "savedAt");
    connection = reqToPromise(request).catch(error => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}

export async function readPreviews(id: string, times: number[]) {
  const db = await openCache();
  const frames = db.transaction("frames").objectStore("frames");
  return Promise.all(times.map(async time => {
    const entry = await reqToPromise<{ image: string } | undefined>(frames.get([id, time]));
    return entry?.image;
  }));
}

export async function savePreview(id: string, time: number, image: string) {
  const db = await openCache();
  const tx = db.transaction("frames", "readwrite");
  const frames = tx.objectStore("frames");
  frames.put({ savedAt: Date.now(), image }, [id, time]);
  const count = frames.count();
  count.onsuccess = () => {
    if (count.result <= MAX_IMAGES) return;
    const oldest = frames.index("savedAt").openKeyCursor();
    oldest.onsuccess = () => { if (oldest.result) frames.delete(oldest.result.primaryKey); };
  };
  await txDone(tx);
}

export async function clearPreviews(id: string) {
  const db = await openCache();
  const tx = db.transaction("frames", "readwrite");
  tx.objectStore("frames").delete(IDBKeyRange.bound([id], [id, []]));
  await txDone(tx);
}
