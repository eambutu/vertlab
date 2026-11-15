import { useState } from "react";
import { Check, Copy, Globe } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";
import { displayUrl } from "../../lib/store";

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
    return true;
  } catch {
    toast.error("Couldn't copy — select the link and copy it manually");
    return false;
  }
}

/** Mono URL with a Copy button, as in the share sheets. */
export function LinkField({
  url,
  label = "Copy",
  showGlobe = false,
  className,
}: {
  url: string | undefined;
  label?: string;
  showGlobe?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[14px] border border-black/12 py-1.5 pl-3.5 pr-1.5",
        className,
      )}
    >
      {showGlobe && <Globe className="size-4 shrink-0 text-zinc-700" />}
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
        {url ? displayUrl(url) : "Creating link…"}
      </span>
      <Button
        className="h-10 rounded-[10px] px-3.5"
        disabled={!url}
        onClick={async () => {
          if (url && (await copyLink(url))) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : label}
      </Button>
    </div>
  );
}
