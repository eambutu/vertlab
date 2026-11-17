import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ScanSearch, ZoomIn, ZoomOut } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "../../components/ui/drawer";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/utils";
import { formatTimecode } from "../../lib/video-utils";
import type { SuggestedEvent } from "./finder";

const SHEET = "mx-auto max-w-lg rounded-t-3xl border-0 bg-white px-5 pb-6";

interface ReviewProps {
  event: SuggestedEvent;
  position: { index: number; total: number };
  /** Previous chosen keyframe (for "+176 ms after Contact"). */
  previous?: { label: string; time: number };
  /** Candidates outside (after, before) can't be picked: they'd break the order. */
  bounds: { after: number; before: number };
  selected: number;
  remaining: number;
  onSelect: (i: number) => void;
  onUse: () => void;
  onNone: () => void;
  onSkip: () => void;
  onBack?: () => void;
  onUseRest: () => void;
}

function Review({
  event,
  position,
  previous,
  bounds,
  selected,
  remaining,
  onSelect,
  onUse,
  onNone,
  onSkip,
  onBack,
  onUseRest,
}: ReviewProps) {
  const [zoom, setZoom] = useState(false);
  const swipeX = useRef<number | null>(null);
  const allowed = event.candidates.map((c) => c.time > bounds.after && c.time < bounds.before);
  const current = event.candidates[selected];

  // Flip with the keyboard: ←/→, 1–4, Enter to confirm.
  useEffect(() => {
    if (!event.found) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      const step = (d: number) => {
        let i = selected;
        do i += d;
        while (i >= 0 && i < allowed.length && !allowed[i]);
        if (i >= 0 && i < allowed.length) onSelect(i);
      };
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (/^[1-4]$/.test(e.key) && allowed[Number(e.key) - 1]) onSelect(Number(e.key) - 1);
      else if (e.key === "Enter" && allowed[selected]) onUse();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const header = (
    <div className="flex items-center gap-1 pt-3">
      {onBack ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous event"
          className="-ml-2 size-10 rounded-full"
          onClick={onBack}
        >
          <ChevronLeft className="size-5" />
        </Button>
      ) : (
        <span className="w-1" />
      )}
      <DrawerTitle className="min-w-0 flex-1 truncate text-lg">{event.label}</DrawerTitle>
      <span className="font-mono text-[13px] text-muted-foreground tabular-nums">
        {position.index + 1} of {position.total}
      </span>
    </div>
  );

  if (!event.found) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <DrawerDescription className="text-sm">
          Couldn't find this one in the video. Pick it by hand, or skip it.
        </DrawerDescription>
        <Button className="h-11 rounded-xl" onClick={onNone}>
          Pick by hand
        </Button>
        <Button variant="ghost" className="h-10 rounded-xl" onClick={onSkip}>
          Skip
        </Button>
      </div>
    );
  }

  const deltaMs = previous ? (current.time - previous.time) * 1000 : null;
  const focus = event.focus ?? { x: 0.5, y: 0.8 };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {header}
      <DrawerDescription className="sr-only">
        Choose the frame where {event.label.toLowerCase()} happens.
      </DrawerDescription>

      <div
        className="relative mx-auto flex max-h-[42vh] w-full touch-pan-y select-none items-center justify-center overflow-hidden rounded-2xl bg-black"
        onPointerDown={(e) => (swipeX.current = e.clientX)}
        onPointerUp={(e) => {
          if (swipeX.current == null) return;
          const dx = e.clientX - swipeX.current;
          swipeX.current = null;
          if (Math.abs(dx) < 40) return;
          let i = selected + (dx < 0 ? 1 : -1);
          while (i >= 0 && i < allowed.length && !allowed[i]) i += dx < 0 ? 1 : -1;
          if (i >= 0 && i < allowed.length) onSelect(i);
        }}
      >
        {current.image ? (
          <img
            src={current.image}
            alt={`Frame at ${formatTimecode(current.time)}`}
            draggable={false}
            className="max-h-[42vh] w-full object-contain"
            style={
              zoom
                ? {
                    transform: "scale(2.5)",
                    transformOrigin: `${focus.x * 100}% ${focus.y * 100}%`,
                  }
                : undefined
            }
          />
        ) : (
          <div className="aspect-video w-full" />
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={zoom ? "Show whole frame" : "Zoom in on the foot"}
          aria-pressed={zoom}
          onClick={() => setZoom((z) => !z)}
          className="absolute bottom-2 right-2 size-10 rounded-full bg-black/55 text-white hover:bg-black/70 hover:text-white"
        >
          {zoom ? <ZoomOut className="size-[18px]" /> : <ZoomIn className="size-[18px]" />}
        </Button>
        {!event.confident && (
          <span className="absolute left-2 top-2 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
            Less sure about this one
          </span>
        )}
      </div>

      <p className="font-mono text-xs text-muted-foreground tabular-nums">
        {formatTimecode(current.time)}
        {deltaMs != null && previous && ` · ${deltaMs >= 0 ? "+" : ""}${Math.round(deltaMs)} ms after ${previous.label}`}
      </p>

      <div role="radiogroup" aria-label="Candidate frames" className="grid grid-cols-4 gap-2">
        {event.candidates.map((c, i) => (
          <button
            key={c.frame}
            type="button"
            role="radio"
            aria-checked={i === selected}
            aria-label={`Frame ${i + 1}, ${formatTimecode(c.time)}${i === event.suggested ? ", suggested" : ""}`}
            disabled={!allowed[i]}
            onClick={() => onSelect(i)}
            className={cn(
              "relative overflow-hidden rounded-xl border-2 bg-black transition-colors disabled:opacity-30",
              i === selected ? "border-zinc-950 ring-2 ring-zinc-950/20" : "border-transparent",
            )}
          >
            {c.image && (
              <img
                src={c.image}
                alt=""
                draggable={false}
                className="aspect-square w-full object-cover"
                style={{ objectPosition: `${focus.x * 100}% ${focus.y * 100}%` }}
              />
            )}
            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-mono text-[10px] text-white">
              {i + 1}
            </span>
          </button>
        ))}
      </div>

      <Button className="mt-1 h-11 rounded-xl" disabled={!allowed[selected]} onClick={onUse}>
        Use this frame
      </Button>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
        <button type="button" className="h-9 font-medium underline-offset-4 hover:underline" onClick={onNone}>
          None of these
        </button>
        <button type="button" className="h-9 text-muted-foreground underline-offset-4 hover:underline" onClick={onSkip}>
          Skip
        </button>
        {remaining > 1 && (
          <button type="button" className="h-9 text-muted-foreground underline-offset-4 hover:underline" onClick={onUseRest}>
            Use suggestions for the rest
          </button>
        )}
      </div>
    </div>
  );
}

