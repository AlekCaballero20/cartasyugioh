/* =============================================================================
   sw.js — Yu-Gi-Oh! DB (GitHub Pages PWA) — vPRO
   - App Shell precached (offline-ready)
   - Navigation fallback to cached index.html
   - Same-origin assets: Stale-While-Revalidate (ignoring cache-bust params)
   - TSV: Network-First (fallback to cached data)
============================================================================= */

const VERSION = "ygo-db-v1.1.0"; // <- súbelo cuando publiques cambios
const STATIC_CACHE = `${VERSION}-static`;
const DATA_CACHE   = `${VERSION}-data`;

/**
 * GitHub Pages: el SW debe estar en la raíz del proyecto
 * y estas rutas deben ser relativas.
 */
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./yugioh.webp",
  // Si luego agregas iconos PNG 192/512, inclúyelos aquí:
  // "./icons/icon-192.png",
  // "./icons/icon-512.png",
];

// Hosts que consideramos "data" (tu TSV publicado)
const TSV_HOSTS = new Set([
  "docs.google.com",
  "docs.googleusercontent.com",
]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);

    // cache: "reload" fuerza a ir a red en install para evitar basura vieja
    await cache.addAll(
      APP_SHELL.map((url) => new Request(url, { cache: "reload" }))
    );

    // Activa el SW nuevo sin esperar pestañas viejas
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Borra caches antiguos
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => !k.startsWith(VERSION))
        .map((k) => caches.delete(k))
    );

    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo GET. POST es para tu Apps Script (no lo tocamos).
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1) Navegación (abrir la app / refresh / rutas). Fallback a index.html
  if (req.mode === "navigate") {
    event.respondWith(navigationHandler(req));
    return;
  }

  // 2) TSV publicado: Network-First (fallback cache)
  if (isTSVRequest(url)) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // 3) Assets del mismo origen: Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidateSameOrigin(req, STATIC_CACHE));
    return;
  }

  // 4) Default: cache-first (por si pides algo externo que sí quieras cachear)
  event.respondWith(cacheFirst(req, STATIC_CACHE));
});

/* =========================
   Helpers
========================= */

function isTSVRequest(url) {
  if (!TSV_HOSTS.has(url.hostname)) return false;

  // Tu caso típico: ...&output=tsv
  const out = url.searchParams.get("output");
  if (out && out.toLowerCase() === "tsv") return true;

  // Fallback: si la ruta o query menciona tsv, lo tratamos como data
  return url.pathname.toLowerCase().includes("tsv") || url.href.toLowerCase().includes("output=tsv");
}

async function navigationHandler(request) {
  try {
    // Network-first para navegación: así actualiza el index cuando hay red
    const net = await fetch(request);

    // Guarda una copia del index.html cuando haya red (para offline)
    if (net && net.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put("./index.html", net.clone());
    }

    return net;
  } catch {
    const cache = await caches.open(STATIC_CACHE);
    return (await cache.match("./index.html")) || new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/* =========================
   Strategies
========================= */

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;

  const net = await fetch(request);
  if (shouldCacheResponse(net)) cache.put(request, net.clone());
  return net;
}

/**
 * Stale-While-Revalidate para mismo origen
 * - Ignora cache-bust query (?v=, ?_ts=, etc.) al buscar en cache
 *   para evitar duplicar entradas inútiles.
 */
async function staleWhileRevalidateSameOrigin(request, cacheName) {
  const cache = await caches.open(cacheName);

  // Match “normalizado” sin querystring
  const normalized = stripSearch(request);

  const cached = await cache.match(normalized, { ignoreSearch: true });

  const fetchPromise = fetch(request)
    .then((net) => {
      if (shouldCacheResponse(net)) cache.put(normalized, net.clone());
      return net;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || Response.error();
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const net = await fetch(request);
    if (shouldCacheResponse(net)) cache.put(request, net.clone());
    return net;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    return cached || new Response("Offline y sin datos en caché 😶", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/* =========================
   Response / Request utils
========================= */

function shouldCacheResponse(resp) {
  // Evita cachear errores o respuestas raras
  if (!resp) return false;
  if (resp.type === "opaque") return false; // cross-origin sin CORS: mejor no
  return resp.ok;
}

function stripSearch(request) {
  const url = new URL(request.url);
  url.search = ""; // borra querystring
  return new Request(url.toString(), {
    method: "GET",
    headers: request.headers,
    mode: request.mode,
    credentials: request.credentials,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    cache: "no-store",
  });
}
  
