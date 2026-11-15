import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { HeightUnit } from "../metrics";
import { LocalClipStore } from "./local-store";
import { SupabaseClipStore } from "./supabase-store";
import type { Clip, ClipStore, Share } from "./types";

export type * from "./types";
export { localDay } from "./local-store";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Supabase when configured (see .env.example), otherwise this browser only. */
export const store: ClipStore =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? new SupabaseClipStore(SUPABASE_URL, SUPABASE_ANON_KEY)
    : new LocalClipStore();

/** False when clips and links live only in this browser. */
export const isCloudBacked = store instanceof SupabaseClipStore;

/** Loads `load()` and reloads it whenever the store changes. */
function useStoreQuery<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      run()
        .then((d) => {
          if (alive) setData(d);
        })
        .catch((e) => {
          console.error(e);
          if (alive)
            toast.error("Couldn't load your library", {
              id: "store-error",
              description: "Check your connection and reload.",
            });
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