/** First step when there are many events (10-5 RSI). */
function Summary({
  total,
  uncertain,
  onReviewUncertain,
  onReviewAll,
  onUseAll,
}: {
  total: number;
  uncertain: number;
  onReviewUncertain: () => void;
  onReviewAll: () => void;
  onUseAll: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 pt-5 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-zinc-950 text-white">
        <ScanSearch className="size-5" />
      </div>
      <div>
        <DrawerTitle className="text-lg">Found {total} keyframes</DrawerTitle>
        <DrawerDescription className="mt-1 text-sm">
          {uncertain
            ? `${uncertain} ${uncertain === 1 ? "looks" : "look"} uncertain. Check those, or go through all of them.`
            : "They all look clear. Check them, or use them as they are."}
        </DrawerDescription>
      </div>
      <div className="flex w-full flex-col gap-2">
        {uncertain > 0 && (
          <Button className="h-11 rounded-xl" onClick={onReviewUncertain}>
            Review uncertain ({uncertain})
          </Button>
        )}
        <Button
          variant={uncertain ? "outline" : "default"}
          className="h-11 rounded-xl"
          onClick={onReviewAll}
        >
          Review all {total}
        </Button>
        <Button variant="ghost" className="h-10 rounded-xl" onClick={onUseAll}>
          Use all suggestions
        </Button>
      </div>
    </div>
  );
}

export function ConfirmSheet({
  open,
  onOpenChange,
  summary,
  review,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary?: Parameters<typeof Summary>[0];
  review?: ReviewProps;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className={SHEET}>
        <div className="min-h-0 overflow-y-auto">
          {summary ? <Summary {...summary} /> : review ? <Review key={review.position.index} {...review} /> : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
