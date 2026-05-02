/* =============================================================================
   stats.js — Yu-Gi-Oh! TCG DB Stats (v1.2.0)
   - Compute stats from TSV rows or object rows
   - Header-based column detection
   - Aggregations: category/type/subtype/attribute/rarity/lang/set/year/edition
   - Totals: registered rows, unique IDs, total copies, total value
   - Diagnostics: no image, no price, no qty, incomplete rows
   - Top cards by copies/value
   - Optional HTML renderer
   - ES Module + window.Stats fallback
============================================================================= */

export const Stats = (() => {
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

  const CATEGORY_ALIASES = {
    monster: ["monster", "monstruo", "monstruos"],
    spell: ["spell", "magia", "magias"],
    trap: ["trap", "trampa", "trampas"],
  };

  const DEFAULT_OPTIONS = {
    currency: "COP",
    locale: "es-CO",
    treatMissingQtyAs1: true,
    topLimit: 10,
    requiredFields: ["nombre", "categoria", "mazo", "cantidad"],
  };

  /* =========================
     PUBLIC: COMPUTE
  ========================= */

  function computeFromTSV(rows, options = {}) {
    const cfg = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    const safeRows = Array.isArray(rows) ? rows : [];

    if (safeRows.length < 1) {
      return emptyStats(cfg);
    }

    const header = Array.isArray(safeRows[0]) ? safeRows[0] : [];
    const data = safeRows.slice(1).filter((row) => Array.isArray(row));

    const columns = buildColumnMap(header);

    return computeFromArrayRows(data, {
      ...cfg,
      header,
      columns,
    });
  }

  function computeFromObjects(items, options = {}) {
    const cfg = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    const rows = Array.isArray(items) ? items : [];

    const header = inferHeaderFromObjects(rows);
    const columns = buildColumnMap(header);

    const arrayRows = rows.map((item) => {
      return header.map((key) => String(item?.[key] ?? "").trim());
    });

    return computeFromArrayRows(arrayRows, {
      ...cfg,
      header,
      columns,
    });
  }

  function computeFromArrayRows(dataRows, options = {}) {
    const cfg = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    const header = Array.isArray(cfg.header) ? cfg.header : [];
    const columns = cfg.columns || buildColumnMap(header);

    const stats = emptyStats(cfg);

    stats.meta.generatedAt = Date.now();
    stats.meta.rows = dataRows.length;
    stats.meta.currency = cfg.currency;
    stats.meta.locale = cfg.locale;
    stats.meta.treatMissingQtyAs1 = Boolean(cfg.treatMissingQtyAs1);
    stats.meta.hasQty = columns.cantidad >= 0;
    stats.meta.hasPrice = columns.precio >= 0;
    stats.meta.hasImage = columns.imagenurl >= 0;
    stats.meta.requiredFields = [...cfg.requiredFields];
    stats.columns = { ...columns };

    const seenIds = new Set();
    const seenCanonicalCards = new Set();

    for (const row of dataRows) {
      const item = readRow(row, columns);

      const qtyInfo = readQty(item.cantidad, cfg);
      const priceInfo = readPrice(item.precio);

      const qty = qtyInfo.qty;
      const price = priceInfo.price;
      const value = qty * price;

      const id = clean(item._id);
      const canonical = makeCanonicalCardKey(item);

      stats.totals.registeredRows += 1;
      stats.totals.totalCopies += qty;
      stats.totals.totalValue += value;

      if (id) seenIds.add(id);
      if (canonical) seenCanonicalCards.add(canonical);

      if (!qtyInfo.hasRawQty) stats.diagnostics.noQty += 1;
      if (!priceInfo.hasRawPrice) stats.diagnostics.noPrice += 1;
      if (!clean(item.imagenurl)) stats.diagnostics.noImage += 1;

      const categoryLabel = normalizeCategoryLabel(item.categoria);
      const categoryKey = normalizeKey(categoryLabel);

      if (categoryLabel === "Monster") stats.totals.monsters += 1;
      else if (categoryLabel === "Spell") stats.totals.spells += 1;
      else if (categoryLabel === "Trap") stats.totals.traps += 1;
      else stats.totals.otherCategory += 1;

      const incompleteReasons = getIncompleteReasons(item, cfg.requiredFields);

      if (incompleteReasons.length) {
        stats.diagnostics.incomplete += 1;
        stats.diagnostics.incompleteRows.push({
          id: id || "",
          nombre: clean(item.nombre) || "Sin nombre",
          reasons: incompleteReasons,
        });

        incompleteReasons.forEach((reason) => {
          bumpSimple(stats.diagnostics.incompleteByReason, reason, 1);
        });
      }

      const labels = {
        category: categoryLabel,
        type: cleanLabel(item.tipo),
        subtype: cleanLabel(item.subtipo),
        attribute: cleanLabel(item.atributo),
        rarity: cleanLabel(item.rareza),
        language: cleanLabel(item.idioma),
        setCode: cleanLabel(item.mazo),
        edition: cleanLabel(item.edicion),
        year: cleanLabel(item.anio),
        level: cleanLabel(item.nivel),
      };

      bumpGroup(stats.byCategory, categoryKey, labels.category, qty, value);
      bumpGroup(stats.byType, normalizeKey(labels.type), labels.type, qty, value);
      bumpGroup(stats.bySubtype, normalizeKey(labels.subtype), labels.subtype, qty, value);
      bumpGroup(stats.byAttribute, normalizeKey(labels.attribute), labels.attribute, qty, value);
      bumpGroup(stats.byRarity, normalizeKey(labels.rarity), labels.rarity, qty, value);
      bumpGroup(stats.byLanguage, normalizeKey(labels.language), labels.language, qty, value);
      bumpGroup(stats.bySetCode, normalizeKey(labels.setCode), labels.setCode, qty, value);
      bumpGroup(stats.byEdition, normalizeKey(labels.edition), labels.edition, qty, value);
      bumpGroup(stats.byYear, normalizeKey(labels.year), labels.year, qty, value);
      bumpGroup(stats.byLevel, normalizeKey(labels.level), labels.level, qty, value);

      const cardLabel = clean(item.nombre) || id || "Carta sin nombre";
      const cardKey = canonical || normalizeKey(cardLabel);

      bumpCard(stats.byCard, cardKey, {
        label: cardLabel,
        id,
        setCode: clean(item.mazo),
        edition: clean(item.edicion),
        rarity: clean(item.rareza),
        language: clean(item.idioma),
        category: labels.category,
        qty,
        value,
      });
    }

    stats.totals.uniqueIds = seenIds.size;
    stats.totals.uniqueCards = seenCanonicalCards.size || stats.totals.registeredRows;
    stats.totals.averagePrice = safeDivide(stats.totals.totalValue, stats.totals.totalCopies);

    finalizeStats(stats, cfg);

    return stats;
  }

  /* =========================
     PUBLIC: HTML RENDER
  ========================= */

  function renderStatsHTML(stats, options = {}) {
    const s = stats || emptyStats(options);

    const cfg = {
      title: "Estadísticas",
      currency: s?.meta?.currency || DEFAULT_OPTIONS.currency,
      locale: s?.meta?.locale || DEFAULT_OPTIONS.locale,
      showValue: true,
      topLimit: 10,
      ...options,
    };

    const hasValue = cfg.showValue;

    const money = (n) => formatMoney(n, cfg.currency, cfg.locale);
    const num = (n) => formatInt(n, cfg.locale);

    const chip = (label, value, sub = "") => `
      <div class="statCard">
        <div class="muted">${escapeHTML(label)}</div>
        <div class="statValue">${escapeHTML(value)}</div>
        ${sub ? `<div class="statCard__sub">${escapeHTML(sub)}</div>` : ""}
      </div>
    `;

    const topList = (arr, field = "copies") => {
      const rows = (arr || [])
        .slice(0, cfg.topLimit)
        .map((item) => {
          const value = field === "value" ? money(item.value) : num(item.copies);

          return `
            <div style="display:flex; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid rgba(148,163,184,.08)">
              <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHTML(item.label)}</span>
              <span class="chip">${escapeHTML(value)}</span>
            </div>
          `;
        })
        .join("");

      return rows || `<div class="muted">Sin datos.</div>`;
    };

    const table = (arr) => {
      const rows = (arr || [])
        .slice(0, cfg.topLimit)
        .map((item) => `
          <tr>
            <td>${escapeHTML(item.label)}</td>
            <td class="num">${escapeHTML(num(item.unique))}</td>
            <td class="num">${escapeHTML(num(item.copies))}</td>
            ${hasValue ? `<td class="num">${escapeHTML(money(item.value))}</td>` : ""}
          </tr>
        `)
        .join("");

      return `
        <div class="statTableWrap">
          <table class="statTable">
            <thead>
              <tr>
                <th>Grupo</th>
                <th class="num">Registros</th>
                <th class="num">Copias</th>
                ${hasValue ? `<th class="num">Valor</th>` : ""}
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="${hasValue ? 4 : 3}">Sin datos.</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
    };

    return `
      <section class="statsPanel">
        <div class="statsPanel__head">
          <div>
            <div class="statsPanel__title">${escapeHTML(cfg.title)}</div>
            <div class="statsPanel__sub">
              ${escapeHTML(`Filas: ${s.meta.rows} · Generado: ${formatDate(s.meta.generatedAt, cfg.locale)}`)}
            </div>
          </div>
        </div>

        <div class="statsGrid">
          ${chip("Cartas registradas", num(s.totals.registeredRows))}
          ${chip("Cartas únicas", num(s.totals.uniqueCards))}
          ${chip("IDs únicos", num(s.totals.uniqueIds))}
          ${chip("Copias totales", num(s.totals.totalCopies))}
          ${chip("Valor total", money(s.totals.totalValue))}
          ${chip("Precio promedio", money(s.totals.averagePrice))}
          ${chip("Sin imagen", num(s.diagnostics.noImage))}
          ${chip("Datos incompletos", num(s.diagnostics.incomplete))}
        </div>

        <div class="statsColumns">
          <section class="statsBlock">
            <h3>Top cartas por copias</h3>
            ${topList(s.tops.cardsByCopies, "copies")}
          </section>

          <section class="statsBlock">
            <h3>Top cartas por valor</h3>
            ${topList(s.tops.cardsByValue, "value")}
          </section>

          <section class="statsBlock">
            <h3>Top sets</h3>
            ${topList(s.tops.setsByCopies, "copies")}
          </section>
        </div>

        <div class="statsColumns">
          <section class="statsBlock">
            <h3>Por categoría</h3>
            ${table(s.tables.byCategory)}
          </section>

          <section class="statsBlock">
            <h3>Por rareza</h3>
            ${table(s.tables.byRarity)}
          </section>
        </div>

        <div class="statsColumns">
          <section class="statsBlock">
            <h3>Por tipo</h3>
            ${table(s.tables.byType)}
          </section>

          <section class="statsBlock">
            <h3>Por atributo</h3>
            ${table(s.tables.byAttribute)}
          </section>
        </div>
      </section>
    `;
  }

  /* =========================
     PUBLIC: SMALL HELPERS
  ========================= */

  function getTop(stats, tableName, limit = 10) {
    const arr = stats?.tables?.[tableName] || [];
    return arr.slice(0, limit);
  }

  function summarize(stats, options = {}) {
    const s = stats || emptyStats(options);

    return {
      registeredRows: s.totals.registeredRows,
      uniqueCards: s.totals.uniqueCards,
      uniqueIds: s.totals.uniqueIds,
      totalCopies: s.totals.totalCopies,
      totalValue: s.totals.totalValue,
      averagePrice: s.totals.averagePrice,
      monsters: s.totals.monsters,
      spells: s.totals.spells,
      traps: s.totals.traps,
      noImage: s.diagnostics.noImage,
      noPrice: s.diagnostics.noPrice,
      noQty: s.diagnostics.noQty,
      incomplete: s.diagnostics.incomplete,
    };
  }

  function buildColumnMap(header) {
    const normHeader = (header || []).map((h) => normalizeKey(h));
    const out = {};

    for (const key of Object.keys(HEADER_ALIASES)) {
      const aliases = HEADER_ALIASES[key].map((alias) => normalizeKey(alias));
      let idx = -1;

      for (let i = 0; i < normHeader.length; i += 1) {
        const h = normHeader[i];

        if (!h) continue;

        if (aliases.includes(h)) {
          idx = i;
          break;
        }
      }

      if (idx === -1) {
        for (let i = 0; i < normHeader.length; i += 1) {
          const h = normHeader[i];

          if (!h) continue;

          if (aliases.some((alias) => h.includes(alias))) {
            idx = i;
            break;
          }
        }
      }

      out[key] = idx;
    }

    if (out._id < 0 && clean(header?.[0])) {
      out._id = 0;
    }

    return out;
  }

  function rowsToObjects(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return [];

    const header = rows[0].map((h) => clean(h));

    return rows.slice(1).map((row) => {
      const obj = {};

      header.forEach((key, index) => {
        if (!key) return;
        obj[key] = row[index] ?? "";
      });

      return obj;
    });
  }

  /* =========================
     EMPTY / FINALIZE
  ========================= */

  function emptyStats(options = {}) {
    const cfg = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    return {
      meta: {
        generatedAt: Date.now(),
        rows: 0,
        currency: cfg.currency,
        locale: cfg.locale,
        treatMissingQtyAs1: Boolean(cfg.treatMissingQtyAs1),
        hasQty: false,
        hasPrice: false,
        hasImage: false,
        requiredFields: [...cfg.requiredFields],
      },

      columns: {},

      totals: {
        registeredRows: 0,
        uniqueCards: 0,
        uniqueIds: 0,
        totalCopies: 0,
        totalValue: 0,
        averagePrice: 0,

        monsters: 0,
        spells: 0,
        traps: 0,
        otherCategory: 0,
      },

      diagnostics: {
        noImage: 0,
        noPrice: 0,
        noQty: 0,
        incomplete: 0,
        incompleteByReason: {},
        incompleteRows: [],
      },

      byCategory: {},
      byType: {},
      bySubtype: {},
      byAttribute: {},
      byRarity: {},
      byLanguage: {},
      bySetCode: {},
      byEdition: {},
      byYear: {},
      byLevel: {},
      byCard: {},

      tops: {
        cardsByCopies: [],
        cardsByValue: [],
        setsByCopies: [],
        setsByValue: [],
        rarityByCopies: [],
        typeByCopies: [],
        categoryByCopies: [],
      },

      tables: {
        byCategory: [],
        byType: [],
        bySubtype: [],
        byAttribute: [],
        byRarity: [],
        byLanguage: [],
        bySetCode: [],
        byEdition: [],
        byYear: [],
        byLevel: [],
        byCard: [],
      },
    };
  }

  function finalizeStats(stats, cfg) {
    const topLimit = Number(cfg.topLimit || DEFAULT_OPTIONS.topLimit);

    stats.tables.byCategory = toSortedArray(stats.byCategory);
    stats.tables.byType = toSortedArray(stats.byType);
    stats.tables.bySubtype = toSortedArray(stats.bySubtype);
    stats.tables.byAttribute = toSortedArray(stats.byAttribute);
    stats.tables.byRarity = toSortedArray(stats.byRarity);
    stats.tables.byLanguage = toSortedArray(stats.byLanguage);
    stats.tables.bySetCode = toSortedArray(stats.bySetCode);
    stats.tables.byEdition = toSortedArray(stats.byEdition);
    stats.tables.byYear = toSortedArray(stats.byYear);
    stats.tables.byLevel = toSortedArray(stats.byLevel);
    stats.tables.byCard = toSortedArray(stats.byCard);

    stats.tops.cardsByCopies = topN(stats.byCard, topLimit, "copies");
    stats.tops.cardsByValue = topN(stats.byCard, topLimit, "value");
    stats.tops.setsByCopies = topN(stats.bySetCode, topLimit, "copies");
    stats.tops.setsByValue = topN(stats.bySetCode, topLimit, "value");
    stats.tops.rarityByCopies = topN(stats.byRarity, topLimit, "copies");
    stats.tops.typeByCopies = topN(stats.byType, topLimit, "copies");
    stats.tops.categoryByCopies = topN(stats.byCategory, topLimit, "copies");

    stats.diagnostics.incompleteRows = stats.diagnostics.incompleteRows.slice(0, 50);

    return stats;
  }

  /* =========================
     ROW READERS
  ========================= */

  function readRow(row, columns) {
    const get = (key) => {
      const idx = columns[key];

      if (!Number.isInteger(idx) || idx < 0) return "";

      return clean(row?.[idx]);
    };

    return {
      _id: get("_id"),
      num: get("num"),
      nombre: get("nombre"),
      categoria: get("categoria"),
      tipo: get("tipo"),
      subtipo: get("subtipo"),
      atributo: get("atributo"),
      nivel: get("nivel"),
      atk: get("atk"),
      def: get("def"),
      rareza: get("rareza"),
      idioma: get("idioma"),
      mazo: get("mazo"),
      edicion: get("edicion"),
      anio: get("anio"),
      cantidad: get("cantidad"),
      precio: get("precio"),
      fecha_compra: get("fecha_compra"),
      notas: get("notas"),
      imagenurl: get("imagenurl"),
    };
  }

  function readQty(rawQty, cfg) {
    const hasRawQty = clean(rawQty) !== "";
    const parsed = parseNumber(rawQty);

    if (Number.isFinite(parsed) && parsed > 0) {
      return {
        qty: Math.floor(parsed),
        hasRawQty,
      };
    }

    return {
      qty: cfg.treatMissingQtyAs1 ? 1 : 0,
      hasRawQty,
    };
  }

  function readPrice(rawPrice) {
    const hasRawPrice = clean(rawPrice) !== "";
    const parsed = parseNumber(rawPrice);

    return {
      price: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
      hasRawPrice,
    };
  }

  function getIncompleteReasons(item, requiredFields) {
    const reasons = [];

    requiredFields.forEach((field) => {
      if (!clean(item[field])) {
        reasons.push(`Falta ${field}`);
      }
    });

    if (clean(item.imagenurl) && !looksLikeUrl(item.imagenurl)) {
      reasons.push("ImagenURL inválida");
    }

    if (clean(item.cantidad) && !Number.isFinite(parseNumber(item.cantidad))) {
      reasons.push("Cantidad inválida");
    }

    if (clean(item.precio) && !Number.isFinite(parseNumber(item.precio))) {
      reasons.push("Precio inválido");
    }

    return reasons;
  }

  /* =========================
     GROUP HELPERS
  ========================= */

  function bumpGroup(map, key, label, copies, value) {
    const safeKey = key || "—";

    if (!map[safeKey]) {
      map[safeKey] = {
        label: label || "—",
        unique: 0,
        copies: 0,
        value: 0,
      };
    }

    map[safeKey].unique += 1;
    map[safeKey].copies += Number(copies || 0);
    map[safeKey].value += Number(value || 0);
  }

  function bumpCard(map, key, patch) {
    const safeKey = key || "—";

    if (!map[safeKey]) {
      map[safeKey] = {
        label: patch.label || "Carta sin nombre",
        id: patch.id || "",
        setCode: patch.setCode || "",
        edition: patch.edition || "",
        rarity: patch.rarity || "",
        language: patch.language || "",
        category: patch.category || "",
        unique: 0,
        copies: 0,
        value: 0,
      };
    }

    map[safeKey].unique += 1;
    map[safeKey].copies += Number(patch.qty || 0);
    map[safeKey].value += Number(patch.value || 0);

    if (patch.id) map[safeKey].id = patch.id;
    if (patch.setCode) map[safeKey].setCode = patch.setCode;
    if (patch.edition) map[safeKey].edition = patch.edition;
    if (patch.rarity) map[safeKey].rarity = patch.rarity;
    if (patch.language) map[safeKey].language = patch.language;
    if (patch.category) map[safeKey].category = patch.category;
  }

  function bumpSimple(map, key, amount = 1) {
    const safeKey = key || "—";
    map[safeKey] = (map[safeKey] || 0) + amount;
  }

  function toSortedArray(map) {
    return Object.values(map || {})
      .sort((a, b) => {
        const copiesDiff = Number(b.copies || 0) - Number(a.copies || 0);
        if (copiesDiff !== 0) return copiesDiff;

        const valueDiff = Number(b.value || 0) - Number(a.value || 0);
        if (valueDiff !== 0) return valueDiff;

        return String(a.label || "").localeCompare(String(b.label || ""), "es", {
          sensitivity: "base",
        });
      })
      .map((item) => ({
        label: item.label || "—",
        id: item.id || "",
        setCode: item.setCode || "",
        edition: item.edition || "",
        rarity: item.rarity || "",
        language: item.language || "",
        category: item.category || "",
        unique: Number(item.unique || 0),
        copies: Number(item.copies || 0),
        value: Number(item.value || 0),
      }));
  }

  function topN(map, limit, field) {
    return Object.values(map || {})
      .slice()
      .sort((a, b) => {
        const diff = Number(b[field] || 0) - Number(a[field] || 0);
        if (diff !== 0) return diff;

        return String(a.label || "").localeCompare(String(b.label || ""), "es", {
          sensitivity: "base",
        });
      })
      .slice(0, limit)
      .map((item) => ({
        label: item.label || "—",
        id: item.id || "",
        setCode: item.setCode || "",
        edition: item.edition || "",
        rarity: item.rarity || "",
        language: item.language || "",
        category: item.category || "",
        unique: Number(item.unique || 0),
        copies: Number(item.copies || 0),
        value: Number(item.value || 0),
      }));
  }

  /* =========================
     NORMALIZERS
  ========================= */

  function normalizeCategoryLabel(value) {
    const raw = clean(value);

    if (!raw) return "—";

    const key = normalizeKey(raw);

    if (CATEGORY_ALIASES.monster.includes(key)) return "Monster";
    if (CATEGORY_ALIASES.spell.includes(key)) return "Spell";
    if (CATEGORY_ALIASES.trap.includes(key)) return "Trap";

    return raw;
  }

  function cleanLabel(value) {
    return clean(value) || "—";
  }

  function makeCanonicalCardKey(item) {
    const parts = [
      item.nombre,
      item.mazo,
      item.edicion,
      item.idioma,
      item.rareza,
    ].map(normalizeKey);

    const hasName = Boolean(parts[0]);

    if (!hasName) return "";

    return parts.join("|");
  }

  function inferHeaderFromObjects(items) {
    const seen = new Set();
    const header = [];

    (items || []).forEach((item) => {
      if (!item || typeof item !== "object") return;

      Object.keys(item).forEach((key) => {
        if (seen.has(key)) return;

        seen.add(key);
        header.push(key);
      });
    });

    return header;
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function normalizeKey(value) {
    return clean(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
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

  function looksLikeUrl(value) {
    try {
      const url = new URL(clean(value));
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function safeDivide(a, b) {
    const x = Number(a || 0);
    const y = Number(b || 0);

    if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return 0;

    return x / y;
  }

  /* =========================
     FORMATTERS
  ========================= */

  function formatInt(value, locale = "es-CO") {
    const n = Number(value);

    if (!Number.isFinite(n)) return "0";

    return Math.round(n).toLocaleString(locale);
  }

  function formatMoney(value, currency = "COP", locale = "es-CO") {
    const n = Number(value);

    if (!Number.isFinite(n)) return "0";

    try {
      return n.toLocaleString(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      });
    } catch {
      return `${formatInt(n, locale)} ${currency || ""}`.trim();
    }
  }

  function formatDate(timestamp, locale = "es-CO") {
    const n = Number(timestamp);

    if (!Number.isFinite(n) || n <= 0) return "—";

    try {
      return new Date(n).toLocaleString(locale);
    } catch {
      return "—";
    }
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* =========================
     PUBLIC API
  ========================= */

  return {
    HEADER_ALIASES,

    computeFromTSV,
    computeFromObjects,
    computeFromArrayRows,

    renderStatsHTML,

    summarize,
    getTop,

    buildColumnMap,
    rowsToObjects,

    normalizeCategoryLabel,
    parseNumber,
    formatInt,
    formatMoney,
    formatDate,
  };
})();

/* =========================
   Window fallback
========================= */
try {
  if (typeof window !== "undefined") {
    window.Stats = Stats;
  }
} catch {
  // Si falla esto, al menos no prendemos fuego al navegador. Todavía.
}