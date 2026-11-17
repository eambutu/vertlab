import { format, isToday, isYesterday, parseISO } from "date-fns";

/** "Today · Sun, Nov 15", "Yesterday · Sat, Nov 14", "Thu, Nov 12", "Thu, Nov 12, 2025". */
export function dayHeading(day: string): string {
  const d = parseISO(day);
  const label = d.getFullYear() === new Date().getFullYear()
    ? format(d, "EEE, MMM d")
    : format(d, "EEE, MMM d, yyyy");
  if (isToday(d)) return `Today · ${label}`;
  if (isYesterday(d)) return `Yesterday · ${label}`;
  return label;
}

/** Short day label without the relative prefix: "Thu, Nov 12". */
export function dayShort(day: string): string {
  return format(parseISO(day), "EEE, MMM d");
}

/** Full day for public pages: "Thu, Nov 12, 2026". */
export function dayLong(day: string): string {
  return format(parseISO(day), "EEE, MMM d, yyyy");
}

/** "6:51 PM" */
export function clockTime(ms: number): string {
  return format(ms, "h:mm a");
}

/** "Today, 6:51 PM" or "Thu, Nov 12, 6:51 PM" */
export function whenRecorded(ms: number): string {
  const d = new Date(ms);
  if (isToday(d)) return `Today, ${clockTime(ms)}`;
  if (isYesterday(d)) return `Yesterday, ${clockTime(ms)}`;
  return `${format(d, "EEE, MMM d")}, ${clockTime(ms)}`;
}

/** "shared today" / "shared Nov 12" */
export function sharedWhen(ms: number): string {
  return isToday(ms) ? "shared today" : `shared ${format(ms, "MMM d")}`;
}

/** Clip length badge: "2.4s" */
export function shortDuration(seconds?: number): string | undefined {
  if (!seconds || !isFinite(seconds)) return undefined;
  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "0 MB", "84.2 MB", "1.27 GB" (decimal units, as storage plans use). */
export function fileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  const mb = bytes / 1e6;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
