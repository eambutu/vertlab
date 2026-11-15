import { useEffect, useState } from "react";

/**
 * Renders small JPEG thumbnails of a video at the given times, using an
 * offscreen <video>. Returns data URLs in the same order (undefined until ready).
 */
export function useFrameThumbs(
  videoUrl: string | undefined,
  times: number[],
  width = 200,
): (string | undefined)[] {
  const key = times.map((t) => t.toFixed(4)).join(",");
  const [thumbs, setThumbs] = useState<(string | undefined)[]>([]);

  useEffect(() => {
    setThumbs([]);
    if (!videoUrl || times.length === 0) return;
    let cancelled = false;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = videoUrl;

    const seek = (t: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          v.removeEventListener("seeked", done);
          resolve();
        };
        v.addEventListener("seeked", done);
        v.currentTime = t;
      });

    (async () => {
      await new Promise<void>((resolve, reject) => {
        v.addEventListener("loadeddata", () => resolve(), { once: true });
        v.addEventListener("error", () => reject(v.error), { once: true });
      });
      const h = Math.round((width * v.videoHeight) / v.videoWidth) || width;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      for (let i = 0; i < times.length; i++) {
        if (cancelled) return;
        await seek(times[i] + 0.0001);
        ctx.drawImage(v, 0, 0, width, h);
        const url = canvas.toDataURL("image/jpeg", 0.8);
        setThumbs((prev) => {
          const next = [...prev];
          next[i] = url;
          return next;
        });
      }
    })().catch(() => {
      /* thumbnails are decorative; leave placeholders */
    });

    return () => {
      cancelled = true;
      v.removeAttribute("src");
      v.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, key, width]);

  return thumbs;
}
