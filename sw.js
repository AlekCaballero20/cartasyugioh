/* =============================================================================
   sw.js — Yu-Gi-Oh! DB (GitHub Pages PWA) — v1.3.0
   - App Shell precached (offline-ready)
   - Navigation fallback to cached index.html (SPA-friendly)
   - Same-origin assets: Stale-While-Revalidate (ignoring cache-bust params)
   - TSV (Sheets published): Network-First + cache fallback (ignoring search if needed)
   - Avoids caching opaque / non-OK responses
   - Supports SKIP_WAITING + CLIENTS_CLAIM messages
============================================================================= */

"use strict";

const VERSION = "ygo-db-v1.3.0"; // súbelo cuando publiques cambios
const STATIC_CACHE = `${VERSION}-static`;
const DATA_CACHE = `${VERSION}-data`;

/**
 * App shell (rutas relativas para GitHub Pages).
 * Mantén esto alineado con tu repo.
 */
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./yugioh.webp",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Hosts de TSV (Sheets publicado)
const TSV_HOSTS = new Set(["docs.google.com", "docs.googleusercontent.com"]);

// Query params típicos de cache-bust que queremos ignorar al cachear assets
const IGNORED_SEARCH_PARAMS = new Set(["_ts", "ts", "v", "ver", "cachebust"]);

/* =========================
   Install / Activate
========================= */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);

      // Forzamos red en install para evitar que el SW nuevo quede con shell viejo.
      // Si algo falla, igual dejamos que el SW se instale; la app funciona sin offline.
      try {
        await cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: "reload" })));
      } catch (err) {
        // Silent: no rompemos instalación por un icon que no exista, etc.
      }

      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Borra caches antiguos
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));

      await self.clients.claim();
    })()
  );
});

/**
 * Permite que tu app fuerce actualización:
 * navigator.serviceWorker.controller?.postMessage({ type: "SKIP_WAITING" })
 */
self.addEventListener("message", (event) => {
  const type = event?.data?.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
  if (type === "CLIENTS_CLAIM") self.clients.claim();
});

/* =========================
   Fetch
========================= */

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo GET. POST/PUT/etc no se tocan.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Solo http/https
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // 1) Navegación (HTML): network-first + fallback offline a index cacheado
  if (isNavigationRequest(req)) {
    event.respondWith(navigationHandler(req));
    return;
  }

  // 2) TSV publicado: network-first (fallback cache data)
  if (isTSVRequest(url)) {
    event.respondWith(networkFirst(req, DATA_CACHE, { ignoreSearchOnFallback: true }));
    return;
  }

  // 3) Same-origin assets: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // 4) Default: network (sin cache) para externos. Menos magia, menos bugs raros.
  // Si quieres cachear externos, cambia esto por cacheFirst(...).
  return;
});

/* =========================
   Navigation handler
========================= */

async function navigationHandler(request) {
  const cache = await caches.open(STATIC_CACHE);

  try {
    // Importante: pedir HTML explícitamente reduce respuestas raras en algunos hosts
    const net = await fetch(request);

    if (net && net.ok) {
      // Cachea una copia de index.html para offline (SPA fallback)
      // Nota: guardamos con key fija para match simple
      await cache.put("./index.html", net.clone());
    }

    return net;
  } catch (err) {
    const cached = await cache.match("./index.html", { ignoreSearch: true });
    return (
      cached ||
      new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

/* =========================
   Strategies
========================= */

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const key = normalizeRequestForCache_(request);

  const cached = await cache.match(key, { ignoreSearch: true });
  if (cached) return cached;

  const net = await fetch(request);
  if (await shouldCacheResponse_(net, request)) await cache.put(key, net.clone());
  return net;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const key = normalizeRequestForCache_(request);

  const cached = await cache.match(key, { ignoreSearch: true });

  const updatePromise = (async () => {
    try {
      const net = await fetch(request);
      if (await shouldCacheResponse_(net, request)) await cache.put(key, net.clone());
      return net;
    } catch (e) {
      return null;
    }
  })();

  return cached || (await updatePromise) || Response.error();
}

async function networkFirst(request, cacheName, opts = {}) {
  const cache = await caches.open(cacheName);

  try {
    const net = await fetch(request);
    if (await shouldCacheResponse_(net, request)) await cache.put(request, net.clone());
    return net;
  } catch (err) {
    const cached = await cache.match(request, {
      ignoreSearch: Boolean(opts.ignoreSearchOnFallback),
    });

    return (
      cached ||
      new Response("Offline y sin datos en caché 😶", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

/* =========================
   Utils
========================= */

function isNavigationRequest(req) {
  // req.mode === "navigate" es lo usual,
  // pero algunos casos (Safari / reload) se benefician con Accept: text/html
  if (req.mode === "navigate") return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

function isTSVRequest(url) {
  if (!TSV_HOSTS.has(url.hostname)) return false;

  // Caso típico: output=tsv
  const out = url.searchParams.get("output");
  if (out && out.toLowerCase() === "tsv") return true;

  // Fallbacks
  const href = url.href.toLowerCase();
  if (href.includes("output=tsv")) return true;

  const path = url.pathname.toLowerCase();
  return path.endsWith(".tsv") || path.includes("tsv");
}

async function shouldCacheResponse_(resp, request) {
  if (!resp) return false;

  // Opaque = cross-origin sin CORS: inútil para cosas como TSV y puede inflar cache.
  if (resp.type === "opaque") return false;

  // Solo OK
  if (!resp.ok) return false;

  // Evita cachear respuestas "no-store"
  const cc = (resp.headers.get("cache-control") || "").toLowerCase();
  if (cc.includes("no-store")) return false;

  // No cacheamos HTML de navegación aquí (lo maneja navigationHandler)
  const accept = request?.headers?.get?.("accept") || "";
  if (accept.includes("text/html")) return false;

  return true;
}

/**
 * Normaliza requests para evitar duplicar entradas por ?_ts=...
 * - Solo limpiamos params “cache-bust”, mantenemos los demás.
 */
function normalizeRequestForCache_(request) {
  const url = new URL(request.url);

  for (const k of Array.from(url.searchParams.keys())) {
    if (IGNORED_SEARCH_PARAMS.has(k.toLowerCase())) url.searchParams.delete(k);
  }
  if ([...url.searchParams.keys()].length === 0) url.search = "";

  // Importante: no propagamos headers raros, ni "no-store" obligado.
  // Para cache key y fetches de assets, esto es suficiente y más estable.
  return new Request(url.toString(), {
    method: "GET",
    mode: request.mode,
    credentials: request.credentials,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    // Dejamos que el browser decida cache; el SW ya maneja Cache Storage
  });
}