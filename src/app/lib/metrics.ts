// Pure calculations behind each analysis mode, shared by the analyzer panels,
// the library rows and the share viewer.
import { jumpHeightInches } from "./video-utils";

export interface ContactJumpMetrics {
  /** Seconds from penultimate step to ground contact (approach only). */
  penultimateSec?: number;
  contactMs: number;
  airtime: number;
  jumpIn: number;
}

/** Approach jump: [penultimate, contact, takeoff, landing]. */
export function approachMetrics(times: number[]): ContactJumpMetrics | null {
  if (times.length < 4) return null;
  const [penultimate, contact, takeoff, landing] = times;
  const airtime = landing - takeoff;
  return {
    penultimateSec: contact - penultimate,
    contactMs: (takeoff - contact) * 1000,
    airtime,
    jumpIn: jumpHeightInches(airtime),
  };
}

/** Depth jump: [contact, takeoff, landing]. */
export function depthMetrics(times: number[]): ContactJumpMetrics | null {
  if (times.length < 3) return null;
  const [contact, takeoff, landing] = times;
  const airtime = landing - takeoff;
  return {
    contactMs: (takeoff - contact) * 1000,
    airtime,
    jumpIn: jumpHeightInches(airtime),
  };
}

export interface RsiJump {
  index: number;
  contact: number; // seconds on the ground
  flight: number; // seconds in the air
  rsi: number; // flight / contact
}

export const RSI_TOP_N = 5;

/** 10-5 RSI: landing, takeoff, landing, takeoff … ending on a landing. */
export function rsiJumps(times: number[]): RsiJump[] {
  const jumps: RsiJump[] = [];
  for (let i = 0; i + 2 < times.length; i += 2) {
    const contact = times[i + 1] - times[i];
    const flight = times[i + 2] - times[i + 1];
    jumps.push({
      index: jumps.length + 1,
      contact,
      flight,
      rsi: contact > 0 ? flight / contact : 0,
    });
  }
  return jumps;
}

export function rsiTop(jumps: RsiJump[]) {
  const topIds = new Set(
    [...jumps]
      .sort((a, b) => b.rsi - a.rsi)
      .slice(0, RSI_TOP_N)
      .map((j) => j.index),
  );
  const top = jumps.filter((j) => topIds.has(j.index));
  const bestAvg = top.length
    ? top.reduce((sum, j) => sum + j.rsi, 0) / top.length
    : 0;
  return { topIds, bestAvg };
}

/* ---------- Summary: the one-line result stored with each clip ---------- */

export type HeightUnit = "in" | "cm";

export interface ClipStat {
  label: string;
  /** Raw value; `kind` decides how it's formatted. */
  value: number;
  kind: "height" | "ms" | "s" | "rsi" | "count";
}

export interface ClipSummary {
  /** Headline number (inches for heights). */
  value: number;
  kind: "height" | "rsi";
  /** Secondary line, e.g. "GCT 176 ms". */
  sub: string;
  stats: ClipStat[];
}

export function summarize(mode: string, times: number[]): ClipSummary | null {
  if (mode === "approach-jump" || mode === "depth-jump") {
    const m = mode === "approach-jump" ? approachMetrics(times) : depthMetrics(times);
    if (!m) return null;
    return {
      value: m.jumpIn,
      kind: "height",
      sub: `GCT ${Math.round(m.contactMs)} ms`,
      stats: [
        { label: "Ground contact", value: m.contactMs, kind: "ms" },
        { label: "Airtime", value: m.airtime, kind: "s" },
        ...(m.penultimateSec !== undefined
          ? [{ label: "Penultimate step", value: m.penultimateSec, kind: "s" as const }]
          : []),
      ],
    };
  }
  if (mode === "ten-five-rsi") {
    const jumps = rsiJumps(times);
    if (!jumps.length) return null;
    const { bestAvg } = rsiTop(jumps);
    const avgContact = jumps.reduce((s, j) => s + j.contact, 0) / jumps.length;
    const avgFlight = jumps.reduce((s, j) => s + j.flight, 0) / jumps.length;
    return {
      value: bestAvg,
      kind: "rsi",
      sub: `Best ${Math.min(RSI_TOP_N, jumps.length)} of ${jumps.length}`,
      stats: [
        { label: "Avg contact", value: avgContact * 1000, kind: "ms" },
        { label: "Avg flight", value: avgFlight, kind: "s" },
      ],
    };
  }
  return null;
}

export function formatHeight(inches: number, unit: HeightUnit) {
  return unit === "cm"
    ? { value: (inches * 2.54).toFixed(1), unit: "cm" }
    : { value: inches.toFixed(1), unit: "in" };
}

/** Format a summary's headline for display: { value, unit }. */
export function formatHeadline(s: ClipSummary, unit: HeightUnit) {
  return s.kind === "height"
    ? formatHeight(s.value, unit)
    : { value: s.value.toFixed(2), unit: "RSI" };
}

export function formatStat(stat: ClipStat, unit: HeightUnit): string {
  switch (stat.kind) {
    case "ms":
      return `${Math.round(stat.value)} ms`;
    case "s":
      return `${stat.value.toFixed(3)} s`;
    case "rsi":
      return stat.value.toFixed(2);
    case "height": {
      const h = formatHeight(stat.value, unit);
      return `${h.value} ${h.unit}`;
    }
    default:
      return String(stat.value);
  }
}

export const MODE_LABELS: Record<string, string> = {
  compare: "Compare",
  "approach-jump": "Approach",
  "depth-jump": "Depth",
  "ten-five-rsi": "10-5 RSI",
};

/** Keyframe labels per mode (used by the analyzer strip and the viewer). */
const APPROACH_LABELS = ["Penultimate", "Contact", "Takeoff", "Landing"];
const DEPTH_LABELS = ["Contact", "Takeoff", "Landing"];

function rsiLabel(i: number): string {
  if (i === 0) return "Initial landing";
  const jump = i % 2 === 1 ? (i + 1) / 2 : i / 2;
  return i % 2 === 1 ? `Jump ${jump} takeoff` : `Jump ${jump} landing`;
}

export function keyframeLabel(mode: string, i: number): string | undefined {
  if (mode === "approach-jump") return APPROACH_LABELS[i];
  if (mode === "depth-jump") return DEPTH_LABELS[i];
  if (mode === "ten-five-rsi") return rsiLabel(i);
  return undefined;
}
