import { approachMetrics, contactJumpErrors } from "../../lib/metrics";
import { useShowErrors } from "../../lib/store";
import type { Keyframe } from "../types";
import {
  GroundContactCard,
  JumpHeightCard,
  PenultimateStepCard,
} from "./jump-cards";

interface ApproachJumpPanelProps {
  /** Only the times are used, so the shared viewer can pass plain times. */
  keyframes: Pick<Keyframe, "time">[];
  fps: number;
}

export function ApproachJumpPanel({ keyframes, fps }: ApproachJumpPanelProps) {
  const showErrors = useShowErrors();
  if (keyframes.length < 4) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Capture 4 keyframes — penultimate step, ground contact, takeoff, then
        landing.
      </div>
    );
  }

  // Uses the first four keyframes in time order (already sorted upstream).
  const m = approachMetrics(keyframes.map((k) => k.time))!;
  const { penultimateSec, contactMs, airtime, jumpIn } = m;
  const err = showErrors ? contactJumpErrors(m, fps) : undefined;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <PenultimateStepCard seconds={penultimateSec!} err={err?.penultimateSec} />
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
