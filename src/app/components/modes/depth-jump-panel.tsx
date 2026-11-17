import {
  bestRepIndex,
  contactJumpErrors,
  depthMetrics,
  depthReps,
  frameSeconds,
  heightErrInches,
  withError,
} from "../../lib/metrics";
import { useShowErrors } from "../../lib/store";
import type { Keyframe } from "../types";
import { GroundContactCard, JumpHeightCard } from "./jump-cards";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

interface DepthJumpPanelProps {
  keyframes: Keyframe[];
  fps: number;
  /** Reps in the video; each one is contact, takeoff, landing. */
  reps: number;
}

function Num({ value, err, plain }: { value: number; err?: number; plain: string }) {
  if (err === undefined) return <>{plain}</>;
  const v = withError(value, err);
  return (
    <>
      {v.value}
      <span className="text-muted-foreground"> ± {v.err}</span>
    </>
  );
}

export function DepthJumpPanel({ keyframes, fps, reps }: DepthJumpPanelProps) {
  const showErrors = useShowErrors();
  const times = keyframes.map((k) => k.time);

  if (keyframes.length < 3) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {reps === 1
          ? "Capture 3 keyframes — ground contact, takeoff, then landing."
          : `Capture ground contact, takeoff and landing for each rep — ${reps * 3} keyframes for ${reps} reps.`}
      </div>
    );
  }

  if (reps === 1) {
    // Uses the first three keyframes in time order (already sorted upstream).
    const m = depthMetrics(times)!;
    const err = showErrors ? contactJumpErrors(m, fps) : undefined;
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <GroundContactCard contactMs={m.contactMs} err={err?.contactMs} />
        <JumpHeightCard
          jumpIn={m.jumpIn}
          airtime={m.airtime}
          err={err?.jumpIn}
          airtimeErr={err?.airtime}
        />
      </div>
    );
  }

  const done = depthReps(times, reps);
  const bestIdx = bestRepIndex(done);
  const best = done[bestIdx];
  const bestErr = showErrors ? contactJumpErrors(best, fps) : undefined;
  const dt = showErrors ? frameSeconds(fps) : undefined;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Best rep (rep {bestIdx + 1}) · {done.length} of {reps} reps captured
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <GroundContactCard contactMs={best.contactMs} err={bestErr?.contactMs} />
        <JumpHeightCard
          jumpIn={best.jumpIn}
          airtime={best.airtime}
          err={bestErr?.jumpIn}
          airtimeErr={bestErr?.airtime}
        />
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rep</TableHead>
              <TableHead className="text-right">Contact (ms)</TableHead>
              <TableHead className="text-right">Height (in)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {done.map((m, i) => (
              <TableRow key={i} className={i === bestIdx ? "bg-accent/60" : ""}>
                <TableCell className="font-mono tabular-nums">
                  {i + 1}
                  {i === bestIdx && (
                    <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                      best
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  <Num
                    value={m.contactMs}
                    err={dt && dt * 1000}
                    plain={m.contactMs.toFixed(1)}
                  />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  <Num
                    value={m.jumpIn}
                    err={dt && heightErrInches(m.airtime, dt)}
                    plain={m.jumpIn.toFixed(2)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
