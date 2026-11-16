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

/* ---------- Error bars from frame quantization ----------
 *
 * Every keyframe snaps to a whole frame, so an event really happened somewhere
 * in the frame interval before the one marked. A span between two keyframes is
 * therefore off by up to ±1 frame. These are worst-case bounds for frame rate
 * alone; picking the wrong frame by eye adds to them.
 */

const G = 9.81; // m/s²
const IN_PER_M = 39.3701;

/** Length of one frame in seconds. */
export function frameSeconds(fps: number): number {
  return fps > 0 ? 1 / fps : 1 / 30;
}

/** ± inches on a jump height from ±dt on its airtime: dh = (g·t/4)·dt. */
export function heightErrInches(airtime: number, dt: number): number {
  return ((G * airtime) / 4) * dt * IN_PER_M;
}

/** ± on flight/contact when the shared takeoff frame can shift both spans. */
export function rsiErr(contact: number, flight: number, dt: number): number {
  if (contact <= 0 || flight <= 0) return 0;
  return (flight / contact) * (dt / flight + dt / contact);
}

/** Averaging n independent measurements shrinks random error by √n. */
function meanErr(err: number, n: number): number {
  return n > 0 ? err / Math.sqrt(n) : err;
}

export interface ContactJumpErrors {
  penultimateSec?: number;
  contactMs: number;
  airtime: number;
  jumpIn: number;
}

export function contactJumpErrors(m: ContactJumpMetrics, fps: number): ContactJumpErrors {
  const dt = frameSeconds(fps);
  return {
    penultimateSec: m.penultimateSec !== undefined ? dt : undefined,
    contactMs: dt * 1000,
    airtime: dt,
    jumpIn: heightErrInches(m.airtime, dt),
  };
}

/** ± on the best-N average: each top jump's bound, averaged, over √N. */
export function rsiBestAvgErr(jumps: RsiJump[], topIds: Set<number>, fps: number): number {
  const dt = frameSeconds(fps);
  const top = jumps.filter((j) => topIds.has(j.index));
  if (!top.length) return 0;
  const avg = top.reduce((s, j) => s + rsiErr(j.contact, j.flight, dt), 0) / top.length;
  return meanErr(avg, top.length);
}

/** Decimals that keep one or two significant digits of the error. */
export function decimalsFor(err: number): number {
  if (!isFinite(err) || err <= 0) return 2;
  return Math.max(0, Math.min(3, 1 - Math.floor(Math.log10(err))));
}

/** Round a value and its error to the same, honest number of decimals. */
export function withError(value: number, err: number) {
  const d = decimalsFor(err);
  return { value: value.toFixed(d), err: err.toFixed(d) };
}

export type RangeFit = "in" | "out" | "unclear";

/** Whether value ± err sits inside [min, max], outside it, or straddles an edge. */
export function rangeFit(value: number, err: number, min: number, max: number): RangeFit {
  if (value - err >= min && value + err <= max) return "in";
  if (value + err < min || value - err > max) return "out";
  return "unclear";
}

/* ---------- Summary: the one-line result stored with each clip ---------- */

export type HeightUnit = "in" | "cm";

export interface ClipStat {
  label: string;
  /** Raw value; `kind` decides how it's formatted. */
  value: number;
  kind: "height" | "ms" | "s" | "rsi" | "count";
  /** ± error from frame quantization, in the same units as `value`. */
  err?: number;
}

export interface ClipSummary {
  /** Headline number (inches for heights). */
  value: number;
  kind: "height" | "rsi";
  /** Secondary line, e.g. "GCT 176 ms". */
  sub: string;
  stats: ClipStat[];
}

/**
 * Build the one-line result for a clip. Pass `fps` to attach ± error bars to
 * each stat (left out when saving, since they can be recomputed from fps).
 */
export function summarize(
  mode: string,
  times: number[],
  fps?: number,
): ClipSummary | null {
  const dt = fps ? frameSeconds(fps) : undefined;
  if (mode === "approach-jump" || mode === "depth-jump") {
    const m = mode === "approach-jump" ? approachMetrics(times) : depthMetrics(times);
    if (!m) return null;
    return {
      value: m.jumpIn,
      kind: "height",
      sub: `GCT ${Math.round(m.contactMs)} ms`,
      stats: [
        { label: "Ground contact", value: m.contactMs, kind: "ms", err: dt && dt * 1000 },
        { label: "Airtime", value: m.airtime, kind: "s", err: dt },
        ...(m.penultimateSec !== undefined
          ? [{ label: "Penultimate step", value: m.penultimateSec, kind: "s" as const, err: dt }]
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
        {
          label: "Avg contact",
          value: avgContact * 1000,
          kind: "ms",
          err: dt && meanErr(dt * 1000, jumps.length),
        },
        { label: "Avg flight", value: avgFlight, kind: "s", err: dt && meanErr(dt, jumps.length) },
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

export function formatStat(
  stat: ClipStat,
  unit: HeightUnit,
  showErr = false,
): string {
  if (showErr && stat.err !== undefined) {
    const scale = stat.kind === "height" && unit === "cm" ? 2.54 : 1;
    const v = withError(stat.value * scale, stat.err * scale);
    const suffix =
      stat.kind === "ms" ? " ms" : stat.kind === "s" ? " s" : stat.kind === "height" ? ` ${unit}` : "";
    return `${v.value} ± ${v.err}${suffix}`;
  }
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
