import { useEffect, useState } from "react";
import { Globe, Link2Off } from "lucide-react";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { cn } from "../ui/utils";
import { dayShort, whenRecorded } from "../../lib/format";
import { isCloudBacked, shareUrl, store, useOnline, useUnit } from "../../lib/store";
import type { Clip, Share } from "../../lib/store";
import { LinkField } from "./link-field";
import { ClipThumb, Headline, clipSubline, modeLabel } from "../library/parts";

const SHEET = "mx-auto max-w-lg rounded-t-3xl border-0 bg-white px-5 pb-7";

function StopSharingButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      className="h-12 w-full rounded-[14px] bg-red-50 font-semibold text-red-700 hover:bg-red-100 hover:text-red-800"
      onClick={onClick}
    >
      <Link2Off className="size-4" />
      Stop sharing
    </Button>
  );
}

/* ---------------- Share one jump ---------------- */

export function ShareClipDrawer({
  clip,
  open,
  onOpenChange,
}: {
  clip: Clip | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const unit = useUnit();
  const online = useOnline();
  const [share, setShare] = useState<Share | null>(null);
  const canShare = !!clip && (!isCloudBacked || (online && clip.videoStatus === "ready"));

  // Opening the sheet makes (or reuses) the link, as in the design.
  useEffect(() => {
    if (!open || !clip) return;
    setShare(null);
    if (!canShare) return;
    let alive = true;
    void store.shareClip(clip.id).then((s) => alive && setShare(s)).catch(() => {
      if (alive) toast.error("Couldn't create the link. Try again when you're online.");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clip?.id, canShare]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className={SHEET}>
        {clip && (
          <div className="flex flex-col gap-4 pt-4">
            <DrawerHeader className="flex-row items-center gap-3 p-0 text-left">
              <ClipThumb clip={clip} />
              <div className="min-w-0 flex-1">
                <DrawerTitle className="text-lg">Share this jump</DrawerTitle>
                <DrawerDescription className="text-[13px]">
                  {modeLabel(clip)} · {whenRecorded(clip.createdAt)}
                </DrawerDescription>
              </div>
              <Headline clip={clip} unit={unit} className="text-xl" />
            </DrawerHeader>

            <div className="flex items-center gap-2.5 rounded-[14px] bg-zinc-100 px-3.5 py-3">
              <Globe className="size-[18px] shrink-0 text-zinc-700" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Anyone with the link</span>
                <span className="text-xs text-muted-foreground">
                  Can watch the clip and see its numbers. No sign-in.
                </span>
              </div>
            </div>

            {canShare ? <LinkField url={share ? shareUrl(share) : undefined} /> : (
              <p className="text-sm text-muted-foreground">
                {online ? "You can share this clip once its video has synced." : "Connect to the internet to share this clip."}
              </p>
            )}
            {share && canShare && (
              <StopSharingButton
                onClick={async () => {
                  await store.stopSharing(share.id);
                  onOpenChange(false);
                  toast("Link stopped", {
                    description: "Anyone who opens it now sees it's unavailable.",
                  });
                }}
              />
            )}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/* ---------------- Share a whole day ---------------- */

export function ShareDayDrawer({
  day,
  clips,
  open,
  onOpenChange,
}: {
  day: string | null;
  clips: Clip[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const unit = useUnit();
  const online = useOnline();
  const [share, setShare] = useState<Share | null>(null);
  const [included, setIncluded] = useState<string[]>([]);

  // Oldest first, the order the session happened in.
  const ordered = clips.filter((clip) => !isCloudBacked || clip.videoStatus === "ready")
    .sort((a, b) => a.createdAt - b.createdAt);
  const orderedKey = ordered.map((c) => c.id).join(",");
  const canShare = ordered.length > 0 && (!isCloudBacked || online);

  useEffect(() => {
    if (!open || !day) return;
    setShare(null);
    if (!canShare) return;
    let alive = true;
    void (async () => {
      const existing = (await store.listShares()).find(
        (s) => s.kind === "day" && s.day === day,
      );
      const ids = existing
        ? ordered.filter((c) => existing.clipIds.includes(c.id)).map((c) => c.id)
        : ordered.map((c) => c.id);
      const s = existing ?? await store.shareDay(day, ids);
      if (alive) {
        setIncluded(ids);
        setShare(s);
      }
    })().catch(() => {
      if (alive) toast.error("Couldn't create the link. Try again when you're online.");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day, orderedKey, canShare]);

  async function toggle(id: string, on: boolean) {
    if (!day) return;
    const next = ordered
      .map((c) => c.id)
      .filter((c) => (c === id ? on : included.includes(c)));
    if (next.length === 0) {
      toast("Keep at least one jump in the link");
      return;
    }
    try {
      setShare(await store.shareDay(day, next));
      setIncluded(next);
    } catch {
      toast.error("Couldn't update the link. Try again when you're online.");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className={SHEET}>
        {day && (
          <div className="flex min-h-0 flex-col gap-3.5 pt-4">
            <DrawerHeader className="gap-1 p-0 text-left">
              <DrawerTitle className="text-lg">Share {dayShort(day)}</DrawerTitle>
              <DrawerDescription className="text-[13px]">
                {!canShare ? (online ? "You can share these clips once their videos have synced."
                  : "Connect to the internet to share this day.")
                  : ordered.length < clips.length ? "Choose which synced clips to include in the link."
                  : "One link that opens the whole day. Untick anything you'd rather leave out."}
              </DrawerDescription>
            </DrawerHeader>

            {canShare && <>
            {/* A div, not a fieldset: fieldsets don't reliably shrink and clip
                inside a flex column, so the list spilled over the footer. */}
            <div
              role="group"
              aria-label="Jumps to include"
              data-vaul-no-drag
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[14px] border border-black/10"
            >
              <div className="divide-y divide-black/[0.07]">
                {ordered.map((c) => {
                  const on = included.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2"
                    >
                      <Checkbox
                        checked={on}
                        onCheckedChange={(v) => toggle(c.id, v === true)}
                        className="size-5 rounded-[5px]"
                      />
                      <span className={cn("contents", !on && "[&>*]:opacity-45")}>
                        <ClipThumb clip={c} size="sm" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-[13px] font-medium">{modeLabel(c)}</span>
                          <span className="truncate text-[11px] text-muted-foreground">
                            {clipSubline(c)}
                          </span>
                        </span>
                        <Headline clip={c} unit={unit} className="text-sm" />
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-3.5">
              <LinkField
                url={share ? shareUrl(share) : undefined}
                label="Copy link"
                showGlobe
                className="border-0 bg-zinc-100"
              />
              <p className="-mt-1.5 text-xs text-muted-foreground">
                {included.length} of {ordered.length} jumps included. Anyone with this link can browse your other shared days.
              </p>

              <StopSharingButton
                onClick={async () => {
                  if (share) await store.stopSharing(share.id);
                  onOpenChange(false);
                  toast("Link stopped");
                }}
              />
            </div>
            </>}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
