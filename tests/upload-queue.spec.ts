import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";

const chunk = 6 * 1024 * 1024;
const size = chunk + 2048;
const user = "04f0a970-c335-4b39-9839-d323a74ec0c2";

// Exercise the real IndexedDB outbox, tus client and browser network cancellation.
async function backend(context: BrowserContext, scenario: "conflict" | "hang" | "repeat") {
  const clips = new Map<string, { id: string; title: string; video_path?: string }>();
  const events: string[] = [];
  let offset = 0;
  let held: ServerResponse | undefined;
  await context.addInitScript(({ user }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: "fixture", refresh_token: "test", expires_at: Date.now() / 1000 + 3600,
      user: { id: user, aud: "authenticated" },
    }));
  }, { user });
  await context.route("http://127.0.0.1:5398/rest/v1/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const id = url.searchParams.get("id")?.replace(/^eq\./, "");
    if (!url.pathname.endsWith("/clips")) return route.fulfill({ json: [] });
    if (req.method() === "POST") {
      const row = req.postDataJSON();
      if (!clips.has(row.id)) clips.set(row.id, { keyframes: [], summary: null, mode: "compare", ...row });
      return route.fulfill({ status: 201, json: null });
    }
    if (req.method() === "DELETE") {
      clips.delete(id!);
      return route.fulfill({ status: 204 });
    }
    if (req.method() === "PATCH" && clips.has(id!)) {
      Object.assign(clips.get(id!)!, req.postDataJSON());
      events.push("linked " + clips.get(id!)!.title);
    }
    const rows = [...clips.values()].filter(c => !id || id === c.id || id.includes(c.id));
    return route.fulfill({ json: (url.searchParams.get("day") ?? "").startsWith("lt.") ? [] : rows });
  });
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "HEAD, PATCH, POST, OPTIONS, DELETE");
    res.setHeader("Access-Control-Expose-Headers", "Location, Upload-Offset, Upload-Length");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (req.url?.includes("/object/")) return res.writeHead(200).end("{}");
    if (req.method === "POST") {
      events.push("create session");
      return res.writeHead(201, { Location: "/storage/v1/upload/resumable/session" }).end();
    }
    if (req.method === "HEAD") {
      events.push("HEAD " + offset);
      return res.writeHead(200, { "Upload-Offset": offset, "Upload-Length": size }).end();
    }
    if (req.method !== "PATCH") return res.writeHead(404).end();
    const start = Number(req.headers["upload-offset"]);
    events.push("PATCH " + start);
    if (scenario === "hang" && start === chunk) {
      held = res;
      res.on("close", () => events.push("aborted"));
      return;
    }
    let bytes = 0;
    for await (const data of req) bytes += data.length;
    if (scenario === "repeat" || (scenario === "conflict" && start === chunk)) {
      if (scenario === "conflict") offset = chunk + 1024; // Server accepted part of the lost request.
      return res.writeHead(409).end();
    }
    if (start !== offset) return res.writeHead(409).end();
    offset += bytes;
    return res.writeHead(204, { "Upload-Offset": offset }).end();
  });
  await new Promise<void>(resolve => server.listen(5398, "127.0.0.1", resolve));
  return {
    events, clips,
    close: async () => {
      held?.destroy();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

async function selectBatch(page: Page) {
  await page.goto("/");
  await page.locator('input[multiple]').first().setInputFiles([
    { name: "first.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(size) },
    { name: "second.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(100) },
  ]);
}

test("an offset conflict yields to the second clip and resumes at the server checkpoint", async ({ page, context }) => {
  const api = await backend(context, "conflict");
  try {
    await selectBatch(page);
    await expect(page.getByText(/Waiting to retry/)).toBeVisible();
    await expect.poll(() => api.events).toContain("linked second.mp4");
    await expect.poll(() => api.events, { timeout: 15000 }).toContain("linked first.mp4");
    expect(api.events).toEqual(["create session", "PATCH 0", "PATCH " + chunk, "linked second.mp4",
      "HEAD " + (chunk + 1024), "PATCH " + (chunk + 1024), "linked first.mp4"]);
  } finally { await api.close(); }
});

test("deleting a stalled transfer from another tab aborts it and releases the queue", async ({ page, context }) => {
  const api = await backend(context, "hang");
  try {
    await selectBatch(page);
    await expect(page.getByText("Uploading · 99%")).toBeVisible();
    const other = await context.newPage();
    await other.goto("/");
    const row = other.locator('a[href^="/clip/"]').filter({ hasText: "first.mp4" });
    await row.locator("..").getByRole("button", { name: "More actions" }).click();
    await other.getByRole("menuitem", { name: /Delete/ }).click();
    await other.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(() => api.events).toContain("aborted");
    await expect.poll(() => api.events).toContain("linked second.mp4");
    await expect.poll(() => [...api.clips.values()].map(c => c.title)).toEqual(["second.mp4"]);
    await other.reload();
    await expect(other.locator('a[href^="/clip/"]')).toHaveCount(1);
    expect(api.events).not.toContain("linked first.mp4");
  } finally { await api.close(); }
});

test("repeated failures without progress stop automatically and keep the local file for retry", async ({ page, context }) => {
  const api = await backend(context, "repeat");
  try {
    await page.clock.install();
    await selectBatch(page);
    for (let failures = 1; failures < 5; failures++) {
      await expect.poll(() => api.events.filter(x => x === "PATCH 0").length).toBe(failures);
      await expect(page.getByText(/Waiting to retry/)).toBeVisible();
      await page.clock.fastForward(60_001);
    }
    await expect(page.getByText("Video didn't finish uploading")).toBeVisible();
    await page.clock.fastForward(120_000);
    expect(api.events.filter(x => x === "PATCH 0")).toHaveLength(5);
    const row = page.locator('a[href^="/clip/"]').filter({ hasText: "first.mp4" });
    await row.locator("..").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Retry upload" }).click();
    await expect.poll(() => api.events.filter(x => x === "PATCH 0").length).toBe(6);
  } finally { await api.close(); }
});

test("a silent request times out, yields, and stays deleted after a reload during backoff", async ({ page, context }) => {
  const api = await backend(context, "hang");
  try {
    await page.clock.install();
    await selectBatch(page);
    await expect.poll(() => api.events).toContain("PATCH " + chunk);
    await page.clock.fastForward(46_000);
    await expect(page.getByText(/Waiting to retry/)).toBeVisible();
    await expect.poll(() => api.events).toContain("linked second.mp4");
    await page.reload();
    await expect(page.getByText(/Waiting to retry/)).toBeVisible();
    const row = page.locator('a[href^="/clip/"]').filter({ hasText: "first.mp4" });
    await row.locator("..").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Delete/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await page.clock.fastForward(120_000);
    await expect.poll(() => [...api.clips.values()].map(c => c.title)).toEqual(["second.mp4"]);
    expect(api.events.some(e => e.startsWith("HEAD"))).toBe(false);
  } finally { await api.close(); }
});

test("a clip deleted on another device is discarded before resuming its video", async ({ page, context }) => {
  const api = await backend(context, "conflict");
  try {
    await page.clock.install();
    await selectBatch(page);
    await expect(page.getByText(/Waiting to retry/)).toBeVisible();
    const first = [...api.clips.values()].find(c => c.title === "first.mp4")!;
    api.clips.delete(first.id);
    await page.clock.fastForward(6_000);
    await expect(page.getByText("first.mp4")).toHaveCount(0);
    await expect.poll(() => api.events).toContain("linked second.mp4");
    expect(api.events.some(e => e.startsWith("HEAD"))).toBe(false);
    expect(api.events).not.toContain("linked first.mp4");
  } finally { await api.close(); }
});
