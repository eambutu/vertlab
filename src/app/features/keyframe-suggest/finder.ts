// Finds each event of an analysis mode and proposes 4 consecutive frames for it.
//
// 1. Coarse: pose tracking at ~60 samples/s gives foot heights over time.
//    From those we find when both feet are in the air, which foot struck
//    when, and so roughly where each event is.
// 2. Fine: around each coarse event, every frame is read and a small box
//    around the foot is compared frame to frame. A foot arriving shows as
//    motion that stops; a foot leaving as motion that starts. The best frame
//    and its neighbours become the 4 candidates.
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { keyframeLabel } from "../../lib/metrics";
import { FrameReader } from "./frames";
import { detectPoses, loadPose, LM, resetPoseTrack } from "./pose";

export type EventKind = "arrival" | "departure";

export interface Candidate {
  frame: number;
  time: number;
  image?: string;
}

export interface SuggestedEvent {
  label: string;
  kind: EventKind;
  found: boolean;
  /** 4 consecutive frames; empty when the event wasn't found. */
  candidates: Candidate[];
  /** Index into candidates of the best guess. */
  suggested: number;
  confident: boolean;
  /** Where the foot is (0–1 of the frame), for the zoomed view. */
  focus?: { x: number; y: number };
}

export type FindResult =
  | { ok: true; events: SuggestedEvent[] }
  | { ok: false; reason: string };

export interface FindOptions {
  url: string;
  mode: string;
  fps: number;
  signal?: AbortSignal;
  onProgress?: (stage: string, fraction: number) => void;
  /** Skip candidate images (the accuracy test doesn't need them). */
  withImages?: boolean;
}

const POSE_WIDTH = 384;
const COARSE_RATE = 60; // pose samples per second of video
const IMAGE_WIDTH = 540;
const CROP_SIZE = 48;
const WINDOW = 4;

// Heights are measured in leg lengths (hip to ankle), so they hold for any
// framing. A foot is "down" below ON and "up" above OFF (hysteresis).
const ON = 0.06;
const OFF = 0.12;
const MIN_FLIGHT = 0.12;

/* ------------------------------------------------------------ tracking */

type Foot = 0 | 1; // left, right

export interface Body {
  x: [number, number];
  y: [number, number]; // lowest point of each foot (heel or toe), 0–1 down
  hip: { x: number; y: number };
  legLen: number; // in units of frame height
}

interface Track {
  n: number;
  x: [number[], number[]];
  y: [number[], number[]];
  legLen: number;
  /** Foot height above the ground, in leg lengths. */
  h: [number[], number[]];
  on: [boolean[], boolean[]];
}

function bodyFrom(lm: NormalizedLandmark[], aspect: number): Body {
  const foot = (heel: number, toe: number) => ({
    x: (lm[heel].x + lm[toe].x) / 2,
    y: Math.max(lm[heel].y, lm[toe].y),
  });
  const l = foot(LM.leftHeel, LM.leftToe);
  const r = foot(LM.rightHeel, LM.rightToe);
  const leg = (hip: number, ankle: number) =>
    Math.hypot((lm[hip].x - lm[ankle].x) * aspect, lm[hip].y - lm[ankle].y);
  return {
    x: [l.x, r.x],
    y: [l.y, r.y],
    hip: {
      x: (lm[LM.leftHip].x + lm[LM.rightHip].x) / 2,
      y: (lm[LM.leftHip].y + lm[LM.rightHip].y) / 2,
    },
    legLen: (leg(LM.leftHip, LM.leftAnkle) + leg(LM.rightHip, LM.rightAnkle)) / 2,
  };
}

