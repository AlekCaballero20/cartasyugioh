/* =============================================================================
   sw.js — Yu-Gi-Oh! TCG DB (GitHub Pages PWA) — v1.4.0
   - App shell precached
   - Navigation fallback to cached index.html
   - Same-origin assets: Stale-While-Revalidate
   - TSV published from Google Sheets: Network-First + cache fallback
   - Cache-bust params ignored when useful
   - Avoids caching opaque / non-OK responses
   - Supports SKIP_WAITING, CLIENTS_CLAIM, CLEAR_CACHES, GET_VERSION
============================================================================= */

"use strict";

/* =========================
   VERSION / CACHES
========================= */
const VERSION = "ygo-db-v1.4.0";
const CACHE_PREFIX = "ygo-db-";

const STATIC_CACHE = `${VERSION}-static`;
const DATA_CACHE = `${VERSION}-data`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const KNOWN_CACHES = new Set([
  STATIC_CACHE,
  DATA_CACHE,
  RUNTIME_CACHE,
]);

/**
 * App shell para GitHub Pages.
 * Mantener alineado con index.html.
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

/**
 * Hosts de datos externos.
 */
const TSV_HOSTS = new Set([
  "docs.google.com",
  "docs.googleusercontent.com",
]);

/**
 * Query params típicos de cache-bust.
 * Los quitamos para no duplicar entradas inútiles en Cache Storage.
 */
const IGNORED_SEARCH_PARAMS = new Set([
  "_ts",
  "ts",
  "v",
  "ver",
  "version",
  "cachebust",
  "cache_bust",
]);

/* =========================
   INSTALL
========================= */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);

      /**
       * No usamos cache.addAll directo porque si un solo archivo falla,
       * aborta todo. Muy elegante, muy absurdo, muy navegador.
       */
      await Promise.allSettled(
        APP_SHELL.map(async (url) => {
          const req = new Request(url, {
            cache: "reload",
          });

          try {
            const resp = await fetch(req);

            if (await shouldCacheResponse(resp, req, { allowHtml: true })) {
              await cache.put(normalizeRequestForCache(req), resp.clone());
            }
          } catch (err) {
            // Silencioso a propósito: la app debe poder instalar el SW aunque falte un ícono.
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

/* =========================
   ACTIVATE
========================= */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys.map((key) => {
          const isOurCache = key.startsWith(CACHE_PREFIX);
          const shouldDelete = isOurCache && !KNOWN_CACHES.has(key);

          return shouldDelete ? caches.delete(key) : Promise.resolve(false);
        })
      );

      await self.clients.claim();
    })()
  );
});

/* =========================
   MESSAGES
========================= */
self.addEventListener("message", (event) => {
  const type = event?.data?.type;

  if (type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (type === "CLIENTS_CLAIM") {
    self.clients.claim();
    return;
  }

  if (type === "CLEAR_CACHES") {
    event.waitUntil(clearOwnCaches());
    return;
  }

  if (type === "GET_VERSION") {
    event.source?.postMessage?.({
      type: "SW_VERSION",
      version: VERSION,
      caches: Array.from(KNOWN_CACHES),
    });
  }
});

/* =========================
   FETCH
========================= */
self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  /**
   * 1) Navegación HTML:
   * Network-first + fallback a index.html cacheado.
   */
  if (isNavigationRequest(req)) {
    event.respondWith(navigationHandler(req));
    return;
  }

  /**
   * 2) TSV publicado:
   * Network-first para tener datos frescos.
   * Fallback a caché si no hay internet.
   */
  if (isTSVRequest(url)) {
    event.respondWith(
      networkFirst(req, DATA_CACHE, {
        ignoreSearchOnFallback: true,
        normalizeKey: true,
      })
    );
    return;
  }

  /**
   * 3) Assets same-origin:
   * Stale-While-Revalidate para que cargue rápido y actualice en segundo plano.
   */
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  /**
   * 4) Externos:
   * Network only. Menos magia, menos fantasmas.
   */
});

/* =========================
   NAVIGATION HANDLER
========================= */
async function navigationHandler(request) {
  const cache = await caches.open(STATIC_CACHE);

  try {
    const net = await fetch(request);

    if (net && net.ok) {
      await cache.put(
        normalizeRequestForCache(new Request("./index.html")),
        net.clone()
      );
    }

    return net;
  } catch (err) {
    const cached =
      (await cache.match(normalizeRequestForCache(new Request("./index.html")), {
        ignoreSearch: true,
      })) ||
      (await cache.match("./index.html", {
        ignoreSearch: true,
      })) ||
      (await cache.match("./", {
        ignoreSearch: true,
      }));

    return (
      cached ||
      new Response(getOfflineHtml(), {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      })
    );
  }
}

