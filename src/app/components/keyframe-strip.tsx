import { X } from "lucide-react";
import { formatTimecode, preciseMs } from "../lib/video-utils";
import type { Keyframe } from "./types";

interface KeyframeStripProps {
  keyframes: Keyframe[];
  selected: string[];
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  /** Optional per-keyframe labels (by id) shown under the timecode. */
  labels?: Record<string, string>;
  /** When false, frames can't be clicked to select (e.g. outside compare mode). */
  selectable?: boolean;
}

export function KeyframeStrip({
  keyframes,
  selected,
  onSelect,
  onRemove,
  labels,
  selectable = true,
}: KeyframeStripProps) {
  if (keyframes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No keyframes yet. Scrub to a moment and capture the current frame.
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {keyframes.map((kf) => {
        const selIndex = selected.indexOf(kf.id);
        const isSelected = selIndex !== -1;
        return (
          <div
            key={kf.id}
            className={`group relative shrink-0 w-40 overflow-hidden rounded-xl border-2 transition-all ${
              selectable ? "cursor-pointer" : ""
            } ${
              isSelected
                ? "border-primary ring-2 ring-primary/30"
                : selectable
                  ? "border-border hover:border-primary/50"
                  : "border-border"
            }`}
            onClick={selectable ? () => onSelect(kf.id) : undefined}
          >
            <img
              src={kf.thumbUrl}
              alt={`Keyframe at ${formatTimecode(kf.time)}`}
              className="h-24 w-full bg-black object-contain"
            />
            {isSelected && (
              <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                {selIndex + 1}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(kf.id);
              }}
              className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
            <div className="bg-card px-2 py-1.5">
              <p className="font-mono text-sm tabular-nums">
                {formatTimecode(kf.time)}
              </p>
              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                {preciseMs(kf.time)} ms
              </p>
              {labels?.[kf.id] && (
                <p className="font-mono text-xs text-muted-foreground">
                  {labels[kf.id]}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
