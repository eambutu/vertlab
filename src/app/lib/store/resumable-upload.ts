import { Upload, defaultOptions } from "tus-js-client";
import { logUpload } from "./upload";

// Supabase requires 6 MiB chunks for resumable uploads.
export const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;

interface ResumableVideo {
  projectUrl: string;
  anonKey: string;
  bucket: string;
  path: string;
  clipId: string;
  file: File;
  contentType: string;
  getAccessToken: () => Promise<string>;
  signal: AbortSignal;
}

export function uploadResumableVideo({
  projectUrl,
  anonKey,
  bucket,
  path,
  clipId,
  file,
  contentType,
  getAccessToken,
  signal,
}: ResumableVideo) {
  const endpoint = new URL(projectUrl);
  const hosted = endpoint.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/);
  if (hosted) endpoint.hostname = `${hosted[1]}.storage.supabase.co`;
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/storage/v1/upload/resumable`;

  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    let nextProgress = 10;
    const upload = new Upload(file, {
      endpoint: endpoint.href,
      chunkSize: RESUMABLE_CHUNK_BYTES,
      retryDelays: [0, 1000, 3000, 5000, 10_000],
      uploadDataDuringCreation: true,
      // Resume transient failures within this attempt. Clip IDs and video files
      // are managed by the library, so don't reuse an upload URL from localStorage.
      storeFingerprintForResuming: false,
      headers: { apikey: anonKey, "x-upsert": "true" },
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType,
        cacheControl: "3600",
      },
      onBeforeRequest: async (request) => {
        const token = await getAccessToken();
        signal.throwIfAborted();
        request.setHeader("Authorization", `Bearer ${token}`);
      },
      onShouldRetry: (error, attempt, options) => {
        const retry = defaultOptions.onShouldRetry?.(error, attempt, options);
        if (retry) {
          logUpload("transfer retry", {
            clipId,
            attempt: attempt + 1,
            method: error.originalRequest.getMethod(),
            status: error.originalResponse?.getStatus(),
          }, "warn");
        }
        return !!retry;
      },
      onChunkComplete: (_chunkSize, bytes, total) => {
        const percent = Math.floor((bytes / total) * 100);
        if (percent < nextProgress && bytes < total) return;
        nextProgress = percent + 10;
        logUpload("transfer progress", { clipId, bytes, total, percent });
      },
      onSuccess: () => {
        signal.removeEventListener("abort", cancel);
        resolve();
      },
      onError: (error) => {
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    });
    function cancel() {
      void upload.abort().then(() => reject(signal.reason), reject);
    }
    signal.addEventListener("abort", cancel, { once: true });
    upload.start();
  });
}
