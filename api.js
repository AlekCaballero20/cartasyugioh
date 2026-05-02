/* =============================================================================
   api.js — Yu-Gi-Oh! TCG DB API helpers (v1.1.0)
   - Fetch TSV published from Google Sheets
   - POST to Apps Script WebApp without CORS preflight
   - Timeout + AbortController
   - Cache bust helper
   - Safe JSON parse
   - TSV parser helper
   - Error normalization
   - ES Modules + window.API fallback
============================================================================= */

export const API = (() => {
  "use strict";

  /* =========================
     DEFAULTS
  ========================= */
  const DEFAULT_TIMEOUT_MS = 12000;

  const ERROR_CODES = {
    TIMEOUT: "TIMEOUT",
    NETWORK: "NETWORK",
    HTTP: "HTTP",
    INVALID_URL: "INVALID_URL",
    INVALID_PAYLOAD: "INVALID_PAYLOAD",
    APPS_SCRIPT: "APPS_SCRIPT",
    PARSE: "PARSE",
    UNKNOWN: "UNKNOWN",
  };

  /* =========================
     PUBLIC: TSV
  ========================= */

  /**
   * Fetch raw TSV text.
   *
   * @param {string} url
   * @param {{ timeoutMs?: number, bypassCache?: boolean }} options
   * @returns {Promise<string>}
   */
  async function fetchTSVText(url, options = {}) {
    const {
      timeoutMs = DEFAULT_TIMEOUT_MS,
      bypassCache = false,
    } = options;

    assertValidUrl(url);

    const finalUrl = bypassCache ? cacheBust(url) : url;

    return requestText(finalUrl, {
      timeoutMs,
      method: "GET",
      cache: "no-store",
      credentials: "omit",
    });
  }

  /**
   * Fetch TSV and parse it into an array of rows.
   *
   * @param {string} url
   * @param {{ timeoutMs?: number, bypassCache?: boolean }} options
   * @returns {Promise<string[][]>}
   */
  async function fetchTSVRows(url, options = {}) {
    const text = await fetchTSVText(url, options);
    return parseTSV(text);
  }

  /* =========================
     PUBLIC: APPS SCRIPT POST
  ========================= */

  /**
   * POST to Apps Script without CORS preflight.
   * Important: Content-Type text/plain avoids preflight.
   *
   * @param {string} url
   * @param {unknown} payload
   * @param {{ timeoutMs?: number }} options
   * @returns {Promise<{ ok: boolean, data: any, raw: string }>}
   */
  async function postNoPreflight(url, payload, options = {}) {
    const {
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = options;

    assertValidUrl(url);

    const body = typeof payload === "string"
      ? payload
      : JSON.stringify(payload ?? {});

    const raw = await requestText(url, {
      timeoutMs,
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      redirect: "follow",
      credentials: "omit",
      body,
    });

    const parsed = safeJsonParse(raw);

    if (parsed && typeof parsed === "object") {
      if (parsed.ok === false) {
        throw makeError(
          parsed.error || parsed.msg || "Apps Script request failed",
          ERROR_CODES.APPS_SCRIPT,
          {
            response: parsed,
            raw,
          }
        );
      }

      return {
        ok: true,
        data: parsed,
        raw,
      };
    }

    return {
      ok: true,
      data: null,
      raw,
    };
  }

  /**
   * Save a row using the expected Apps Script payload.
   *
   * Expected payload:
   * {
   *   action: "add" | "update",
   *   rowIndex: string,
   *   row: string[]
   * }
   *
   * @param {string} apiUrl
   * @param {{ action: string, rowIndex?: string | number, row: unknown[] }} payload
   * @param {{ timeoutMs?: number }} options
   * @returns {Promise<{ ok: boolean, data: any, raw: string }>}
   */
  async function saveRow(apiUrl, payload, options = {}) {
    const normalized = normalizeSavePayload(payload);

    return postNoPreflight(apiUrl, normalized, options);
  }

  /**
   * Shortcut for adding a new row.
   *
   * @param {string} apiUrl
   * @param {unknown[]} row
   * @param {{ timeoutMs?: number }} options
   * @returns {Promise<{ ok: boolean, data: any, raw: string }>}
   */
  async function addRow(apiUrl, row, options = {}) {
    return saveRow(
      apiUrl,
      {
        action: "add",
        rowIndex: "",
        row,
      },
      options
    );
  }

  /**
   * Shortcut for updating an existing row.
   *
   * @param {string} apiUrl
   * @param {string | number} rowIndex
   * @param {unknown[]} row
   * @param {{ timeoutMs?: number }} options
   * @returns {Promise<{ ok: boolean, data: any, raw: string }>}
   */
  async function updateRow(apiUrl, rowIndex, row, options = {}) {
    return saveRow(
      apiUrl,
      {
        action: "update",
        rowIndex,
        row,
      },
      options
    );
  }

  /* =========================
     PUBLIC: GENERIC REQUESTS
  ========================= */

  /**
   * Generic text request with timeout.
   *
   * @param {string} url
   * @param {RequestInit & { timeoutMs?: number }} options
   * @returns {Promise<string>}
   */
  async function requestText(url, options = {}) {
    const {
      timeoutMs = DEFAULT_TIMEOUT_MS,
      ...fetchOptions
    } = options;

    assertValidUrl(url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw makeError(
          `HTTP error ${response.status}`,
          ERROR_CODES.HTTP,
          {
            status: response.status,
            statusText: response.statusText,
            url,
          }
        );
      }

      return await response.text();
    } catch (error) {
      throw normalizeNetError(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generic JSON request with timeout.
   *
   * @param {string} url
   * @param {RequestInit & { timeoutMs?: number }} options
   * @returns {Promise<any>}
   */
  async function requestJSON(url, options = {}) {
    const raw = await requestText(url, options);
    const parsed = safeJsonParse(raw);

    if (parsed == null) {
      throw makeError(
        "Invalid JSON response",
        ERROR_CODES.PARSE,
        {
          raw,
        }
      );
    }

    return parsed;
  }

  /* =========================
     PUBLIC: PARSERS / HELPERS
  ========================= */

  /**
   * Parse TSV into rows.
   * Good enough for published Google Sheets TSV.
   *
   * @param {string} tsv
   * @returns {string[][]}
   */
  function parseTSV(tsv) {
    const clean = String(tsv || "")
      .replace(/\r/g, "")
      .trim();

    if (!clean) return [];

    return clean
      .split("\n")
      .map((line) =>
        line
          .split("\t")
          .map((cell) => String(cell ?? "").trim())
      );
  }

  /**
   * Convert rows into objects using first row as header.
   *
   * @param {string[][]} rows
   * @returns {Record<string, string>[]}
   */
  function rowsToObjects(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return [];

    const header = rows[0].map((h) => String(h || "").trim());

    return rows.slice(1).map((row) => {
      const obj = {};

      header.forEach((key, index) => {
        if (!key) return;
        obj[key] = row[index] ?? "";
      });

      return obj;
    });
  }

  /**
   * Add cache-bust param.
   *
   * @param {string} url
   * @param {string} param
   * @returns {string}
   */
  function cacheBust(url, param = "_ts") {
    assertValidUrl(url);

    const u = new URL(url, windowLocationOrigin());
    u.searchParams.set(param, String(Date.now()));

    return u.toString();
  }

  /**
   * Safe JSON parse.
   *
   * @param {string} text
   * @param {any} fallback
   * @returns {any}
   */
  function safeJsonParse(text, fallback = null) {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  /**
   * Checks if a value looks like a valid URL.
   *
   * @param {string} value
   * @returns {boolean}
   */
  function isValidUrl(value) {
    try {
      const url = new URL(String(value || ""), windowLocationOrigin());
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  /* =========================
     NORMALIZERS
  ========================= */

  function normalizeSavePayload(payload) {
    const action = String(payload?.action || "").trim();
    const rowIndex = String(payload?.rowIndex ?? "").trim();
    const row = Array.isArray(payload?.row)
      ? payload.row.map((cell) => String(cell ?? "").trim())
      : [];

    if (!action) {
      throw makeError(
        "Missing action",
        ERROR_CODES.INVALID_PAYLOAD,
        { payload }
      );
    }

    if (!["add", "update"].includes(action)) {
      throw makeError(
        `Invalid action: ${action}`,
        ERROR_CODES.INVALID_PAYLOAD,
        { payload }
      );
    }

    if (action === "update" && !rowIndex) {
      throw makeError(
        "Missing rowIndex for update action",
        ERROR_CODES.INVALID_PAYLOAD,
        { payload }
      );
    }

    if (!row.length) {
      throw makeError(
        "Missing row data",
        ERROR_CODES.INVALID_PAYLOAD,
        { payload }
      );
    }

    return {
      action,
      rowIndex,
      row,
    };
  }

  function assertValidUrl(url) {
    if (!isValidUrl(url)) {
      throw makeError(
        `Invalid URL: ${String(url || "")}`,
        ERROR_CODES.INVALID_URL,
        { url }
      );
    }
  }

  function normalizeNetError(error) {
    if (error?.code) return error;

    const err = error instanceof Error
      ? error
      : new Error(String(error || "Unknown error"));

    if (err.name === "AbortError") {
      return makeError(
        "Timeout / request aborted",
        ERROR_CODES.TIMEOUT,
        { cause: err }
      );
    }

    const message = String(err.message || "").toLowerCase();

    if (
      message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("load failed") ||
      message.includes("network request failed")
    ) {
      return makeError(
        "Network error. Possible offline, blocked request or CORS issue.",
        ERROR_CODES.NETWORK,
        { cause: err }
      );
    }

    return err;
  }

  function makeError(message, code = ERROR_CODES.UNKNOWN, extra = {}) {
    const error = new Error(message);
    error.code = code;

    Object.assign(error, extra);

    return error;
  }

  function windowLocationOrigin() {
    try {
      if (typeof window !== "undefined" && window.location?.origin) {
        return window.location.origin;
      }
    } catch {}

    return "https://example.com";
  }

  /* =========================
     PUBLIC API
  ========================= */
  return {
    ERROR_CODES,

    fetchTSVText,
    fetchTSVRows,

    postNoPreflight,
    saveRow,
    addRow,
    updateRow,

    requestText,
    requestJSON,

    parseTSV,
    rowsToObjects,
    cacheBust,
    safeJsonParse,
    isValidUrl,
  };
})();

/* =========================
   Non-module fallback
========================= */
try {
  if (typeof window !== "undefined") {
    window.API = API;
  }
} catch {
  // Nada. El universo sigue igual de raro.
}