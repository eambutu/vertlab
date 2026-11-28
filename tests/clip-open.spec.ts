import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const user = "04f0a970-c335-4b39-9839-d323a74ec0c2";
const id = "87fad0d7-12c7-4a4d-9c77-dd1efea5612a";
const sample = path.resolve("tests/fixtures/clip-24fps.webm");

async function clipPage(page: Page, fps: number | null, times: number[]) {
  const clip = {
    id, user_id: user, mode: "ten-five-rsi", title: "Test clip", fps, keyframes: times,
    video_path: user + "/" + id + "/video.webm", width: 96, height: 64, duration: 2,
    poster: null as string | null, day: "2026-11-27", created_at: "2026-11-27T12:00:00Z",
    summary: null, starred: false,
  };
  const edits: Record<string, unknown>[] = [];
  await page.addInitScript(({ user }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: "test", refresh_token: "test", expires_at: Date.now() / 1000 + 3600,
      user: { id: user, aud: "authenticated" },
    }));
    const counters = { playerSeeks: 0, backgroundSeeks: 0, frameSamples: 0, decoders: 0 };
    Object.assign(window, { counters });
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")!;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      ...desc, set(time: number) {
        if (this.isConnected) counters.playerSeeks++;
        else counters.backgroundSeeks++;
        desc.set!.call(this, time);
      },
    });
    const sampleFrame = HTMLVideoElement.prototype.requestVideoFrameCallback;
    HTMLVideoElement.prototype.requestVideoFrameCallback = function(cb) {
      counters.frameSamples++;
      return sampleFrame.call(this, cb);
    };
    const create = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      if (tag === "video") counters.decoders++;
      return create(tag, options);
    }) as typeof document.createElement;
  }, { user });
  await page.route("**/rest/v1/clips?**", async route => {
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON();
      edits.push(patch);
      Object.assign(clip, patch);
      return route.fulfill({ json: clip });
    }
    await route.fulfill({ json: [clip] });
  });
  await page.route("**/storage/v1/object/sign/clips/**", route =>
    route.fulfill({ json: { signedURL: "/object/sign/clips/sample.webm?token=test" } }));
  await page.route("**/sample.webm?token=test", route =>
    route.fulfill({ path: sample, contentType: "video/webm" }));
  await page.goto("/clip/" + id);
  return { edits, clip };
}

test("a saved FPS opens immediately, and a warm clip needs no thumbnail decoder or player seeks", async ({ page }) => {
  const times = Array.from({ length: 25 }, (_, i) => i / 24);
  const { edits, clip } = await clipPage(page, 59.94, times);
  await expect(page.getByText("12 jumps captured", { exact: false })).toBeVisible();
  await expect(page.getByText("Measuring frame rate…")).toHaveCount(0);
  await expect(page.locator('img[alt^="Keyframe at"]')).toHaveCount(25);
  const counters = () => page.evaluate(() => (window as any).counters);
  expect(await counters()).toMatchObject({ playerSeeks: 0, frameSamples: 0, backgroundSeeks: 24 });
  await expect.poll(() => clip.poster).toBeTruthy();
  expect(clip.keyframes).toEqual(times);
  const writes = edits.length;
  await page.reload();
  await expect(page.locator('img[alt^="Keyframe at"]')).toHaveCount(25);
  await expect.poll(() => page.locator("video").evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThan(1);
  expect(await counters()).toMatchObject({ playerSeeks: 0, backgroundSeeks: 0, frameSamples: 0, decoders: 1 });
  expect(edits).toHaveLength(writes);
});

test("a new clip measures FPS once and reuses a manually captured thumbnail on reopen", async ({ page }) => {
  const { clip } = await clipPage(page, null, []);
  await expect.poll(() => clip.fps, { timeout: 10000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).counters.frameSamples)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Capture this frame" }).click();
  await expect.poll(() => clip.keyframes.length).toBe(1);
  await page.reload();
  await expect(page.locator('img[alt^="Keyframe at"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).counters)).toMatchObject({
    playerSeeks: 0, backgroundSeeks: 0, frameSamples: 0, decoders: 1,
  });
});

test("an unavailable preview decoder leaves the player, marks, and RSI result usable", async ({ page }) => {
  await page.addInitScript(() => {
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!;
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      ...src, set(url: string) {
        if (this.isConnected) src.set!.call(this, url);
        else queueMicrotask(() => this.dispatchEvent(new Event("error")));
      },
    });
  });
  const { clip, edits } = await clipPage(page, 30, [0.25, 0.5, 1.5]);
  await expect(page.getByText("1 jump captured", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture this frame" })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as any).counters.decoders)).toBe(2);
  await expect(page.locator('img[alt^="Keyframe at"]')).toHaveCount(0);
  expect(clip.keyframes).toEqual([0.25, 0.5, 1.5]);
  expect(edits.every(patch => !("keyframes" in patch))).toBe(true);
});
