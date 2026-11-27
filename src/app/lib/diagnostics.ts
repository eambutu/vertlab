import { supabase } from "./supabase";

const STORAGE_KEY = "vertlab.diagnostics.v1";
const MAX_EVENTS = 300;

type Level = "info" | "warn" | "error";
type Category = "upload" | "playback" | "app";
type Detail = string | number | boolean;

interface DiagnosticEvent {
  at: string;
  category: Category;
  level: Level;
  event: string;
  details: Record<string, Detail>;
}

// Keep persisted reports limited to diagnostic fields. Do not store filenames,
// media URLs, share tokens, account data, or raw exception messages.
const allowedNumbers = new Set([
  "bytes", "total", "percent", "pending", "files", "fileNumber", "added", "failed",
  "elapsedMs", "queueMs", "attempt", "status", "code", "readyState", "networkState",
  "duration", "width", "height", "frames", "line", "column",
]);
const allowedText: Record<string, RegExp> = {
  mode: /^(compare|custom|depth-jump|approach-jump|ten-five-rsi)$/,
  page: /^(library|clip|settings|shared|labs|other)$/,
  bundle: /^[a-zA-Z0-9_-]{1,100}\.js$/,
  clipId: /^[a-f0-9-]{36}$/i,
  batchId: /^[a-f0-9-]{36}$/i,
  loadId: /^[a-f0-9-]{36}$/i,
  storage: /^(browser|cloud)$/,
  source: /^(local|cloud)$/,
  view: /^(library|shared)$/,
  stage: /^(clip lookup|video source|media|transfer|link clip)$/,
  transfer: /^(standard|resumable)$/,
  videoStatus: /^(ready|queued|uploading|failed)$/,
  method: /^(POST|HEAD|PATCH|DELETE|GET)$/,
  name: /^[A-Za-z]{0,35}Error$/,
  code: /^(PGRST\d+|[A-Z0-9]{5})$/,
  type: /^(video\/[a-z0-9.+-]{1,48}|application\/octet-stream)$/i,
  contentType: /^video\/[a-z0-9.+-]{1,48}$/i,
  failureKind: /^(empty file|format|file size|missing video|quota|authentication|permissions)$/,
};

let pending: DiagnosticEvent[] = [];

function readEvents(): DiagnosticEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function logDiagnostic(
  category: Category,
  event: string,
  details: Record<string, unknown>,
  level: Level = "info",
) {
  const safe: Record<string, Detail> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "number" && Number.isFinite(value) && allowedNumbers.has(key)) {
      safe[key] = value;
    } else if (typeof value === "string" && Object.hasOwn(allowedText, key) && allowedText[key].test(value)) {
      safe[key] = value;
    } else if (typeof value === "boolean" && (key === "fromPicker" || key === "online")) {
      safe[key] = value;
    }
  }
  console[level](`[vertlab ${category}]`, event, safe);
  pending.push({ at: new Date().toISOString(), category, level, event, details: safe });
  pending = pending.slice(-MAX_EVENTS);
  try {
    const events = [...readEvents(), ...pending].slice(-MAX_EVENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    pending = [];
  } catch {
    // Keep recent events available in this tab even when storage is blocked or full.
  }
}

export async function sendDiagnostics() {
  if (!supabase) throw new Error("Supabase is not configured");
  const diagnostics = {
    version: 1,
    browser: navigator.userAgent,
    events: [...readEvents(), ...pending].slice(-MAX_EVENTS),
  };
  const { data, error } = await supabase
    .from("error_reports")
    .insert({ diagnostics })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}
