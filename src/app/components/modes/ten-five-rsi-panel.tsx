import { Zap } from "lucide-react";
import type { Keyframe } from "../types";
import {
  RSI_TOP_N as TOP_N,
  frameSeconds,
  rsiBestAvgErr,
  rsiErr,
  rsiJumps,
  rsiTop,
  withError,
} from "../../lib/metrics";
import { useShowErrors } from "../../lib/store";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

interface TenFiveRsiPanelProps {
  /** Only the times are used, so the shared viewer can pass plain times. */
  keyframes: Pick<Keyframe, "time">[];
  fps: number;
}

/** "2.50" or "2.50 ± 0.32" in muted ± text. */
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

export function TenFiveRsiPanel({ keyframes, fps }: TenFiveRsiPanelProps) {
  const showErrors = useShowErrors();
  const jumps = rsiJumps(keyframes.map((k) => k.time));

  if (jumps.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Capture keyframes in order — landing, takeoff, landing, takeoff … ending
        on a landing. Each completed jump needs a landing, a takeoff, and the
        next landing.
      </div>
    );
  }

  // The 10-5 test scores your best 5.
  const { topIds, bestAvg } = rsiTop(jumps);
  const dt = showErrors ? frameSeconds(fps) : undefined;
  const bestAvgErr = showErrors ? rsiBestAvgErr(jumps, topIds, fps) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-foreground">
          <Zap className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            RSI · average of best {Math.min(TOP_N, jumps.length)}
          </p>
          <p className="font-mono tabular-nums">
            <span className="text-xl">
              <Num value={bestAvg} err={bestAvgErr} plain={bestAvg.toFixed(2)} />
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              {jumps.length} jump{jumps.length === 1 ? "" : "s"} captured
            </span>
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jump</TableHead>
              <TableHead className="text-right">Contact (ms)</TableHead>
              <TableHead className="text-right">Flight (ms)</TableHead>
              <TableHead className="text-right">RSI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jumps.map((j) => {
              const isTop = topIds.has(j.index);
              return (
                <TableRow key={j.index} className={isTop ? "bg-accent/60" : ""}>
                  <TableCell className="font-mono tabular-nums">
                    {j.index}
                    {isTop && (
                      <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                        top {TOP_N}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <Num
                      value={j.contact * 1000}
                      err={dt && dt * 1000}
                      plain={(j.contact * 1000).toFixed(1)}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <Num
                      value={j.flight * 1000}
                      err={dt && dt * 1000}
                      plain={(j.flight * 1000).toFixed(1)}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <Num
                      value={j.rsi}
                      err={dt && rsiErr(j.contact, j.flight, dt)}
                      plain={j.rsi.toFixed(2)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
