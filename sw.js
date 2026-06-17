/* PromptFoundry Local — Service Worker
 * Makes the app shell + library load fully offline after the first visit.
 * The (large) model weights are cached separately by Transformers.js itself,
 * so we deliberately do NOT duplicate them here.
 */
const VERSION = 'pfl-v1';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
];

// Library/CDN hosts we cache at runtime (stale-while-revalidate).
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'cdn.tailwindcss.com'];
// Model-weight hosts: let Transformers.js own the caching; SW passes through.
const MODEL_HOSTS = ['huggingface.co', 'hf.co'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  // Never intercept model weights — Transformers.js handles those.
  if (MODEL_HOSTS.some((h) => url.hostname.endsWith(h))) return;

  const sameOrigin = url.origin === self.location.origin;
  const isRuntimeCDN = RUNTIME_HOSTS.some((h) => url.hostname.endsWith(h));
  if (!sameOrigin && !isRuntimeCDN) return; // let everything else go straight to network

  // Stale-while-revalidate: serve cache instantly, refresh in background.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: false });
    const network = fetch(request)
      .then((res) => { if (res && res.ok) cache.put(request, res.clone()); return res; })
      .catch(() => null);
    return cached || (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
