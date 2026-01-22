/* =============================================================================
   sw.js — Yu-Gi-Oh! DB (GitHub Pages PWA)
   - App Shell cached (offline-ready)
   - Stale-While-Revalidate for static assets
   - Network-First for TSV (fallback to cache)
============================================================================= */

const VERSION = "ygo-db-v1.0.0";
const STATIC_CACHE = `${VERSION}-static`;
const DATA_CACHE = `${VERSION}-data`;

/**
 * Ajusta esta lista si cambias nombres o rutas.
 * OJO GitHub Pages: rutas relativas se resuelven bien si el SW está en la raíz.
 */
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./yugioh.webp"
];

// Dominio que consideramos "data" (tu TSV de Google Sheets publicado)
const TSV_HOSTS = new Set([
  "docs.google.com",
  "docs.googleusercontent.com"
]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(APP_SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Limpia caches viejos
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => !k.startsWith(VERSION))
        .map((k) => caches.delete(k))
    );

    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo GET. Nada de meterle mano a POST (tu API de Apps Script).
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Navegación: devuelve index.html (modo SPA-like). Ideal para PWA install.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        // Guarda copia del index por si luego offline
        const cache = await caches.open(STATIC_CACHE);
        cache.put("./index.html", net.clone());
        return net;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  // TSV/data: network-first, fallback a cache
  if (TSV_HOSTS.has(url.hostname) && url.searchParams.get("output") === "tsv") {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // Assets estáticos del mismo origen: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // Default: intenta cache, si no, red
  event.respondWith(cacheFirst(req, STATIC_CACHE));
});

/* =========================
   Strategies
========================= */

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;

  const net = await fetch(request);
  // Solo cachea respuestas ok
  if (net && net.ok) cache.put(request, net.clone());
  return net;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });

  const fetchPromise = fetch(request)
    .then((net) => {
      if (net && net.ok) cache.put(request, net.clone());
      return net;
    })
    .catch(() => null);

  // Si hay cache, úsalo ya; si no, espera red
  return cached || (await fetchPromise) || Response.error();
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const net = await fetch(request);
    if (net && net.ok) cache.put(request, net.clone());
    return net;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    return cached || new Response("Offline y sin datos en caché 😶", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
