import { contactJumpErrors, depthMetrics } from "../../lib/metrics";
import { useShowErrors } from "../../lib/store";
import type { Keyframe } from "../types";
import { GroundContactCard, JumpHeightCard } from "./jump-cards";

interface DepthJumpPanelProps {
  keyframes: Keyframe[];
  fps: number;
}

export function DepthJumpPanel({ keyframes, fps }: DepthJumpPanelProps) {
  const showErrors = useShowErrors();
  if (keyframes.length < 3) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Capture 3 keyframes — ground contact, takeoff, then landing.
      </div>
    );
  }

  // Uses the first three keyframes in time order (already sorted upstream).
  const m = depthMetrics(keyframes.map((k) => k.time))!;
  const { contactMs, airtime, jumpIn } = m;
  const err = showErrors ? contactJumpErrors(m, fps) : undefined;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <GroundContactCard contactMs={contactMs} err={err?.contactMs} />
      <JumpHeightCard
        jumpIn={jumpIn}
        airtime={airtime}
        err={err?.jumpIn}
        airtimeErr={err?.airtime}
      />
    </div>
  );
}
