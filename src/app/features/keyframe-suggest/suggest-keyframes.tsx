import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Hand, Loader2, ScanSearch, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Progress } from "../../components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { findKeyframes, type SuggestedEvent } from "./finder";
import { ConfirmSheet } from "./confirm-sheet";

/** Called with the time of a hand-captured frame; return true to claim it. */
export type CaptureHook = MutableRefObject<((time: number) => boolean) | null>;

interface Props {
  videoUrl: string;
  mode: string;
  fps: number;
  keyframeCount: number;
  seekTo: (time: number) => void;
  captureHook: CaptureHook;
  onApply: (times: number[]) => Promise<void> | void;
}

type Phase = "idle" | "running" | "summary" | "review" | "manual";

/** Many events (10-5 RSI) start with a summary instead of one-by-one review. */
const SUMMARY_FROM = 6;

export default function SuggestKeyframes({
  videoUrl,
  mode,
  fps,
  keyframeCount,
  seekTo,
  captureHook,
  onApply,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ stage: "", fraction: 0 });
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [events, setEvents] = useState<SuggestedEvent[]>([]);
  const [picks, setPicks] = useState<(number | null)[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [queue, setQueue] = useState<number[]>([]);
  const [pos, setPos] = useState(0);
  const abort = useRef<AbortController | null>(null);

  // Leaving the clip or switching mode drops any work in progress.
  useEffect(
    () => () => {
      abort.current?.abort();
      captureHook.current = null;
    },
    [captureHook],
  );
  useEffect(() => {
    abort.current?.abort();
    captureHook.current = null;
    setPhase("idle");
    setError(null);
  }, [mode, videoUrl, captureHook]);

  const halfFrame = 0.5 / fps;

  async function run() {
    setConfirmReplace(false);
    setError(null);
    setPhase("running");
    setProgress({ stage: "Starting", fraction: 0 });
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await findKeyframes({
        url: videoUrl,
        mode,
        fps,
        signal: controller.signal,
        onProgress: (stage, fraction) => setProgress({ stage, fraction }),
      });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setError(result.reason);
        setPhase("idle");
        return;
      }
      const evs = result.events;
      setEvents(evs);
      setPicks(evs.map((e) => (e.found ? e.candidates[e.suggested].time : null)));
      setSelected(evs.map((e) => e.suggested));
      if (evs.length >= SUMMARY_FROM) {
        setPhase("summary");
      } else {
        setQueue(evs.map((_, i) => i));
        setPos(0);
        setPhase("review");
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error(e);
      setError("Something went wrong while reading the video.");
      setPhase("idle");
    }
  }

  async function finish(finalPicks: (number | null)[]) {
    captureHook.current = null;
    setPhase("idle");
    const times = finalPicks.filter((t): t is number => t != null).sort((a, b) => a - b);
    if (!times.length) {
      toast("No keyframes added");
      return;
    }
    await onApply(times);
    toast.success(`${times.length} keyframe${times.length === 1 ? "" : "s"} added`);
  }

  const current = queue[pos];
  const advance = (nextPicks: (number | null)[]) => {
    if (pos + 1 < queue.length) {
      setPos(pos + 1);
      setPhase("review");
    } else {
      void finish(nextPicks);
    }
  };

  const setPick = (i: number, time: number | null) => {
    const next = [...picks];
    next[i] = time;
    setPicks(next);
    return next;
  };

  function pickByHand() {
    const ev = events[current];
    const mid = ev.found ? ev.candidates[ev.suggested].time : picks.slice(0, current).filter((t) => t != null).pop();
    if (mid != null) seekTo(mid);
    setPhase("manual");
    const index = current;
    // Picks can't change while picking by hand, so this snapshot is current.
    const snapshot = picks;
    captureHook.current = (time) => {
      captureHook.current = null;
      const next = [...snapshot];
      next[index] = time;
      setPicks(next);
      advanceFrom(index, next);
      return true;
    };
  }

  // The capture hook runs after later renders, so it advances from the event
  // it was opened for rather than from `pos`.
  const advanceFrom = (index: number, nextPicks: (number | null)[]) => {
    const at = queue.indexOf(index);
    if (at + 1 < queue.length) {
      setPos(at + 1);
      setPhase("review");
    } else {
      void finish(nextPicks);
    }
  };

  const reviewProps = (() => {
    if (phase !== "review" || current == null) return undefined;
    const ev = events[current];
    const before = picks.slice(0, current);
    const prevIndex = before.map((t, i) => (t != null ? i : -1)).filter((i) => i >= 0).pop();
    const after = picks.slice(current + 1).find((t) => t != null);
    return {
      event: ev,
      position: { index: pos, total: queue.length },
      previous:
        prevIndex != null
          ? { label: events[prevIndex].label, time: picks[prevIndex]! }
          : undefined,
      bounds: {
        after: prevIndex != null ? picks[prevIndex]! + halfFrame : -Infinity,
        before: after != null ? after - halfFrame : Infinity,
      },
      selected: selected[current] ?? ev.suggested,
      remaining: queue.length - pos,
      onSelect: (i: number) => {
        const next = [...selected];
        next[current] = i;
        setSelected(next);
      },
      onUse: () => {
        const sel = selected[current] ?? ev.suggested;
        advance(setPick(current, ev.candidates[sel].time));
      },
      onNone: pickByHand,
      onSkip: () => advance(setPick(current, null)),
      onBack: pos > 0 ? () => setPos(pos - 1) : undefined,
      onUseRest: () => void finish(picks),
    };
  })();

  const uncertain = events
    .map((e, i) => (!e.found || !e.confident ? i : -1))
    .filter((i) => i >= 0);

  const startReview = (indices: number[]) => {
    setQueue(indices);
    setPos(0);
    setPhase("review");
  };

  return (
    <>
      {phase === "running" ? (
        <div className="space-y-2.5 rounded-xl border border-border bg-card p-3.5">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <span className="flex-1">{progress.stage}…</span>
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                abort.current?.abort();
                setPhase("idle");
              }}
            >
              Cancel
            </button>
          </div>
          <Progress value={progress.fraction * 100} className="h-1.5 bg-zinc-200 [&>*]:bg-zinc-900" />
        </div>
      ) : phase === "manual" ? (
        <div className="flex items-start gap-3 rounded-xl border border-zinc-300 bg-white p-3.5">
          <Hand className="mt-0.5 size-4 shrink-0 text-zinc-700" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Pick {events[current]?.label} by hand</p>
            <p className="text-muted-foreground">
              Step to the right frame, then tap Capture this frame.
            </p>
            <div className="mt-2 flex gap-4">
              <button
                type="button"
                className="font-medium underline-offset-4 hover:underline"
                onClick={() => {
                  captureHook.current = null;
                  setPhase("review");
                }}
              >
                Back to suggestions
              </button>
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  captureHook.current = null;
                  setPhase("idle");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            variant="outline"
            className="h-11 w-full bg-white"
            onClick={() => (keyframeCount ? setConfirmReplace(true) : run())}
          >
            <ScanSearch className="size-4" /> Find keyframes
          </Button>
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800">
              <span className="flex-1">{error}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
                <X className="size-4" />
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmSheet
        open={phase === "review" || phase === "summary"}
        onOpenChange={(open) => {
          if (!open && (phase === "review" || phase === "summary")) setPhase("idle");
        }}
        summary={
          phase === "summary"
            ? {
                total: events.length,
                uncertain: uncertain.length,
                onReviewUncertain: () => startReview(uncertain),
                onReviewAll: () => startReview(events.map((_, i) => i)),
                onUseAll: () => void finish(picks),
              }
            : undefined
        }
        review={reviewProps}
      />

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your keyframes?</AlertDialogTitle>
            <AlertDialogDescription>
              The {keyframeCount} keyframe{keyframeCount === 1 ? "" : "s"} you have now will be
              replaced by the ones you confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>Find keyframes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
