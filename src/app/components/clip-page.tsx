import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Analyzer } from "./analyzer";
import { Page } from "./library/parts";
import { isCloudBacked, store, useClip, useOnline } from "../lib/store";
import { describeUploadError, logUpload } from "../lib/store/upload";

/** /clip/:id — opens a saved clip in the analyzer. */
export function ClipPage() {
  const { id } = useParams();
  const clip = useClip(id);
  const online = useOnline();
  const [videoUrl, setVideoUrl] = useState<string | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    let url: string | undefined;
    setVideoUrl(undefined);
    setLoadFailed(false);
    store.getVideoUrl(id)
      .then((u) => {
        url = u;
        if (alive) setVideoUrl(u ?? null);
        else if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
      })
      .catch((error) => {
        logUpload("video lookup failed", { clipId: id, ...describeUploadError(error) }, "error");
        if (alive) {
          setLoadFailed(true);
          setVideoUrl(null);
        }
      });
    return () => {
      alive = false;
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [id]);

  // useClip is undefined both while loading and when missing; the video lookup
  // settles which one it is.
  if (videoUrl === null) {
    let title = "This clip isn't in your library";
    let detail = "It may have been deleted.";
    if (isCloudBacked && !online) {
      title = "This video isn't available offline";
      detail = "Reconnect and reopen the clip from the library.";
    } else if (loadFailed) {
      title = "Couldn't load this video";
      detail = "Try reopening the clip from the library.";
    } else if (clip) {
      title = "This clip's video didn't finish uploading";
      detail = "You can retry the upload from the clip's menu in the library.";
    }
    return (
      <Page className="flex min-h-screen flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        <Button asChild variant="outline" className="mt-6 rounded-xl bg-white">
          <Link to="/">Back to library</Link>
        </Button>
      </Page>
    );
  }

  if (!clip || !videoUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f3ef] text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return <Analyzer key={clip.id} clip={clip} videoUrl={videoUrl} />;
}
