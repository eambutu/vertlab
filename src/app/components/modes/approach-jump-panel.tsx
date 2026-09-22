import { jumpHeightInches } from "../../lib/video-utils";
import type { Keyframe } from "../types";
import {
  GroundContactCard,
  JumpHeightCard,
  PenultimateStepCard,
} from "./jump-cards";

interface ApproachJumpPanelProps {
  keyframes: Keyframe[];
}

export function ApproachJumpPanel({ keyframes }: ApproachJumpPanelProps) {
  if (keyframes.length < 4) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Capture 4 keyframes — penultimate step, ground contact, takeoff, then
        landing.
      </div>
    );
  }

  // Uses the first four keyframes in time order (already sorted upstream).
  const [penultimate, contact, takeoff, landing] = keyframes;
  const penultimateSec = contact.time - penultimate.time;
  const contactMs = (takeoff.time - contact.time) * 1000;
  const airtime = landing.time - takeoff.time;
  const jumpIn = jumpHeightInches(airtime);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <PenultimateStepCard seconds={penultimateSec} />
      <GroundContactCard contactMs={contactMs} />
      <JumpHeightCard jumpIn={jumpIn} airtime={airtime} />
    </div>
  );
}
