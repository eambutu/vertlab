import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  MoreHorizontal,
  Plus,
  RotateCw,
  Settings,
  Share,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { buttonVariants } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { cn } from "../ui/utils";
import { Home } from "../home";
import { dayHeading, plural } from "../../lib/format";
import { isCloudBacked, localDay, store, useClips, useOnline, useUnit } from "../../lib/store";
import type { Clip } from "../../lib/store";
import { describeUploadError, logUpload } from "../../lib/store/upload";
import type { UploaderProps } from "../uploader";
import { ShareClipDrawer, ShareDayDrawer } from "../share/share-drawers";
import { DeleteClipDialog } from "./delete-clip-dialog";
import {
  ClipThumb,
  Headline,
  ListCard,
  Page,
  StarMark,
  clipSubline,
  modeLabel,
} from "./parts";

function useAddClips() {
  const navigate = useNavigate();
  const busy = useRef(false);
  const mounted = useRef(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function onFiles(files: File[]) {
    if (!files.length || busy.current) return;
    busy.current = true;
    setAdding(true);
    const batchId = crypto.randomUUID();
    const context = { batchId, storage: isCloudBacked ? "cloud" : "browser" };
    let added = 0;
    let lastClip: Clip | undefined;
    logUpload("selection received", { ...context, files: files.length });
    try {
      for (const [index, file] of files.entries()) {
        const started = performance.now();
        const details = { ...context, fileNumber: index + 1, bytes: file.size, type: file.type };
        logUpload("adding clip", details);
        try {
          lastClip = await store.createClip(file);
          added += 1;
          logUpload("clip added", {
            ...details, clipId: lastClip.id, videoStatus: lastClip.videoStatus,
            elapsedMs: Math.round(performance.now() - started),
          });
        } catch (error) {
          const failure = describeUploadError(error);
          logUpload("add failed", {
            ...details, ...failure, elapsedMs: Math.round(performance.now() - started),
          }, "error");
          toast.error(`Couldn't add ${file.name}`, {
            description: failure.reason ?? "Check your device storage and try again.",
        });
        }
      }
      const failed = files.length - added;
      logUpload("selection processed", { ...context, added, failed });
      if (files.length === 1 && lastClip && mounted.current) {
        navigate(`/clip/${lastClip.id}`);
      } else if (files.length > 1) {
        toast(`${added} of ${files.length} videos added`, {
          description: failed ? `${plural(failed, "video")} couldn't be added.` : undefined,
        });
      }
    } finally {
      busy.current = false;
      if (mounted.current) setAdding(false);
    }
  }

  return { onFiles, adding };
}

function groupByDay(clips: Clip[]) {
  const days = new Map<string, Clip[]>();
  for (const c of clips) {
    const list = days.get(c.day) ?? [];
    list.push(c);
    days.set(c.day, list);
  }
  return [...days.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
}

// On touch screens the tap that picks a menu item can land on the row
// underneath once the menu closes. Ignore clicks briefly after any menu closes.
let lastMenuClose = -Infinity;
function noteMenu(open: boolean) {
  if (!open) lastMenuClose = performance.now();
}
function swallowGhostClick(e: MouseEvent) {
  // Never the file picker a menu item opened on purpose.
  if (e.target instanceof HTMLInputElement && e.target.type === "file") return;
  if (performance.now() - lastMenuClose < 450) {
    e.preventDefault();
    e.stopPropagation();
  }
}

const ICON_BTN = cn(
  buttonVariants({ variant: "ghost", size: "icon" }),
  "size-11 rounded-full text-zinc-700 data-[state=open]:bg-zinc-200",
);

function AddClipButton({ onFiles, adding }: UploaderProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={adding}
        onClick={() => input.current?.click()}
        className="flex w-full items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-black/25 bg-white/60 px-3.5 py-3 text-left transition-colors hover:border-black/40 hover:bg-white"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white">
          <Plus className="size-[22px]" strokeWidth={2.2} />
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">
            {adding ? "Adding videos…" : "Add clips to today"}
          </span>
          <span className="text-xs text-muted-foreground">Record or pick videos</span>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="video/*,.mp4,.m4v,.mov,.webm"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          onFiles(files);
        }}
      />
    </>
  );
}

