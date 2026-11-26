import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { HeightUnit } from "../metrics";
import { LocalClipStore } from "./local-store";
import { SupabaseClipStore } from "./supabase-store";
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "../supabase";
import type { Clip, ClipStore, Share, StorageUsage } from "./types";

export type * from "./types";
export { localDay } from "./local-store";

/** Supabase when configured (see .env.example), otherwise this browser only. */
export const store: ClipStore =
  supabase && SUPABASE_URL && SUPABASE_ANON_KEY
    ? new SupabaseClipStore(supabase, SUPABASE_URL, SUPABASE_ANON_KEY)
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
    let latest = 0;
    const refresh = () => {
      const request = ++latest;
      return run()
        .then((d) => {
          if (alive && request === latest) setData(d);
        })
        .catch((e) => {
          if (!alive || request !== latest) return;
          console.error(e);
          toast.error("Couldn't load your library", {
            id: "store-error",
            description: "Check your connection and reload.",
          });
        });
    };
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

/** Reloads with the library, so adding or deleting a clip updates it. */
export function useStorageUsage(): StorageUsage | null | undefined {
  return useStoreQuery(() => store.storageUsage(), []);
}

export function usePendingStorageUsage(): StorageUsage | null | undefined {
  return useStoreQuery(
    () => store instanceof SupabaseClipStore ? store.pendingStorageUsage() : Promise.resolve(null),
    [],
  );
}

function subscribeConnection(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribeConnection, () => navigator.onLine, () => true);
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

/* ---------- Error ranges setting (per device) ---------- */

const ERRORS_KEY = "vertlab.showErrors";
const errorListeners = new Set<() => void>();

function readShowErrors(): boolean {
  try {
    return localStorage.getItem(ERRORS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setShowErrors(show: boolean) {
  try {
    localStorage.setItem(ERRORS_KEY, show ? "1" : "0");
  } catch {
    /* localStorage unavailable */
  }
  errorListeners.forEach((l) => l());
}

/** Whether results show ± ranges from the video's frame rate. */
export function useShowErrors(): boolean {
  return useSyncExternalStore(
    (l) => {
      errorListeners.add(l);
      return () => errorListeners.delete(l);
    },
    readShowErrors,
    () => false,
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
