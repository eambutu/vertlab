import type { ReactNode } from "react";
import { ArrowUp, Footprints, Timer } from "lucide-react";

// Coaching target ranges shared across jump modes.
export const CONTACT_TARGET = { min: 200, max: 300 }; // ms
export const PENULTIMATE_TARGET = { min: 0.13, max: 0.17 }; // seconds

function inRangeClass(ok: boolean): string {
  return ok ? "text-green-600 dark:text-green-500" : "";
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

export function PenultimateStepCard({ seconds }: { seconds: number }) {
  const ok = seconds >= PENULTIMATE_TARGET.min && seconds <= PENULTIMATE_TARGET.max;
  return (
    <ResultCard icon={<Footprints className="size-5" />} label="Penultimate step">
      <p className="font-mono tabular-nums">
        <span className={`text-xl ${inRangeClass(ok)}`}>
          {seconds.toFixed(3)}
        </span>{" "}
        s
      </p>
      <p className="font-mono text-xs text-muted-foreground tabular-nums">
        Target {PENULTIMATE_TARGET.min.toFixed(2)}–
        {PENULTIMATE_TARGET.max.toFixed(2)} s
      </p>
    </ResultCard>
  );
}

export function GroundContactCard({ contactMs }: { contactMs: number }) {
  const ok = contactMs >= CONTACT_TARGET.min && contactMs <= CONTACT_TARGET.max;
  return (
    <ResultCard icon={<Timer className="size-5" />} label="Ground contact time">
      <p className="font-mono tabular-nums">
        <span className={`text-xl ${inRangeClass(ok)}`}>
          {contactMs.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </span>{" "}
        ms
      </p>
      <p className="font-mono text-xs text-muted-foreground tabular-nums">
        Target {CONTACT_TARGET.min}–{CONTACT_TARGET.max} ms
      </p>
    </ResultCard>
  );
}

export function JumpHeightCard({
  jumpIn,
  airtime,
}: {
  jumpIn: number;
  airtime: number;
}) {
  return (
    <ResultCard icon={<ArrowUp className="size-5" />} label="Jump height">
      <p className="font-mono tabular-nums">
        <span className="text-xl">{jumpIn.toFixed(2)}</span> in
      </p>
      <p className="font-mono text-xs text-muted-foreground tabular-nums">
        (
        {(airtime * 1000).toLocaleString(undefined, {
          maximumFractionDigits: 1,
        })}{" "}
        ms airtime)
      </p>
    </ResultCard>
  );
}
