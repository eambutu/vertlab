import { useRef, useState, type MouseEvent } from "react";
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
import { localDay, store, useClips, useUnit } from "../../lib/store";
import type { Clip } from "../../lib/store";
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

/** Saves a picked video as a new clip and opens it in the analyzer. */
export function useAddClip() {
  const navigate = useNavigate();
  return async (file: File) => {
    try {
      const clip = await store.createClip(file);
      navigate(`/clip/${clip.id}`);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't save that video", {
        description: "Check your connection and try again.",
      });
    }
  };
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
let lastMenuClose = 0;
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

function AddClipButton({ onFile }: { onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex w-full items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-black/25 bg-white/60 px-3.5 py-3 text-left transition-colors hover:border-black/40 hover:bg-white"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white">
          <Plus className="size-[22px]" strokeWidth={2.2} />
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">Add a clip to today</span>
          <span className="text-xs text-muted-foreground">Record or pick a video</span>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (!f.type.startsWith("video/")) {
            toast.error("Use a video file — MP4, MOV, or WebM.");
            return;
          }
          onFile(f);
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

  async function retry(file?: File) {
    try {
      if (!(await store.retryUpload(clip.id, file))) picker.current?.click();
    } catch (e) {
      console.error("[vertlab upload] retry failed to start", e);
      toast.error("Couldn't retry the upload", {
        description: "Check your connection and try again.",
      });
    }
  }

  return (
    <div className="flex items-center gap-1.5 pr-1.5 has-[[data-state=open]]:bg-zinc-50">
      {failed && (
        <input
          ref={picker}
          type="file"
          accept="video/*"
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
            {clipSubline(clip)}
          </span>
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
                  store.hasLocalVideo(clip.id) ? retry() : picker.current?.click()
                }
              >
                <RotateCw className="size-[17px]" />
                {store.hasLocalVideo(clip.id) ? "Retry upload" : "Re-add video…"}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="mx-1.5" />
            </>
          )}
          <DropdownMenuItem
            className="h-11 rounded-lg px-2.5 text-sm font-medium"
            onSelect={() => store.updateClip(clip.id, { starred: !clip.starred })}
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
  const addClip = useAddClip();
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
  if (clips.length === 0) return <Home onFile={addClip} />;

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
            {day === today && <AddClipButton onFile={addClip} />}
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
        clip={sharing}
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
