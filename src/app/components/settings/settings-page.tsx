import { Link } from "react-router";
import { ChevronRight, Link2, Link2Off, Copy } from "lucide-react";
import { toast } from "sonner";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Button } from "../ui/button";
import {
  BackHeader,
  ClipThumb,
  ListCard,
  Page,
  SectionLabel,
  modeLabel,
} from "../library/parts";
import { copyLink } from "../share/link-field";
import { dayShort, plural, sharedWhen, whenRecorded } from "../../lib/format";
import { formatHeadline } from "../../lib/metrics";
import type { HeightUnit } from "../../lib/metrics";
import {
  displayUrl,
  setUnit,
  shareUrl,
  store,
  useClips,
  useShares,
  useUnit,
} from "../../lib/store";
import type { Clip, Share } from "../../lib/store";

export function SettingsPage() {
  const shares = useShares();
  const unit = useUnit();

  return (
    <Page>
      <BackHeader to="/" label="Back to library" title="Settings" />
      <div className="flex flex-col gap-[18px] pt-2">
        <section className="flex flex-col gap-1.5">
          <SectionLabel>Sharing</SectionLabel>
          <ListCard>
            <Link
              to="/settings/shared"
              className="flex min-h-14 items-center gap-3 pl-3.5 pr-3 hover:bg-zinc-50"
            >
              <Link2 className="size-[18px] text-zinc-700" />
              <span className="flex-1 text-[15px]">Shared links</span>
              <span className="text-[13px] text-muted-foreground">
                {shares ? `${shares.length} live` : ""}
              </span>
              <ChevronRight className="size-4 text-zinc-500" />
            </Link>
          </ListCard>
        </section>

        <section className="flex flex-col gap-1.5">
          <SectionLabel>Units</SectionLabel>
          <ToggleGroup
            type="single"
            aria-label="Height units"
            value={unit}
            onValueChange={(v) => v && setUnit(v as HeightUnit)}
            className="grid w-full grid-cols-2 gap-1 rounded-xl bg-black/[0.07] p-1"
          >
            {(
              [
                ["in", "Inches"],
                ["cm", "Centimeters"],
              ] as const
            ).map(([value, label]) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="h-10 rounded-[9px]! text-[13px] font-semibold text-zinc-600 hover:bg-transparent data-[state=on]:bg-white data-[state=on]:text-foreground data-[state=on]:shadow-sm"
              >
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>
      </div>
    </Page>
  );
}

function shareTitle(share: Share, clips: Map<string, Clip>, unit: HeightUnit) {
  if (share.kind === "day") return share.day ? dayShort(share.day) : "Day";
  const c = clips.get(share.clipIds[0]);
  if (!c) return "Jump";
  if (!c.summary) return modeLabel(c);
  const h = formatHeadline(c.summary, unit);
  return `${modeLabel(c)} · ${h.value}${h.unit === "RSI" ? "" : ` ${h.unit}`}`;
}

function shareMeta(share: Share, clips: Map<string, Clip>) {
  if (share.kind === "day") {
    const total = [...clips.values()].filter((c) => c.day === share.day).length;
    const n = share.clipIds.length;
    const count = n === total ? plural(n, "jump") : `${n} of ${total} jumps`;
    return `${count} · ${sharedWhen(share.createdAt)}`;
  }
  const c = clips.get(share.clipIds[0]);
  return c ? whenRecorded(c.createdAt) : "";
}

export function SharedLinksPage() {
  const shares = useShares();
  const clipList = useClips();
  const unit = useUnit();
  const clips = new Map((clipList ?? []).map((c) => [c.id, c]));

  const groups = [
    { name: "Days", items: (shares ?? []).filter((s) => s.kind === "day") },
    { name: "Single jumps", items: (shares ?? []).filter((s) => s.kind === "clip") },
  ].filter((g) => g.items.length);

  return (
    <Page>
      <BackHeader to="/settings" label="Back to settings" title="Shared links" />
      <p className="px-1 pb-3.5 text-[13px] text-muted-foreground">
        Everything anyone can open right now. Stopping a link breaks it
        immediately.
      </p>

      {shares && groups.length === 0 && (
        <div className="rounded-2xl border border-dashed border-black/15 p-8 text-center text-sm text-muted-foreground">
          Nothing is shared. Use Share… on a jump or a day in your library.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <section key={g.name} className="flex flex-col gap-1.5">
            <SectionLabel>{g.name}</SectionLabel>
            <ListCard>
              {g.items.map((s) => {
                const first = clips.get(s.clipIds[0]);
                const url = shareUrl(s);
                return (
                  <div key={s.id} className="flex items-center gap-3 py-2.5 pl-3 pr-1.5">
                    <ClipThumb
                      clip={first ?? {}}
                      stacked={s.kind === "day"}
                      className="h-14 w-11"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {shareTitle(s, clips, unit)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {shareMeta(s, clips)}
                      </span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {displayUrl(url)}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Copy link"
                      className="size-11 rounded-full"
                      onClick={() => copyLink(url)}
                    >
                      <Copy className="size-[17px]" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Stop sharing"
                      className="size-11 rounded-full text-red-700 hover:bg-red-50 hover:text-red-800"
                      onClick={async () => {
                        await store.stopSharing(s.id);
                        toast("Link stopped");
                      }}
                    >
                      <Link2Off className="size-[17px]" />
                    </Button>
                  </div>
                );
              })}
            </ListCard>
          </section>
        ))}
      </div>
    </Page>
  );
}
