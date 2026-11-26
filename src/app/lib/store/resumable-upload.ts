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
    xhr.timeout = 120_000;
    request.send = (body) => new Promise((resolve, reject) => {
      xhr.ontimeout = () => reject(new Error("Upload request timed out"));
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
  saveUploadUrl: (url: string) => Promise<void>;
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
  saveUploadUrl,
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
      retryDelays: [0, 1000, 3000, 5000, 10_000],
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
        if (request.getMethod() === "HEAD" && (status >= 500 || status === 429)) {
          // Give the current URL another chance when the server is temporarily unavailable.
          throw new Error(`Could not read the current upload offset (${status})`);
        }
        if (request.getMethod() !== "POST" || status !== 201) return;
        const location = response.getHeader("Location");
        if (location) await saveUploadUrl(resolveUploadUrl(location));
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
