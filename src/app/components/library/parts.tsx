import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronLeft, Star } from "lucide-react";
import { cn } from "../ui/utils";
import { buttonVariants } from "../ui/button";
import { shortDuration } from "../../lib/format";
import { formatHeadline, modeTitle } from "../../lib/metrics";
import type { HeightUnit } from "../../lib/metrics";
import type { Clip, SharedClip } from "../../lib/store";

/** Warm off-white page shell shared by the library, settings and viewer. */
export function Page({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-screen bg-[#f4f3ef] text-foreground">
      <div
        className={cn("mx-auto w-full max-w-lg px-4 pb-12 sm:px-5", className)}
      >
        {children}
      </div>
    </div>
  );
}

/** Back chevron + title row used on secondary screens. */
export function BackHeader({
  to,
  label,
  title,
  children,
}: {
  to: string;
  label: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-1 pb-2 pt-3">
      <Link
        to={to}
        aria-label={label}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "-ml-2 size-11 rounded-full")}
      >
        <ChevronLeft className="size-5" />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{title}</h1>
      {children}
    </header>
  );
}

/** Uppercase section label ("SHARING", "DAYS"). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </h2>
  );
}

/** White grouped list container with hairline dividers between rows. */
export function ListCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-black/8 bg-white divide-y divide-black/[0.07]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Portrait poster thumbnail with a duration badge. */
export function ClipThumb({
  clip,
  size = "md",
  stacked = false,
  className,
}: {
  clip: Pick<Clip, "poster" | "duration">;
  size?: "sm" | "md";
  stacked?: boolean;
  className?: string;
}) {
  const dur = size === "md" ? shortDuration(clip.duration) : undefined;
  return (
    <span
      aria-hidden
      className={cn(
        "relative block shrink-0",
        size === "md" ? "h-16 w-12" : "h-9 w-7",
        className,
      )}
    >
      {stacked && (
        <span className="absolute -top-1 left-1 -right-1 bottom-1 rounded-[9px] bg-zinc-400" />
      )}
      <span
        className={cn(
          "absolute inset-0 overflow-hidden bg-gradient-to-br from-zinc-700 to-zinc-950",
          size === "md" ? "rounded-[10px]" : "rounded-md",
        )}
      >
        {clip.poster && (
          <img src={clip.poster} alt="" className="size-full object-cover" />
        )}
        {dur && (
          <span className="absolute bottom-0.5 left-1 font-mono text-[9px] text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
            {dur}
          </span>
        )}
      </span>
    </span>
  );
}

export function StarMark({ className }: { className?: string }) {
  return (
    <Star
      role="img"
      aria-label="Starred"
      className={cn("size-3.5 fill-orange-700 text-orange-700", className)}
    />
  );
}

/** "31.4 in" headline, or a muted placeholder when the clip has no result yet. */
export function Headline({
  clip,
  unit,
  className,
}: {
  clip: Pick<Clip, "summary">;
  unit: HeightUnit;
  className?: string;
}) {
  if (!clip.summary) return null;
  const h = formatHeadline(clip.summary, unit);
  return (
    <span
      className={cn(
        "whitespace-nowrap font-mono text-[17px] font-semibold tracking-tight tabular-nums",
        className,
      )}
    >
      {h.value}
      <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">
        {h.unit}
      </span>
    </span>
  );
}

/** The clip's title: its custom label, or the kind of jump. */
export function modeLabel(clip: Pick<Clip, "mode">) {
  return modeTitle(clip.mode);
}

/** Second line under the mode: the result detail, or what's still missing. */
export function clipSubline(clip: Clip | SharedClip): string {
  if ("videoStatus" in clip && clip.videoStatus === "uploading")
    return "Uploading video…";
  if ("videoStatus" in clip && clip.videoStatus === "failed")
    return "Video didn't finish uploading";
  if (clip.summary) return clip.summary.sub;
  const n = clip.keyframes.length;
  if (n === 0) return "Not analyzed yet";
  return `${n} keyframe${n === 1 ? "" : "s"}`;
}
