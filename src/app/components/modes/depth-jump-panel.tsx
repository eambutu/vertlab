import { depthMetrics } from "../../lib/metrics";
import type { Keyframe } from "../types";
import { GroundContactCard, JumpHeightCard } from "./jump-cards";

interface DepthJumpPanelProps {
  keyframes: Keyframe[];
}

export function DepthJumpPanel({ keyframes }: DepthJumpPanelProps) {
  if (keyframes.length < 3) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Capture 3 keyframes — ground contact, takeoff, then landing.
      </div>
    );
  }

  // Uses the first three keyframes in time order (already sorted upstream).
  const { contactMs, airtime, jumpIn } = depthMetrics(
    keyframes.map((k) => k.time),
  )!;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <GroundContactCard contactMs={contactMs} />
      <JumpHeightCard jumpIn={jumpIn} airtime={airtime} />
    </div>
  );
}