/** The athlete: the person nearest the last one we followed, else the biggest. */
function pickBody(
  poses: NormalizedLandmark[][],
  prev: Body | null,
  aspect: number,
): Body | null {
  const bodies = poses.map((lm) => bodyFrom(lm, aspect)).filter((b) => b.legLen > 0.04);
  if (!bodies.length) return null;
  if (prev) {
    return bodies.reduce((a, b) =>
      Math.hypot(a.hip.x - prev.hip.x, a.hip.y - prev.hip.y) <=
      Math.hypot(b.hip.x - prev.hip.x, b.hip.y - prev.hip.y)
        ? a
        : b,
    );
  }
  return bodies.reduce((a, b) => (a.legLen >= b.legLen ? a : b));
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

function smooth(values: number[]): number[] {
  const med = values.map((_, i) => {
    const w = values.slice(Math.max(0, i - 1), i + 2);
    return quantile(w, 0.5);
  });
  return med.map((_, i) => {
    const w = med.slice(Math.max(0, i - 1), i + 2);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
}

/** Fills gaps by linear interpolation; null if too little was seen. */
function fill(values: (number | null)[]): number[] | null {
  const known = values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
  if (known.length < Math.max(4, values.length * 0.5)) return null;
  return values.map((v, i) => {
    if (v != null) return v;
    const before = [...known].reverse().find((k) => k < i);
    const after = known.find((k) => k > i);
    if (before == null) return values[after!]!;
    if (after == null) return values[before]!;
    const t = (i - before) / (after - before);
    return values[before]! * (1 - t) + values[after]! * t;
  });
}

/**
 * Ground height as a line across the frame: the 90th percentile of foot
 * heights per horizontal band, so a camera that isn't quite level still works.
 */
function groundLine(
  xs: number[],
  ys: number[],
  legLen: number,
): (x: number) => number {
  const flat = quantile(ys, 0.9);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (hi - lo < 0.15) return () => flat;
  const BINS = 8;
  const pts: [number, number][] = [];
  for (let b = 0; b < BINS; b++) {
    const a = lo + ((hi - lo) * b) / BINS;
    const z = lo + ((hi - lo) * (b + 1)) / BINS;
    const inBin = ys.filter((_, i) => xs[i] >= a && xs[i] <= z);
    // Bands where the feet never reach the floor (standing on a box) would
    // tilt the line; only fit through bands near the overall floor.
    const level = inBin.length >= 3 ? quantile(inBin, 0.9) : NaN;
    if (Math.abs(level - flat) < 0.25 * legLen) pts.push([(a + z) / 2, level]);
  }
  if (pts.length < 2) return () => flat;
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const slope = sxx > 0 ? sxy / sxx : 0;
  return (x) => my + slope * (x - mx);
}

export function buildTrack(raw: (Body | null)[]): Track | null {
  const cols = (pick: (b: Body) => number) => fill(raw.map((b) => (b ? pick(b) : null)));
  const xl = cols((b) => b.x[0]);
  const xr = cols((b) => b.x[1]);
  const yl = cols((b) => b.y[0]);
  const yr = cols((b) => b.y[1]);
  if (!xl || !xr || !yl || !yr) return null;
  const legLen = quantile(
    raw.filter((b): b is Body => !!b).map((b) => b.legLen),
    0.5,
  );
  const y: [number[], number[]] = [smooth(yl), smooth(yr)];
  const x: [number[], number[]] = [smooth(xl), smooth(xr)];
  const ground = groundLine([...x[0], ...x[1]], [...y[0], ...y[1]], legLen);
  const h = [0, 1].map((f) =>
    y[f].map((yy, i) => (ground(x[f][i]) - yy) / legLen),
  ) as [number[], number[]];
  const on = h.map((hs) => {
    let down = hs[0] < (ON + OFF) / 2;
    return hs.map((v) => {
      if (down && v > OFF) down = false;
      else if (!down && v < ON) down = true;
      return down;
    });
  }) as [boolean[], boolean[]];
  return { n: raw.length, x, y, legLen, h, on };
}

/* -------------------------------------------------------------- events */

interface Flight {
  start: number; // first sample with both feet up
  end: number; // last sample with both feet up
  peak: number;
}

interface CoarseEvent {
  label: string;
  kind: EventKind;
  /** departure: last sample on the ground; arrival: first sample back down. */
  sample: number;
  foot: Foot;
}

function flights(t: Track): Flight[] {
  const out: Flight[] = [];
  let start = -1;
  for (let k = 0; k <= t.n; k++) {
    const up = k < t.n && !t.on[0][k] && !t.on[1][k];
    if (up && start < 0) start = k;
    if (!up && start >= 0) {
      const end = k - 1;
      let peak = 0;
      for (let j = start; j <= end; j++) peak = Math.max(peak, Math.min(t.h[0][j], t.h[1][j]));
      if (end - start + 1 >= 2 && peak >= MIN_FLIGHT) out.push({ start, end, peak });
      start = -1;
    }
  }
  return out;
}

/** Samples where a foot comes down, in time order. */
function strikes(t: Track): { sample: number; foot: Foot }[] {
  const out: { sample: number; foot: Foot }[] = [];
  for (let k = 1; k < t.n; k++) {
    for (const f of [0, 1] as Foot[]) {
      if (t.on[f][k] && !t.on[f][k - 1]) out.push({ sample: k, foot: f });
    }
  }
  return out.sort((a, b) => a.sample - b.sample);
}

const lowerFoot = (t: Track, k: number): Foot => (t.h[0][k] <= t.h[1][k] ? 0 : 1);

function takeoffOf(t: Track, f: Flight, label: string): CoarseEvent | null {
  // "Up" needs a clearly raised foot, which lags the real takeoff; walk back
  // to the last sample a foot was truly on the floor.
  let k = f.start - 1;
  while (k > 0 && Math.min(t.h[0][k], t.h[1][k]) >= ON) k--;
  return k >= 0 ? { label, kind: "departure", sample: k, foot: lowerFoot(t, k) } : null;
}

function landingOf(t: Track, f: Flight, label: string): CoarseEvent | null {
  const k = f.end + 1;
  return k < t.n ? { label, kind: "arrival", sample: k, foot: lowerFoot(t, k) } : null;
}

/** Event list for a mode; null entries are events we couldn't place. */
export function coarseEvents(
  mode: string,
  t: Track,
): { label: string; kind: EventKind; event: CoarseEvent | null }[] {
  const fl = flights(t);
  const st = strikes(t);
  const label = (i: number) => keyframeLabel(mode, i) ?? `Keyframe ${i + 1}`;
  const slot = (i: number, kind: EventKind, event: CoarseEvent | null) => ({
    label: label(i),
    kind,
    event: event ? { ...event, label: label(i) } : null,
  });
  const biggest = (list: Flight[]) =>
    list.length ? list.reduce((a, b) => (b.peak > a.peak ? b : a)) : null;
  const lastStrikeBefore = (sample: number, notFoot?: Foot) =>
    [...st].reverse().find((s) => s.sample < sample && (notFoot == null || s.foot !== notFoot));
  const strikeEvent = (s: { sample: number; foot: Foot } | undefined, name: string) =>
    s ? ({ label: name, kind: "arrival", sample: s.sample, foot: s.foot } as CoarseEvent) : null;

  if (mode === "approach-jump") {
    const main = biggest(fl);
    const contact = main ? lastStrikeBefore(main.start) : undefined;
    const penultimate = contact
      ? lastStrikeBefore(contact.sample, contact.foot) ?? lastStrikeBefore(contact.sample)
      : undefined;
    return [
      slot(0, "arrival", strikeEvent(penultimate, "")),
      slot(1, "arrival", strikeEvent(contact, "")),
      slot(2, "departure", main && takeoffOf(t, main, "")),
      slot(3, "arrival", main && landingOf(t, main, "")),
    ];
  }

  if (mode === "depth-jump") {
    // With a drop off the box first, the jump is the biggest flight after it.
    const main = fl.length >= 2 ? biggest(fl.slice(1)) : biggest(fl);
    const before = main ? fl[fl.indexOf(main) - 1] : undefined;
    const contact = before
      ? landingOf(t, before, "")
      : main
        ? strikeEvent(lastStrikeBefore(main.start), "")
        : null;
    return [
      slot(0, "arrival", contact),
      slot(1, "departure", main && takeoffOf(t, main, "")),
      slot(2, "arrival", main && landingOf(t, main, "")),
    ];
  }

  if (mode === "ten-five-rsi") {
    if (!fl.length) return [slot(0, "arrival", null)];
    const out = [slot(0, "arrival", landingOf(t, fl[0], ""))];
    for (const f of fl.slice(1)) {
      out.push(slot(out.length, "departure", takeoffOf(t, f, "")));
      out.push(slot(out.length, "arrival", landingOf(t, f, "")));
    }
    return out;
  }

  return [];
}

/* ---------------------------------------------------------- refinement */

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

async function refine(
  reader: FrameReader,
  t: Track,
  ev: CoarseEvent,
  stride: number,
  minFrame: number,
  withImages: boolean,
  signal?: AbortSignal,
): Promise<Omit<SuggestedEvent, "label" | "kind" | "found">> {
  const F = (k: number) => k * stride;
  // The true frame lies between the last sample on one side of the change
  // and the first sample on the other.
  const [a, b] =
    ev.kind === "departure"
      ? [F(ev.sample), F(Math.min(t.n - 1, ev.sample + 1)) - 1]
      : [F(Math.max(0, ev.sample - 1)) + 1, F(ev.sample)];
  const center = (a + Math.max(a, b)) / 2;
  const pad = 2 + stride;
  const lo = reader.clampFrame(Math.max(minFrame, a - pad));
  const hi = reader.clampFrame(Math.max(lo, b + pad));

  // A square box around the foot, a bit more above it than below.
  const fx = t.x[ev.foot][ev.sample];
  const fy = t.y[ev.foot][ev.sample];
  const side = Math.max(24, 0.7 * t.legLen * reader.height);
  const box = {
    x: Math.max(0, Math.min(reader.width - side, fx * reader.width - side / 2)),
    y: Math.max(0, Math.min(reader.height - side, fy * reader.height - side * 0.7)),
    w: Math.min(side, reader.width),
    h: Math.min(side, reader.height),
  };

  const canvas = document.createElement("canvas");
  canvas.width = CROP_SIZE;
  canvas.height = CROP_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const gray = new Map<number, Float32Array>();
  const images = new Map<number, string>();

  const read = async (f: number) => {
    await reader.seek(f);
    reader.draw(ctx, CROP_SIZE, CROP_SIZE, box);
    const px = ctx.getImageData(0, 0, CROP_SIZE, CROP_SIZE).data;
    const g = new Float32Array(CROP_SIZE * CROP_SIZE);
    for (let i = 0; i < g.length; i++) {
      g[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
    }
    gray.set(f, g);
    if (withImages) images.set(f, reader.snapshot(IMAGE_WIDTH));
  };

  for (let f = Math.max(0, lo - 1); f <= Math.min(reader.frameCount - 1, hi + 2); f++) {
    abortIfNeeded(signal);
    await read(f);
  }

  // motion[f]: how much the foot box changed from frame f-1 to f.
  const motion = (f: number) => {
    const p = gray.get(f - 1);
    const c = gray.get(f);
    if (!p || !c) return 0;
    let s = 0;
    for (let i = 0; i < c.length; i++) s += Math.abs(c[i] - p[i]);
    return s / c.length;
  };
  const m = new Map<number, number>();
  for (let f = lo - 1; f <= hi + 2; f++) m.set(f, motion(f));
  const mv = (f: number) => m.get(f) ?? 0;
  const values = [...m.values()];
  const range = Math.max(...values) - Math.min(...values);

  const score = (e: number) => {
    const before = (mv(e - 1) + mv(e)) / 2; // motion arriving at e
    const after = (mv(e + 1) + mv(e + 2)) / 2; // motion leaving e
    const raw = ev.kind === "arrival" ? before - after : after - before;
    const off = Math.max(0, Math.abs(e - center) - (b - a) / 2);
    return raw - (0.25 * range * off) / (stride + pad);
  };

  let best = Math.round(Math.max(lo, Math.min(hi, center)));
  let confident = false;
  if (range > 1) {
    const scores = new Map<number, number>();
    for (let e = lo; e <= hi; e++) scores.set(e, score(e));
    best = [...scores.entries()].reduce((x, y) => (y[1] > x[1] ? y : x))[0];
    const others = [...scores.entries()].filter(([e]) => Math.abs(e - best) >= 2).map(([, s]) => s);
    const runnerUp = others.length ? Math.max(...others) : -Infinity;
    confident = scores.get(best)! - runnerUp >= 0.2 * range;
  }

  // Best guess second of four: misses are about as likely early as late.
  const start = Math.max(minFrame, Math.min(reader.frameCount - WINDOW, best - 1));
  const frames = Array.from({ length: WINDOW }, (_, i) => reader.clampFrame(start + i));
  for (const f of frames) {
    if (withImages && !images.has(f)) await read(f);
  }

  return {
    candidates: frames.map((f) => ({
      frame: f,
      time: reader.timeOf(f),
      image: images.get(f),
    })),
    suggested: Math.max(0, Math.min(WINDOW - 1, best - start)),
    confident,
    focus: { x: fx, y: Math.max(0, fy - 0.02) },
  };
}

/* ---------------------------------------------------------------- main */

export async function findKeyframes(opts: FindOptions): Promise<FindResult> {
  const { url, mode, fps, signal, withImages = true } = opts;
  const progress = opts.onProgress ?? (() => {});

  progress("Loading the pose model", 0);
  try {
    await loadPose();
  } catch {
    return { ok: false, reason: "Couldn't load the pose model. Check your connection and try again." };
  }
  abortIfNeeded(signal);

  let reader: FrameReader;
  try {
    reader = await FrameReader.open(url, fps);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "This video couldn't be read." };
  }

  try {
    resetPoseTrack();
    const stride = Math.max(1, Math.round(fps / COARSE_RATE));
    const aspect = reader.width / reader.height;
    const pw = POSE_WIDTH;
    const ph = Math.round(pw / aspect);
    const canvas = document.createElement("canvas");
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext("2d")!;

    const raw: (Body | null)[] = [];
    let prev: Body | null = null;
    const samples = Math.ceil(reader.frameCount / stride);
    for (let k = 0; k < samples; k++) {
      abortIfNeeded(signal);
      await reader.seek(k * stride);
      reader.draw(ctx, pw, ph);
      const body = pickBody(await detectPoses(canvas), prev, aspect);
      raw.push(body);
      if (body) prev = body;
      progress("Finding the athlete", 0.05 + 0.65 * ((k + 1) / samples));
    }

    const track = buildTrack(raw);
    if (!track) {
      return { ok: false, reason: "Couldn't find a person clearly in this video." };
    }

    const coarse = coarseEvents(mode, track);
    if (!coarse.some((c) => c.event)) {
      return {
        ok: false,
        reason: "Couldn't see the feet leave the ground. A side-on clip with the feet in view works best.",
      };
    }

    const events: SuggestedEvent[] = [];
    let minFrame = 0;
    for (let i = 0; i < coarse.length; i++) {
      const c = coarse[i];
      progress("Pinpointing frames", 0.7 + 0.3 * (i / coarse.length));
      if (!c.event) {
        events.push({ label: c.label, kind: c.kind, found: false, candidates: [], suggested: 0, confident: false });
        continue;
      }
      const r = await refine(reader, track, c.event, stride, minFrame, withImages, signal);
      events.push({ label: c.label, kind: c.kind, found: true, ...r });
      minFrame = r.candidates[r.suggested].frame + 1;
    }
    progress("Done", 1);
    return { ok: true, events };
  } finally {
    reader.close();
  }
}
