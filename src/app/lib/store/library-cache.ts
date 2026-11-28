import type { LibraryPage } from "./types";
import { reqToPromise, txDone } from "../indexed-db";

let connection: Promise<IDBDatabase> | undefined;
function openCache() {
  if (!connection) {
    const request = indexedDB.open("vertlab-library-cache", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("recent");
    connection = reqToPromise(request).catch(error => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}

export async function readRecent(scope: string, from: string): Promise<LibraryPage | undefined> {
  const db = await openCache();
  const entry = await reqToPromise(db.transaction("recent").objectStore("recent").get(scope));
  if (!entry) return undefined;
  // A Monday snapshot still helps on Tuesday. Anything that aged out becomes
  // a cursor, so the cached first page never loses the route to older days.
  const page: LibraryPage = entry.page;
  if (entry.from > from) return undefined;
  const olderDay = page.clips.reduce((day, clip) =>
    clip.day < from && (!day || clip.day > day) ? clip.day : day, page.olderDay);
  return { clips: page.clips.filter(c => c.day >= from), olderDay };
}

export async function saveRecent(scope: string, from: string, page: LibraryPage) {
  const db = await openCache();
  const tx = db.transaction("recent", "readwrite");
  tx.objectStore("recent").put({ from, page }, scope);
  await txDone(tx);
}
