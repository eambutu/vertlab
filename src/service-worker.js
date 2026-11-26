const CACHE_PREFIX = "vertlab-app-";
const cacheName = CACHE_PREFIX + self.APP_VERSION;
const appAssets = new Set(self.APP_ASSETS);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) =>
    cache.addAll(self.APP_ASSETS.map((url) => new Request(url, { cache: "reload" }))),
  ));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== cacheName)
      .map((key) => caches.delete(key)),
  )));
});

async function appDocument(request) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match("/index.html");
  if (saved && !self.navigator.onLine) return saved;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    // Use the current deployment online, including while a new worker is waiting.
    const response = await fetch(request, { signal: controller.signal });
    if (response.status < 500 || !saved) return response;
  } catch (error) {
    if (!saved) throw error;
  } finally {
    clearTimeout(timeout);
  }
  return saved;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(appDocument(request));
  } else if (appAssets.has(url.pathname)) {
    event.respondWith(caches.open(cacheName).then(async (cache) =>
      (await cache.match(url.pathname)) ?? fetch(request),
    ));
  }
});
