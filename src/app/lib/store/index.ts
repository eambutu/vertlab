import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { HeightUnit } from "../metrics";
import { LocalClipStore } from "./local-store";
import type { Clip, ClipStore, Share } from "./types";

export type * from "./types";
export { localDay } from "./local-store";

// Swap for the Supabase implementation once it exists (see the plan doc).
export const store: ClipStore = new LocalClipStore();

/** Loads `load()` and reloads it whenever the store changes. */
function useStoreQuery<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      run().then((d) => {
        if (alive) setData(d);
      });
    refresh();
    const unsub = store.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, [run]);
  return data;
}

export function useClips(): Clip[] | undefined {
  return useStoreQuery(() => store.listClips(), []);
}

export function useClip(id: string | undefined) {
  return useStoreQuery(
    () => (id ? store.getClip(id) : Promise.resolve(undefined)),
    [id],
  );
}

export function useShares(): Share[] | undefined {
  return useStoreQuery(() => store.listShares(), []);
}

/* ---------- Units setting (per device) ---------- */

const UNIT_KEY = "vertlab.units";
const unitListeners = new Set<() => void>();

function readUnit(): HeightUnit {
  try {
    return localStorage.getItem(UNIT_KEY) === "cm" ? "cm" : "in";
  } catch {
    return "in";
  }
}

export function setUnit(unit: HeightUnit) {
  try {
    localStorage.setItem(UNIT_KEY, unit);
  } catch {
    /* localStorage unavailable */
  }
  unitListeners.forEach((l) => l());
}

export function useUnit(): HeightUnit {
  return useSyncExternalStore(
    (l) => {
      unitListeners.add(l);
      return () => unitListeners.delete(l);
    },
    readUnit,
    () => "in",
  );
}

/* ---------- Share URLs ---------- */

export function shareUrl(share: Pick<Share, "kind" | "token">): string {
  return `${window.location.origin}/${share.kind === "day" ? "d" : "j"}/${share.token}`;
}

/** Display form without the scheme, e.g. "vertlab.app/j/k7q2mx". */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
