import { Upload, defaultOptions, type HttpStack } from "tus-js-client";
import { logUpload } from "./upload";

// Supabase requires 6 MiB chunks for resumable uploads.
export const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;

const xhrStack = defaultOptions.httpStack;
const httpStack: HttpStack = {
  getName: () => xhrStack.getName(),
  createRequest(method, url) {
    const request = xhrStack.createRequest(method, url);
    const xhr: XMLHttpRequest = request.getUnderlyingObject();
    const send = request.send.bind(request);

    request.send = (body) => new Promise((resolve, reject) => {
      // A slow connection can still be making progress on a 6 MiB chunk.
      const stalled = () => {
        xhr.abort();
        reject(new Error("Upload made no progress"));
      };
      let timer = window.setTimeout(stalled, 45_000);
      const progress = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(stalled, 45_000);
      };
      xhr.upload.addEventListener("progress", progress);
      xhr.addEventListener("loadend", () => {
        window.clearTimeout(timer);
        xhr.upload.removeEventListener("progress", progress);
      }, { once: true });
      void send(body).then(resolve, reject);
    });
    return request;
  },
};

interface ResumableVideo {
  projectUrl: string;
  anonKey: string;
  bucket: string;
  path: string;
  clipId: string;
  file: Blob;
  contentType: string;
  getAccessToken: () => Promise<string>;
  uploadUrl?: string;
  saveCheckpoint: (url: string, confirmedBytes: number) => Promise<void>;
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
  uploadUrl,
  saveCheckpoint,
  signal,
}: ResumableVideo) {
  const endpoint = new URL(projectUrl);
  const hosted = endpoint.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/);
  if (hosted) endpoint.hostname = `${hosted[1]}.storage.supabase.co`;
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/storage/v1/upload/resumable`;

  function resolveUploadUrl(location: string) {
    const url = new URL(location, endpoint);
    if (url.origin !== endpoint.origin || url.username || url.password) {
      throw new Error("Unexpected resumable upload origin");
    }
    return url.href;
  }

  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    let nextProgress = 10;
    const upload = new Upload(file, {
      endpoint: endpoint.href,
      httpStack,
      uploadUrl: uploadUrl ? resolveUploadUrl(uploadUrl) : undefined,
      chunkSize: RESUMABLE_CHUNK_BYTES,
      // The outbox yields to other clips before resuming this URL with HEAD.
      retryDelays: null,
      // Store the URL with the exact video before sending the first chunk.
      storeFingerprintForResuming: false,
      headers: { apikey: anonKey, "x-upsert": "true" },
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType,
        cacheControl: "3600",
      },
      onBeforeRequest: async (request) => {
        resolveUploadUrl(request.getURL());
        const token = await getAccessToken();
        signal.throwIfAborted();
        request.setHeader("Authorization", `Bearer ${token}`);
      },
      onAfterResponse: async (request, response) => {
        const status = response.getStatus();
        const method = request.getMethod();
        if (method === "HEAD" && status >= 400 && status !== 404 && status !== 410) {
          // Only an expired/missing session should cause tus to create a fresh one.
          throw Object.assign(new Error("Could not resume upload"), { status });
        }
        if (status < 200 || status >= 300) return;
        const url = method === "POST" ? response.getHeader("Location") : request.getURL();
        const offset = Number(response.getHeader("Upload-Offset") ?? (method === "POST" ? 0 : NaN));
        if (url && Number.isSafeInteger(offset) && offset >= 0 && offset <= file.size) {
          await saveCheckpoint(resolveUploadUrl(url), offset);
        }
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
