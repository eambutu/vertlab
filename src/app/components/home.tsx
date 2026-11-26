import type { ReactNode } from "react";
import { Link } from "react-router";
import { Cloud, Settings, Timer } from "lucide-react";
import { buttonVariants } from "./ui/button";
import { cn } from "./ui/utils";
import { Uploader, type UploaderProps } from "./uploader";
import { isCloudBacked } from "../lib/store";

function Mark() {
  return (
    <div
      aria-hidden
      className="relative flex size-14 items-center justify-center rounded-2xl bg-zinc-950 text-white shadow-[0_18px_40px_-18px_rgba(24,24,27,0.7)]"
    >
      <span className="text-[1.7rem] font-semibold leading-none tracking-tight">
        V
      </span>
    </div>
  );
}

/** Brand hero on the warm grid background, shared by Home and sign-in. */
export function HeroShell({
  children,
  footer,
  corner,
}: {
  children: ReactNode;
  footer?: ReactNode;
  /** Top-right control, e.g. the settings gear. */
  corner?: ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f4f3ef] text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(24,24,27,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(24,24,27,0.04)_1px,transparent_1px)] bg-[size:56px_56px]" />
        <div className="absolute inset-0 bg-[radial-gradient(900px_420px_at_50%_-10%,rgba(255,255,255,0.95),transparent_70%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#f4f3ef] to-transparent" />
      </div>

      {corner && <div className="absolute right-3 top-3 z-10">{corner}</div>}

      <div className="relative mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center px-4 py-16 sm:px-5">
        <div className="mb-8 flex w-full min-w-0 flex-col items-center text-center">
          <Mark />
          <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Jump performance lab
          </p>
          <h1 className="mt-2 text-[2.75rem] font-semibold leading-none tracking-tight">
            VertLab
          </h1>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
            Frame-by-frame analysis of approach jumps, depth jumps and 10-5 RSI,
            down to the millisecond.
          </p>
        </div>

        {children}

        {footer && (
          <div className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Home(props: UploaderProps) {
  return (
    <HeroShell
      corner={
        <Link
          to="/settings"
          aria-label="Settings"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "size-11 rounded-full text-zinc-700",
          )}
        >
          <Settings className="size-[21px]" />
        </Link>
      }
      footer={
        isCloudBacked ? (
          <>
            <Cloud className="size-3.5" />
            Clips are saved on this device first and sync when you're online
          </>
        ) : (
          <>
            <Timer className="size-3.5" />
            Videos stay on this device
          </>
        )
      }
    >
      <Uploader {...props} />
    </HeroShell>
  );
}
