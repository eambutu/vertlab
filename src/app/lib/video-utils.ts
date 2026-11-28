// Pure helpers for time formatting and frame differencing.

/** Format seconds into mm:ss.mmm (millisecond precision). */
export function formatTimecode(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/** Full millisecond value of a time in seconds, kept to one decimal of a ms. */
export function preciseMs(seconds: number): string {
  return (seconds * 1000).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

// Common real-world frame rates we snap a noisy measurement to.
const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];

/** Snap a measured rate to the nearest common fps when close, else round to 2dp. */
export function snapFps(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 30;
  let best = raw;
  let bestDist = Infinity;
  for (const c of COMMON_FPS) {
    const d = Math.abs(c - raw);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  // Only snap if the measurement is within ~0.6 fps of a common rate.
  if (bestDist <= 0.6) return best;
  return Math.round(raw * 100) / 100;
}

/**
 * Measure a video's true frame rate using requestVideoFrameCallback.
 * Plays muted from the start, samples the mediaTime of presented frames,
 * then restores the original position. Falls back to 30 when unsupported.
 */
export function detectFps(video: HTMLVideoElement): Promise<number> {
  return new Promise((resolve) => {
    const anyVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
    };
    if (typeof anyVideo.requestVideoFrameCallback !== "function") {
      resolve(30);
      return;
    }

    const SAMPLES = 24;
    const deltas: number[] = [];
    let lastMediaTime: number | null = null;
    const startTime = video.currentTime;
    const wasMuted = video.muted;
    let settled = false;
    let callbackId: number;

    const finish = (fps: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      anyVideo.cancelVideoFrameCallback?.(callbackId);
      video.pause();
      video.muted = wasMuted;
      try {
        video.currentTime = startTime;
      } catch {
        /* ignore */
      }
      resolve(fps);
    };

    const computeFps = () => {
      const positive = deltas.filter((d) => d > 0).sort((a, b) => a - b);
      if (positive.length === 0) return 30;
      const median = positive[Math.floor(positive.length / 2)];
      return snapFps(1 / median);
    };

    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (settled) return;
      if (lastMediaTime !== null) deltas.push(meta.mediaTime - lastMediaTime);
      lastMediaTime = meta.mediaTime;
      if (deltas.length >= SAMPLES) {
        finish(computeFps());
        return;
      }
      callbackId = anyVideo.requestVideoFrameCallback!(onFrame);
    };

    // Safety net: never hang if playback can't start.
    const timeout = setTimeout(() => finish(deltas.length ? computeFps() : 30), 4000);

    video.muted = true;
    callbackId = anyVideo.requestVideoFrameCallback!(onFrame);
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => finish(30));
    }
  });
}

/**
 * Interpret an airtime (in seconds) as the hang time of a vertical jump and
 * return the implied peak height in inches. For a projectile launched straight
 * up, time-to-apex is t/2, so peak height h = ½·g·(t/2)² = g·t²/8.
 */
export function jumpHeightInches(airtimeSeconds: number): number {
  if (!isFinite(airtimeSeconds) || airtimeSeconds <= 0) return 0;
  const G = 9.81; // m/s²
  const meters = (G * airtimeSeconds * airtimeSeconds) / 8;
  return meters * 39.3701; // metres → inches
}

export interface DiffResult {
  /** Percentage of pixels that changed beyond the threshold (0-100). */
  changedPercent: number;
  /** Mean per-channel absolute difference across the whole frame (0-255). */
  meanDelta: number;
  /** Data URL of a heatmap visualizing where the change happened. */
  heatmapUrl: string;
}

/**
 * Compute the visual difference between two equally-sized ImageData frames.
 * Produces a red-tinted heatmap highlighting regions that changed.
 */
export function diffFrames(
  a: ImageData,
  b: ImageData,
  threshold = 24,
): DiffResult {
  const len = Math.min(a.data.length, b.data.length);
  const width = a.width;
  const height = a.height;
  const out = new Uint8ClampedArray(width * height * 4);

  let changed = 0;
  let totalDelta = 0;
  const pixels = len / 4;

  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const delta = (dr + dg + db) / 3;
    totalDelta += delta;

    if (delta > threshold) changed++;

    // Heatmap: dim grayscale base of frame B, with red overlay where it changed.
    const gray = (b.data[i] * 0.3 + b.data[i + 1] * 0.59 + b.data[i + 2] * 0.11) * 0.35;
    const intensity = Math.min(255, delta * 3);
    out[i] = Math.min(255, gray + intensity); // R boosted by change
    out[i + 1] = gray * (1 - intensity / 255);
    out[i + 2] = gray * (1 - intensity / 255);
    out[i + 3] = 255;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(out, width, height), 0, 0);

  return {
    changedPercent: (changed / pixels) * 100,
    meanDelta: totalDelta / pixels,
    heatmapUrl: canvas.toDataURL("image/png"),
  };
}
