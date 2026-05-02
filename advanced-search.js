/* =============================================================================
   advanced-search.js — Yu-Gi-Oh! TCG DB Advanced Search (v1.2.0)
   - Pure JS filtering over TSV rows: [header, ...data]
   - Header-based column detection
   - Text search + structured filters + ranges + sorting
   - Diagnostics filters: missing image/price/qty, incomplete rows
   - Facets for dynamic selects
   - Query builder from form-like DOM
   - ES Module + window.AdvancedSearch fallback
============================================================================= */

export const AdvancedSearch = (() => {
  "use strict";

  /* =========================
     HEADER ALIASES
  ========================= */
  const HEADER_ALIASES = {
    _id: ["_id", "id", "uuid", "cardid", "card id"],
    num: ["#", "num", "numero", "número", "number"],
    nombre: ["nombre", "name", "card name", "carta"],
    categoria: ["categoria", "categoría", "category"],
    tipo: ["tipo", "type"],
    subtipo: ["subtipo", "sub type", "subtype"],
    atributo: ["atributo", "attribute"],
    nivel: ["nivel", "level", "estrellas", "stars"],
    atk: ["atk", "attack"],
    def: ["def", "defense"],
    rareza: ["rareza", "rarity"],
    idioma: ["idioma", "language", "lang"],
    mazo: ["mazo", "set", "setcode", "set code", "codigo", "código"],
    edicion: ["edicion", "edición", "edition"],
    anio: ["anio", "año", "year"],
    cantidad: ["cantidad", "qty", "quantity", "copias", "copies"],
    precio: ["precio", "price", "valor", "value"],
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

  const RANGE_KEYS = [
    "anio",
    "nivel",
    "atk",
    "def",
    "cantidad",
    "precio",
  ];

  const FACET_KEYS = [
    "categoria",
    "tipo",
    "subtipo",
    "atributo",
    "rareza",
    "idioma",
    "edicion",
    "mazo",
    "anio",
    "nivel",
  ];

  const CATEGORY_ALIASES = {
    monster: ["monster", "monstruo", "monstruos"],
    spell: ["spell", "magia", "magias"],
    trap: ["trap", "trampa", "trampas"],
  };

  const DEFAULT_OPTIONS = {
    treatMissingQtyAs1: true,
    includeHeaderInResult: true,
    defaultSortDir: "asc",
    requiredFields: ["nombre", "categoria", "mazo", "cantidad"],
  };

  /* =========================
     PUBLIC API
  ========================= */

  /**
   * buildIndex(header) -> column index map.
   */
  function buildIndex(header) {
    return buildColIndexFromHeader(header || []);
  }

  /**
   * filterRows(rows, query, opts)
   *
   * rows:
   *   [header, ...data]
   *
   * query:
   * {
   *   text: "dark magician",
   *   textMode: "contains" | "equals" | "startsWith" | "words",
   *   textFields: ["nombre", "notas"],
   *
   *   category / categoria: "Monster" | ["Monster", "Spell"],
   *   tipo, subtipo, atributo, rareza, idioma, edicion, mazo,
   *
   *   ranges: {
   *     anio: { min, max },
   *     nivel: { min, max },
   *     atk: { min, max },
   *     def: { min, max },
   *     cantidad: { min, max },
   *     precio: { min, max }
   *   },
   *
   *   diagnostics: {
   *     noImage: true,
   *     hasImage: true,
   *     noPrice: true,
   *     hasPrice: true,
   *     noQty: true,
   *     hasQty: true,
   *     incomplete: true,
   *     complete: true
   *   },
   *
   *   sort: { by: "nombre", dir: "asc" | "desc" },
   *   limit: 100,
   *   offset: 0
   * }
   *
   * returns:
   * {
   *   header,
   *   rows,
   *   resultRows,
   *   matchedIndexes,
   *   total,
   *   page,
   *   query,
   *   columns
   * }
   */
  function filterRows(rows, query = {}, opts = {}) {
    const cfg = {
      ...DEFAULT_OPTIONS,
      ...opts,
    };

    const safeRows = Array.isArray(rows) ? rows : [];

    if (safeRows.length < 1) {
      return emptyResult();
    }

    const header = Array.isArray(safeRows[0]) ? safeRows[0] : [];
    const data = safeRows.slice(1).filter((row) => Array.isArray(row));
    const columns = buildColIndexFromHeader(header);
    const normalizedQuery = normalizeQuery(query);

    const matched = [];
    const matchedIndexes = [];

    for (let i = 0; i < data.length; i += 1) {
      const row = data[i];

      if (!rowPasses(row, columns, normalizedQuery, cfg)) continue;

      matched.push(row);
      matchedIndexes.push(i + 2);
    }

    const sorted = sortRows(matched, columns, normalizedQuery.sort, {
      defaultSortDir: cfg.defaultSortDir,
    });

    const total = sorted.length;
    const paged = paginateRows(sorted, normalizedQuery);

    return {
      header,
      rows: paged,
      resultRows: cfg.includeHeaderInResult ? [header, ...paged] : paged,
      matchedIndexes,
      total,
      page: {
        offset: normalizedQuery.offset,
        limit: normalizedQuery.limit,
        returned: paged.length,
        hasMore: normalizedQuery.offset + paged.length < total,
      },
      query: normalizedQuery,
      columns,
    };
  }

  /**
   * Returns true if one row matches a query.
   */
  function matchRow(row, headerOrColumns, query = {}, opts = {}) {
    const columns = Array.isArray(headerOrColumns)
      ? buildColIndexFromHeader(headerOrColumns)
      : headerOrColumns || {};

    const normalizedQuery = normalizeQuery(query);

    return rowPasses(row, columns, normalizedQuery, {
      ...DEFAULT_OPTIONS,
      ...opts,
    });
  }

  /**
   * Build dynamic facets from TSV rows.
   */
  function quickFacets(rows, options = {}) {
    const {
      includeCounts = false,
      includeNumericRanges = true,
    } = options;

    const safeRows = Array.isArray(rows) ? rows : [];

    if (safeRows.length < 2) {
      return emptyFacets(includeCounts, includeNumericRanges);
    }

    const header = safeRows[0] || [];
    const data = safeRows.slice(1).filter((row) => Array.isArray(row));
    const columns = buildColIndexFromHeader(header);

    const facets = {};

    FACET_KEYS.forEach((key) => {
      facets[key] = includeCounts
        ? uniqueWithCounts(data, columns, key)
        : uniqueSorted(readColumnValues(data, columns, key));
    });

    if (includeNumericRanges) {
      facets.ranges = {};

      RANGE_KEYS.forEach((key) => {
        facets.ranges[key] = numericRange(data, columns, key);
      });
    }

    return facets;
  }

  /**
   * Build a query object from DOM inputs.
   * Useful if later app.js imports this module.
   */
  function queryFromForm(root = document, mapping = {}) {
    const get = (name) => {
      const selector = mapping[name] || `[name="${name}"], #${name}`;
      const el = root.querySelector(selector);

      if (!el) return "";

      if (el.type === "checkbox") return el.checked;
      if (el.type === "radio") {
        const checked = root.querySelector(`${selector}:checked`);
        return checked?.value || "";
      }

      return el.value || "";
    };

    const query = {
      text: get("text") || get("q") || get("advQ"),
      nombre: get("nombre") || get("advNombre"),
      mazo: get("mazo") || get("advMazo"),
      categoria: get("categoria") || get("category") || get("advCategoria"),
      tipo: get("tipo") || get("advTipo"),
      subtipo: get("subtipo") || get("advSubtipo"),
      atributo: get("atributo") || get("advAtributo"),
      rareza: get("rareza") || get("advRareza"),
      idioma: get("idioma") || get("advIdioma"),
      edicion: get("edicion") || get("advEdicion"),

      ranges: {
        anio: {
          min: get("anioMin") || get("advAnioMin"),
          max: get("anioMax") || get("advAnioMax"),
        },
        nivel: {
          min: get("nivelMin") || get("lvlMin") || get("advLvlMin"),
          max: get("nivelMax") || get("lvlMax") || get("advLvlMax"),
        },
        atk: {
          min: get("atkMin") || get("advAtkMin"),
          max: get("atkMax") || get("advAtkMax"),
        },
        def: {
          min: get("defMin") || get("advDefMin"),
          max: get("defMax") || get("advDefMax"),
        },
        cantidad: {
          min: get("cantidadMin") || get("qtyMin") || get("advQtyMin"),
          max: get("cantidadMax") || get("qtyMax") || get("advQtyMax"),
        },
        precio: {
          min: get("precioMin") || get("priceMin") || get("advPriceMin"),
          max: get("precioMax") || get("priceMax") || get("advPriceMax"),
        },
      },

      diagnostics: {
        noImage: Boolean(get("noImage")),
        hasImage: Boolean(get("hasImage")),
        noPrice: Boolean(get("noPrice")),
        hasPrice: Boolean(get("hasPrice")),
        noQty: Boolean(get("noQty")),
        hasQty: Boolean(get("hasQty")),
        incomplete: Boolean(get("incomplete")),
        complete: Boolean(get("complete")),
      },

      sort: {
        by: get("sortBy"),
        dir: get("sortDir"),
      },
    };

    return normalizeQuery(query);
  }

  /**
   * Convert query object to a human-readable label list.
   */
  function describeQuery(query = {}) {
    const q = normalizeQuery(query);
    const parts = [];

    if (q.text) parts.push(`Texto: "${q.text}"`);

    [
      ["categoria", "Categoría"],
      ["tipo", "Tipo"],
      ["subtipo", "Subtipo"],
      ["atributo", "Atributo"],
      ["rareza", "Rareza"],
      ["idioma", "Idioma"],
      ["edicion", "Edición"],
      ["mazo", "Set"],
    ].forEach(([key, label]) => {
      const value = q[key];

      if (!value) return;

      const arr = Array.isArray(value) ? value : [value];
      const clean = arr.map((item) => String(item || "").trim()).filter(Boolean);

      if (clean.length) {
        parts.push(`${label}: ${clean.join(", ")}`);
      }
    });

    Object.entries(q.ranges || {}).forEach(([key, range]) => {
      const min = range?.min;
      const max = range?.max;

      if (min != null && max != null) parts.push(`${key}: ${min} a ${max}`);
      else if (min != null) parts.push(`${key}: desde ${min}`);
      else if (max != null) parts.push(`${key}: hasta ${max}`);
    });

    Object.entries(q.diagnostics || {}).forEach(([key, value]) => {
      if (!value) return;
      parts.push(diagnosticLabel(key));
    });

    if (q.sort?.by) {
      parts.push(`Orden: ${q.sort.by} ${q.sort.dir || "asc"}`);
    }

    return parts;
  }

  /**
   * Get row as object using header.
   */
  function rowToObject(row, headerOrColumns, headerMaybe = null) {
    let header = [];
    let columns = {};

    if (Array.isArray(headerOrColumns)) {
      header = headerOrColumns;
      columns = buildColIndexFromHeader(header);
    } else {
      columns = headerOrColumns || {};
      header = Array.isArray(headerMaybe) ? headerMaybe : [];
    }

    const obj = {};

    if (header.length) {
      header.forEach((key, index) => {
        if (!key) return;
        obj[key] = row?.[index] ?? "";
      });

      return obj;
    }

    Object.entries(columns).forEach(([key, index]) => {
      if (!Number.isInteger(index) || index < 0) return;
      obj[key] = row?.[index] ?? "";
    });

    return obj;
  }

  /* =========================
     CORE MATCHING
  ========================= */

  function rowPasses(row, columns, query, cfg) {
    if (!matchText(row, columns, query)) return false;
    if (!matchStructuredFields(row, columns, query)) return false;
    if (!matchRanges(row, columns, query, cfg)) return false;
    if (!matchDiagnostics(row, columns, query, cfg)) return false;

    return true;
  }

  function matchText(row, columns, query) {
    if (!query.text) return true;

    const fields = query.textFields?.length
      ? query.textFields
      : TEXT_DEFAULT_FIELDS;

    const needle = normalize(query.text);
    const mode = String(query.textMode || "contains").toLowerCase();

    if (!needle) return true;

    const words = needle.split(/\s+/).filter(Boolean);

    return fields.some((key) => {
      const idx = columns[key];

      if (!Number.isInteger(idx) || idx < 0) return false;

      const haystack = normalize(row?.[idx]);

      if (!haystack) return false;

      if (mode === "equals") return haystack === needle;
      if (mode === "startswith" || mode === "startsWith".toLowerCase()) return haystack.startsWith(needle);
      if (mode === "words") return words.every((word) => haystack.includes(word));

      return haystack.includes(needle);
    });
  }

  function matchStructuredFields(row, columns, query) {
    if (!matchIn(row, columns, "categoria", query.categoria, { categoryAware: true })) return false;
    if (!matchIn(row, columns, "tipo", query.tipo)) return false;
    if (!matchIn(row, columns, "subtipo", query.subtipo)) return false;
    if (!matchIn(row, columns, "atributo", query.atributo)) return false;
    if (!matchIn(row, columns, "rareza", query.rareza)) return false;
    if (!matchIn(row, columns, "idioma", query.idioma)) return false;
    if (!matchIn(row, columns, "edicion", query.edicion)) return false;
    if (!matchIn(row, columns, "mazo", query.mazo)) return false;

    return true;
  }

  function matchRanges(row, columns, query, cfg) {
    const ranges = query.ranges || {};

    for (const key of RANGE_KEYS) {
      const range = ranges[key];

      if (!range || !rangeHasValue(range)) continue;

      if (key === "cantidad") {
        const n = readNumber(row, columns, key, {
          missingFallback: cfg.treatMissingQtyAs1 ? 1 : 0,
        });

        if (!inRange(n, range)) return false;
        continue;
      }

      const n = readNumber(row, columns, key);

      if (!Number.isFinite(n)) return false;
      if (!inRange(n, range)) return false;
    }

    return true;
  }

  function matchDiagnostics(row, columns, query, cfg) {
    const diagnostics = query.diagnostics || {};

    if (!hasActiveDiagnostics(diagnostics)) return true;

    const image = clean(readCell(row, columns, "imagenurl"));
    const priceRaw = clean(readCell(row, columns, "precio"));
    const qtyRaw = clean(readCell(row, columns, "cantidad"));

    const hasImage = Boolean(image) && looksLikeUrl(image);
    const hasPrice = Boolean(priceRaw) && Number.isFinite(parseNumber(priceRaw));
    const hasQty = Boolean(qtyRaw) && Number.isFinite(parseNumber(qtyRaw));

    const incompleteReasons = getIncompleteReasons(row, columns, cfg.requiredFields);
    const isIncomplete = incompleteReasons.length > 0;

    if (diagnostics.noImage && hasImage) return false;
    if (diagnostics.hasImage && !hasImage) return false;

    if (diagnostics.noPrice && hasPrice) return false;
    if (diagnostics.hasPrice && !hasPrice) return false;

    if (diagnostics.noQty && hasQty) return false;
    if (diagnostics.hasQty && !hasQty) return false;

    if (diagnostics.incomplete && !isIncomplete) return false;
    if (diagnostics.complete && isIncomplete) return false;

    return true;
  }

  function matchIn(row, columns, key, allowed, options = {}) {
    if (allowed == null) return true;

    const list = toArray(allowed)
      .map((item) => clean(item))
      .filter(Boolean);

    if (!list.length) return true;

    const value = clean(readCell(row, columns, key));

    if (!value) return false;

    if (options.categoryAware) {
      const rowCategory = normalizeCategoryLabel(value);

      return list.some((item) => {
        return normalizeCategoryLabel(item) === rowCategory;
      });
    }

    const normalizedValue = normalize(value);

    return list.some((item) => {
      return normalizedValue === normalize(item);
    });
  }

  /* =========================
     SORTING / PAGINATION
  ========================= */

  function sortRows(rows, columns, sort, options = {}) {
    const safe = Array.isArray(rows) ? rows.slice() : [];

    const by = normalizeSortKey(sort?.by);
    const dir = String(sort?.dir || options.defaultSortDir || "asc").trim().toLowerCase() === "desc"
      ? "desc"
      : "asc";

    if (!by) return safe;

    const idx = columns[by];
    const isNum = isNumericSortKey(by);

    safe.sort((a, b) => {
      const va = Number.isInteger(idx) && idx >= 0 ? a?.[idx] : "";
      const vb = Number.isInteger(idx) && idx >= 0 ? b?.[idx] : "";

      let cmp = 0;

      if (isNum) {
        const na = parseNumber(va);
        const nb = parseNumber(vb);

        const aa = Number.isFinite(na) ? na : Number.NEGATIVE_INFINITY;
        const bb = Number.isFinite(nb) ? nb : Number.NEGATIVE_INFINITY;

        cmp = aa - bb;
      } else {
        cmp = clean(va).localeCompare(clean(vb), "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return dir === "desc" ? -cmp : cmp;
    });

    return safe;
  }

  function paginateRows(rows, query) {
    const limit = Number(query.limit || 0);
    const offset = Math.max(0, Number(query.offset || 0));

    if (!Number.isFinite(limit) || limit <= 0) {
      return rows.slice(offset);
    }

    return rows.slice(offset, offset + limit);
  }

  /* =========================
     QUERY NORMALIZATION
  ========================= */

  function normalizeQuery(input = {}) {
    const q = input && typeof input === "object" ? input : {};

    const out = {
      text: clean(q.text ?? q.q ?? q.query ?? ""),
      textMode: clean(q.textMode || "contains"),
      textFields: Array.isArray(q.textFields)
        ? q.textFields.map(clean).filter(Boolean)
        : null,

      categoria: q.categoria ?? q.category ?? null,
      tipo: q.tipo ?? null,
      subtipo: q.subtipo ?? null,
      atributo: q.atributo ?? null,
      rareza: q.rareza ?? null,
      idioma: q.idioma ?? null,
      edicion: q.edicion ?? null,
      mazo: q.mazo ?? q.set ?? null,

      ranges: cleanRanges(q.ranges || q),

      diagnostics: normalizeDiagnostics(q.diagnostics || q),

      sort: normalizeSort(q.sort || q),
      limit: normalizeLimit(q.limit),
      offset: normalizeOffset(q.offset),
    };

    return out;
  }

  function cleanRanges(source) {
    const ranges = {};

    RANGE_KEYS.forEach((key) => {
      const direct = source?.[key];

      const min =
        source?.[`${key}Min`] ??
        source?.[`min${capitalize(key)}`] ??
        direct?.min ??
        null;

      const max =
        source?.[`${key}Max`] ??
        source?.[`max${capitalize(key)}`] ??
        direct?.max ??
        null;

      if (valueHasContent(min) || valueHasContent(max)) {
        ranges[key] = {
          min: valueHasContent(min) ? min : null,
          max: valueHasContent(max) ? max : null,
        };
      }
    });

    return ranges;
  }

  function normalizeDiagnostics(source) {
    const flags = {
      noImage: Boolean(source?.noImage),
      hasImage: Boolean(source?.hasImage),
      noPrice: Boolean(source?.noPrice),
      hasPrice: Boolean(source?.hasPrice),
      noQty: Boolean(source?.noQty),
      hasQty: Boolean(source?.hasQty),
      incomplete: Boolean(source?.incomplete),
      complete: Boolean(source?.complete),
    };

    return flags;
  }

  function normalizeSort(source) {
    const by = normalizeSortKey(source?.by || source?.sortBy);
    const dir = clean(source?.dir || source?.sortDir || "asc").toLowerCase() === "desc"
      ? "desc"
      : "asc";

    return by ? { by, dir } : null;
  }

  function normalizeSortKey(value) {
    const key = normalize(clean(value));

    if (!key) return "";

    const aliases = {
      nombre: ["nombre", "name"],
      mazo: ["mazo", "set", "setcode"],
      categoria: ["categoria", "category"],
      tipo: ["tipo", "type"],
      subtipo: ["subtipo", "subtype"],
      atributo: ["atributo", "attribute"],
      rareza: ["rareza", "rarity"],
      idioma: ["idioma", "language"],
      edicion: ["edicion", "edition"],
      anio: ["anio", "year"],
      nivel: ["nivel", "level"],
      atk: ["atk"],
      def: ["def"],
      cantidad: ["cantidad", "qty", "quantity"],
      precio: ["precio", "price", "valor"],
      num: ["num", "#", "numero", "number"],
      fecha_compra: ["fecha", "fecha compra", "fecha ingreso", "fecha_compra"],
    };

    for (const canonical of Object.keys(aliases)) {
      if (aliases[canonical].map(normalize).includes(key)) {
        return canonical;
      }
    }

    return key;
  }

  function normalizeLimit(value) {
    const n = Number(value);

    if (!Number.isFinite(n) || n <= 0) return 0;

    return Math.floor(n);
  }

  function normalizeOffset(value) {
    const n = Number(value);

    if (!Number.isFinite(n) || n < 0) return 0;

    return Math.floor(n);
  }

  /* =========================
     FACETS
  ========================= */

  function readColumnValues(data, columns, key) {
    const idx = columns[key];

    if (!Number.isInteger(idx) || idx < 0) return [];

    return data
      .map((row) => clean(row?.[idx]))
      .filter(Boolean);
  }

  function uniqueWithCounts(data, columns, key) {
    const values = readColumnValues(data, columns, key);
    const map = new Map();

    values.forEach((value) => {
      const normalizedValue = key === "categoria"
        ? normalizeCategoryLabel(value)
        : value;

      const normalizedKey = normalize(normalizedValue);

      if (!normalizedKey) return;

      if (!map.has(normalizedKey)) {
        map.set(normalizedKey, {
          value: normalizedValue,
          label: normalizedValue,
          count: 0,
        });
      }

      map.get(normalizedKey).count += 1;
    });

    return Array.from(map.values()).sort((a, b) => {
      const countDiff = b.count - a.count;
      if (countDiff !== 0) return countDiff;

      return a.label.localeCompare(b.label, "es", {
        numeric: true,
        sensitivity: "base",
      });
    });
  }

  function uniqueSorted(values) {
    const seen = new Set();
    const out = [];

    (values || []).forEach((value) => {
      const cleanValue = clean(value);

      if (!cleanValue) return;

      const key = normalize(cleanValue);

      if (seen.has(key)) return;

      seen.add(key);
      out.push(cleanValue);
    });

    return out.sort((a, b) =>
      a.localeCompare(b, "es", {
        numeric: true,
        sensitivity: "base",
      })
    );
  }

  function numericRange(data, columns, key) {
    const idx = columns[key];

    if (!Number.isInteger(idx) || idx < 0) {
      return {
        min: null,
        max: null,
        count: 0,
      };
    }

    const nums = data
      .map((row) => parseNumber(row?.[idx]))
      .filter(Number.isFinite);

    if (!nums.length) {
      return {
        min: null,
        max: null,
        count: 0,
      };
    }

    return {
      min: Math.min(...nums),
      max: Math.max(...nums),
      count: nums.length,
    };
  }

  function emptyFacets(includeCounts, includeNumericRanges) {
    const facets = {};

    FACET_KEYS.forEach((key) => {
      facets[key] = [];
    });

    if (includeCounts) {
      FACET_KEYS.forEach((key) => {
        facets[key] = [];
      });
    }

    if (includeNumericRanges) {
      facets.ranges = {};

      RANGE_KEYS.forEach((key) => {
        facets.ranges[key] = {
          min: null,
          max: null,
          count: 0,
        };
      });
    }

    return facets;
  }

  /* =========================
     HEADER MAPPING
  ========================= */

  function buildColIndexFromHeader(header) {
    const normalizedHeader = (header || []).map((h) => normalize(h));
    const out = {};

    Object.keys(HEADER_ALIASES).forEach((key) => {
      const aliases = HEADER_ALIASES[key].map((alias) => normalize(alias));
      let idx = -1;

      for (let i = 0; i < normalizedHeader.length; i += 1) {
        const h = normalizedHeader[i];

        if (!h) continue;

        if (aliases.includes(h)) {
          idx = i;
          break;
        }
      }

      if (idx === -1) {
        for (let i = 0; i < normalizedHeader.length; i += 1) {
          const h = normalizedHeader[i];

          if (!h) continue;

          if (aliases.some((alias) => h.includes(alias))) {
            idx = i;
            break;
          }
        }
      }

      out[key] = idx;
    });

    if (out._id < 0 && clean(header?.[0])) {
      out._id = 0;
    }

    return out;
  }

  /* =========================
     DIAGNOSTICS
  ========================= */

  function getIncompleteReasons(row, columns, requiredFields = DEFAULT_OPTIONS.requiredFields) {
    const reasons = [];

    requiredFields.forEach((field) => {
      const value = clean(readCell(row, columns, field));

      if (!value) {
        reasons.push(`Falta ${field}`);
      }
    });

    const image = clean(readCell(row, columns, "imagenurl"));

    if (image && !looksLikeUrl(image)) {
      reasons.push("ImagenURL inválida");
    }

    const qty = clean(readCell(row, columns, "cantidad"));

    if (qty && !Number.isFinite(parseNumber(qty))) {
      reasons.push("Cantidad inválida");
    }

    const price = clean(readCell(row, columns, "precio"));

    if (price && !Number.isFinite(parseNumber(price))) {
      reasons.push("Precio inválido");
    }

    return reasons;
  }

  function hasActiveDiagnostics(diagnostics) {
    return Object.values(diagnostics || {}).some(Boolean);
  }

  function diagnosticLabel(key) {
    const labels = {
      noImage: "Sin imagen",
      hasImage: "Con imagen",
      noPrice: "Sin precio",
      hasPrice: "Con precio",
      noQty: "Sin cantidad",
      hasQty: "Con cantidad",
      incomplete: "Datos incompletos",
      complete: "Datos completos",
    };

    return labels[key] || key;
  }

  /* =========================
     NUMBERS / RANGES
  ========================= */

  function readNumber(row, columns, key, options = {}) {
    const idx = columns[key];

    if (!Number.isInteger(idx) || idx < 0) {
      return options.missingFallback ?? NaN;
    }

    const raw = clean(row?.[idx]);

    if (!raw && options.missingFallback != null) {
      return options.missingFallback;
    }

    return parseNumber(raw);
  }

  function rangeHasValue(range) {
    return valueHasContent(range?.min) || valueHasContent(range?.max);
  }

  function inRange(value, range) {
    if (!Number.isFinite(value)) return false;

    const min = valueHasContent(range?.min) ? parseNumber(range.min) : null;
    const max = valueHasContent(range?.max) ? parseNumber(range.max) : null;

    if (min != null && Number.isFinite(min) && value < min) return false;
    if (max != null && Number.isFinite(max) && value > max) return false;

    return true;
  }

  function parseNumber(value) {
    const raw = clean(value);

    if (!raw) return NaN;

    let text = raw
      .replace(/\s/g, "")
      .replace(/COP/gi, "")
      .replace(/\$/g, "");

    const hasComma = text.includes(",");
    const hasDot = text.includes(".");

    if (hasComma && hasDot) {
      const lastComma = text.lastIndexOf(",");
      const lastDot = text.lastIndexOf(".");

      if (lastComma > lastDot) {
        text = text.replace(/\./g, "").replace(",", ".");
      } else {
        text = text.replace(/,/g, "");
      }
    } else if (hasComma && !hasDot) {
      text = text.replace(",", ".");
    }

    text = text.replace(/[^\d.-]/g, "");

    const n = Number(text);

    return Number.isFinite(n) ? n : NaN;
  }

  function isNumericSortKey(key) {
    return [
      "precio",
      "cantidad",
      "anio",
      "atk",
      "def",
      "nivel",
      "num",
    ].includes(key);
  }

  /* =========================
     NORMALIZERS / UTIL
  ========================= */

  function normalizeCategoryLabel(value) {
    const raw = clean(value);

    if (!raw) return "";

    const key = normalize(raw);

    if (CATEGORY_ALIASES.monster.includes(key)) return "Monster";
    if (CATEGORY_ALIASES.spell.includes(key)) return "Spell";
    if (CATEGORY_ALIASES.trap.includes(key)) return "Trap";

    return raw;
  }

  function readCell(row, columns, key) {
    const idx = columns[key];

    if (!Number.isInteger(idx) || idx < 0) return "";

    return row?.[idx] ?? "";
  }

  function toArray(value) {
    if (Array.isArray(value)) return value;
    return [value];
  }

  function valueHasContent(value) {
    return value != null && String(value).trim() !== "";
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function normalize(value) {
    return clean(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  function looksLikeUrl(value) {
    try {
      const url = new URL(clean(value));
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function capitalize(value) {
    const s = clean(value);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }

  function emptyResult() {
    return {
      header: [],
      rows: [],
      resultRows: [],
      matchedIndexes: [],
      total: 0,
      page: {
        offset: 0,
        limit: 0,
        returned: 0,
        hasMore: false,
      },
      query: normalizeQuery({}),
      columns: {},
    };
  }

  /* =========================
     PUBLIC EXPORT
  ========================= */

  return {
    HEADER_ALIASES,
    TEXT_DEFAULT_FIELDS,
    RANGE_KEYS,
    FACET_KEYS,

    buildIndex,
    filterRows,
    matchRow,
    quickFacets,

    queryFromForm,
    describeQuery,
    rowToObject,

    normalizeQuery,
    normalizeCategoryLabel,
    parseNumber,
    getIncompleteReasons,
  };
})();

/* =========================
   Window fallback
========================= */
try {
  if (typeof window !== "undefined") {
    window.AdvancedSearch = AdvancedSearch;
  }
} catch {
  // Nada. El navegador ya tiene suficientes problemas.
}