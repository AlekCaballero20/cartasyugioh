/* ============================
   api.js — Yu-Gi-Oh DB API helpers (v1.0)
   - fetch TSV (published) with timeout + cache bust
   - POST to Apps Script WebApp WITHOUT CORS preflight
   - Safe JSON parse + error normalization
============================ */

/**
 * Si estás usando ES Modules:
 *   import { API } from './api.js';
 *   const text = await API.fetchTSVText(TSV_URL);
 *
 * Si NO estás usando módulos:
 *   <script src="./api.js"></script>
 *   window.API.fetchTSVText(...)
 */

export const API = (() => {
  "use strict";

  // -------------------------
  // Public methods
  // -------------------------
  async function fetchTSVText(url, { timeoutMs = 12000, bypassCache = false } = {}) {
    const finalUrl = bypassCache ? cacheBust(url) : url;
    return await fetchTextWithTimeout(finalUrl, timeoutMs);
  }

  async function postNoPreflight(url, payload, { timeoutMs = 12000 } = {}) {
    // payload puede ser string o objeto
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);

    const text = await postTextWithTimeout(url, body, timeoutMs);

    // intenta JSON, si no, devuelve texto
    const parsed = safeJsonParse(text);

    // Normaliza respuesta típica de Apps Script: { ok, msg, error, data }
    if (parsed && typeof parsed === "object") {
      if (parsed.ok === false) {
        const err = new Error(parsed.error || parsed.msg || "Request failed");
        err.payload = parsed;
        throw err;
      }
      return { ok: true, data: parsed, raw: text };
    }

    // si no es JSON, asumimos "ok" pero devolvemos raw
    return { ok: true, data: null, raw: text };
  }

  // Útil para tu app: { action, rowIndex, row }
  async function saveRow(apiUrl, { action, rowIndex, row }, { timeoutMs = 12000 } = {}) {
    const payload = {
      action: String(action || "").trim(),
      rowIndex: String(rowIndex || "").trim(),
      row: Array.isArray(row) ? row : [],
    };

    if (!payload.action) throw new Error("Missing action");
    // rowIndex puede ir vacío para add

    return await postNoPreflight(apiUrl, payload, { timeoutMs });
  }

  // -------------------------
  // Internals
  // -------------------------
  async function fetchTextWithTimeout(url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        cache: "no-store",
        credentials: "omit",
      });
      if (!r.ok) throw new Error(`Fetch failed (${r.status})`);
      return await r.text();
    } catch (err) {
      throw normalizeNetError(err);
    } finally {
      clearTimeout(t);
    }
  }

  async function postTextWithTimeout(url, body, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const r = await fetch(url, {
        method: "POST",
        // CLAVE: text/plain evita CORS preflight
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        redirect: "follow",
        body,
        signal: ctrl.signal,
        credentials: "omit",
      });
      return await r.text();
    } catch (err) {
      throw normalizeNetError(err);
    } finally {
      clearTimeout(t);
    }
  }

  function cacheBust(url) {
    const u = new URL(url);
    u.searchParams.set("_ts", String(Date.now()));
    return u.toString();
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function normalizeNetError(err) {
    const e = err instanceof Error ? err : new Error(String(err || "Unknown error"));

    // AbortController timeout
    if (e.name === "AbortError") {
      const ne = new Error("Timeout / request aborted");
      ne.code = "TIMEOUT";
      return ne;
    }

    // Fetch bloqueado / CORS / offline
    const msg = String(e.message || "").toLowerCase();
    if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed")) {
      const ne = new Error("Network error (offline / blocked / CORS)");
      ne.code = "NETWORK";
      return ne;
    }

    return e;
  }

  return {
    fetchTSVText,
    postNoPreflight,
    saveRow,

    // helpers (por si los quieres)
    cacheBust,
    safeJsonParse,
  };
})();

// Soporte para no-modules: expone API en window
try {
  if (typeof window !== "undefined") window.API = API;
} catch {}