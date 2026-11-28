import { useEffect, useState } from "react";
import { readPreviews, savePreview } from "../../lib/frame-preview-cache";

// Saved timestamps are enough to use the player. Only decode missing images,
// with a separate video so this work never moves or pauses the playhead.
export function useFrameThumbs(videoUrl: string | undefined, times: number[], cacheId?: string, canDecode = true) {
  const key = JSON.stringify(times);
  const [result, setResult] = useState<{ source: string; images: Map<number, string> }>();
  useEffect(() => {
    if (!videoUrl || key === "[]") return;
    const controller = new AbortController();
    const { signal } = controller;
    let video: HTMLVideoElement | undefined;
    async function load() {
      const stamps: number[] = JSON.parse(key);
      const cached = cacheId ? await readPreviews(cacheId, stamps).catch(() => []) : [];
      if (signal.aborted) return;
      const images = new Map<number, string>();
      stamps.forEach((t, i) => { if (cached[i]) images.set(t, cached[i]!); });
      const publish = () => setResult({ source: videoUrl!, images: new Map(images) });
      publish();
      const missing = stamps.filter(t => !images.has(t));
      if (!missing.length || !canDecode) return;
      const v = video = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      function waitFor(event: string, start: () => void) {
        return new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", fail);
            v.removeEventListener("error", fail);
            v.removeEventListener(event, done);
          };
          const fail = () => { cleanup(); reject(new Error("Preview unavailable")); };
          const done = () => { cleanup(); resolve(); };
          const timer = setTimeout(fail, 15000);
          signal.addEventListener("abort", fail, { once: true });
          v.addEventListener("error", fail, { once: true });
          v.addEventListener(event, done, { once: true });
          start();
        });
      }
      await waitFor("loadeddata", () => { v.src = videoUrl!; });
      const canvas = document.createElement("canvas");
      const scale = cacheId ? Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight)) : 200 / v.videoWidth;
      canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      for (const time of missing) {
        if (signal.aborted) return;
        if (v.currentTime !== time) await waitFor("seeked", () => { v.currentTime = time; });
        if (signal.aborted) return;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/jpeg", 0.85);
        images.set(time, image);
        publish();
        if (cacheId) void savePreview(cacheId, time, image).catch(() => {});
      }
    }
    const release = () => {
      if (video) { video.removeAttribute("src"); video.load(); video = undefined; }
    };
    void load().catch(() => { /* Keep timestamps usable if decoding or storage fails. */ }).finally(release);
    return () => { controller.abort(); release(); };
  }, [videoUrl, key, cacheId, canDecode]);
  return result?.source === videoUrl ? result?.images : undefined;
}
