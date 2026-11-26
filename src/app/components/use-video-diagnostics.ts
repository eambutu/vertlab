import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logDiagnostic } from "../lib/diagnostics";

function mediaState(video: HTMLVideoElement) {
  return { readyState: video.readyState, networkState: video.networkState, online: navigator.onLine };
}

export function useVideoDiagnostics(
  videoRef: { readonly current: HTMLVideoElement | null },
  url: string,
  clipId: string,
  loadId: string,
  view: "library" | "shared",
) {
  const context = useMemo(() => ({
    clipId, loadId, view, stage: "media",
    source: url.startsWith("blob:") ? "local" : "cloud",
  }), [clipId, loadId, view, url]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const stalled = useRef(false);
  const firstFrame = useRef(false);
  const [problem, setProblem] = useState<{
    context: typeof context;
    code?: number;
  }>();
  const currentProblem = problem?.context === context ? problem : undefined;

  useEffect(() => {
    stalled.current = false;
    firstFrame.current = false;
    logDiagnostic("playback", "media load started", context);
    timer.current = setTimeout(() => {
      const video = videoRef.current;
      const ready = view === "shared" ? HTMLMediaElement.HAVE_METADATA : HTMLMediaElement.HAVE_CURRENT_DATA;
      if (!video || video.readyState >= ready || video.error) return;
      logDiagnostic("playback", "media load taking longer than expected", {
        ...context, ...mediaState(video), elapsedMs: 15_000,
      }, "warn");
      setProblem({ context });
    }, 15_000);
    return () => clearTimeout(timer.current);
  }, [context, videoRef, view]);

  function onMetadata(video: HTMLVideoElement) {
    if (view === "shared") {
      clearTimeout(timer.current);
      setProblem(undefined);
    }
    logDiagnostic("playback", "video metadata loaded", {
      ...context, ...mediaState(video),
      duration: video.duration, width: video.videoWidth, height: video.videoHeight,
    });
  }

  function onFrameReady(video: HTMLVideoElement) {
    if (firstFrame.current) return;
    firstFrame.current = true;
    clearTimeout(timer.current);
    setProblem(undefined);
    logDiagnostic("playback", "first video frame loaded", { ...context, ...mediaState(video) });
  }

  function onError(video: HTMLVideoElement) {
    clearTimeout(timer.current);
    const code = video.error?.code ?? 0;
    logDiagnostic("playback", "video playback failed", {
      ...context, ...mediaState(video), code,
    }, "error");
    setProblem({ context, code });
  }

  function onStalled(video: HTMLVideoElement) {
    if (stalled.current) return;
    stalled.current = true;
    logDiagnostic("playback", "video data stalled", { ...context, ...mediaState(video) }, "warn");
  }

  const play = useCallback((video: HTMLVideoElement) => {
    video.play().catch((error: unknown) => {
      const name = error instanceof Error ? error.name : undefined;
      // The browser cancels a pending play() when the user pauses or seeks.
      if (name === "AbortError") return;
      logDiagnostic("playback", "play request failed", { ...context, ...mediaState(video), name }, "warn");
    });
  }, [context]);

  const code = currentProblem?.code;
  const message = code === 3 || code === 4
    ? "This video couldn't be decoded. Try exporting it as an H.264 MP4."
    : code !== undefined
      ? "Couldn't play this video. Try reopening it."
      : currentProblem
        ? "This video is taking longer than expected to load."
        : undefined;

  return { onMetadata, onFrameReady, onError, onStalled, play, message };
}
