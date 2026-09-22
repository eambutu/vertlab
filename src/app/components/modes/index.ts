import type { ComponentType } from "react";
import type { Keyframe } from "../types";
import { ApproachJumpPanel } from "./approach-jump-panel";
import { DepthJumpPanel } from "./depth-jump-panel";
import { TenFiveRsiPanel } from "./ten-five-rsi-panel";

export interface AnalysisMode {
  id: string;
  label: string;
  /** Minimum captured keyframes required before the mode can run. */
  minFrames: number;
  /** Short hint shown under the Keyframes heading when this mode is active. */
  hint: string;
  /** Label for the keyframe at a given index, shown in the strip. */
  labelForFrame?: (index: number) => string | undefined;
  Panel: ComponentType<{ keyframes: Keyframe[] }>;
}

const APPROACH_JUMP_LABELS = ["Penultimate", "Contact", "Takeoff", "Landing"];

const approachJumpMode: AnalysisMode = {
  id: "approach-jump",
  label: "Approach jump",
  minFrames: 4,
  hint: "First 4 frames used automatically",
  labelForFrame: (i) => APPROACH_JUMP_LABELS[i],
  Panel: ApproachJumpPanel,
};

const DEPTH_JUMP_LABELS = ["Contact", "Takeoff", "Landing"];

const depthJumpMode: AnalysisMode = {
  id: "depth-jump",
  label: "Depth jump",
  minFrames: 3,
  hint: "First 3 frames used automatically",
  labelForFrame: (i) => DEPTH_JUMP_LABELS[i],
  Panel: DepthJumpPanel,
};

// Keyframes alternate landing / takeoff, starting with the initial landing.
function rsiLabel(i: number): string {
  if (i === 0) return "Initial landing";
  const jump = i % 2 === 1 ? (i + 1) / 2 : i / 2;
  return i % 2 === 1 ? `Jump ${jump} takeoff` : `Jump ${jump} landing`;
}

const tenFiveRsiMode: AnalysisMode = {
  id: "ten-five-rsi",
  label: "10-5 RSI",
  minFrames: 3,
  hint: "Capture landing, takeoff, landing … ending on a landing",
  labelForFrame: rsiLabel,
  Panel: TenFiveRsiPanel,
};

export const MODES: AnalysisMode[] = [
  approachJumpMode,
  depthJumpMode,
  tenFiveRsiMode,
];
