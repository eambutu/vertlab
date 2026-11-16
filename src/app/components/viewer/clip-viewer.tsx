import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "../ui/utils";
import { formatHeadline, formatStat, keyframeLabel } from "../../lib/metrics";
import { useUnit } from "../../lib/store";
import type { SharedClip } from "../../lib/store";
import { modeLabel } from "../library/parts";
import { Slider } from "../ui/slider";
import { useFrameThumbs } from "./use-frame-thumbs";

const MAX_KEYFRAMES = 6;

const PILL =
  "flex h-8 items-center rounded-full bg-white/20 px-2.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30";

/** Read-only player + numbers for one shared jump. */
export function ClipViewer({ clip }: { clip: SharedClip }) {
  const unit = useUnit();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const fps = clip.fps ?? 30;

  useEffect(() => {
    if (video.current) video.current.playbackRate = slow ? 0.25 : 1;
  }, [slow, clip.id]);

  // Reset when navigating between jumps in a day.
  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [clip.id]);

  // Keep the scrubber in sync while playing.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v) setCurrent(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const times = clip.keyframes.slice(0, MAX_KEYFRAMES);
  const thumbs = useFrameThumbs(clip.videoUrl, times);
  const headline = clip.summary ? formatHeadline(clip.summary, unit) : null;
  const aspect =
    clip.width && clip.height ? clip.width / clip.height : 9 / 16;

  function toggle() {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function seek(t: number) {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
  }

  function step(frames: number) {
    const v = video.current;
    if (!v) return;
    const f = 1 / fps;
    seek((Math.round(v.currentTime * fps) + frames) * f + f * 0.001);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="relative mx-auto w-full overflow-hidden rounded-[18px] bg-gradient-to-br from-zinc-700 to-zinc-950"
        style={{ aspectRatio: aspect, maxHeight: "62vh", maxWidth: `calc(62vh * ${aspect})` }}
      >
        <video
          key={clip.id}
          ref={video}
          src={clip.videoUrl}
          poster={clip.poster}
          crossOrigin="anonymous"
          playsInline
          preload="metadata"
          className="size-full object-contain"
          onClick={toggle}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />

        {headline && (
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col rounded-xl bg-white/95 px-2.5 py-1.5 shadow-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {modeLabel(clip)}
            </span>
            <span className="font-mono text-[22px] font-semibold leading-tight tracking-tight tabular-nums">
              {headline.value}
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                {headline.unit}
              </span>
            </span>
          </div>
        )}

        {!playing && (
          <button
            type="button"
            aria-label="Play clip"
            onClick={toggle}
            className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-zinc-950 shadow-lg transition-transform active:scale-95"
          >
            <Play className="ml-0.5 size-5 fill-current" />
          </button>
        )}

        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/55 to-transparent"
        />
        <div className="absolute inset-x-3 bottom-3 flex items-center gap-1.5">
          <button
            type="button"
            aria-pressed={slow}
            onClick={() => setSlow((s) => !s)}
            className={cn(PILL, slow && "bg-white text-zinc-950 hover:bg-white")}
          >
            0.25×
          </button>
          <div className="flex h-8 items-center rounded-full bg-white/20 text-white backdrop-blur-sm">
            <button
              type="button"
              aria-label="Previous frame"
              onClick={() => step(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/20"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="px-0.5 text-xs font-medium">Frame</span>
            <button
              type="button"
              aria-label="Next frame"
              onClick={() => step(1)}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/20"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          {playing && (
            <button
              type="button"
              aria-label="Pause"
              onClick={toggle}
              className={cn(PILL, "ml-auto w-8 justify-center px-0")}
            >
              <Pause className="size-3.5 fill-current" />
            </button>
          )}
        </div>
      </div>

      {/* Scrubber */}
      <Slider
        value={[current]}
        min={0}
        max={duration || 0}
        step={0.001}
        onValueChange={([v]) => seek(v)}
        className="py-2"
      />

      {clip.summary && (
        <div className="grid grid-cols-2 gap-2">
          {clip.summary.stats.slice(0, 2).map((s) => (
            <div
              key={s.label}
              className="flex flex-col gap-1 rounded-[14px] border border-black/8 bg-white px-3 py-2.5"
            >
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
              <span className="font-mono text-[19px] font-semibold tabular-nums">
                {formatStat(s, unit)}
              </span>
            </div>
          ))}
        </div>
      )}

      {times.length > 0 && (
        <div
          className={cn(
            "grid gap-2",
            times.length === 4 ? "grid-cols-4" : "grid-cols-3",
          )}
        >
          {times.map((t, i) => (
            <button
              key={i}
              type="button"
              onClick={() => seek(t)}
              className="flex flex-col gap-1.5 text-left"
            >
              <span className="block h-16 overflow-hidden rounded-[10px] bg-zinc-900">
                {thumbs[i] && (
                  <img src={thumbs[i]} alt="" className="size-full object-cover" />
                )}
              </span>
              <span className="truncate text-[11px] font-medium">
                {keyframeLabel(clip.mode, i) ?? `Frame ${i + 1}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
