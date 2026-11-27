import { useEffect, useRef, useState } from "react";
import { cn } from "../ui/utils";
import { Button } from "../ui/button";
import { keyframeLabel } from "../../lib/metrics";
import { useUnit } from "../../lib/store";
import type { SharedClip } from "../../lib/store";
import { Headline, modeLabel } from "../library/parts";
import { KeyframeStrip } from "../keyframe-strip";
import { ModeResults } from "../modes/mode-results";
import { PlayerControls } from "../player-controls";
import { useFrameThumbs } from "./use-frame-thumbs";
import { VideoFrame } from "../video-frame";
import { useVideoDiagnostics } from "../use-video-diagnostics";

/**
 * Read-only player + numbers for one shared jump. Built from the analyzer's
 * own controls, keyframe strip and results panels so the two look alike.
 */
export function ClipViewer({ clip }: { clip: SharedClip }) {
  const unit = useUnit();
  const video = useRef<HTMLVideoElement>(null);
  const [loadId] = useState(() => crypto.randomUUID());
  const diagnostics = useVideoDiagnostics(video, clip.videoUrl, clip.id, loadId, "shared");
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

  // Keep the readout and scrubber in sync while playing.
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

  const times = clip.keyframes;
  const thumbs = useFrameThumbs(clip.videoUrl, times);
  const frames = times.map((time, i) => ({ id: String(i), time, thumbUrl: thumbs[i] }));
  const labels: Record<string, string> = {};
  times.forEach((_, i) => {
    labels[String(i)] = keyframeLabel(clip.mode, i) ?? `Frame ${i + 1}`;
  });
  const aspect = clip.width && clip.height ? clip.width / clip.height : 9 / 16;

  function toggle() {
    const v = video.current;
    if (!v) return;
    if (v.paused) diagnostics.play(v);
    else v.pause();
  }

  function seek(t: number) {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
  }

  function step(n: number) {
    const v = video.current;
    if (!v) return;
    const f = 1 / fps;
    seek((Math.round(v.currentTime * fps) + n) * f + f * 0.001);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate">{modeLabel(clip)}</h2>
          {clip.summary && (
            <p className="truncate text-sm text-muted-foreground">{clip.summary.sub}</p>
          )}
        </div>
        <Headline clip={clip} unit={unit} className="text-2xl" />
      </div>

      <VideoFrame
        key={clip.id}
        videoRef={video}
        src={clip.videoUrl}
        aspect={aspect}
        poster={clip.poster}
        preload="metadata"
        diagnostics={diagnostics}
        onTogglePlay={toggle}
        onPlayingChange={setPlaying}
        onMetadata={(v) => setDuration(v.duration)}
      />

      <PlayerControls
        current={current}
        duration={duration}
        playing={playing}
        fps={fps}
        onSeek={seek}
        onStep={step}
        onTogglePlay={toggle}
        extra={
          <Button
            variant="ghost"
            aria-pressed={slow}
            onClick={() => setSlow((s) => !s)}
            title="Slow motion"
            className={cn(
              "size-9 p-0 font-mono text-[11px]",
              slow && "bg-zinc-950 text-white hover:bg-zinc-800 hover:text-white",
            )}
          >
            0.25×
          </Button>
        }
      />

      {times.length > 0 && (
        <section className="space-y-3">
          <h2>Keyframes</h2>
          <KeyframeStrip
            keyframes={frames}
            selected={[]}
            onSelect={(id) => seek(times[Number(id)])}
            labels={labels}
          />
        </section>
      )}

      <ModeResults mode={clip.mode} times={times} fps={fps} />
    </div>
  );
}
