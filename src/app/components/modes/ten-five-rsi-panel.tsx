import { Zap } from "lucide-react";
import type { Keyframe } from "../types";
import { RSI_TOP_N as TOP_N, rsiJumps, rsiTop } from "../../lib/metrics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

interface TenFiveRsiPanelProps {
  keyframes: Keyframe[];
}

export function TenFiveRsiPanel({ keyframes }: TenFiveRsiPanelProps) {
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
            <span className="text-xl">{bestAvg.toFixed(2)}</span>
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
                    {(j.contact * 1000).toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {(j.flight * 1000).toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {j.rsi.toFixed(2)}
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
