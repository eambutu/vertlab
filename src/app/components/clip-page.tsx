import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Analyzer } from "./analyzer";
import { ErrorReport } from "./error-report";
import { Page } from "./library/parts";
import { isCloudBacked, store, useClip, useOnline } from "../lib/store";
import { describeUploadError } from "../lib/store/upload";
import { logDiagnostic } from "../lib/diagnostics";

type VideoLookup =
  | { status: "loaded"; url: string }
  | { status: "missing" | "failed" };

/** /clip/:id — opens a saved clip in the analyzer. */
export function ClipPage() {
  const { id } = useParams();
  return id ? <SavedClip key={id} id={id} /> : null;
}

function SavedClip({ id }: { id: string }) {
  const online = useOnline();
  const clipResult = useClip(id);
  const [load] = useState(() => ({
    context: {
      clipId: id,
      loadId: crypto.randomUUID(),
      view: "library",
      storage: isCloudBacked ? "cloud" : "browser",
    },
    started: performance.now(),
  }));
  const [video, setVideo] = useState<VideoLookup>();
  const [slow, setSlow] = useState(false);
  const clip = clipResult?.status === "loaded" ? clipResult.clip : undefined;
  const hasClip = !!clip;
  const clipError = clipResult?.status === "failed" ? clipResult.error : undefined;
  const clipStatus = clipResult?.status;
  const videoStatus = clip?.videoStatus;
  const sourceStatus = video?.status;

  useEffect(() => {
    let alive = true;
    let url: string | undefined;
    logDiagnostic("playback", "clip open started", load.context);
    store.getVideoUrl(id)
      .then((source) => {
        if (!alive) {
          if (source?.startsWith("blob:")) URL.revokeObjectURL(source);
          return;
        }
        url = source;
        const details = {
          ...load.context,
          stage: "video source",
          elapsedMs: Math.round(performance.now() - load.started),
        };
        if (url) {
          logDiagnostic("playback", "video source resolved", {
            ...details, source: url.startsWith("blob:") ? "local" : "cloud",
          });
          setVideo({ status: "loaded", url });
        } else {
          logDiagnostic("playback", "video source missing", details, "warn");
          setVideo({ status: "missing" });
        }
      })
      .catch((error) => {
        if (!alive) return;
        logDiagnostic("playback", "video source lookup failed", {
          ...load.context, ...describeUploadError(error), stage: "video source",
          elapsedMs: Math.round(performance.now() - load.started), online: navigator.onLine,
        }, "error");
        setVideo({ status: "failed" });
      });
    return () => {
      alive = false;
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [id, load]);

  useEffect(() => {
    const details = {
      ...load.context, stage: "clip lookup", elapsedMs: Math.round(performance.now() - load.started),
    };
    if (clipStatus === "failed") {
      logDiagnostic("playback", "clip record lookup failed", {
        ...details, ...describeUploadError(clipError), online: navigator.onLine,
      }, "error");
    } else if (clipStatus === "loaded" && !hasClip) {
      logDiagnostic("playback", "clip record missing", details, "warn");
    }
  }, [clipError, clipStatus, hasClip, load]);

  useEffect(() => {
    if (sourceStatus === "missing" && videoStatus) {
      logDiagnostic("playback", "clip video unavailable", {
        ...load.context, stage: "video source", videoStatus,
      }, "warn");
    }
  }, [sourceStatus, videoStatus, load]);

  const loadingStage = !clipResult ? "clip lookup" : !video ? "video source" : undefined;
  useEffect(() => {
    if (!loadingStage) return;
    const timeout = setTimeout(() => {
      logDiagnostic("playback", "clip open taking longer than expected", {
        ...load.context, stage: loadingStage, online: navigator.onLine,
        elapsedMs: Math.round(performance.now() - load.started),
      }, "warn");
      setSlow(true);
    }, Math.max(0, 15_000 - (performance.now() - load.started)));
    return () => clearTimeout(timeout);
  }, [loadingStage, load]);

  const failed = clipStatus === "failed" || video?.status === "failed";
  if (failed || (clipResult && (!clip || video?.status === "missing"))) {
    const uploadIncomplete = clip && clip.videoStatus !== "ready";
    const title = isCloudBacked && !online ? "This video isn't available offline" : failed ? "Couldn't load this video" : !clip
      ? "This clip isn't in your library"
      : uploadIncomplete ? "This clip's video isn't ready" : "This clip's video is unavailable";
    const message = isCloudBacked && !online ? "Reconnect and reopen the clip from the library." : failed ? "Try reopening the clip from the library." : !clip
      ? "It may have been deleted."
      : clip.videoStatus === "failed"
        ? "You can retry the upload from the clip's menu in the library."
        : uploadIncomplete
          ? "Try again after the video finishes uploading."
          : "Try reopening the clip from the library.";
    return (
      <Page className="flex min-h-screen flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline" className="rounded-xl bg-white">
            <Link to="/">Back to library</Link>
          </Button>
          <ErrorReport />
        </div>
      </Page>
    );
  }

  if (!clip || video?.status !== "loaded") {
    return (
      <Page className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <p role="status">{slow ? "This clip is taking longer than expected to load." : "Opening video…"}</p>
        {slow && <ErrorReport />}
      </Page>
    );
  }

  return <Analyzer clip={clip} videoUrl={video.url} loadId={load.context.loadId} />;
}