/* =========================
   STRATEGIES
========================= */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const key = normalizeRequestForCache(request);

  const cached = await cache.match(key, {
    ignoreSearch: true,
  });

  const updatePromise = (async () => {
    try {
      const net = await fetch(request);

      if (await shouldCacheResponse(net, request, { allowHtml: false })) {
        await cache.put(key, net.clone());
      }

      return net;
    } catch (err) {
      return null;
    }
  })();

  return cached || (await updatePromise) || Response.error();
}

async function networkFirst(request, cacheName, options = {}) {
  const cache = await caches.open(cacheName);
  const key = options.normalizeKey ? normalizeRequestForCache(request) : request;

  try {
    const net = await fetch(request);

    if (await shouldCacheResponse(net, request, { allowHtml: false })) {
      await cache.put(key, net.clone());
    }

    return net;
  } catch (err) {
    const cached = await cache.match(key, {
      ignoreSearch: Boolean(options.ignoreSearchOnFallback),
    });

    return (
      cached ||
      new Response("Offline y sin datos en caché.", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      })
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const key = normalizeRequestForCache(request);

  const cached = await cache.match(key, {
    ignoreSearch: true,
  });

  if (cached) return cached;

  const net = await fetch(request);

  if (await shouldCacheResponse(net, request, { allowHtml: false })) {
    await cache.put(key, net.clone());
  }

  return net;
}

/* =========================
   CACHE MANAGEMENT
========================= */
async function clearOwnCaches() {
  const keys = await caches.keys();

  await Promise.all(
    keys.map((key) => {
      return key.startsWith(CACHE_PREFIX) ? caches.delete(key) : Promise.resolve(false);
    })
  );
}

/* =========================
   CHECKS
========================= */
function isNavigationRequest(request) {
  if (request.mode === "navigate") return true;

  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

function isTSVRequest(url) {
  if (!TSV_HOSTS.has(url.hostname)) return false;

  const output = url.searchParams.get("output");

  if (output && output.toLowerCase() === "tsv") {
    return true;
  }

  const href = url.href.toLowerCase();
  const path = url.pathname.toLowerCase();

  return (
    href.includes("output=tsv") ||
    path.endsWith(".tsv") ||
    path.includes("tsv")
  );
}

async function shouldCacheResponse(response, request, options = {}) {
  if (!response) return false;

  /**
   * Respuestas opaque no sirven para leer ni validar.
   * Cachearlas suele inflar Storage como si fuera colección de cartas repetidas.
   */
  if (response.type === "opaque") return false;

  if (!response.ok) return false;

  const cacheControl = (response.headers.get("cache-control") || "").toLowerCase();

  if (cacheControl.includes("no-store")) return false;

  const accept = request?.headers?.get?.("accept") || "";
  const isHtml = accept.includes("text/html");

  if (isHtml && !options.allowHtml) return false;

  return true;
}

/* =========================
   REQUEST NORMALIZATION
========================= */
function normalizeRequestForCache(request) {
  const url = new URL(request.url, self.location.href);

  for (const key of Array.from(url.searchParams.keys())) {
    if (IGNORED_SEARCH_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  if ([...url.searchParams.keys()].length === 0) {
    url.search = "";
  }

  return new Request(url.toString(), {
    method: "GET",
    mode: request.mode,
    credentials: request.credentials,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
  });
}

/* =========================
   OFFLINE FALLBACK
========================= */
function getOfflineHtml() {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Yu-Gi-Oh! TCG DB · Offline</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --panel: #0f172a;
      --line: rgba(148,163,184,.2);
      --text: #e5edff;
      --muted: #8aa0c6;
      --accent: #3b82f6;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(900px 420px at 10% -10%, rgba(59,130,246,.18), transparent 60%),
        radial-gradient(700px 420px at 90% 10%, rgba(34,197,94,.1), transparent 60%),
        var(--bg);
      color: var(--text);
    }

    main {
      width: min(560px, 100%);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 22px;
      background: rgba(15,23,42,.88);
      box-shadow: 0 20px 70px rgba(0,0,0,.45);
    }

    h1 {
      margin: 0 0 10px;
      font-size: 24px;
    }

    p {
      color: var(--muted);
      line-height: 1.5;
    }

    button {
      margin-top: 12px;
      border: 1px solid rgba(59,130,246,.8);
      background: linear-gradient(180deg, #4f8cff, #2563eb);
      color: white;
      padding: 10px 14px;
      border-radius: 12px;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    <h1>Estás offline</h1>
    <p>
      No se pudo cargar la app ni encontrar una versión guardada en caché.
      Cuando vuelva la conexión, recarga la página.
    </p>
    <button onclick="location.reload()">Reintentar</button>
  </main>
</body>
</html>`;
}