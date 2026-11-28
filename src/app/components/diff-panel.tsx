import { ArrowRight, Timer, ArrowUp } from "lucide-react";
import { formatTimecode, preciseMs, jumpHeightInches } from "../lib/video-utils";
import type { Keyframe } from "./types";

interface DiffPanelProps {
  a: Keyframe;
  b: Keyframe;
}

export function DiffPanel({ a, b }: DiffPanelProps) {
  // Order by time so the delta is always positive and intuitive.
  const [first, second] = a.time <= b.time ? [a, b] : [b, a];

  const deltaMs = (second.time - first.time) * 1000;
  const jumpIn = jumpHeightInches(deltaMs / 1000);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FrameCard label="Frame A" kf={first} />
        <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground">
          <ArrowRight className="hidden size-6 sm:block" />
          <div className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5">
            <Timer className="size-4" />
            <span className="font-mono text-sm tabular-nums text-foreground">
              +{deltaMs.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms
            </span>
          </div>
        </div>
        <FrameCard label="Frame B" kf={second} />
      </div>

      {/* Fun physics: treat the time gap as a vertical jump's hang time. */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-foreground">
          <ArrowUp className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            Vertical jump — if this gap were hang time
          </p>
          <p className="font-mono tabular-nums">
            <span className="text-xl">{jumpIn.toFixed(2)}</span> in
          </p>
        </div>
      </div>
    </div>
  );
}

function FrameCard({ label, kf }: { label: string; kf: Keyframe }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {kf.thumbUrl ? <img
        src={kf.thumbUrl}
        alt={label}
        className="h-40 w-full bg-black object-contain"
      /> : <div className="h-40 bg-black" />}
      <div className="px-3 py-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-mono text-sm tabular-nums">
          {formatTimecode(kf.time)}
        </p>
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          {preciseMs(kf.time)} ms
        </p>
      </div>
    </div>
  );
}
