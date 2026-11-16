import { useRef } from "react";
import { Trash2, X } from "lucide-react";
import { formatTimecode, preciseMs } from "../lib/video-utils";
import type { Keyframe } from "./types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";

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

const MENU_ITEM = "h-11 rounded-lg px-2.5 text-sm font-medium";

export function KeyframeStrip({
  keyframes,
  selected,
  onSelect,
  onRemove,
  labels,
  selectable = true,
}: KeyframeStripProps) {
  // Lifting the finger after a long-press also fires a click; don't let it
  // toggle selection or land on the item underneath the menu.
  const menuClosedAt = useRef(0);
  const menuJustUsed = () => performance.now() - menuClosedAt.current < 450;

  if (keyframes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No keyframes yet. Scrub to a moment and capture the current frame.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-3 overflow-x-auto pb-2">
        {keyframes.map((kf) => {
          const selIndex = selected.indexOf(kf.id);
          const isSelected = selIndex !== -1;
          const label = labels?.[kf.id];
          return (
            <ContextMenu
              key={kf.id}
              onOpenChange={(open) => {
                if (!open) menuClosedAt.current = performance.now();
              }}
            >
              <ContextMenuTrigger asChild>
                <div
                  className={`group relative w-40 shrink-0 select-none overflow-hidden rounded-xl border-2 transition-all [-webkit-touch-callout:none] data-[state=open]:ring-2 data-[state=open]:ring-primary/30 ${
                    selectable ? "cursor-pointer" : ""
                  } ${
                    isSelected
                      ? "border-primary ring-2 ring-primary/30"
                      : selectable
                        ? "border-border hover:border-primary/50"
                        : "border-border"
                  }`}
                  onClick={
                    selectable
                      ? () => {
                          if (!menuJustUsed()) onSelect(kf.id);
                        }
                      : undefined
                  }
                >
                  <img
                    src={kf.thumbUrl}
                    alt={`Keyframe at ${formatTimecode(kf.time)}`}
                    draggable={false}
                    className="pointer-events-none h-24 w-full bg-black object-contain"
                  />
                  {isSelected && (
                    <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                      {selIndex + 1}
                    </span>
                  )}
                  {/* Quick remove for mouse users; touch uses the long-press menu. */}
                  <button
                    type="button"
                    aria-label={`Remove keyframe at ${formatTimecode(kf.time)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(kf.id);
                    }}
                    className="absolute right-1.5 top-1.5 hidden size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:hover)]:flex"
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
                    {label && (
                      <p className="font-mono text-xs text-muted-foreground">
                        {label}
                      </p>
                    )}
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48 rounded-xl p-1.5">
                <ContextMenuItem
                  variant="destructive"
                  className={MENU_ITEM}
                  onSelect={() => onRemove(kf.id)}
                >
                  <Trash2 className="size-[17px]" />
                  Remove keyframe
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Press and hold a keyframe (or right-click) to remove it.
      </p>
    </div>
  );
}
