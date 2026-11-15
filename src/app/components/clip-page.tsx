import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Analyzer } from "./analyzer";
import { Page } from "./library/parts";
import { store, useClip } from "../lib/store";

/** /clip/:id — opens a saved clip in the analyzer. */
export function ClipPage() {
  const { id } = useParams();
  const clip = useClip(id);
  const [videoUrl, setVideoUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    let url: string | undefined;
    setVideoUrl(undefined);
    store.getVideoUrl(id).then((u) => {
      url = u;
      if (alive) setVideoUrl(u ?? null);
    });
    return () => {
      alive = false;
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [id]);

  // useClip is undefined both while loading and when missing; the video lookup
  // settles which one it is.
  if (videoUrl === null) {
    return (
      <Page className="flex min-h-screen flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold">
          {clip ? "This clip's video didn't finish uploading" : "This clip isn't in your library"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {clip
            ? "Delete it from your library and add the video again."
            : "It may have been deleted."}
        </p>
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
