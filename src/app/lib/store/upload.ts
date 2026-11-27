import { logDiagnostic } from "../diagnostics";

export const MAX_CLOUD_VIDEO_BYTES = 250 * 1024 * 1024;

const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function videoExtension(file: File) {
  return file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1].toLowerCase();
}

export function videoContentType(file: File) {
  if (file.type.startsWith("video/")) return file.type;
  if (!file.type || file.type === "application/octet-stream") {
    return VIDEO_TYPES[videoExtension(file) ?? ""];
  }
}

export class VideoUploadError extends Error {
  constructor(readonly failureKind: "empty file" | "format" | "file size" | "missing video", message: string) {
    super(message);
  }
}

function mib(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function validateVideo(file: File, cloud = false) {
  if (!file.size) throw new VideoUploadError("empty file", "This file is empty.");
  const contentType = videoContentType(file);
  if (!contentType) throw new VideoUploadError("format", "Choose an MP4, MOV, or WebM video.");
  if (cloud && file.size > MAX_CLOUD_VIDEO_BYTES) {
    throw new VideoUploadError(
      "file size",
      `This video is ${mib(file.size)} MiB. Trim or compress it to 250 MiB or less.`,
    );
  }
  return contentType;
}

export function logUpload(
  event: string,
  details: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info",
) {
  logDiagnostic("upload", event, details, level);
}

export function describeUploadError(error: unknown) {
  const err = error as {
    name?: string;
    code?: string;
    status?: number;
    statusCode?: string;
    causingError?: { status?: number };
    originalRequest?: { getMethod(): string };
    message?: string;
    originalResponse?: { getStatus(): number; getBody(): string } | null;
  } | null;
  const status = Number(err?.originalResponse?.getStatus() ?? err?.status ?? err?.causingError?.status ?? err?.statusCode) || undefined;
  const body = err?.originalResponse?.getBody() ?? err?.message ?? "";
  let reason: string | undefined;
  let failureKind: string | undefined;
  if (error instanceof VideoUploadError) {
    reason = error.message;
    failureKind = error.failureKind;
  } else if (err?.name === "QuotaExceededError") {
    reason = "This browser is out of storage. Free up space and try again.";
    failureKind = "quota";
  } else if (status === 413 || /exceeded.*(?:size|limit)|entitytoolarge/i.test(body)) {
    reason = "This video exceeds the cloud project's file size limit. Trim or compress it and try again.";
    failureKind = "file size";
  } else if (status === 401) {
    reason = "Your session expired. Sign in again and retry.";
    failureKind = "authentication";
  } else if (status === 403) {
    reason = "Cloud storage denied the upload. Check your account access and retry.";
    failureKind = "permissions";
  } else if (status === 415 || /mime type.*(?:invalid|not supported)/i.test(body)) {
    reason = "Cloud storage didn't accept this format. Try exporting it as an H.264 MP4.";
    failureKind = "format";
  }
  return { name: err?.name, code: err?.code, method: err?.originalRequest?.getMethod(), status, reason, failureKind };
}
