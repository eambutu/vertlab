// MediaPipe Pose Landmarker, loaded on first use (~6 MB the first time,
// cached by the browser afterwards).
import type { NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision";

declare const __POSE_RUNTIME_VERSION__: string;
const WASM_URL = `/pose-runtime/${__POSE_RUNTIME_VERSION__}`;
const LOAD_TIMEOUT_MS = 30_000;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

let landmarker: Promise<PoseLandmarker> | null = null;
// VIDEO mode needs strictly increasing timestamps for the landmarker's whole
// life, across clips too.
let clock = 0;

async function create(signal: AbortSignal): Promise<PoseLandmarker> {
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const response = await fetch(MODEL_URL, { signal });
  if (!response.ok) throw new Error("Pose model download failed");
  const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetBuffer, delegate },
    runningMode: "VIDEO" as const,
    numPoses: 2,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    signal.throwIfAborted();
    return PoseLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

export function loadPose(): Promise<PoseLandmarker> {
  if (!landmarker) {
    const controller = new AbortController();
    landmarker = new Promise<PoseLandmarker>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new DOMException("The pose model took too long to load. Try again, or capture the frames manually.", "TimeoutError"));
      }, LOAD_TIMEOUT_MS);
      create(controller.signal).then(pose => {
        if (controller.signal.aborted) pose.close();
        else resolve(pose);
      }, reject).finally(() => clearTimeout(timer));
    }).catch(error => {
      landmarker = null;
      throw error;
    });
  }
  return landmarker;
}

/** Poses in this image, in normalized (0–1) image coordinates. */
export async function detectPoses(
  image: HTMLCanvasElement,
): Promise<NormalizedLandmark[][]> {
  const pose = await loadPose();
  clock += 34; // any increasing value works; keep it frame-sized
  return pose.detectForVideo(image, clock).landmarks;
}

/** Starts a fresh track (a new clip) so smoothing doesn't carry over. */
export function resetPoseTrack() {
  clock += 10_000;
}

// Landmark indices (MediaPipe BlazePose topology).
export const LM = {
  leftHip: 23,
  rightHip: 24,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftToe: 31,
  rightToe: 32,
} as const;
