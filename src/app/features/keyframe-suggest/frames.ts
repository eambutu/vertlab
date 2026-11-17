// Frame-exact access to a video by stepping an offscreen <video> element.
// Frame i is shown at i/fps; we seek slightly past that, matching the
// analyzer's own frame stepping so times line up with hand-captured ones.

const SEEK_TIMEOUT_MS = 3000;

export class FrameReader {
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;

  private constructor(
    private video: HTMLVideoElement,
    readonly fps: number,
  ) {
    this.width = video.videoWidth;
    this.height = video.videoHeight;
    this.frameCount = Math.max(1, Math.floor(video.duration * fps));
  }

  static async open(url: string, fps: number): Promise<FrameReader> {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    await new Promise<void>((resolve, reject) => {
      v.addEventListener("loadeddata", () => resolve(), { once: true });
      v.addEventListener(
        "error",
        () => reject(new Error("This video couldn't be read.")),
        { once: true },
      );
    });
    if (!v.videoWidth || !isFinite(v.duration)) {
      throw new Error("This video couldn't be read.");
    }
    return new FrameReader(v, fps);
  }

  timeOf(frame: number): number {
    return (frame + 0.001) / this.fps;
  }

  frameOf(time: number): number {
    return Math.round(time * this.fps);
  }

  clampFrame(frame: number): number {
    return Math.max(0, Math.min(this.frameCount - 1, frame));
  }

  /** Shows frame `i` in the hidden video. */
  seek(frame: number): Promise<void> {
    const v = this.video;
    const t = this.timeOf(this.clampFrame(frame));
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        v.removeEventListener("seeked", done);
        resolve();
      };
      const timer = setTimeout(done, SEEK_TIMEOUT_MS);
      v.addEventListener("seeked", done);
      v.currentTime = t;
    });
  }

  /** Draws the current frame (or a crop of it, in source pixels) into ctx. */
  draw(
    ctx: CanvasRenderingContext2D,
    dw: number,
    dh: number,
    crop?: { x: number; y: number; w: number; h: number },
  ) {
    if (crop) {
      ctx.drawImage(this.video, crop.x, crop.y, crop.w, crop.h, 0, 0, dw, dh);
    } else {
      ctx.drawImage(this.video, 0, 0, dw, dh);
    }
  }

  /** JPEG of the current frame at `width` px wide. */
  snapshot(width: number): string {
    const w = Math.min(width, this.width);
    const h = Math.round((w * this.height) / this.width);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    this.draw(c.getContext("2d")!, w, h);
    return c.toDataURL("image/jpeg", 0.82);
  }

  close() {
    this.video.removeAttribute("src");
    this.video.load();
  }
}
