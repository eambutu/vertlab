import { localDay } from "./local-store";

export function windowStart(day: string, days: number) {
  const start = new Date(day + "T12:00:00");
  start.setDate(start.getDate() - days + 1);
  return localDay(start);
}

export const recentLibraryStart = () => windowStart(localDay(), 7);
