import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Camera,
  ChevronLeft,
  Loader2,
  MoreHorizontal,
  Settings,
  Share,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "./ui/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { KeyframeStrip } from "./keyframe-strip";
import { DiffPanel } from "./diff-panel";
import { MODES } from "./modes";
import { ModeResults } from "./modes/mode-results";
import { PlayerControls } from "./player-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ShareClipDrawer } from "./share/share-drawers";
import { DeleteClipDialog } from "./library/delete-clip-dialog";
import { store, useShowErrors } from "../lib/store";
import type { Clip } from "../lib/store";
import {
  CUSTOM_LABEL_MAX,
  CUSTOM_MODE,
  MAX_DEPTH_REPS,
  composeMode,
  keyframeLabel,
  parseMode,
  summarize,
} from "../lib/metrics";
import { whenRecorded } from "../lib/format";
import {
  SUGGEST_MODES,
  useSuggestKeyframes,
} from "../features/keyframe-suggest/flag";
import type { CaptureHook } from "../features/keyframe-suggest/suggest-keyframes";

// Labs: suggested keyframes, only downloaded when the setting is on.
const SuggestKeyframes = lazy(
  () => import("../features/keyframe-suggest/suggest-keyframes"),
);

// The analysis selector combines the built-in two-frame compare with the modes.
const COMPARE_MODE = "compare";
const ANALYSIS_OPTIONS = [
  { id: COMPARE_MODE, label: "Compare" },
  ...MODES.map((m) => ({ id: m.id, label: m.label })),
  { id: CUSTOM_MODE, label: "Custom" },
];

/** Compare and Custom both work by picking two frames to compare. */
const isCompareLike = (id: string) => id === COMPARE_MODE || id === CUSTOM_MODE;

const MODE_STORAGE_KEY = "vertlab.analysisMode";

function loadStoredMode(): string {
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    if (saved && ANALYSIS_OPTIONS.some((o) => o.id === parseMode(saved).id)) return saved;
  } catch {
    /* localStorage unavailable */
  }
  return COMPARE_MODE;
}
import { detectFps } from "../lib/video-utils";
import type { Keyframe } from "./types";

interface AnalyzerProps {
  clip: Clip;
  videoUrl: string;
}

const POSTER_WIDTH = 240;
const SAVE_DEBOUNCE_MS = 400;

// Fixed downscale width for diff comparisons (keeps all frames aligned & fast).
const DIFF_WIDTH = 160;

