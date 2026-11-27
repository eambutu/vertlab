import { useCallback, useEffect, useState } from "react";
import { store, type Clip, type LibraryPage } from "../../lib/store";
import { recentLibraryStart, windowStart } from "../../lib/store/library-dates";

interface Window { from: string; before?: string }

export function useLibraryFeed() {
  const [windows, setWindows] = useState<Window[]>(() => [{ from: recentLibraryStart() }]);
  const [feed, setFeed] = useState<LibraryPage>();
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    let current = 0;
    async function refresh() {
      const request = ++current;
      let settled = false;
      if (windows.length === 1 && store.cachedLibraryPage) {
        store.cachedLibraryPage(windows[0].from).then(page => {
          if (alive && current === request && !settled && page && (page.clips.length || page.olderDay)) {
            setFeed(page);
          }
        }).catch(() => {});
      }
      try {
        const pages = await Promise.all(windows.map(w => store.libraryPage(w.from, w.before)));
        if (!alive || current !== request) return;
        const clips = new Map<string, Clip>();
        for (const page of pages) for (const clip of page.clips) clips.set(clip.id, clip);
        settled = true;
        setFeed({
          clips: [...clips.values()].sort((a, b) => b.createdAt - a.createdAt),
          olderDay: pages[pages.length - 1].olderDay,
        });
        setLoaded(windows.length);
        setFailed(false);
      } catch {
        if (alive && current === request) setFailed(true);
      }
    }
    void refresh();
    const unsubscribe = store.subscribe(refresh);
    return () => { alive = false; unsubscribe(); };
  }, [windows, attempt]);

  const olderDay = feed?.olderDay;
  const loadOlder = useCallback(() => {
    if (!olderDay || failed) return;
    setWindows(prev => prev.length !== loaded ? prev : [...prev, {
      from: windowStart(olderDay, 14), before: prev[prev.length - 1].from,
    }]);
  }, [olderDay, loaded, failed]);
  return { feed, failed, loading: loaded < windows.length, loadOlder,
    retry: () => { setFailed(false); setAttempt(n => n + 1); } };
}
