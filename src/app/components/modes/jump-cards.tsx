import type { ReactNode } from "react";
import { ArrowUp, Footprints, Timer } from "lucide-react";
import { rangeFit, withError } from "../../lib/metrics";
import type { RangeFit } from "../../lib/metrics";

// Coaching target ranges shared across jump modes.
export const CONTACT_TARGET = { min: 200, max: 300 }; // ms
export const PENULTIMATE_TARGET = { min: 0.13, max: 0.17 }; // seconds

function fitClass(fit: RangeFit): string {
  if (fit === "in") return "text-green-600 dark:text-green-500";
  if (fit === "unclear") return "text-amber-600 dark:text-amber-500";
  return "";
}

/** In/out of a target; with an error bar, "unclear" when it straddles an edge. */
function targetFit(value: number, min: number, max: number, err?: number): RangeFit {
  if (err !== undefined) return rangeFit(value, err, min, max);
  return value >= min && value <= max ? "in" : "out";
}

/** "186" or, with an error bar, "186 ± 17" rounded to the error's precision. */
function ValueWithError({
  value,
  err,
  plain,
  className,
}: {
  value: number;
  err?: number;
  /** How to show the value when there's no error bar. */
  plain: string;
  className?: string;
}) {
  if (err === undefined) return <span className={`text-xl ${className ?? ""}`}>{plain}</span>;
  const v = withError(value, err);
  return (
    <>
      <span className={`text-xl ${className ?? ""}`}>{v.value}</span>
      <span className="text-sm text-muted-foreground"> ± {v.err}</span>
    </>
  );
}

function ResultCard({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        {children}
      </div>
    </div>
  );
}

function TargetLine({ fit, children }: { fit: RangeFit; children: ReactNode }) {
  return (
    <p className="font-mono text-xs text-muted-foreground tabular-nums">
      Target {children}
      {fit === "unclear" && (
        <span className="text-amber-600 dark:text-amber-500"> · too close to call</span>
      )}
    </p>
  );
}

/** Pass `err` (seconds) to show a ± range. */
export function PenultimateStepCard({ seconds, err }: { seconds: number; err?: number }) {
  const fit = targetFit(seconds, PENULTIMATE_TARGET.min, PENULTIMATE_TARGET.max, err);
  return (
    <ResultCard icon={<Footprints className="size-5" />} label="Penultimate step">
      <p className="font-mono tabular-nums">
        <ValueWithError
          value={seconds}
          err={err}
          plain={seconds.toFixed(3)}
          className={fitClass(fit)}
        />{" "}
        s
      </p>
      <TargetLine fit={fit}>
        {PENULTIMATE_TARGET.min.toFixed(2)}–{PENULTIMATE_TARGET.max.toFixed(2)} s
      </TargetLine>
    </ResultCard>
  );
}

/** Pass `err` (ms) to show a ± range. */
export function GroundContactCard({ contactMs, err }: { contactMs: number; err?: number }) {
  const fit = targetFit(contactMs, CONTACT_TARGET.min, CONTACT_TARGET.max, err);
  return (
    <ResultCard icon={<Timer className="size-5" />} label="Ground contact time">
      <p className="font-mono tabular-nums">
        <ValueWithError
          value={contactMs}
          err={err}
          plain={contactMs.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          className={fitClass(fit)}
        />{" "}
        ms
      </p>
      <TargetLine fit={fit}>
        {CONTACT_TARGET.min}–{CONTACT_TARGET.max} ms
      </TargetLine>
    </ResultCard>
  );
}

/** Pass `err` (inches) and `airtimeErr` (seconds) to show ± ranges. */
export function JumpHeightCard({
  jumpIn,
  airtime,
  err,
  airtimeErr,
}: {
  jumpIn: number;
  airtime: number;
  err?: number;
  airtimeErr?: number;
}) {
  const airtimeMs =
    airtimeErr !== undefined
      ? (() => {
          const v = withError(airtime * 1000, airtimeErr * 1000);
          return `${v.value} ± ${v.err}`;
        })()
      : (airtime * 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <ResultCard icon={<ArrowUp className="size-5" />} label="Jump height">
      <p className="font-mono tabular-nums">
        <ValueWithError value={jumpIn} err={err} plain={jumpIn.toFixed(2)} /> in
      </p>
      <p className="font-mono text-xs text-muted-foreground tabular-nums">
        ({airtimeMs} ms airtime)
      </p>
    </ResultCard>
  );
}