export function Analyzer({ clip, videoUrl: url }: AnalyzerProps) {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  // A clip that was already worked on reopens in its own mode; a fresh one
  // starts in the last mode you used.
  // The mode string carries options too ("custom:Box jump", "depth-jump:3");
  // split it so each part has its own control.
  // A labelled Custom clip counts as worked on even before any keyframes.
  const [initialMode] = useState(() =>
    parseMode(
      clip.keyframes.length || clip.summary || parseMode(clip.mode).label
        ? clip.mode
        : loadStoredMode(),
    ),
  );
  const [analysisMode, setAnalysisMode] = useState<string>(initialMode.id);
  // The label lives on the clip, never in the remembered mode, so a fresh
  // clip doesn't inherit the last one's.
  const [customLabel, setCustomLabel] = useState(initialMode.label ?? "");
  const [depthReps, setDepthReps] = useState(initialMode.reps);
  const fullMode = composeMode(analysisMode, { label: customLabel, reps: depthReps });
  const [fps, setFps] = useState(clip.fps ?? 30);
  const showErrors = useShowErrors();
  const [detecting, setDetecting] = useState(true);
  const [aspect, setAspect] = useState(
    clip.width && clip.height ? clip.width / clip.height : 16 / 9,
  );
  /** True once saved keyframes are back on screen; autosave waits for it. */
  const [restored, setRestored] = useState(false);
  const posterRef = useRef<string | undefined>(clip.poster);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const suggestOn = useSuggestKeyframes();
  /** Lets "Find keyframes" claim the next hand capture while picking by hand. */
  const captureHook: CaptureHook = useRef(null);

  // Remember the chosen analysis mode across uploads.
  useEffect(() => {
    try {
      localStorage.setItem(
        MODE_STORAGE_KEY,
        composeMode(analysisMode, { reps: depthReps }),
      );
    } catch {
      /* localStorage unavailable */
    }
  }, [analysisMode, depthReps]);

  // Keep the time readout updated continuously while playing.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setCurrent(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const diffHeight = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return Math.round((DIFF_WIDTH * 9) / 16);
    return Math.round((DIFF_WIDTH * v.videoHeight) / v.videoWidth);
  }, []);

  /** Grab the current video frame into a Keyframe (thumbnail + diff data). */
  const grabFrame = useCallback((): Keyframe | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;

    // Thumbnail at a readable size.
    const thumbW = Math.min(480, v.videoWidth);
    const thumbH = Math.round((thumbW * v.videoHeight) / v.videoWidth);
    const tc = document.createElement("canvas");
    tc.width = thumbW;
    tc.height = thumbH;
    tc.getContext("2d")!.drawImage(v, 0, 0, thumbW, thumbH);

    // Small fixed-size buffer for diffing.
    const dh = diffHeight();
    const dc = document.createElement("canvas");
    dc.width = DIFF_WIDTH;
    dc.height = dh;
    const dctx = dc.getContext("2d", { willReadFrequently: true })!;
    dctx.drawImage(v, 0, 0, DIFF_WIDTH, dh);

    return {
      id: `${v.currentTime.toFixed(4)}-${Math.random().toString(36).slice(2, 7)}`,
      time: v.currentTime,
      thumbUrl: tc.toDataURL("image/jpeg", 0.85),
      imageData: dctx.getImageData(0, 0, DIFF_WIDTH, dh),
    };
  }, [diffHeight]);

  /** Seek and wait for the frame to be ready to draw. */
  const seekAndWait = useCallback(
    (t: number) =>
      new Promise<void>((resolve) => {
        const v = videoRef.current;
        if (!v) return resolve();
        const done = () => {
          v.removeEventListener("seeked", done);
          resolve();
        };
        v.addEventListener("seeked", done);
        v.currentTime = t;
      }),
    [],
  );

  /** Small poster frame for the library list. */
  const grabPoster = useCallback((): string | undefined => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return undefined;
    const c = document.createElement("canvas");
    c.width = POSTER_WIDTH;
    c.height = Math.round((POSTER_WIDTH * v.videoHeight) / v.videoWidth);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.75);
  }, []);

  /** Keyframes (thumbnail + diff data) for the given times. */
  const framesAt = useCallback(
    async (times: number[]) => {
      videoRef.current?.pause();
      const frames: Keyframe[] = [];
      for (const t of times) {
        await seekAndWait(t);
        const kf = grabFrame();
        if (kf) frames.push({ ...kf, time: t });
      }
      return frames;
    },
    [seekAndWait, grabFrame],
  );

  /** Replaces the keyframes with these times (from "Find keyframes"). */
  const applyKeyframeTimes = useCallback(
    async (times: number[]) => {
      const frames = await framesAt(times);
      setSelected([]);
      setKeyframes(frames.sort((a, b) => a.time - b.time));
      if (frames.length) await seekAndWait(frames[0].time);
    },
    [framesAt, seekAndWait],
  );

  /** After the video is ready: redraw saved keyframes and make a poster. */
  const restore = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    const frames = await framesAt(clip.keyframes);
    if (!posterRef.current) {
      await seekAndWait(0);
      posterRef.current = grabPoster();
    }
    await seekAndWait(0);
    setKeyframes(frames);
    setRestored(true);
  }, [clip.keyframes, framesAt, seekAndWait, grabPoster]);

  // Autosave keyframes, mode and result as you work. Every clip is stored.
  useEffect(() => {
    if (!restored) return;
    const times = keyframes.map((k) => k.time);
    const timer = setTimeout(() => {
      const v = videoRef.current;
      store
        .updateClip(clip.id, {
          mode: fullMode,
          keyframes: times,
          summary: summarize(fullMode, times),
          fps,
          duration: v?.duration || undefined,
          width: v?.videoWidth || undefined,
          height: v?.videoHeight || undefined,
          poster: posterRef.current,
        })
        .catch(() => toast.error("Couldn't save your changes"));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [restored, keyframes, fullMode, fps, clip.id]);

  const captureCurrent = useCallback(() => {
    const v = videoRef.current;
    if (v && captureHook.current?.(v.currentTime)) return;
    const kf = grabFrame();
    if (!kf) return;
    // Same frame twice would skew every mode's maths; keep one.
    const halfFrame = 0.5 / fps;
    if (keyframes.some((k) => Math.abs(k.time - kf.time) < halfFrame)) {
      toast("This frame is already a keyframe", { id: "dup-keyframe" });
      return;
    }
    // Keyframes stay in time order wherever you capture from.
    setKeyframes((prev) =>
      [...prev, kf].sort((a, b) => a.time - b.time),
    );
  }, [grabFrame, fps, keyframes]);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    // Pause first: seeking during an in-flight play() promise aborts playback
    // and can leave the video stuck. Stepping/scrubbing are paused actions.
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
  }, []);

  /** Step by N frames, snapping to frame boundaries to avoid drift. */
  const stepFrame = useCallback(
    (frames: number) => {
      const v = videoRef.current;
      if (!v) return;
      const f = 1 / fps;
      const frameIndex = Math.round(v.currentTime * fps);
      seekTo((frameIndex + frames) * f + f * 0.001);
    },
    [fps, seekTo],
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // play() returns a promise that rejects with AbortError if the video is
      // paused/seeked before playback starts; swallow it (state syncs via events).
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, []);

  const toggleSelect = useCallback((id: string) => {
    // Selecting frames is a compare action; Custom compares too, so it stays.
    setAnalysisMode((m) => (isCompareLike(m) ? m : COMPARE_MODE));
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const next = [...prev, id];
      return next.slice(-2); // keep at most two for comparison
    });
  }, []);

  // Clicking a keyframe jumps the video to it; in compare mode it also
  // toggles the frame in or out of the comparison.
  const clickKeyframe = useCallback(
    (id: string) => {
      const kf = keyframes.find((k) => k.id === id);
      if (kf) seekTo(kf.time);
      if (isCompareLike(analysisMode)) toggleSelect(id);
    },
    [keyframes, seekTo, analysisMode, toggleSelect],
  );

  const changeMode = useCallback((id: string) => {
    setSelected([]); // switching analysis type resets the comparison selection
    setAnalysisMode(id);
  }, []);

  const removeKeyframe = useCallback((id: string) => {
    setKeyframes((prev) => prev.filter((k) => k.id !== id));
    setSelected((prev) => prev.filter((x) => x !== id));
  }, []);

  const selectedFrames = selected
    .map((id) => keyframes.find((k) => k.id === id))
    .filter(Boolean) as Keyframe[];

  // Label keyframes according to the active mode (e.g. Approach jump, 10-5 RSI).
  const frameLabels: Record<string, string> = {};
  if (MODES.some((m) => m.id === analysisMode)) {
    keyframes.forEach((kf, i) => {
      const label = keyframeLabel(fullMode, i);
      if (label) frameLabels[kf.id] = label;
    });
  }

  return (
    <div className="min-h-screen bg-[#f4f3ef]">
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-10 pt-3">
      <header className="flex items-center gap-1">
        <Link
          to="/"
          aria-label="Back to library"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "-ml-2 size-11 shrink-0 rounded-full",
          )}
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">
            {whenRecorded(clip.createdAt)}
          </h1>
          <p className="truncate text-sm text-muted-foreground">{clip.title}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={clip.starred ? "Unstar" : "Star"}
          aria-pressed={clip.starred}
          className="size-11 rounded-full"
          onClick={() => store.updateClip(clip.id, { starred: !clip.starred })}
        >
          <Star
            className={cn(
              "size-[19px]",
              clip.starred && "fill-orange-700 text-orange-700",
            )}
          />
        </Button>
        <Button
          variant="ghost"
          aria-label="Share"
          className="size-11 rounded-full p-0 sm:h-9 sm:w-auto sm:border sm:bg-white sm:px-3.5"
          onClick={() => setShareOpen(true)}
        >
          <Share className="size-[18px] sm:size-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More actions"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "-mr-2 size-11 rounded-full",
            )}
          >
            <MoreHorizontal className="size-[18px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
            <DropdownMenuItem
              variant="destructive"
              className="h-11 rounded-lg px-2.5 text-sm font-medium"
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-[17px]" /> Delete clip
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Player */}
      <div className="relative flex justify-center overflow-hidden rounded-2xl border border-border bg-black">
        <video
          ref={videoRef}
          src={url}
          // Signed storage URLs are cross-origin; without CORS mode the
          // canvas frame grabs would be blocked.
          crossOrigin="anonymous"
          playsInline
          style={{ aspectRatio: aspect }}
          className="max-h-[70vh] w-full bg-black object-contain"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setDuration(v.duration);
            if (v.videoWidth && v.videoHeight) {
              setAspect(v.videoWidth / v.videoHeight);
            }
            setDetecting(true);
            const detect = clip.fps
              ? Promise.resolve(clip.fps)
              : detectFps(v);
            detect
              .then((detected) => {
                setFps(detected);
                return restore();
              })
              .finally(() => setDetecting(false));
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={togglePlay}
        />
        {/* Masks the brief playback used to measure the frame rate. */}
        {detecting && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black text-sm text-white/80">
            <Loader2 className="size-4 animate-spin" />
            {clip.keyframes.length ? "Loading your keyframes…" : "Analyzing video…"}
          </div>
        )}
      </div>

      <PlayerControls
        current={current}
        duration={duration}
        playing={playing}
        fps={fps}
        onSeek={seekTo}
        onStep={stepFrame}
        onTogglePlay={togglePlay}
        extra={
        // Frame rate settings
        <Popover>
          <PopoverTrigger
            className={buttonVariants({ variant: "ghost", size: "icon" })}
            title="Frame rate"
          >
            <Settings className="size-4" />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="w-60 rounded-xl shadow-xl ring-1 ring-black/5"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm" htmlFor="fps-input">
                  Frame rate
                </label>
                <span className="text-xs text-muted-foreground">
                  {detecting ? "DETECTING…" : "AUTO"}
                </span>
              </div>
              <div className="flex items-baseline gap-2 rounded-lg border border-border bg-input-background px-3 py-2">
                <Input
                  id="fps-input"
                  type="number"
                  min={1}
                  max={240}
                  step={0.001}
                  value={Number(fps.toFixed(3))}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (isFinite(v) && v > 0) setFps(v);
                  }}
                  className="h-8 w-24 border-0 bg-transparent px-0 font-mono tabular-nums shadow-none focus-visible:ring-0"
                />
                <span className="text-sm text-muted-foreground">fps</span>
              </div>
              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                {detecting
                  ? "detecting…"
                  : `${(1000 / fps).toFixed(1)} ms/frame`}
              </p>
              {showErrors && !detecting && (
                <p className="text-xs text-muted-foreground">
                  Times can be off by ±1 frame (±{(1000 / fps).toFixed(1)} ms).
                  {analysisMode === "approach-jump" && fps < 120 &&
                    " Use 120 fps or higher to judge the penultimate step."}
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
        }
      />

      {/* Capture action */}
      <Button
        className="h-11 w-full transition-transform active:scale-95"
        onClick={captureCurrent}
      >
        <Camera className="size-4" /> Capture this frame
      </Button>

      {suggestOn && SUGGEST_MODES.includes(analysisMode) && !detecting && (
        <Suspense fallback={null}>
          <SuggestKeyframes
            videoUrl={url}
            mode={analysisMode}
            fps={fps}
            keyframeCount={keyframes.length}
            seekTo={seekTo}
            captureHook={captureHook}
            onApply={applyKeyframeTimes}
          />
        </Suspense>
      )}

      {/* Keyframes */}
      <section className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <h2>Keyframes</h2>
            <div className="flex items-center gap-1.5">
            {analysisMode === "depth-jump" && (
              <Select
                value={String(depthReps)}
                onValueChange={(v) => setDepthReps(Number(v))}
              >
                <SelectTrigger
                  aria-label="Reps in this video"
                  className="h-7! w-auto gap-1 rounded-full px-2.5 py-0 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: MAX_DEPTH_REPS }, (_, i) => i + 1).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} rep{n === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={analysisMode} onValueChange={changeMode}>
              <SelectTrigger className="h-7! w-auto gap-1 rounded-full px-2.5 py-0 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANALYSIS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
          </div>
          {analysisMode === CUSTOM_MODE && (
            <Input
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              maxLength={CUSTOM_LABEL_MAX}
              placeholder="What is this? e.g. Box jump"
              aria-label="Custom label, shown as this clip's title"
              className="h-10 rounded-xl bg-white"
            />
          )}
          <p className="text-sm text-muted-foreground">
            {isCompareLike(analysisMode)
              ? analysisMode === CUSTOM_MODE && !customLabel.trim()
                ? "The label becomes this clip's title in your library and share links"
                : selected.length < 2
                  ? "Select two to compare"
                  : "Comparing 2 frames"
              : analysisMode === "depth-jump" && depthReps > 1
                ? `Contact, takeoff, landing for each rep (${depthReps * 3} frames)`
                : MODES.find((m) => m.id === analysisMode)?.hint}
          </p>
        </div>
        <KeyframeStrip
          keyframes={keyframes}
          selected={selected}
          onSelect={clickKeyframe}
          onRemove={removeKeyframe}
          labels={frameLabels}
        />
      </section>

      {/* Mode results (Approach jump, etc.) — the share viewer shows the same. */}
      {!isCompareLike(analysisMode) && (
        <ModeResults mode={fullMode} times={keyframes.map((k) => k.time)} fps={fps} />
      )}

      {/* Comparison */}
      {isCompareLike(analysisMode) && selectedFrames.length === 2 && (
        <section className="space-y-3">
          <h2>Comparison</h2>
          <DiffPanel a={selectedFrames[0]} b={selectedFrames[1]} />
        </section>
      )}

      <ShareClipDrawer
        clip={clip}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
      <DeleteClipDialog
        clip={deleteOpen ? clip : null}
        onOpenChange={setDeleteOpen}
        onDeleted={() => navigate("/")}
      />
    </div>
    </div>
  );
}
