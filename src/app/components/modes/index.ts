import type { ComponentType } from "react";
import type { Keyframe } from "../types";
import { keyframeLabel } from "../../lib/metrics";
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
  Panel: ComponentType<{ keyframes: Pick<Keyframe, "time">[]; fps: number; reps: number }>;
}

const approachJumpMode: AnalysisMode = {
  id: "approach-jump",
  label: "Approach jump",
  minFrames: 4,
  hint: "First 4 frames used automatically",
  labelForFrame: (i) => keyframeLabel("approach-jump", i),
  Panel: ApproachJumpPanel,
};

const depthJumpMode: AnalysisMode = {
  id: "depth-jump",
  label: "Depth jump",
  minFrames: 3,
  hint: "First 3 frames used automatically",
  labelForFrame: (i) => keyframeLabel("depth-jump", i),
  Panel: DepthJumpPanel,
};

const tenFiveRsiMode: AnalysisMode = {
  id: "ten-five-rsi",
  label: "10-5 RSI",
  minFrames: 3,
  hint: "Capture landing, takeoff, landing … ending on a landing",
  labelForFrame: (i) => keyframeLabel("ten-five-rsi", i),
  Panel: TenFiveRsiPanel,
};

export const MODES: AnalysisMode[] = [
  approachJumpMode,
  depthJumpMode,
  tenFiveRsiMode,
];
