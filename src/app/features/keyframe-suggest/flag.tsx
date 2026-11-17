// Labs switch for suggested keyframes. Everything for this feature lives in
// this folder; to remove it, delete the folder and the few imports of it
// (settings page, analyzer, App routes).
import { useSyncExternalStore } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { Switch } from "../../components/ui/switch";

const KEY = "vertlab.labs.suggestKeyframes";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSuggestKeyframes(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* localStorage unavailable */
  }
  listeners.forEach((l) => l());
}

/** Whether the analyzer offers "Find keyframes" (per device, off by default). */
export function useSuggestKeyframes(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => false,
  );
}

/** Modes the finder knows how to read. */
export const SUGGEST_MODES = ["approach-jump", "depth-jump", "ten-five-rsi"];

/** Settings rows: the switch, plus the accuracy test when it's on. */
export function SuggestKeyframesSetting() {
  const on = useSuggestKeyframes();
  return (
    <>
      <label
        htmlFor="suggest-keyframes"
        className="flex min-h-14 cursor-pointer items-center gap-3 py-2.5 pl-3.5 pr-3"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px]">Suggest keyframes</span>
          <span className="text-xs text-muted-foreground">
            Finds likely frames for each event. You flip between 4 and pick
            the right one.
          </span>
        </span>
        <Switch
          id="suggest-keyframes"
          checked={on}
          onCheckedChange={setSuggestKeyframes}
        />
      </label>
      {on && (
        <Link
          to="/labs/keyframe-accuracy"
          className="flex min-h-12 items-center gap-3 pl-3.5 pr-3 text-[15px] hover:bg-zinc-50"
        >
          <span className="flex-1">Test accuracy on your clips</span>
          <ChevronRight className="size-4 text-zinc-500" />
        </Link>
      )}
    </>
  );
}
