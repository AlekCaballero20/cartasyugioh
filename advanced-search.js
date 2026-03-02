/* ============================
   advanced-search.js — Yu-Gi-Oh DB Advanced Search (v1.0)
   - Pure JS filtering over TSV rows: [header, ...data]
   - Header-based column index (robust aliases)
   - Query object with structured filters + ranges + sorting
============================ */

export const AdvancedSearch = (() => {
  "use strict";

  // Column aliases (independiente)
  const HEADER_ALIASES = {
    _id: ["_id", "id", "uuid"],
    num: ["#", "num", "numero", "número"],
    nombre: ["nombre", "name"],
    categoria: ["categoria", "categoría", "category"],
    tipo: ["tipo", "type"],
    subtipo: ["subtipo", "sub type", "subtype"],
    atributo: ["atributo", "attribute"],
    rareza: ["rareza", "rarity"],
    idioma: ["idioma", "language", "lang"],
    mazo: ["mazo", "set", "setcode", "set code", "codigo", "código"],
    edicion: ["edicion", "edición"],
    anio: ["anio", "año", "year"],
    nivel: ["nivel", "level", "estrellas", "stars"],
    atk: ["atk"],
    def: ["def"],
    cantidad: ["cantidad", "qty", "quantity"],
    precio: ["precio", "price", "valor"],
    fecha_compra: ["fecha_compra", "fecha compra", "fecha", "fecha ingreso", "fecha de ingreso"],
    notas: ["notas", "notes"],
    imagenurl: ["imagenurl", "imagen url", "image", "imageurl", "image url", "url imagen", "url"],
  };

  const TEXT_DEFAULT_FIELDS = [
    "nombre",
    "mazo",
    "categoria",
    "tipo",
    "subtipo",
    "atributo",
    "rareza",
    "idioma",
    "edicion",
    "anio",
    "notas",
  ];

  // -------------------------
  // Public API
  // -------------------------

  /**
   * buildIndex(header) -> colIndex map
   */
  function buildIndex(header) {
    return buildColIndexFromHeader_(header || []);
  }

  /**
   * filterRows(rows, query, opts)
   *
   * rows: [header, ...data]
   * query:
   *  {
   *    text: "dark magician",
   *    textMode: "contains"|"equals"|"startsWith",
   *    textFields: ["nombre","notas"] (optional)
   *
   *    category: ["Monster","Spell"] or "Monster"
   *    tipo: [...]
   *    subtipo: [...]
   *    atributo: [...]
   *    rareza: [...]
   *    idioma: [...]
   *    edicion: [...]
   *    mazo: [...]
   *
   *    ranges: {
   *      anio: { min, max },
   *      nivel: { min, max },
   *      atk: { min, max },
   *      def: { min, max },
   *      cantidad: { min, max },
   *      precio: { min, max }
   *    }
   *
   *    sort: { by: "nombre"|"precio"|"cantidad"|"anio"|"atk"|"def"|"nivel", dir: "asc"|"desc" }
   *  }
   *
   * returns:
   *  { header, rows, matchedIndexes }
   */
  function filterRows(rows, query = {}, opts = {}) {
    const cfg = {
      treatMissingQtyAs1: true,
      ...opts,
    };

    const safeRows = Array.isArray(rows) ? rows : [];
    if (safeRows.length < 1) return { header: [], rows: [], matchedIndexes: [] };

    const header = safeRows[0] || [];
    const data = safeRows.slice(1);

    const col = buildColIndexFromHeader_(header);

    const q = normalizeQuery_(query);

    const matched = [];
    const matchedIdx = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;

      if (!matchStructured_(row, col, q, cfg)) continue;

      matched.push(row);
      matchedIdx.push(i + 2); // +2 porque data arranca en fila 2 (1=header)
    }

    // Sort
    const sorted = sortRows_(matched, col, q.sort);

    return { header, rows: sorted, matchedIndexes: matchedIdx };
  }

  /**
   * quickFacets(rows) -> values for selects (unique sorted)
   * Useful for building UI options for advanced search
   */
  function quickFacets(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (safeRows.length < 2) {
      return {
        categoria: [],
        tipo: [],
        subtipo: [],
        atributo: [],
        rareza: [],
        idioma: [],
        edicion: [],
        mazo: [],
        anio: [],
      };
    }

    const header = safeRows[0] || [];
    const data = safeRows.slice(1);
    const col = buildColIndexFromHeader_(header);

    const uniq = (key) => {
      const idx = col[key];
      if (!Number.isInteger(idx) || idx < 0) return [];
      const arr = [];
      for (const r of data) {
        const v = String(r?.[idx] ?? "").trim();
        if (v) arr.push(v);
      }
      return uniqueSorted_(arr);
    };

    return {
      categoria: uniq("categoria"),
      tipo: uniq("tipo"),
      subtipo: uniq("subtipo"),
      atributo: uniq("atributo"),
      rareza: uniq("rareza"),
      idioma: uniq("idioma"),
      edicion: uniq("edicion"),
      mazo: uniq("mazo"),
      anio: uniq("anio"),
    };
  }

  // -------------------------
  // Core matching
  // -------------------------
  function matchStructured_(row, col, q, cfg) {
    // Text search
    if (q.text) {
      const fields = (q.textFields && q.textFields.length) ? q.textFields : TEXT_DEFAULT_FIELDS;
      if (!matchText_(row, col, q.text, q.textMode, fields)) return false;
    }

    // Multi-select filters
    if (!matchIn_(row, col, "categoria", q.category)) return false;
    if (!matchIn_(row, col, "tipo", q.tipo)) return false;
    if (!matchIn_(row, col, "subtipo", q.subtipo)) return false;
    if (!matchIn_(row, col, "atributo", q.atributo)) return false;
    if (!matchIn_(row, col, "rareza", q.rareza)) return false;
    if (!matchIn_(row, col, "idioma", q.idioma)) return false;
    if (!matchIn_(row, col, "edicion", q.edicion)) return false;
    if (!matchIn_(row, col, "mazo", q.mazo)) return false;

    // Ranges
    if (!matchRange_(row, col, "anio", q.ranges?.anio)) return false;
    if (!matchRange_(row, col, "nivel", q.ranges?.nivel)) return false;
    if (!matchRange_(row, col, "atk", q.ranges?.atk)) return false;
    if (!matchRange_(row, col, "def", q.ranges?.def)) return false;
    if (!matchRange_(row, col, "precio", q.ranges?.precio)) return false;

    // Cantidad: si falta y treatMissingQtyAs1 = true, lo trata como 1
    if (q.ranges?.cantidad && (q.ranges.cantidad.min != null || q.ranges.cantidad.max != null)) {
      const idx = col.cantidad;
      let n = 0;
      if (Number.isInteger(idx) && idx >= 0) {
        n = toNumber_(row?.[idx]);
        if (!Number.isFinite(n)) n = 0;
      } else {
        n = cfg.treatMissingQtyAs1 ? 1 : 0;
      }
      if (!inRangeNum_(n, q.ranges.cantidad)) return false;
    }

    return true;
  }

  function matchText_(row, col, needle, mode, fields) {
    const n = normalize_(needle);
    if (!n) return true;

    const m = (mode || "contains").toLowerCase();

    for (const key of fields) {
      const idx = col[key];
      if (!Number.isInteger(idx) || idx < 0) continue;

      const raw = String(row?.[idx] ?? "");
      const hay = normalize_(raw);

      if (!hay) continue;

      if (m === "equals") {
        if (hay === n) return true;
      } else if (m === "startswith") {
        if (hay.startsWith(n)) return true;
      } else {
        // contains default
        if (hay.includes(n)) return true;
      }
    }

    return false;
  }

  function matchIn_(row, col, key, allowed) {
    if (allowed == null) return true;

    const arr = Array.isArray(allowed) ? allowed : [allowed];
    const list = arr.map((x) => String(x ?? "").trim()).filter(Boolean);
    if (!list.length) return true;

    const idx = col[key];
    if (!Number.isInteger(idx) || idx < 0) return false;

    const value = String(row?.[idx] ?? "").trim();
    if (!value) return false;

    // Comparación case-insensitive + sin tildes
    const vN = normalize_(value);
    for (const item of list) {
      if (vN === normalize_(item)) return true;
    }

    return false;
  }

  function matchRange_(row, col, key, range) {
    if (!range) return true;
    const hasMin = range.min != null && range.min !== "";
    const hasMax = range.max != null && range.max !== "";
    if (!hasMin && !hasMax) return true;

    const idx = col[key];
    if (!Number.isInteger(idx) || idx < 0) return false;

    const raw = row?.[idx];
    const n = toNumber_(raw);
    if (!Number.isFinite(n)) return false;

    return inRangeNum_(n, range);
  }

  function inRangeNum_(n, range) {
    const hasMin = range.min != null && range.min !== "";
    const hasMax = range.max != null && range.max !== "";
    if (!hasMin && !hasMax) return true;

    const min = hasMin ? toNumber_(range.min) : null;
    const max = hasMax ? toNumber_(range.max) : null;

    if (min != null && Number.isFinite(min) && n < min) return false;
    if (max != null && Number.isFinite(max) && n > max) return false;
    return true;
  }

  // -------------------------
  // Sorting
  // -------------------------
  function sortRows_(rows, col, sort) {
    const safe = Array.isArray(rows) ? rows.slice() : [];
    const by = String(sort?.by || "").trim().toLowerCase();
    const dir = String(sort?.dir || "asc").trim().toLowerCase() === "desc" ? "desc" : "asc";
    if (!by) return safe;

    const idx = col[by];
    const isNum = ["precio", "cantidad", "anio", "atk", "def", "nivel", "num"].includes(by);

    safe.sort((a, b) => {
      const va = readCell_(a, idx);
      const vb = readCell_(b, idx);

      let cmp = 0;

      if (isNum) {
        const na = toNumber_(va);
        const nb = toNumber_(vb);
        cmp = (Number.isFinite(na) ? na : -Infinity) - (Number.isFinite(nb) ? nb : -Infinity);
      } else {
        const sa = String(va ?? "");
        const sb = String(vb ?? "");
        cmp = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
      }

      return dir === "desc" ? -cmp : cmp;
    });

    return safe;
  }

  function readCell_(row, idx) {
    if (!Number.isInteger(idx) || idx < 0) return "";
    return row?.[idx] ?? "";
  }

  // -------------------------
  // Query normalization
  // -------------------------
  function normalizeQuery_(q) {
    const out = {
      text: String(q.text || "").trim(),
      textMode: String(q.textMode || "contains").trim(),
      textFields: Array.isArray(q.textFields) ? q.textFields.map((x) => String(x || "").trim()).filter(Boolean) : null,

      category: q.category ?? q.categoria ?? null,
      tipo: q.tipo ?? null,
      subtipo: q.subtipo ?? null,
      atributo: q.atributo ?? null,
      rareza: q.rareza ?? null,
      idioma: q.idioma ?? null,
      edicion: q.edicion ?? null,
      mazo: q.mazo ?? null,

      ranges: q.ranges && typeof q.ranges === "object" ? q.ranges : {},

      sort: q.sort && typeof q.sort === "object" ? q.sort : null,
    };

    // Limpia ranges vacíos
    out.ranges = cleanRanges_(out.ranges);

    return out;
  }

  function cleanRanges_(ranges) {
    const r = ranges || {};
    const keys = ["anio", "nivel", "atk", "def", "cantidad", "precio"];
    const out = {};
    for (const k of keys) {
      const x = r[k];
      if (!x || typeof x !== "object") continue;
      const hasMin = x.min != null && String(x.min).trim() !== "";
      const hasMax = x.max != null && String(x.max).trim() !== "";
      if (hasMin || hasMax) out[k] = { min: x.min, max: x.max };
    }
    return out;
  }

  // -------------------------
  // Header mapping
  // -------------------------
  function buildColIndexFromHeader_(header) {
    const normHeader = (header || []).map((h) => normalizeKey_(h));
    const out = {};

    for (const key of Object.keys(HEADER_ALIASES)) {
      const aliases = HEADER_ALIASES[key].map((a) => normalizeKey_(a));
      let idx = -1;

      // exact
      for (let i = 0; i < normHeader.length; i++) {
        if (!normHeader[i]) continue;
        if (aliases.includes(normHeader[i])) { idx = i; break; }
      }

      // contains
      if (idx === -1) {
        for (let i = 0; i < normHeader.length; i++) {
          const h = normHeader[i];
          if (!h) continue;
          if (aliases.some((a) => h.includes(a))) { idx = i; break; }
        }
      }

      out[key] = idx;
    }

    // fallback
    if (out._id < 0 && (header?.[0] || "").trim()) out._id = 0;

    return out;
  }

  // -------------------------
  // Utils
  // -------------------------
  function normalize_(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function normalizeKey_(s) {
    return normalize_(s);
  }

  function toNumber_(v) {
    const n = Number(String(v ?? "").replace(",", ".").trim());
    return Number.isFinite(n) ? n : NaN;
  }

  function uniqueSorted_(arr) {
    const seen = new Set();
    const out = [];
    for (const x of arr || []) {
      const v = String(x ?? "").trim();
      if (!v) continue;
      const k = normalize_(v);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }

  // -------------------------
  // Exposed
  // -------------------------
  return {
    buildIndex,
    filterRows,
    quickFacets,
  };
})();

// fallback global
try {
  if (typeof window !== "undefined") window.AdvancedSearch = AdvancedSearch;
} catch {}