function ClipRow({
  clip,
  onShare,
  onDelete,
}: {
  clip: Clip;
  onShare: () => void;
  onDelete: () => void;
}) {
  const unit = useUnit();
  const picker = useRef<HTMLInputElement>(null);
  const failed = clip.videoStatus === "failed";
  const hasLocalVideo = failed && store.hasLocalVideo(clip.id);
  const showFileName = clip.videoStatus !== "ready" || (!clip.summary && !clip.keyframes.length);

  async function retry(file?: File) {
    try {
      if (!(await store.retryUpload(clip.id, file))) picker.current?.click();
    } catch (error) {
      const details = describeUploadError(error);
      logUpload("retry could not start", { clipId: clip.id, ...details }, "error");
      toast.error("Couldn't retry the upload", {
        description: details.reason ?? "Check your connection and try again.",
      });
    }
  }

  return (
    <div className="flex items-center gap-1.5 pr-1.5 has-[[data-state=open]]:bg-zinc-50">
      {failed && (
        <input
          ref={picker}
          type="file"
          accept="video/*,.mp4,.m4v,.mov,.webm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) retry(f);
          }}
        />
      )}
      <Link
        to={`/clip/${clip.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 outline-none focus-visible:bg-zinc-50"
      >
        <ClipThumb clip={clip} />
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {modeLabel(clip)}
            {clip.starred && <StarMark />}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {showFileName ? clip.title : clipSubline(clip)}
          </span>
          {clip.videoStatus !== "ready" && (
            <span className="text-xs text-muted-foreground">{clipSubline(clip)}</span>
          )}
        </span>
        <Headline clip={clip} unit={unit} />
      </Link>
      <DropdownMenu onOpenChange={noteMenu}>
        <DropdownMenuTrigger aria-label="More actions" className={ICON_BTN}>
          <MoreHorizontal className="size-[18px]" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
          {failed && (
            <>
              <DropdownMenuItem
                className="h-11 rounded-lg px-2.5 text-sm font-medium"
                onSelect={() =>
                  // Open the picker inside the tap when there's no copy here;
                  // phones block file pickers opened later.
                  hasLocalVideo ? retry() : picker.current?.click()
                }
              >
                <RotateCw className="size-[17px]" />
                {hasLocalVideo ? "Retry upload" : "Re-add video…"}
              </DropdownMenuItem>
              {hasLocalVideo && (
                <DropdownMenuItem
                  className="h-11 rounded-lg px-2.5 text-sm font-medium"
                  onSelect={() => picker.current?.click()}
                >
                  <Plus className="size-[17px]" />
                  Choose another video…
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="mx-1.5" />
            </>
          )}
          <DropdownMenuItem
            className="h-11 rounded-lg px-2.5 text-sm font-medium"
            onSelect={() => {
              void store.updateClip(clip.id, { starred: !clip.starred })
                .catch(() => toast.error("Couldn't save your changes"));
            }}
          >
            <Star
              className={cn(
                "size-[17px]",
                clip.starred && "fill-orange-700 text-orange-700",
              )}
            />
            {clip.starred ? "Unstar" : "Star"}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-11 rounded-lg px-2.5 text-sm font-medium"
            onSelect={onShare}
          >
            <Share className="size-[17px]" />
            Share…
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-1.5" />
          <DropdownMenuItem
            variant="destructive"
            className="h-11 rounded-lg px-2.5 text-sm font-medium"
            onSelect={onDelete}
          >
            <Trash2 className="size-[17px]" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function Library() {
  const clips = useClips();
  const online = useOnline();
  const uploader = useAddClips();
  const [sharing, setSharing] = useState<Clip | null>(null);
  const [sharingDay, setSharingDay] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Clip | null>(null);

  if (clips === undefined) {
    return (
      <Page>
        <div className="space-y-4 pt-6">
          <Skeleton className="h-9 w-40 bg-black/5" />
          <Skeleton className="h-20 w-full rounded-2xl bg-black/5" />
          <Skeleton className="h-64 w-full rounded-2xl bg-black/5" />
        </div>
      </Page>
    );
  }

  // First run: keep the original landing page as the empty state.
  if (clips.length === 0) return <Home {...uploader} />;

  const today = localDay();
  const days = groupByDay(clips);
  if (!days.some(([d]) => d === today)) days.unshift([today, []]);

  return (
    <Page>
      <header className="flex items-end justify-between gap-3 pb-3 pt-5">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
            VertLab
          </p>
          <h1 className="text-[30px] font-semibold leading-none tracking-tight">
            Library
          </h1>
        </div>
        <Link to="/settings" aria-label="Settings" className={cn(ICON_BTN, "-mr-1.5")}>
          <Settings className="size-[21px]" />
        </Link>
      </header>

      {isCloudBacked && !online && (
        <p role="status" className="px-1 pt-2 text-sm text-muted-foreground">
          You're offline. Videos saved on this device will sync when you're back online.
        </p>
      )}

      <div className="flex flex-col gap-[18px] pt-2" onClickCapture={swallowGhostClick}>
        {days.map(([day, dayClips]) => (
          <section key={day} className="flex flex-col gap-2">
            <div className="flex items-center justify-between pt-2.5">
              <h2 className="text-[13px] font-semibold">{dayHeading(day)}</h2>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">
                  {plural(dayClips.length, "jump")}
                </span>
                {dayClips.length > 0 && (
                  <DropdownMenu onOpenChange={noteMenu}>
                    <DropdownMenuTrigger
                      aria-label="Day actions"
                      className={cn(ICON_BTN, "-mr-1.5 size-9")}
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
                      <DropdownMenuItem
                        className="h-11 rounded-lg px-2.5 text-sm font-medium"
                        onSelect={() => setSharingDay(day)}
                      >
                        <Share className="size-[17px]" />
                        Share day…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
            {day === today && <AddClipButton {...uploader} />}
            {dayClips.length > 0 && (
              <ListCard>
                {dayClips.map((c) => (
                  <ClipRow
                    key={c.id}
                    clip={c}
                    onShare={() => setSharing(c)}
                    onDelete={() => setDeleting(c)}
                  />
                ))}
              </ListCard>
            )}
          </section>
        ))}
      </div>

      <ShareClipDrawer
        clip={clips.find((clip) => clip.id === sharing?.id) ?? null}
        open={!!sharing}
        onOpenChange={(o) => !o && setSharing(null)}
      />
      <ShareDayDrawer
        day={sharingDay}
        clips={clips.filter((c) => c.day === sharingDay)}
        open={!!sharingDay}
        onOpenChange={(o) => !o && setSharingDay(null)}
      />
      <DeleteClipDialog
        clip={deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
      />
    </Page>
  );
}
