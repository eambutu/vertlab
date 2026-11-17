import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { formatTimecode, preciseMs } from "../lib/video-utils";

/**
 * Time readout, scrubber and transport under a video. Shared by the analyzer
 * and the share viewer; `extra` sits at the right end of the transport row.
 */
export function PlayerControls({
  current,
  duration,
  playing,
  fps,
  onSeek,
  onStep,
  onTogglePlay,
  extra,
}: {
  current: number;
  duration: number;
  playing: boolean;
  fps: number;
  onSeek: (t: number) => void;
  onStep: (frames: number) => void;
  onTogglePlay: () => void;
  extra?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between rounded-xl border border-border bg-card px-4 py-3">
        <span className="font-mono text-xl tabular-nums">{formatTimecode(current)}</span>
        <span className="font-mono text-sm text-muted-foreground tabular-nums">
          {preciseMs(current)} ms / {formatTimecode(duration)}
        </span>
      </div>

      <Slider
        value={[current]}
        min={0}
        max={duration || 0}
        step={0.001}
        onValueChange={([v]) => onSeek(v)}
      />

      {/* Three columns keep the buttons centred and give `extra` its own room
          at the right, so it never runs into them on a phone. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <span />
        <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => onStep(-5)} title="Back 5 frames">
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onStep(-1)}
          title={`Previous frame (1/${fps}s)`}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button size="lg" onClick={onTogglePlay} className="px-4 sm:px-6">
          {playing ? (
            <>
              <Pause className="size-4" /> Pause
            </>
          ) : (
            <>
              <Play className="size-4" /> Play
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onStep(1)}
          title={`Next frame (1/${fps}s)`}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="outline" size="icon" onClick={() => onStep(5)} title="Forward 5 frames">
          <ChevronsRight className="size-4" />
        </Button>
        </div>
        <div className="flex justify-end">{extra}</div>
      </div>
    </>
  );
}
