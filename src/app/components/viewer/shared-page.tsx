import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ChevronLeft, ChevronRight, Link2Off } from "lucide-react";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { dayLong, dayShort, plural, whenRecorded } from "../../lib/format";
import { store, useUnit } from "../../lib/store";
import type { SharedView } from "../../lib/store";
import {
  ClipThumb,
  Headline,
  ListCard,
  Page,
  clipSubline,
  modeLabel,
} from "../library/parts";
import { ClipViewer } from "./clip-viewer";

function Mark() {
  return (
    <div
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-zinc-950 text-base font-semibold text-white"
    >
      V
    </div>
  );
}

function BrandHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="flex items-center gap-2.5 pb-3.5 pt-5">
      <Mark />
      <div className="flex min-w-0 flex-col gap-px">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {eyebrow}
        </span>
        <h1 className="truncate text-[17px] font-semibold">{title}</h1>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <p className="pt-8 text-center text-xs text-muted-foreground">
      Analyzed with{" "}
      <Link to="/" className="font-medium text-foreground underline-offset-4 hover:underline">
        VertLab
      </Link>
    </p>
  );
}

function useShare(token: string | undefined) {
  const [view, setView] = useState<SharedView | null | undefined>(undefined);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    let urls: string[] = [];
    setView(undefined);
    store.openShare(token).then((v) => {
      urls = v?.clips.map((c) => c.videoUrl) ?? [];
      if (alive) setView(v ?? null);
    });
    return () => {
      alive = false;
      urls.forEach((u) => u.startsWith("blob:") && URL.revokeObjectURL(u));
    };
  }, [token]);
  return view;
}

/** /j/:token, /d/:token and /d/:token/:n */
export function SharedPage({ kind }: { kind: "clip" | "day" }) {
  const { token, n } = useParams();
  const navigate = useNavigate();
  const unit = useUnit();
  const view = useShare(token);

  if (view === undefined) {
    return (
      <Page>
        <div className="space-y-3 pt-6">
          <Skeleton className="h-10 w-48 bg-black/5" />
          <Skeleton className="h-80 w-full rounded-2xl bg-black/5" />
        </div>
      </Page>
    );
  }

  if (view === null || view.kind !== kind) {
    return (
      <Page className="flex min-h-screen flex-col items-center justify-center text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-white text-zinc-700 shadow-sm">
          <Link2Off className="size-5" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">This link isn't available</h1>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          The person who shared it may have stopped sharing, or the link was
          copied incompletely.
        </p>
        <Button asChild variant="outline" className="mt-6 rounded-xl bg-white">
          <Link to="/">Open VertLab</Link>
        </Button>
      </Page>
    );
  }

  /* ----- Single jump ----- */
  if (kind === "clip") {
    const clip = view.clips[0];
    return (
      <Page>
        <BrandHeader eyebrow="Shared jump" title={whenRecorded(clip.createdAt)} />
        <ClipViewer clip={clip} />
        {view.partOf && (
          <Link
            to={`/d/${view.partOf.token}`}
            className="mt-2.5 flex items-center gap-2.5 rounded-[14px] border border-black/8 bg-white px-3.5 py-3 hover:bg-zinc-50"
          >
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">
                Part of {dayShort(view.partOf.day)}
              </span>
              <span className="text-xs text-muted-foreground">
                See all {plural(view.partOf.count, "jump")} from that session
              </span>
            </span>
            <ChevronRight className="size-4 text-zinc-500" />
          </Link>
        )}
        <Footer />
      </Page>
    );
  }

  /* ----- A jump inside a shared day ----- */
  const total = view.clips.length;
  const index = n ? Number(n) - 1 : -1;
  if (index >= 0 && index < total) {
    const clip = view.clips[index];
    const go = (i: number) => navigate(`/d/${token}/${((i + total) % total) + 1}`, { replace: true });
    return (
      <Page>
        <header className="-ml-2 flex items-center gap-0.5 pb-2 pt-3.5">
          <Button
            asChild
            variant="ghost"
            className="h-11 gap-1 pl-1.5 pr-2.5 text-[15px] font-semibold"
          >
            <Link to={`/d/${token}`}>
              <ChevronLeft className="size-5" />
              {view.day ? dayShort(view.day) : "Back"}
            </Link>
          </Button>
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous jump"
            className="size-11 rounded-full"
            onClick={() => go(index - 1)}
          >
            <ChevronLeft className="size-[18px]" />
          </Button>
          <span className="min-w-10 text-center font-mono text-[13px] text-zinc-700 tabular-nums">
            {index + 1} / {total}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next jump"
            className="-mr-2 size-11 rounded-full"
            onClick={() => go(index + 1)}
          >
            <ChevronRight className="size-[18px]" />
          </Button>
        </header>
        <ClipViewer clip={clip} />
        <Footer />
      </Page>
    );
  }

  /* ----- The day ----- */
  return (
    <Page>
      <BrandHeader
        eyebrow="Shared session"
        title={view.day ? dayLong(view.day) : "Session"}
      />
      <ListCard>
        {view.clips.map((c, i) => (
          <Link
            key={c.id}
            to={`/d/${token}/${i + 1}`}
            className="flex items-center gap-3 py-2.5 pl-3 pr-2 hover:bg-zinc-50"
          >
            <ClipThumb clip={c} />
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="text-sm font-medium">{modeLabel(c)}</span>
              <span className="truncate text-xs text-muted-foreground">
                {clipSubline(c)}
              </span>
            </span>
            <Headline clip={c} unit={unit} />
            <ChevronRight className="size-4 shrink-0 text-zinc-500" />
          </Link>
        ))}
      </ListCard>
      <Footer />
    </Page>
  );
}
