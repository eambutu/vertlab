import { reqToPromise, txDone } from "../indexed-db";
import type { Clip, ClipPatch } from "./types";

export interface PendingVideo {
  id: string;
  size: number;
  contentType: string;
  path: string;
  uploadUrl?: string;
  confirmedBytes?: number;
  uploading?: boolean;
  transferred?: boolean;
  missing?: boolean;
}

export interface ClipJob {
  scope: string;
  id: string;
  revision: string;
  queuedAt: number;
  clip?: Clip;
  create?: boolean;
  patch?: ClipPatch;
  video?: PendingVideo;
  deletePaths?: string[];
  failed?: boolean;
  retryAt?: number;
  consecutiveFailures?: number;
}

const JOBS = "jobs";
const VIDEOS = "videos";
let dbPromise: Promise<IDBDatabase> | undefined;

function db() {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("vertlab-cloud-outbox", 1);
    request.onupgradeneeded = () => {
      const jobs = request.result.createObjectStore(JOBS, { keyPath: ["scope", "id"] });
      jobs.createIndex("scope", "scope");
      request.result.createObjectStore(VIDEOS);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        dbPromise = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    dbPromise = undefined;
    throw error;
  });
  return dbPromise;
}

export async function listJobs(scope: string): Promise<ClipJob[]> {
  const database = await db();
  return reqToPromise(database.transaction(JOBS).objectStore(JOBS).index("scope").getAll(scope));
}

export async function getJob(scope: string, id: string): Promise<ClipJob | undefined> {
  const database = await db();
  return reqToPromise(database.transaction(JOBS).objectStore(JOBS).get([scope, id]));
}

export async function getJobVideo(scope: string, id: string, videoId: string): Promise<Blob | undefined> {
  const database = await db();
  const tx = database.transaction([JOBS, VIDEOS]);
  const key = [scope, id];
  const job = await reqToPromise<ClipJob | undefined>(tx.objectStore(JOBS).get(key));
  if (job?.video?.id === videoId) return reqToPromise(tx.objectStore(VIDEOS).get(key));
}

/** Commit the job and its video together, and drop the blob when the job no longer needs it. */
export async function changeJob(
  scope: string,
  id: string,
  change: (current: ClipJob | undefined) => ClipJob | undefined,
  file?: File,
) {
  const database = await db();
  const tx = database.transaction([JOBS, VIDEOS], "readwrite");
  const done = txDone(tx);
  // An individual request can reject before the abort event is delivered.
  void done.catch(() => {});
  const jobs = tx.objectStore(JOBS);
  const videos = tx.objectStore(VIDEOS);
  const key = [scope, id];
  const current = await reqToPromise<ClipJob | undefined>(jobs.get(key));
  const next = change(current);
  if (next !== current) {
    if (file) videos.put(file, key);
    else if (current?.video && !next?.video) videos.delete(key);
    if (next) jobs.put(next);
    else jobs.delete(key);
  }
  await done;
  return next;
}
