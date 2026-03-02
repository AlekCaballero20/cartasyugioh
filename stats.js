/* ============================
   stats.js — Yu-Gi-Oh DB Stats (v1.0)
   - Compute stats from rows (TSV array)
   - Header-based column detection (robust)
   - Aggregations: category/type/attr/rarity/lang/set/year/edition
   - Totals: unique cards, total copies, total value (qty * price)
   - Render helper (HTML string) optional
============================ */

export const Stats = (() => {
  "use strict";

  // Aliases (independiente del app.js)
  const HEADER_ALIASES = {
    _id: ["_id", "id", "uuid"],
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
    cantidad: ["cantidad", "qty", "quantity"],
    precio: ["precio", "price", "valor"],
    fecha_compra: ["fecha_compra", "fecha compra", "fecha", "fecha ingreso", "fecha de ingreso"],
  };

  // -------------------------
  // Public API
  // -------------------------
  function computeFromTSV(rows, options = {}) {
    const cfg = {
      useFiltered: true,          // si te pasan rows filtrados, igual sirve
      treatMissingQtyAs1: true,   // si una carta no tiene cantidad, cuenta como 1
      currency: "COP",
      ...options,
    };

    const safeRows = Array.isArray(rows) ? rows : [];
    if (safeRows.length < 1) return emptyStats_();

    const header = safeRows[0] || [];
    const data = safeRows.slice(1);

    const col = buildColIndexFromHeader_(header);

    // Helpers de lectura
    const get = (row, key) => {
      const idx = col[key];
      if (!Number.isInteger(idx) || idx < 0) return "";
      return String(row?.[idx] ?? "").trim();
    };

    const qtyOf = (row) => {
      const raw = get(row, "cantidad");
      const n = toInt_(raw);
      if (Number.isFinite(n) && n > 0) return n;
      return cfg.treatMissingQtyAs1 ? 1 : 0;
    };

    const priceOf = (row) => {
      const raw = get(row, "precio");
      const n = toNumber_(raw);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    const normKey = (s) => normalizeKey_(s) || "—";
    const label = (s) => (String(s ?? "").trim() || "—");

    // Aggregators
    const out = emptyStats_();
    out.meta = {
      generatedAt: Date.now(),
      rows: data.length,
      hasQty: col.cantidad >= 0,
      hasPrice: col.precio >= 0,
      currency: cfg.currency,
    };

    for (const row of data) {
      out.totals.uniqueCards += 1;

      const qty = qtyOf(row);
      const price = priceOf(row);
      const value = qty * price;

      out.totals.totalCopies += qty;
      out.totals.totalValue += value;

      const cat = label(get(row, "categoria"));
      const type = label(get(row, "tipo"));
      const attr = label(get(row, "atributo"));
      const rar = label(get(row, "rareza"));
      const lang = label(get(row, "idioma"));
      const setc = label(get(row, "mazo"));
      const ed = label(get(row, "edicion"));
      const year = label(get(row, "anio"));

      bump_(out.byCategory, normKey(cat), { label: cat, copies: qty, unique: 1, value });
      bump_(out.byType, normKey(type), { label: type, copies: qty, unique: 1, value });
      bump_(out.byAttribute, normKey(attr), { label: attr, copies: qty, unique: 1, value });
      bump_(out.byRarity, normKey(rar), { label: rar, copies: qty, unique: 1, value });
      bump_(out.byLanguage, normKey(lang), { label: lang, copies: qty, unique: 1, value });
      bump_(out.bySetCode, normKey(setc), { label: setc, copies: qty, unique: 1, value });
      bump_(out.byEdition, normKey(ed), { label: ed, copies: qty, unique: 1, value });
      bump_(out.byYear, normKey(year), { label: year, copies: qty, unique: 1, value });

      // Top cards by copies/value (usa nombre si existe, si no _id)
      const name = label(get(row, "nombre")) || label(get(row, "_id"));
      const cardKey = normKey(name);

      bump_(out.byCard, cardKey, {
        label: name,
        copies: qty,
        unique: 1,
        value,
      });
    }

    // Derivados / tops
    out.tops = {
      cardsByCopies: topN_(out.byCard, 10, "copies"),
      cardsByValue: topN_(out.byCard, 10, "value"),
      setsByCopies: topN_(out.bySetCode, 10, "copies"),
      rarityByCopies: topN_(out.byRarity, 10, "copies"),
      typeByCopies: topN_(out.byType, 10, "copies"),
    };

    // Ordena mapas a arrays para UI fácil
    out.tables = {
      byCategory: toSortedArray_(out.byCategory),
      byType: toSortedArray_(out.byType),
      byAttribute: toSortedArray_(out.byAttribute),
      byRarity: toSortedArray_(out.byRarity),
      byLanguage: toSortedArray_(out.byLanguage),
      bySetCode: toSortedArray_(out.bySetCode),
      byEdition: toSortedArray_(out.byEdition),
      byYear: toSortedArray_(out.byYear),
    };

    return out;
  }

  function renderStatsHTML(stats, options = {}) {
    const s = stats || emptyStats_();
    const cfg = {
      title: "Estadísticas",
      currency: s?.meta?.currency || "COP",
      showValue: true,
      ...options,
    };

    const money = (n) => formatMoney_(n, cfg.currency);
    const num = (n) => formatInt_(n);

    const hasValue = (s?.meta?.hasPrice && s?.meta?.hasQty) && cfg.showValue;

    const chipRow = (label, value) => `
      <div class="statChip">
        <div class="statChip__label">${escapeHTML_(label)}</div>
        <div class="statChip__value">${escapeHTML_(value)}</div>
      </div>
    `;

    const lineTop = (arr, mode) => {
      const rows = (arr || []).slice(0, 10).map((it) => {
        const v = mode === "value" ? money(it.value) : num(it.copies);
        return `<li><span>${escapeHTML_(it.label)}</span><b>${escapeHTML_(v)}</b></li>`;
      }).join("");
      return `<ul class="statList">${rows || ""}</ul>`;
    };

    const table = (arr) => {
      const rows = (arr || []).slice(0, 12).map((it) => `
        <tr>
          <td>${escapeHTML_(it.label)}</td>
          <td class="num">${num(it.unique)}</td>
          <td class="num">${num(it.copies)}</td>
          ${hasValue ? `<td class="num">${money(it.value)}</td>` : ""}
        </tr>
      `).join("");

      return `
        <div class="statTableWrap">
          <table class="statTable">
            <thead>
              <tr>
                <th>Grupo</th>
                <th class="num">Únicas</th>
                <th class="num">Copias</th>
                ${hasValue ? `<th class="num">Valor</th>` : ""}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    };

    return `
      <div class="statsPanel">
        <div class="statsPanel__head">
          <div>
            <div class="statsPanel__title">${escapeHTML_(cfg.title)}</div>
            <div class="statsPanel__sub">${escapeHTML_(`Filas: ${s.meta.rows} · Generado: ${new Date(s.meta.generatedAt).toLocaleString()}`)}</div>
          </div>
        </div>

        <div class="statsGrid">
          ${chipRow("Cartas únicas", num(s.totals.uniqueCards))}
          ${chipRow("Copias totales", num(s.totals.totalCopies))}
          ${hasValue ? chipRow("Valor total", money(s.totals.totalValue)) : ""}
        </div>

        <div class="statsColumns">
          <section class="statsBlock">
            <h3>Top cartas (copias)</h3>
            ${lineTop(s.tops.cardsByCopies, "copies")}
          </section>

          ${hasValue ? `
            <section class="statsBlock">
              <h3>Top cartas (valor)</h3>
              ${lineTop(s.tops.cardsByValue, "value")}
            </section>
          ` : ""}

          <section class="statsBlock">
            <h3>Top sets (copias)</h3>
            ${lineTop(s.tops.setsByCopies, "copies")}
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

        <div class="statsColumns">
          <section class="statsBlock">
            <h3>Por idioma</h3>
            ${table(s.tables.byLanguage)}
          </section>
          <section class="statsBlock">
            <h3>Por año</h3>
            ${table(s.tables.byYear)}
          </section>
        </div>

        <div class="statsColumns">
          <section class="statsBlock">
            <h3>Por edición</h3>
            ${table(s.tables.byEdition)}
          </section>
          <section class="statsBlock">
            <h3>Por set code</h3>
            ${table(s.tables.bySetCode)}
          </section>
        </div>
      </div>
    `;
  }

  // -------------------------
  // Helpers
  // -------------------------
  function emptyStats_() {
    return {
      meta: { generatedAt: Date.now(), rows: 0, hasQty: false, hasPrice: false, currency: "COP" },
      totals: { uniqueCards: 0, totalCopies: 0, totalValue: 0 },
      byCategory: {},
      byType: {},
      byAttribute: {},
      byRarity: {},
      byLanguage: {},
      bySetCode: {},
      byEdition: {},
      byYear: {},
      byCard: {},
      tops: {
        cardsByCopies: [],
        cardsByValue: [],
        setsByCopies: [],
        rarityByCopies: [],
        typeByCopies: [],
      },
      tables: {
        byCategory: [],
        byType: [],
        byAttribute: [],
        byRarity: [],
        byLanguage: [],
        bySetCode: [],
        byEdition: [],
        byYear: [],
      },
    };
  }

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

    // fallback: si no hay _id pero hay col 0, úsala
    if (out._id < 0 && (header?.[0] || "").trim()) out._id = 0;

    return out;
  }

  function bump_(map, key, patch) {
    if (!map[key]) {
      map[key] = { label: patch.label || "—", unique: 0, copies: 0, value: 0 };
    }
    map[key].unique += patch.unique || 0;
    map[key].copies += patch.copies || 0;
    map[key].value += patch.value || 0;
  }

  function toSortedArray_(map) {
    return Object.values(map || {})
      .sort((a, b) => (b.copies || 0) - (a.copies || 0))
      .map((x) => ({
        label: x.label,
        unique: x.unique || 0,
        copies: x.copies || 0,
        value: x.value || 0,
      }));
  }

  function topN_(map, n, field) {
    return Object.values(map || {})
      .slice()
      .sort((a, b) => (b[field] || 0) - (a[field] || 0))
      .slice(0, n)
      .map((x) => ({
        label: x.label,
        unique: x.unique || 0,
        copies: x.copies || 0,
        value: x.value || 0,
      }));
  }

  function normalizeKey_(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function toInt_(v) {
    const n = Number(String(v || "").replace(",", "."));
    return Number.isFinite(n) ? Math.floor(n) : NaN;
  }

  function toNumber_(v) {
    const n = Number(String(v || "").replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }

  function formatInt_(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "0";
    return Math.round(x).toLocaleString("es-CO");
  }

  function formatMoney_(n, currency) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "0";
    try {
      return x.toLocaleString("es-CO", { style: "currency", currency: currency || "COP", maximumFractionDigits: 0 });
    } catch {
      return `${formatInt_(x)} ${currency || ""}`.trim();
    }
  }

  function escapeHTML_(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // -------------------------
  // Exposed
  // -------------------------
  return {
    computeFromTSV,
    renderStatsHTML,
  };
})();

// Fallback global si no usan ES Modules
try {
  if (typeof window !== "undefined") window.Stats = Stats;
} catch {}