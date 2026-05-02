/* =============================================================================
   app.js — Yu-Gi-Oh! TCG DB Frontend Controller (vPRO.5 Modular)
   - Imports:
     API from api.js
     Decks from decks.js
     Stats from stats.js
     AdvancedSearch from advanced-search.js

   - Responsibilities:
     ✅ DOM + UI orchestration
     ✅ Load TSV using API
     ✅ Cache TSV locally
     ✅ Render table
     ✅ Drawer editor
     ✅ Save row via Apps Script using API
     ✅ Deck UI using Decks module
     ✅ Stats UI using Stats module
     ✅ Advanced search using AdvancedSearch module
============================================================================= */

import { API } from "./api.js";
import { Decks } from "./decks.js";
import { Stats } from "./stats.js";
import { AdvancedSearch } from "./advanced-search.js";

(() => {
  "use strict";

  /* =========================
     CONFIG
  ========================= */
  const TSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTr_dlYQi8JAzT_PrHeXVPimnOnXYw4VmBmonSSZhbv_k7lKp10csg5YSX2fCGOUWMnLanIbddNjga7/pub?gid=2059687180&single=true&output=tsv";

  const API_URL =
    "https://script.google.com/macros/s/AKfycbxHJlNozhJqdz_-2EDf1PbKv24yB96793nPPmu0TfITZJiwrdKwAO6KGhZVIN0KBCKlKA/exec";

  const STORAGE = {
    tsvCache: "ygo_tsv_cache_v6",
    tsvCacheAt: "ygo_tsv_cache_at_v6",
    lastView: "ygo_last_view_v1",
  };

  const NET = {
    fetchTimeoutMs: 12000,
    toastMs: 2400,
    searchDebounceMs: 120,
  };

  const VIEW_NAMES = {
    cards: "cards",
    decks: "decks",
    stats: "stats",
    advanced: "advanced",
  };

  const FORM_FIELDS = [
    "num",
    "anio",
    "nombre",
    "edicion",
    "mazo",
    "categoria",
    "tipo",
    "nivel",
    "subtipo",
    "atributo",
    "atk",
    "def",
    "rareza",
    "cantidad",
    "idioma",
    "precio",
    "fecha_compra",
    "notas",
    "imagenurl",
  ];

  const DLIST = {
    edicion: "dlEdicion",
    anio: "dlAnio",
    mazo: "dlMazo",
    categoria: "dlCategoria",
    tipo: "dlTipo",
    subtipo: "dlSubtipo",
    atributo: "dlAtributo",
    rareza: "dlRareza",
    idioma: "dlIdioma",
  };

  const DEFAULTS = {
    edicion: ["1st", "Unlimited", "Limited"],
    categoria: ["Monster", "Spell", "Trap"],
    idioma: ["EN", "ES", "JP", "DE", "FR", "IT", "PT"],
    atributo: ["Light", "Dark", "Fire", "Water", "Earth", "Wind", "Divine"],
    rareza: [
      "Common",
      "Rare",
      "Super Rare",
      "Ultra Rare",
      "Secret Rare",
      "Ultimate Rare",
      "Collector's Rare",
      "Ghost Rare",
      "Starlight Rare",
      "Quarter Century Secret Rare",
    ],
    subtipo: [
      "Normal",
      "Effect",
      "Fusion",
      "Synchro",
      "Xyz",
      "Link",
      "Ritual",
      "Pendulum",
      "Tuner",
      "Normal Spell",
      "Continuous Spell",
      "Quick-Play Spell",
      "Field Spell",
      "Ritual Spell",
      "Equip Spell",
      "Normal Trap",
      "Continuous Trap",
      "Counter Trap",
    ],
  };

  const CATEGORY_META = {
    monster: {
      label: "Monster",
      className: "badge badge--monster",
      aliases: ["monster", "monstruo", "monstruos"],
    },
    spell: {
      label: "Spell",
      className: "badge badge--spell",
      aliases: ["spell", "magia", "magias"],
    },
    trap: {
      label: "Trap",
      className: "badge badge--trap",
      aliases: ["trap", "trampa", "trampas"],
    },
  };

  const FIELD_KEYS_FOR_TEXT_SEARCH = [
    "_id",
    "num",
    "nombre",
    "edicion",
    "mazo",
    "categoria",
    "tipo",
    "nivel",
    "subtipo",
    "atributo",
    "atk",
    "def",
    "rareza",
    "cantidad",
    "idioma",
    "precio",
    "fecha_compra",
    "notas",
    "imagenurl",
  ];

  /* =========================
     DOM HELPERS
  ========================= */
  const $ = (id) => document.getElementById(id);
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function safeText(el, value) {
    if (el) el.textContent = String(value ?? "");
  }

  function safeHtml(el, html) {
    if (el) el.innerHTML = String(html ?? "");
  }

  /* =========================
     DOM REFS
  ========================= */
  const dom = {
    table: $("dbTable"),
    search: $("search"),
    btnClearSearch: $("btnClearSearch"),
    countText: $("countText"),
    btnReload: $("btnReload"),
    btnNew: $("btnNew"),

    statusDot: $("statusDot"),
    statusText: $("statusText"),

    drawer: $("drawer"),
    overlay: $("overlay"),
    btnCloseDrawer: $("btnCloseDrawer"),
    btnCancel: $("btnCancel"),
    btnDuplicate: $("btnDuplicate"),
    btnAssignToDeck: $("btnAssignToDeck"),
    drawerTitle: $("drawerTitle"),
    drawerSubtitle: $("drawerSubtitle"),
    form: $("cardForm"),
    rowIndex: $("rowIndex"),
    formMeta: $("formMeta"),

    viewBtns: qsa(
      ".segmented--views .segmented__btn[data-view], .viewTabs [data-view], button[data-view], [data-role='view-tab'][data-view]"
    ),

    views: qsa(".view[data-view], .view[id^='view'], [data-view-root]"),

    filterBtns: qsa(
      ".segmented__btn[data-filter], button[data-filter], [data-role='category-filter'][data-filter]"
    ),

    imagePreview: {
      root: $("cardImagePreview"),
      img: $("cardImagePreviewImg"),
      link: $("cardImagePreviewLink"),
      empty: $("cardImagePreviewEmpty"),
    },

    adv: {
      root: $("viewAdvanced") || qs('[data-view-root="advanced"]'),
      table: $("advTable"),
      tableWrap: $("advTableWrap"),
      btnApply: $("btnApplyAdvanced"),
      btnReset: $("btnResetAdvanced"),
      q: $("advQ"),
      nombre: $("advNombre"),
      mazo: $("advMazo"),
      categoria: $("advCategoria"),
      tipo: $("advTipo"),
      subtipo: $("advSubtipo"),
      atributo: $("advAtributo"),
      rareza: $("advRareza"),
      idioma: $("advIdioma"),
      edicion: $("advEdicion"),
      anioMin: $("advAnioMin"),
      anioMax: $("advAnioMax"),
      lvlMin: $("advLvlMin"),
      lvlMax: $("advLvlMax"),
      atkMin: $("advAtkMin"),
      atkMax: $("advAtkMax"),
      defMin: $("advDefMin"),
      defMax: $("advDefMax"),
      qtyMin: $("advQtyMin"),
      qtyMax: $("advQtyMax"),
      priceMin: $("advPriceMin"),
      priceMax: $("advPriceMax"),
      countText: $("advCountText"),
    },

    decks: {
      root: $("viewDecks") || qs('[data-view-root="decks"]'),
      list: $("deckList"),
      cards: $("deckCards"),
      title: $("deckTitle"),
      meta: $("deckMeta"),
      btnNew: $("btnNewDeck"),
      btnRename: $("btnRenameDeck"),
      btnDelete: $("btnDeleteDeck"),
      btnExport: $("btnExportDeck"),
      btnImport: $("btnImportDeck"),
      select: $("deckSelect"),
    },

    stats: {
      root: $("viewStats") || qs('[data-view-root="stats"]'),
      totalCards: $("statTotalCards"),
      uniqueCards: $("statUniqueCards"),
      totalQty: $("statTotalQty"),
      totalValue: $("statTotalValue"),
      monsters: $("statMonsters"),
      spells: $("statSpells"),
      traps: $("statTraps"),
      noImg: $("statNoImg"),
      noPrice: $("statNoPrice"),
      noQty: $("statNoQty"),
      incomplete: $("statIncomplete"),
      topTypes: $("statTopTypes"),
      topSets: $("statTopSets"),
      topRarities: $("statTopRarities"),
      topAttributes: $("statTopAttributes"),
    },

    modal: $("modal"),
  };

  /* =========================
     STATE
  ========================= */
  const state = {
    header: [],
    rows: [],
    viewRows: [],
    filter: "all",
    query: "",
    isSaving: false,
    selected: null,
    isOnline: navigator.onLine,
    lastLoadedAt: null,
    activeView: VIEW_NAMES.cards,
    col: {},
  };

  /* =========================
     INIT
  ========================= */
  init();

  function init() {
    bindUI();
    bindNetwork();
    initViews();
    initDecks();
    initAdvancedSearch();
    ensureImagePreview();
    syncAssignToDeckButton();
    loadTSV(false);
  }

  function bindUI() {
    bindSearch();
    bindFilterButtons();
    bindDrawer();
    bindTableInteractions();
    bindFormInteractions();

    dom.btnReload?.addEventListener("click", () => loadTSV(true));
    dom.btnNew?.addEventListener("click", () => openNew());
  }

  function bindNetwork() {
    window.addEventListener("online", () => {
      state.isOnline = true;
      setStatus("ok", "Online");
      toast("Conexión restaurada ✅");
    });

    window.addEventListener("offline", () => {
      state.isOnline = false;
      setStatus("error", "Offline");
      toast("Sin internet. Usando caché si existe 📴");
    });
  }

  function bindSearch() {
    const onSearch = debounce((value) => {
      state.query = String(value || "").trim();
      applyFiltersAndRender();
    }, NET.searchDebounceMs);

    dom.search?.addEventListener("input", (event) => {
      onSearch(event.target.value);
    });

    dom.btnClearSearch?.addEventListener("click", () => {
      if (dom.search) dom.search.value = "";
      state.query = "";
      applyFiltersAndRender();
      dom.search?.focus();
    });
  }

  function bindFilterButtons() {
    dom.filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextFilter = btn.dataset.filter || "all";
        state.filter = nextFilter;

        dom.filterBtns.forEach((item) => {
          const isActive = item.dataset.filter === nextFilter;
          item.classList.toggle("is-active", isActive);
          item.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        applyFiltersAndRender();
      });
    });
  }

  function bindDrawer() {
    dom.btnCloseDrawer?.addEventListener("click", closeDrawer);
    dom.btnCancel?.addEventListener("click", closeDrawer);

    dom.overlay?.addEventListener("click", () => {
      if (isModalOpen()) return;
      closeDrawer();
    });

    dom.btnDuplicate?.addEventListener("click", duplicateSelected);
    dom.btnAssignToDeck?.addEventListener("click", handleAssignToDeckClick);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      if (isModalOpen()) {
        closeModal();
        return;
      }

      closeDrawer();
    });
  }

  function bindTableInteractions() {
    dom.table?.addEventListener("click", (event) => {
      const link = event.target?.closest?.("a");
      if (link) return;

      const tr = event.target?.closest?.("tbody tr[data-id]");
      if (!tr) return;

      openRowById(tr.dataset.id);
    });

    dom.table?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;

      const tr = event.target?.closest?.("tbody tr[data-id]");
      if (!tr) return;

      event.preventDefault();
      openRowById(tr.dataset.id);
    });
  }

  function bindFormInteractions() {
    dom.form?.addEventListener("submit", onSave);

    $("categoria")?.addEventListener("input", () => {
      updateMonsterOnlyVisibility();
      updateCategorySuggestions();

      const category = normalize($("categoria")?.value);
      const attribute = ($("atributo")?.value || "").trim();

      if (["spell", "trap", "magia", "trampa"].includes(category) && attribute) {
        toast("Tip: Atributo normalmente aplica solo a Monstruos 😉");
      }
    });

    $("imagenurl")?.addEventListener(
      "input",
      debounce(() => updateImagePreview(val("imagenurl")), 250)
    );
  }

  /* =========================
     VIEWS
  ========================= */
  function initViews() {
    if (!dom.viewBtns.length || !dom.views.length) return;

    dom.viewBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.view;
        if (!target) return;
        switchView(target);
      });
    });

    const stored = getStoredView();
    const activeFromHtml = dom.viewBtns.find((btn) => btn.classList.contains("is-active"))?.dataset.view;
    const first = dom.viewBtns[0]?.dataset.view || VIEW_NAMES.cards;
    const initial = stored || activeFromHtml || first;

    switchView(initial, { silent: true });
  }

  function switchView(viewName, options = {}) {
    const { silent = false } = options;

    if (!viewName) return;

    state.activeView = viewName;
    storeView(viewName);

    dom.viewBtns.forEach((btn) => {
      const isActive = btn.dataset.view === viewName;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    dom.views.forEach((view) => {
      const candidates = [
        view.dataset.view,
        view.dataset.viewRoot,
        view.id,
        normalizeViewId(view.id),
      ].filter(Boolean);

      const isActive = candidates.includes(viewName);

      view.classList.toggle("is-active", isActive);
      view.hidden = !isActive;
    });

    if (viewName === VIEW_NAMES.stats) renderStats();
    if (viewName === VIEW_NAMES.decks) renderDecksUI();

    if (viewName === VIEW_NAMES.advanced && dom.adv.table && !dom.adv.table.innerHTML.trim()) {
      safeText(dom.adv.countText, "0");
    }

    if (!silent) {
      const label = getViewLabel(viewName);
      if (label) toast(label);
    }
  }

  function normalizeViewId(id) {
    const value = String(id || "").trim();

    if (!value) return "";
    if (!value.startsWith("view")) return value;

    return value.replace(/^view/, "").toLowerCase();
  }

  function getViewLabel(viewName) {
    const labels = {
      cards: "Vista de cartas",
      decks: "Vista de decks",
      stats: "Estadísticas",
      advanced: "Búsqueda avanzada",
    };

    return labels[viewName] || "";
  }

  function getStoredView() {
    try {
      return localStorage.getItem(STORAGE.lastView) || "";
    } catch {
      return "";
    }
  }

  function storeView(viewName) {
    try {
      localStorage.setItem(STORAGE.lastView, String(viewName || ""));
    } catch {}
  }

  /* =========================
     TSV LOAD + CACHE
  ========================= */
  async function loadTSV(withBypassCache = false) {
    setStatus("loading", "Cargando…");

    try {
      const text = await API.fetchTSVText(TSV_URL, {
        timeoutMs: NET.fetchTimeoutMs,
        bypassCache: withBypassCache,
      });

      const rows = API.parseTSV(text);

      if (!rows.length) {
        throw new Error("TSV vacío");
      }

      applyRows(rows);
      cacheTSV(text);
      setStatus("ok", "Listo");

      return;
    } catch (error) {
      console.warn("TSV fetch failed:", error);
    }

    const cached = getCachedTSV();

    if (cached) {
      try {
        const rows = API.parseTSV(cached);

        if (!rows.length) {
          throw new Error("Cache TSV inválido");
        }

        applyRows(rows);

        const cachedAt = getCachedTSVAt();
        setStatus("error", cachedAt ? `Offline (cache ${formatTimeAgo(cachedAt)})` : "Offline (cache)");

        return;
      } catch (error) {
        console.warn("Cache parse failed:", error);
      }
    }

    state.rows = [];
    state.header = [];
    state.viewRows = [];
    state.col = {};

    setStatus("error", "Error");
    renderTable([]);
    safeText(dom.countText, "0");
    fillEmptyStats();
    toast("No se pudo cargar la base de cartas.");
  }

  function applyRows(rows) {
    state.rows = Array.isArray(rows) ? rows : [];
    state.header = state.rows[0] || [];
    state.lastLoadedAt = Date.now();
    state.col = AdvancedSearch.buildIndex(state.header);

    hydrateDatalistsFromRows(state.rows);
    applyFiltersAndRender();
    renderStats();
    renderDecksUI();
    syncAssignToDeckButton();
  }

  function cacheTSV(tsvText) {
    try {
      localStorage.setItem(STORAGE.tsvCache, String(tsvText || ""));
      localStorage.setItem(STORAGE.tsvCacheAt, String(Date.now()));
    } catch {}
  }

  function getCachedTSV() {
    try {
      return localStorage.getItem(STORAGE.tsvCache) || "";
    } catch {
      return "";
    }
  }

  function getCachedTSVAt() {
    try {
      const value = localStorage.getItem(STORAGE.tsvCacheAt);
      return value ? Number(value) : null;
    } catch {
      return null;
    }
  }

  /* =========================
     COLUMN HELPERS
  ========================= */
  function col(key) {
    const idx = state.col?.[key];
    return Number.isInteger(idx) ? idx : -1;
  }

  function getCell(row, key) {
    const index = col(key);
    return index >= 0 ? row?.[index] ?? "" : "";
  }

  function setRowCell(rowArray, key, value) {
    const index = col(key);

    if (index >= 0 && Array.isArray(rowArray)) {
      rowArray[index] = String(value ?? "").trim();
    }
  }

  function findRowById(id) {
    const safeId = String(id || "").trim();
    const idIndex = col("_id");

    if (!safeId || idIndex < 0) return null;

    return (state.rows || []).find((row, index) => {
      return index > 0 && String(row?.[idIndex] || "").trim() === safeId;
    }) || null;
  }

  function resolveSheetRowIndexById(id) {
    const safeId = String(id || "").trim();
    const idIndex = col("_id");

    if (!safeId || idIndex < 0) return "";

    const index = (state.rows || []).findIndex((row, rowIndex) => {
      return rowIndex > 0 && String(row?.[idIndex] || "").trim() === safeId;
    });

    return index >= 1 ? index + 1 : "";
  }

  function openRowById(id) {
    const row = findRowById(id);

    if (!row) {
      toast("No encontré esa carta en la base cargada.");
      return;
    }

    const sheetRowIndex = resolveSheetRowIndexById(id);
    openEdit(row, sheetRowIndex);
  }

  function rowToCardObject(row) {
    const obj = {};

    FIELD_KEYS_FOR_TEXT_SEARCH.forEach((key) => {
      obj[key] = String(getCell(row, key) || "").trim();
    });

    obj.id = obj._id;
    obj.cardId = obj._id;

    return obj;
  }

  /* =========================
     DATALISTS
  ========================= */
  function hydrateDatalistsFromRows(rows) {
    const facets = AdvancedSearch.quickFacets(rows, {
      includeCounts: false,
      includeNumericRanges: false,
    });

    const values = {
      edicion: facets.edicion || [],
      anio: facets.anio || [],
      mazo: facets.mazo || [],
      categoria: facets.categoria || [],
      tipo: facets.tipo || [],
      subtipo: facets.subtipo || [],
      atributo: facets.atributo || [],
      rareza: facets.rareza || [],
      idioma: facets.idioma || [],
    };

    Object.keys(values).forEach((key) => {
      renderDatalist(DLIST[key], mergeUnique(values[key], DEFAULTS[key] || []));
    });
  }

  function renderDatalist(datalistId, items) {
    const datalist = $(datalistId);
    if (!datalist) return;

    datalist.innerHTML = "";

    (items || []).forEach((item) => {
      const value = String(item || "").trim();

      if (!value) return;

      const option = document.createElement("option");
      option.value = value;
      datalist.appendChild(option);
    });
  }

  function mergeUnique(primary, fallback) {
    const seen = new Set();
    const output = [];

    [...(primary || []), ...(fallback || [])].forEach((item) => {
      const value = String(item || "").trim();

      if (!value) return;

      const key = normalize(value);

      if (seen.has(key)) return;

      seen.add(key);
      output.push(value);
    });

    return output.sort((a, b) =>
      a.localeCompare(b, "es", {
        numeric: true,
        sensitivity: "base",
      })
    );
  }

  /* =========================
     MAIN FILTER + TABLE
  ========================= */
  function applyFiltersAndRender() {
    if (!state.rows || state.rows.length < 2) {
      state.viewRows = [state.header || []];
      safeText(dom.countText, "0");
      renderTable(state.viewRows);
      return;
    }

    const query = buildMainTableQuery();
    const result = AdvancedSearch.filterRows(state.rows, query, {
      includeHeaderInResult: true,
      treatMissingQtyAs1: false,
    });

    state.viewRows = result.resultRows || [state.header, ...(result.rows || [])];

    renderTable(state.viewRows);
    safeText(dom.countText, String(result.total || 0));
  }

  function buildMainTableQuery() {
    const query = {
      text: state.query || "",
      textMode: "words",
      textFields: FIELD_KEYS_FOR_TEXT_SEARCH.filter((key) => col(key) >= 0),
    };

    if (state.filter === "monster") query.categoria = "Monster";
    if (state.filter === "spell") query.categoria = "Spell";
    if (state.filter === "trap") query.categoria = "Trap";

    return query;
  }

  function renderTable(rows) {
    if (!dom.table) return;

    const header = rows?.[0] || state.header || [];
    const body = (rows || []).slice(1);

    const idIndex = col("_id");
    const categoryIndex = col("categoria");
    const levelIndex = col("nivel");
    const imageIndex = col("imagenurl");

    const visibleCols = header
      .map((_, index) => index)
      .filter((index) => index !== idIndex);

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    visibleCols.forEach((index) => {
      const th = document.createElement("th");
      th.textContent = header[index] || "";
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);

    const tbody = document.createElement("tbody");

    if (!body.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");

      td.colSpan = Math.max(1, visibleCols.length);
      td.innerHTML = `
        <div class="emptyState">
          <strong>No hay resultados.</strong>
          <div class="muted">Prueba con otra búsqueda o limpia los filtros. Sí, el botón existe por algo.</div>
        </div>
      `;

      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      const fragment = document.createDocumentFragment();

      body.forEach((row) => {
        const tr = document.createElement("tr");
        tr.tabIndex = 0;

        const id = idIndex >= 0 ? String(row?.[idIndex] || "").trim() : "";
        if (id) tr.dataset.id = id;

        visibleCols.forEach((index) => {
          const td = document.createElement("td");
          const raw = String(row?.[index] || "").trim();

          if (index === categoryIndex) {
            td.appendChild(createCategoryBadge(raw));
          } else if (index === levelIndex) {
            td.textContent = renderLevel(raw);
            if (raw) td.title = `Nivel: ${raw}`;
          } else if (index === imageIndex) {
            renderImageCell(td, raw);
          } else {
            td.textContent = raw;
          }

          tr.appendChild(td);
        });

        fragment.appendChild(tr);
      });

      tbody.appendChild(fragment);
    }

    dom.table.innerHTML = "";
    dom.table.appendChild(thead);
    dom.table.appendChild(tbody);
  }

  function createCategoryBadge(value) {
    const span = document.createElement("span");
    const key = getCategoryKey(value);
    const meta = CATEGORY_META[key];

    span.className = meta?.className || "badge";
    span.textContent = meta?.label || value || "Sin categoría";

    return span;
  }

  function renderLevel(raw) {
    const n = parseInt(String(raw || "").trim(), 10);

    if (Number.isFinite(n) && n > 0) {
      return "⭐".repeat(Math.min(n, 13));
    }

    return String(raw || "");
  }

  function renderImageCell(td, url) {
    if (!url) {
      td.textContent = "";
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer noopener";
    anchor.textContent = "Ver imagen";
    anchor.className = "tableLink";

    td.appendChild(anchor);
  }

  /* =========================
     DRAWER / FORM
  ========================= */
  function openNew() {
    state.selected = null;

    safeText(dom.drawerTitle, "Nueva carta");
    safeText(dom.drawerSubtitle, "Completa la información y guarda");

    if (dom.rowIndex) dom.rowIndex.value = "";

    clearFormFields();

    if ($("categoria") && !$("categoria").value) {
      $("categoria").value = "Monster";
    }

    if (dom.btnDuplicate) {
      dom.btnDuplicate.disabled = true;
    }

    updateMonsterOnlyVisibility();
    updateCategorySuggestions();
    updateImagePreview("");
    syncAssignToDeckButton();

    setFormMeta("Nueva carta.");
    openDrawer();
  }

  function openEdit(row, sheetRowIndex) {
    state.selected = {
      rowArray: row,
      sheetRowIndex,
    };

    safeText(dom.drawerTitle, "Editar carta");
    safeText(dom.drawerSubtitle, sheetRowIndex ? `Fila #${sheetRowIndex}` : "Editando carta");

    if (dom.rowIndex) {
      dom.rowIndex.value = sheetRowIndex || "";
    }

    fillFormFromRow(row);
    updateMonsterOnlyVisibility();
    updateCategorySuggestions();
    updateImagePreview(getCell(row, "imagenurl"));

    if (dom.btnDuplicate) {
      dom.btnDuplicate.disabled = false;
    }

    syncAssignToDeckButton();

    setFormMeta("Editando carta.");
    openDrawer();
  }

  function openDrawer() {
    if (!dom.drawer) return;

    dom.drawer.classList.add("is-open");
    dom.drawer.setAttribute("aria-hidden", "false");

    if (dom.overlay) {
      dom.overlay.hidden = false;
    }

    setTimeout(() => $("nombre")?.focus(), 0);
  }

  function closeDrawer() {
    if (!dom.drawer) return;

    dom.drawer.classList.remove("is-open");
    dom.drawer.setAttribute("aria-hidden", "true");

    if (dom.overlay) {
      dom.overlay.hidden = true;
    }

    syncAssignToDeckButton();
  }

  function clearFormFields() {
    FORM_FIELDS.forEach((fieldId) => {
      const input = $(fieldId);
      if (input) input.value = "";
    });
  }

  function fillFormFromRow(row) {
    FORM_FIELDS.forEach((fieldId) => {
      setVal(fieldId, getCell(row, fieldId));
    });
  }

  function setVal(id, value) {
    const input = $(id);
    if (input) input.value = String(value ?? "");
  }

  function val(id) {
    return ($(id)?.value || "").trim();
  }

  function buildRowForSave(options = {}) {
    const { forceNewId = false } = options;
    const headerLength = (state.header || []).length;

    if (!headerLength) {
      throw new Error("No header loaded");
    }

    const existingId = getCell(state.selected?.rowArray, "_id");
    const rowId = !forceNewId && existingId ? existingId : makeId();

    const row = new Array(headerLength).fill("");
    const normalizedCategory = normalizeCategoria(val("categoria"));
    const isMonster = isMonsterCategoria(normalizedCategory);

    setRowCell(row, "_id", rowId);
    setRowCell(row, "num", val("num"));
    setRowCell(row, "edicion", val("edicion"));
    setRowCell(row, "anio", val("anio"));
    setRowCell(row, "mazo", val("mazo"));
    setRowCell(row, "nombre", val("nombre"));
    setRowCell(row, "categoria", normalizedCategory);
    setRowCell(row, "tipo", val("tipo"));

    setRowCell(row, "nivel", isMonster ? val("nivel") : "");
    setRowCell(row, "subtipo", val("subtipo"));
    setRowCell(row, "atributo", isMonster ? val("atributo") : "");
    setRowCell(row, "atk", isMonster ? val("atk") : "");
    setRowCell(row, "def", isMonster ? val("def") : "");

    setRowCell(row, "rareza", val("rareza"));
    setRowCell(row, "cantidad", val("cantidad"));
    setRowCell(row, "idioma", val("idioma"));
    setRowCell(row, "precio", val("precio"));
    setRowCell(row, "fecha_compra", val("fecha_compra"));
    setRowCell(row, "notas", val("notas"));
    setRowCell(row, "imagenurl", val("imagenurl"));

    return row;
  }

  function validateFormBeforeSave() {
    const category = normalizeCategoria(val("categoria"));

    if (category && !["Monster", "Spell", "Trap"].includes(category)) {
      toast("Categoría rara. Usa Monster, Spell o Trap.");
      $("categoria")?.focus();
      return false;
    }

    if (isMonsterCategoria(category)) {
      const level = val("nivel");
      const atk = val("atk");
      const def = val("def");

      if (level && !isFiniteInteger(level)) {
        toast("Nivel debe ser un número entero.");
        $("nivel")?.focus();
        return false;
      }

      if (atk && !isFiniteNumber(atk)) {
        toast("ATK debe ser un número.");
        $("atk")?.focus();
        return false;
      }

      if (def && !isFiniteNumber(def)) {
        toast("DEF debe ser un número.");
        $("def")?.focus();
        return false;
      }
    }

    const qty = val("cantidad");

    if (qty && !isFiniteNumber(qty)) {
      toast("Cantidad debe ser un número.");
      $("cantidad")?.focus();
      return false;
    }

    const price = val("precio");

    if (price && !isFiniteNumber(price)) {
      toast("Precio debe ser un número.");
      $("precio")?.focus();
      return false;
    }

    const image = val("imagenurl");

    if (image && !looksLikeUrl(image)) {
      toast("La URL de imagen no parece válida.");
      $("imagenurl")?.focus();
      return false;
    }

    return true;
  }

  async function onSave(event) {
    event.preventDefault();

    if (state.isSaving) return;

    const rowIndex = String(dom.rowIndex?.value || "").trim();
    let action = rowIndex ? "update" : "add";

    if (!val("nombre")) {
      toast("Falta el nombre.");
      $("nombre")?.focus();
      return;
    }

    if (!state.isOnline) {
      toast("Estás offline. No se puede guardar ahora 📴");
      setFormMeta("Offline: no guardó.");
      return;
    }

    if (!validateFormBeforeSave()) return;

    if (!rowIndex) {
      const duplicate = findDuplicateRowForAdd();

      if (duplicate) {
        const duplicateDecision = await handleDuplicateBeforeAdd(duplicate);

        if (!duplicateDecision) return;

        if (duplicateDecision.type === "sum") {
          action = "update";

          await doSave({
            action,
            rowIndex: duplicateDecision.rowIndex,
            row: duplicateDecision.row,
            closeOnAdd: false,
          });

          return;
        }
      }
    }

    let payloadRow;

    try {
      payloadRow = buildRowForSave();
    } catch (error) {
      console.error(error);
      toast("No se pudo preparar el registro. La base aún no cargó el encabezado.");
      return;
    }

    await doSave({
      action,
      rowIndex: rowIndex || "",
      row: payloadRow,
      closeOnAdd: true,
    });
  }

  async function doSave({ action, rowIndex, row, closeOnAdd }) {
    try {
      state.isSaving = true;
      lockSave(true);
      setFormMeta("Guardando…");

      const response = await API.saveRow(
        API_URL,
        {
          action,
          rowIndex: rowIndex || "",
          row,
        },
        {
          timeoutMs: NET.fetchTimeoutMs,
        }
      );

      const msg = response?.data?.msg || response?.data?.message || "Guardado ✅";

      toast(msg);
      setFormMeta("Listo.");

      await loadTSV(true);

      if (action === "add" && closeOnAdd) {
        closeDrawer();
      }
    } catch (error) {
      console.error(error);
      toast("No se pudo guardar. Revisa conexión o permisos.");
      setFormMeta("No guardó. Reintenta.");
    } finally {
      state.isSaving = false;
      lockSave(false);
    }
  }

  function duplicateSelected() {
    if (!state.selected?.rowArray) {
      toast("No hay nada para duplicar.");
      return;
    }

    safeText(dom.drawerTitle, "Duplicar carta");
    safeText(dom.drawerSubtitle, "Se guardará como una nueva carta");

    if (dom.rowIndex) {
      dom.rowIndex.value = "";
    }

    state.selected = null;

    if (dom.btnDuplicate) {
      dom.btnDuplicate.disabled = true;
    }

    syncAssignToDeckButton();
    setFormMeta("Duplica y guarda.");
    openDrawer();
  }

  function lockSave(lock) {
    const btnSave = $("btnSave");

    if (btnSave) {
      btnSave.disabled = lock;
      btnSave.textContent = lock ? "Guardando…" : "Guardar";
    }

    if (dom.btnNew) dom.btnNew.disabled = lock;
    if (dom.btnReload) dom.btnReload.disabled = lock;
    if (dom.btnAssignToDeck) {
      dom.btnAssignToDeck.disabled = lock || !state.selected?.rowArray;
    }
  }

  function updateMonsterOnlyVisibility() {
    const isMonster = isMonsterCategoria(val("categoria"));
    const nodes = qsa('[data-only="monster"]');

    nodes.forEach((wrap) => {
      wrap.style.display = isMonster ? "" : "none";

      const inputs = qsa("input, select, textarea", wrap);

      inputs.forEach((input) => {
        input.disabled = !isMonster;

        if (!isMonster && ["atk", "def", "nivel", "atributo"].includes(input.id)) {
          input.value = "";
        }
      });
    });
  }

  function updateCategorySuggestions() {
    const category = getCategoryKey(val("categoria"));
    const subtype = $("subtipo");

    if (!subtype) return;

    if (category === "spell") {
      subtype.placeholder = "Ej: Quick-Play Spell, Field Spell...";
    } else if (category === "trap") {
      subtype.placeholder = "Ej: Normal Trap, Counter Trap...";
    } else if (category === "monster") {
      subtype.placeholder = "Ej: Effect, Fusion, Tuner...";
    }
  }

  function setFormMeta(message) {
    safeText(dom.formMeta, message);
  }

  function syncAssignToDeckButton() {
    if (!dom.btnAssignToDeck) return;

    dom.btnAssignToDeck.disabled = !Boolean(state.selected?.rowArray);
  }

  /* =========================
     IMAGE PREVIEW
  ========================= */
  function ensureImagePreview() {
    if (dom.imagePreview.root) return;

    const imageInput = $("imagenurl");
    const form = dom.form;

    if (!imageInput || !form) return;

    const wrap = imageInput.closest(".field") || imageInput.parentElement || form;

    const root = document.createElement("div");
    root.id = "cardImagePreview";
    root.className = "cardImagePreview";
    root.innerHTML = `
      <div class="cardImagePreview__empty" id="cardImagePreviewEmpty">
        Sin imagen para previsualizar.
      </div>
      <img id="cardImagePreviewImg" class="cardImagePreview__img" alt="Preview de carta" hidden />
      <a id="cardImagePreviewLink" class="cardImagePreview__link" href="#" target="_blank" rel="noreferrer noopener" hidden>
        Abrir imagen
      </a>
    `;

    wrap.insertAdjacentElement("afterend", root);

    dom.imagePreview.root = root;
    dom.imagePreview.img = $("cardImagePreviewImg");
    dom.imagePreview.link = $("cardImagePreviewLink");
    dom.imagePreview.empty = $("cardImagePreviewEmpty");
  }

  function updateImagePreview(url) {
    ensureImagePreview();

    const cleanUrl = String(url || "").trim();
    const root = dom.imagePreview.root;
    const img = dom.imagePreview.img;
    const link = dom.imagePreview.link;
    const empty = dom.imagePreview.empty;

    if (!root || !img || !link || !empty) return;

    if (!cleanUrl || !looksLikeUrl(cleanUrl)) {
      img.hidden = true;
      link.hidden = true;
      empty.hidden = false;
      empty.textContent = cleanUrl
        ? "La URL de imagen no parece válida."
        : "Sin imagen para previsualizar.";
      img.removeAttribute("src");
      link.removeAttribute("href");
      return;
    }

    empty.hidden = true;
    img.hidden = false;
    link.hidden = false;

    img.src = cleanUrl;
    link.href = cleanUrl;

    img.onerror = () => {
      img.hidden = true;
      empty.hidden = false;
      empty.textContent = "No se pudo cargar la imagen. Ese link está haciendo lo que puede, o sea nada.";
    };

    img.onload = () => {
      empty.hidden = true;
      img.hidden = false;
    };
  }

  /* =========================
     DUPLICATE DETECTION
  ========================= */
  function canonicalKeyFromRow(row) {
    const name = normalize(getCell(row, "nombre"));
    const setCode = normalize(getCell(row, "mazo"));
    const edition = normalize(getCell(row, "edicion"));
    const language = normalize(getCell(row, "idioma"));
    const rarity = normalize(getCell(row, "rareza"));

    return [name, setCode, edition, language, rarity].join("|");
  }

  function canonicalKeyFromForm() {
    const name = normalize(val("nombre"));
    const setCode = normalize(val("mazo"));
    const edition = normalize(val("edicion"));
    const language = normalize(val("idioma"));
    const rarity = normalize(val("rareza"));

    return [name, setCode, edition, language, rarity].join("|");
  }

  function findDuplicateRowForAdd() {
    const key = canonicalKeyFromForm();

    if (!key || key.startsWith("|")) return null;

    const data = (state.rows || []).slice(1);
    const currentId = String(getCell(state.selected?.rowArray, "_id") || "").trim();

    for (const row of data) {
      const id = String(getCell(row, "_id") || "").trim();

      if (currentId && id && id === currentId) continue;

      if (canonicalKeyFromRow(row) === key) {
        return row;
      }
    }

    return null;
  }

  async function handleDuplicateBeforeAdd(duplicateRow) {
    const duplicateInfo = describeRow(duplicateRow);
    const incomingQty = Math.max(0, toInt(val("cantidad"), 0));
    const existingQty = Math.max(0, toInt(getCell(duplicateRow, "cantidad"), 0));

    const choice = await modalChoice({
      title: "Esa carta ya existe 👀",
      subtitle: "¿Qué hacemos con este duplicado?",
      bodyHtml: `
        <div class="emptyState">
          <div style="font-weight:900; margin-bottom:6px;">Encontrada:</div>
          <div class="muted" style="line-height:1.4">${escapeHtml(duplicateInfo)}</div>
          <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
            <span class="chip">Cantidad actual: <b>${existingQty}</b></span>
            <span class="chip">Nueva cantidad: <b>${incomingQty}</b></span>
          </div>
          <div style="margin-top:10px" class="muted">
            Si eliges “Sumar”, actualizo la fila existente sumando cantidad.
          </div>
        </div>
      `,
      buttons: [
        { id: "sum", label: "Sumar cantidad", kind: "primary" },
        { id: "new", label: "Crear otra fila", kind: "ghost" },
        { id: "cancel", label: "Cancelar", kind: "ghost" },
      ],
    });

    if (choice === "cancel" || !choice) {
      toast("Guardado cancelado.");
      setFormMeta("Cancelado.");
      return null;
    }

    if (choice === "new") {
      return { type: "new" };
    }

    if (choice === "sum") {
      const duplicateId = String(getCell(duplicateRow, "_id") || "").trim();
      const duplicateRowIndex = resolveSheetRowIndexById(duplicateId);
      const payloadRow = buildRowForSave({ forceNewId: true });

      setRowCell(payloadRow, "_id", duplicateId);
      setRowCell(payloadRow, "cantidad", String(existingQty + incomingQty));

      return {
        type: "sum",
        rowIndex: String(duplicateRowIndex || ""),
        row: payloadRow,
      };
    }

    return null;
  }

  /* =========================
     DECKS — MODULE
  ========================= */
  function initDecks() {
    dom.decks.btnNew?.addEventListener("click", async () => {
      const name = await modalPrompt({
        title: "Nuevo deck",
        subtitle: "Ponle un nombre al deck.",
        placeholder: "Ej: Dark Magician Control",
        okLabel: "Crear",
      });

      if (!name) return;

      Decks.createDeck(name);
      renderDecksUI();
      toast("Deck creado ✅");
    });

    dom.decks.btnRename?.addEventListener("click", async () => {
      const deck = Decks.getActiveDeck();

      if (!deck) {
        toast("No hay deck activo.");
        return;
      }

      const name = await modalPrompt({
        title: "Renombrar deck",
        subtitle: "Cambiarle el nombre no mejora las cartas, pero al menos ordena la tragedia.",
        placeholder: "Nuevo nombre",
        initialValue: deck.name,
        okLabel: "Guardar",
      });

      if (!name) return;

      Decks.renameDeck(deck.id, name);
      renderDecksUI();
      toast("Renombrado ✅");
    });

    dom.decks.btnDelete?.addEventListener("click", async () => {
      const deck = Decks.getActiveDeck();

      if (!deck) {
        toast("No hay deck activo.");
        return;
      }

      const choice = await modalChoice({
        title: "Eliminar deck",
        subtitle: `Vas a borrar "${escapeHtml(deck.name)}"`,
        bodyHtml: `<div class="emptyState">Esto no tiene undo. Como muchas decisiones humanas.</div>`,
        buttons: [
          { id: "delete", label: "Eliminar", kind: "primary" },
          { id: "cancel", label: "Cancelar", kind: "ghost" },
        ],
      });

      if (choice !== "delete") return;

      Decks.deleteDeck(deck.id);
      renderDecksUI();
      toast("Deck eliminado 🗑️");
    });

    dom.decks.btnExport?.addEventListener("click", () => {
      const deck = Decks.getActiveDeck();

      if (!deck) {
        toast("No hay deck activo.");
        return;
      }

      const json = Decks.exportDeckJSON(deck.id);
      downloadText(json, `deck_${safeFilename(deck.name || deck.id)}.json`, "application/json");
    });

    dom.decks.btnImport?.addEventListener("click", async () => {
      const file = await pickFile(".json,application/json");

      if (!file) return;

      const text = await file.text();
      const result = Decks.importDeckJSON(text, {
        setActive: true,
        mode: "duplicate",
      });

      if (!result?.ok) {
        toast(result?.error || "No se pudo importar el deck.");
        return;
      }

      renderDecksUI();
      toast("Deck importado ✅");
    });

    dom.decks.select?.addEventListener("change", (event) => {
      const id = String(event.target.value || "");

      if (id) {
        Decks.setActiveDeck(id);
      }

      renderDecksUI();
    });

    renderDecksUI();
  }

  async function handleAssignToDeckClick() {
    if (!state.selected?.rowArray) {
      toast("Selecciona una carta primero.");
      return;
    }

    let decks = Decks.listDecks();

    if (!decks.length) {
      const name = await modalPrompt({
        title: "Primero crea un deck",
        subtitle: "No puedo meter cartas en la nada. Aunque suena filosófico.",
        placeholder: "Nombre del deck",
        okLabel: "Crear deck",
      });

      if (!name) return;

      Decks.createDeck(name);
      decks = Decks.listDecks();
    }

    let activeDeck = Decks.getActiveDeck();

    if (!activeDeck) {
      const id = Decks.ensureActiveDeck({
        createIfMissing: true,
      });

      activeDeck = Decks.getDeck(id);
    }

    const card = rowToCardObject(state.selected.rowArray);
    const cardName = card.nombre || "(sin nombre)";

    const choice = await modalChoice({
      title: "Agregar al deck",
      subtitle: `"${escapeHtml(cardName)}" → "${escapeHtml(activeDeck?.name || "Deck")}"`,
      bodyHtml: `
        <div style="display:flex; flex-direction:column; gap:10px;">
          <label style="font-size:13px;">Deck destino:</label>
          <select id="modalDeckSelect" class="select" style="width:100%">
            ${decks
              .map((deck) => {
                const selected = deck.id === activeDeck?.id ? "selected" : "";
                return `<option value="${escapeHtml(deck.id)}" ${selected}>${escapeHtml(deck.name)}</option>`;
              })
              .join("")}
          </select>

          <label style="font-size:13px; margin-top:6px;">Cantidad:</label>
          <input
            id="modalDeckQty"
            type="number"
            min="1"
            max="99"
            value="1"
            class="input"
            style="width:100px;"
          />
        </div>
      `,
      buttons: [
        { id: "confirm", label: "Agregar 🃏", kind: "primary" },
        { id: "cancel", label: "Cancelar", kind: "ghost" },
      ],
    });

    if (!choice || choice === "cancel") return;

    const selectedDeckId = $("modalDeckSelect")?.value || activeDeck?.id;
    const qty = Math.max(1, toInt($("modalDeckQty")?.value || "1", 1));

    if (!selectedDeckId) {
      toast("No hay deck destino.");
      return;
    }

    Decks.setActiveDeck(selectedDeckId);

    const result = await Decks.addCardToDeck(selectedDeckId, card, {
      qty,
      onDuplicate: async ({ existingQty, addQty }) => {
        const duplicateChoice = await modalChoice({
          title: "La carta ya está en el deck",
          subtitle: `${cardName}`,
          bodyHtml: `
            <div class="emptyState">
              <div>Copias actuales: <b>${existingQty}</b></div>
              <div>Copias nuevas: <b>${addQty}</b></div>
              <div class="muted" style="margin-top:8px;">Puedes sumar o reemplazar la cantidad.</div>
            </div>
          `,
          buttons: [
            { id: "increment", label: "Sumar", kind: "primary" },
            { id: "replace", label: "Reemplazar", kind: "ghost" },
            { id: "cancel", label: "Cancelar", kind: "ghost" },
          ],
        });

        return duplicateChoice || "cancel";
      },
    });

    if (!result?.ok) {
      toast(result?.error || "No se pudo agregar la carta al deck.");
      return;
    }

    renderDecksUI();
    toast(`Agregada al deck "${Decks.getActiveDeck()?.name || "Deck"}" ✅`);
  }

  function renderDecksUI() {
    if (!dom.decks.root) return;

    const decks = Decks.listDecks();
    let activeDeck = Decks.getActiveDeck();

    if (!activeDeck && decks.length) {
      Decks.setActiveDeck(decks[0].id);
      activeDeck = Decks.getActiveDeck();
    }

    renderDeckSelect(decks, activeDeck);
    renderDeckList(decks, activeDeck);
    renderActiveDeckCards(activeDeck);
  }

  function renderDeckSelect(decks, activeDeck) {
    if (!dom.decks.select) return;

    dom.decks.select.innerHTML = "";

    if (!decks.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Sin decks";
      dom.decks.select.appendChild(option);
      return;
    }

    decks.forEach((deck) => {
      const option = document.createElement("option");
      option.value = deck.id;
      option.textContent = deck.name;

      if (deck.id === activeDeck?.id) {
        option.selected = true;
      }

      dom.decks.select.appendChild(option);
    });
  }

  function renderDeckList(decks, activeDeck) {
    if (!dom.decks.list) return;

    dom.decks.list.innerHTML = "";

    if (!decks.length) {
      dom.decks.list.innerHTML = `<div class="emptyState">No hay decks. Crea uno y deja de mirar el vacío.</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    decks.forEach((deck) => {
      const stats = Decks.getDeckStats(deck.id);
      const item = document.createElement("div");

      item.className = `deckItem${deck.id === activeDeck?.id ? " is-active" : ""}`;

      item.innerHTML = `
        <div class="deckItem__main">
          <div class="deckItem__name">${escapeHtml(deck.name)}</div>
          <div class="deckItem__sub">${escapeHtml(deck.notes || "Sin notas")}</div>
        </div>
        <div class="deckItem__meta">
          <div class="deckCount">${stats?.totalCopies || 0}</div>
          <div class="muted" style="font-size:11px">${formatTimeAgo(deck.updatedAt || deck.createdAt)}</div>
        </div>
      `;

      item.addEventListener("click", () => {
        Decks.setActiveDeck(deck.id);
        renderDecksUI();
      });

      fragment.appendChild(item);
    });

    dom.decks.list.appendChild(fragment);
  }

  function renderActiveDeckCards(deck) {
    safeText(dom.decks.title, deck?.name || "Decks");
    safeText(dom.decks.meta, deck ? getDeckSummary(deck.id) : "Sin deck activo");

    if (!dom.decks.cards) return;

    dom.decks.cards.innerHTML = "";

    if (!deck) {
      dom.decks.cards.innerHTML = `<div class="emptyState">Crea o selecciona un deck.</div>`;
      return;
    }

    const cards = Decks.getDeckCards(deck.id);

    if (!cards.length) {
      dom.decks.cards.innerHTML = `<div class="emptyState">Vacío. Como un sobre recién abierto sin holográfica.</div>`;
      return;
    }

    const table = document.createElement("table");
    table.className = "deckCardsTable";

    table.innerHTML = `
      <thead>
        <tr>
          <th>Carta</th>
          <th>Categoría</th>
          <th style="text-align:right">Qty</th>
          <th style="text-align:right">Acciones</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");

    cards.forEach((cardRef) => {
      const row = findRowById(cardRef.id);
      const cardObj = row ? rowToCardObject(row) : null;
      const meta = {
        ...(cardRef.meta || {}),
        ...(cardObj || {}),
      };

      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${escapeHtml(getCardLabel(cardRef.id, meta))}</td>
        <td>${escapeHtml(normalizeCategoria(meta.categoria || "-"))}</td>
        <td style="text-align:right">${cardRef.qty}</td>
        <td>
          <div class="deckCardsRowActions">
            <button class="smallbtn" data-act="minus" type="button">-1</button>
            <button class="smallbtn" data-act="plus" type="button">+1</button>
            <button class="smallbtn smallbtn--danger" data-act="del" type="button">Quitar</button>
          </div>
        </td>
      `;

      tr.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          const action = btn.dataset.act;

          if (action === "del") {
            Decks.removeCardFromDeck(deck.id, cardRef.id);
          } else if (action === "plus") {
            Decks.incrementCardQty(deck.id, cardRef.id, 1);
          } else if (action === "minus") {
            Decks.incrementCardQty(deck.id, cardRef.id, -1);
          }

          renderDecksUI();
        });
      });

      tbody.appendChild(tr);
    });

    dom.decks.cards.appendChild(table);
  }

  function getDeckSummary(deckId) {
    const stats = Decks.getDeckStats(deckId);

    if (!stats) return "Sin deck activo";

    const category = stats.byCategory || {};
    const monsters = category.Monster || category.monster || 0;
    const spells = category.Spell || category.spell || 0;
    const traps = category.Trap || category.trap || 0;

    return `${stats.uniqueCards} cartas únicas · ${stats.totalCopies} copias · ${monsters} Monstruos · ${spells} Magias · ${traps} Trampas`;
  }

  function getCardLabel(cardId, meta = {}) {
    const row = findRowById(cardId);

    if (row) {
      const name = String(getCell(row, "nombre") || "").trim();
      const setCode = String(getCell(row, "mazo") || "").trim();
      const edition = String(getCell(row, "edicion") || "").trim();

      return [name, setCode, edition].filter(Boolean).join(" · ") || cardId;
    }

    const name = meta.nombre || meta.name || "Carta no encontrada en TSV";
    const setCode = meta.mazo || meta.set || "";
    const edition = meta.edicion || meta.edition || "";

    return [name, setCode, edition].filter(Boolean).join(" · ") || cardId;
  }

  /* =========================
     STATS — MODULE
  ========================= */
  function renderStats() {
    if (!dom.stats.root) return;

    const stats = Stats.computeFromTSV(state.rows || [], {
      currency: "COP",
      locale: "es-CO",
      treatMissingQtyAs1: false,
      requiredFields: ["nombre", "categoria", "mazo", "cantidad"],
      topLimit: 10,
    });

    const summary = Stats.summarize
      ? Stats.summarize(stats)
      : buildStatsSummaryFallback(stats);

    safeText(dom.stats.totalCards, summary.registeredRows);
    safeText(dom.stats.uniqueCards, summary.uniqueCards || summary.uniqueIds || 0);
    safeText(dom.stats.totalQty, summary.totalCopies);
    safeText(dom.stats.totalValue, Stats.formatMoney(summary.totalValue || 0, "COP", "es-CO"));
    safeText(dom.stats.monsters, summary.monsters);
    safeText(dom.stats.spells, summary.spells);
    safeText(dom.stats.traps, summary.traps);
    safeText(dom.stats.noImg, summary.noImage);
    safeText(dom.stats.noPrice, summary.noPrice);
    safeText(dom.stats.noQty, summary.noQty);
    safeText(dom.stats.incomplete, summary.incomplete);

    renderStatsTopList(dom.stats.topTypes, stats.tables?.byType, 8, "copies");
    renderStatsTopList(dom.stats.topSets, stats.tables?.bySetCode, 8, "copies");
    renderStatsTopList(dom.stats.topRarities, stats.tables?.byRarity, 8, "copies");
    renderStatsTopList(dom.stats.topAttributes, stats.tables?.byAttribute, 8, "copies");
  }

  function fillEmptyStats() {
    [
      dom.stats.totalCards,
      dom.stats.uniqueCards,
      dom.stats.totalQty,
      dom.stats.totalValue,
      dom.stats.monsters,
      dom.stats.spells,
      dom.stats.traps,
      dom.stats.noImg,
      dom.stats.noPrice,
      dom.stats.noQty,
      dom.stats.incomplete,
    ].forEach((el) => safeText(el, "0"));

    [
      dom.stats.topTypes,
      dom.stats.topSets,
      dom.stats.topRarities,
      dom.stats.topAttributes,
    ].forEach((el) => {
      if (el) el.innerHTML = `<div class="muted">Sin datos.</div>`;
    });
  }

  function renderStatsTopList(container, items, limit = 8, field = "copies") {
    if (!container) return;

    const list = (items || []).slice(0, limit);

    if (!list.length) {
      container.innerHTML = `<div class="muted">Sin datos.</div>`;
      return;
    }

    container.innerHTML = list
      .map((item) => {
        const value = field === "value"
          ? Stats.formatMoney(item.value || 0, "COP", "es-CO")
          : Stats.formatInt(item.copies || item.unique || 0, "es-CO");

        return `
          <div style="display:flex; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid rgba(148,163,184,.08)">
            <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(item.label || "—")}</span>
            <span class="chip">${escapeHtml(value)}</span>
          </div>
        `;
      })
      .join("");
  }

  function buildStatsSummaryFallback(stats) {
    return {
      registeredRows: stats?.totals?.registeredRows || stats?.meta?.rows || 0,
      uniqueCards: stats?.totals?.uniqueCards || 0,
      uniqueIds: stats?.totals?.uniqueIds || 0,
      totalCopies: stats?.totals?.totalCopies || 0,
      totalValue: stats?.totals?.totalValue || 0,
      monsters: stats?.totals?.monsters || 0,
      spells: stats?.totals?.spells || 0,
      traps: stats?.totals?.traps || 0,
      noImage: stats?.diagnostics?.noImage || 0,
      noPrice: stats?.diagnostics?.noPrice || 0,
      noQty: stats?.diagnostics?.noQty || 0,
      incomplete: stats?.diagnostics?.incomplete || 0,
    };
  }

  /* =========================
     ADVANCED SEARCH — MODULE
  ========================= */
  function initAdvancedSearch() {
    dom.adv.btnApply?.addEventListener("click", () => applyAdvancedSearch());
    dom.adv.btnReset?.addEventListener("click", () => resetAdvancedSearch());

    getAdvancedFields().forEach((field) => {
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          applyAdvancedSearch();
        }
      });
    });
  }

  function getAdvancedFields() {
    return Object.values(dom.adv).filter((el) => {
      return el && (el.tagName === "INPUT" || el.tagName === "SELECT");
    });
  }

  function resetAdvancedSearch() {
    getAdvancedFields().forEach((field) => {
      field.value = "";
    });

    safeText(dom.adv.countText, "0");

    if (dom.adv.table) {
      dom.adv.table.innerHTML = "";
    }

    toast("Filtros avanzados limpiados.");
  }

  function applyAdvancedSearch() {
    if (!state.rows || state.rows.length < 2) {
      toast("Primero carga la base de cartas.");
      return;
    }

    const query = buildAdvancedQuery();
    const result = AdvancedSearch.filterRows(state.rows, query, {
      includeHeaderInResult: true,
      treatMissingQtyAs1: false,
      requiredFields: ["nombre", "categoria", "mazo", "cantidad"],
    });

    safeText(dom.adv.countText, String(result.total || 0));

    if (dom.adv.table) {
      renderAnyTable(dom.adv.table, result.resultRows || [result.header, ...(result.rows || [])], {
        hideKeys: ["_id"],
      });
    }

    toast(`Resultados avanzados: ${result.total || 0}`);
  }

  function buildAdvancedQuery() {
    return {
      text: valFrom(dom.adv.q),
      textMode: "words",
      textFields: FIELD_KEYS_FOR_TEXT_SEARCH.filter((key) => col(key) >= 0),

      nombre: valFrom(dom.adv.nombre),
      mazo: valFrom(dom.adv.mazo),
      categoria: valFrom(dom.adv.categoria),
      tipo: valFrom(dom.adv.tipo),
      subtipo: valFrom(dom.adv.subtipo),
      atributo: valFrom(dom.adv.atributo),
      rareza: valFrom(dom.adv.rareza),
      idioma: valFrom(dom.adv.idioma),
      edicion: valFrom(dom.adv.edicion),

      ranges: {
        anio: {
          min: valFrom(dom.adv.anioMin),
          max: valFrom(dom.adv.anioMax),
        },
        nivel: {
          min: valFrom(dom.adv.lvlMin),
          max: valFrom(dom.adv.lvlMax),
        },
        atk: {
          min: valFrom(dom.adv.atkMin),
          max: valFrom(dom.adv.atkMax),
        },
        def: {
          min: valFrom(dom.adv.defMin),
          max: valFrom(dom.adv.defMax),
        },
        cantidad: {
          min: valFrom(dom.adv.qtyMin),
          max: valFrom(dom.adv.qtyMax),
        },
        precio: {
          min: valFrom(dom.adv.priceMin),
          max: valFrom(dom.adv.priceMax),
        },
      },
    };
  }

  function renderAnyTable(tableEl, rows, options = {}) {
    const { hideKeys = [] } = options;

    if (!tableEl) return;

    const header = rows?.[0] || [];
    const body = (rows || []).slice(1);

    const hideIndexes = new Set();

    hideKeys.forEach((key) => {
      const index = col(key);
      if (index >= 0) hideIndexes.add(index);
    });

    const visibleCols = header
      .map((_, index) => index)
      .filter((index) => !hideIndexes.has(index));

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    visibleCols.forEach((index) => {
      const th = document.createElement("th");
      th.textContent = header[index] || "";
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);

    const tbody = document.createElement("tbody");

    if (!body.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");

      td.colSpan = Math.max(1, visibleCols.length);
      td.innerHTML = `<div class="emptyState">Sin resultados avanzados.</div>`;

      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      body.forEach((row) => {
        const tr = document.createElement("tr");
        const id = String(getCell(row, "_id") || "").trim();

        tr.tabIndex = 0;
        if (id) tr.dataset.id = id;

        visibleCols.forEach((index) => {
          const td = document.createElement("td");
          td.textContent = row?.[index] || "";
          tr.appendChild(td);
        });

        tr.addEventListener("click", () => {
          openRowById(tr.dataset.id || "");
        });

        tr.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;

          event.preventDefault();
          openRowById(tr.dataset.id || "");
        });

        tbody.appendChild(tr);
      });
    }

    tableEl.innerHTML = "";
    tableEl.appendChild(thead);
    tableEl.appendChild(tbody);
  }

  function valFrom(el) {
    return String(el?.value || "").trim();
  }

  /* =========================
     MODAL
  ========================= */
  function ensureModal() {
    let modal = dom.modal;

    if (modal) {
      if (!modal.__bound) {
        bindModalBaseEvents(modal);
      }

      return modal;
    }

    modal = document.createElement("div");
    modal.id = "modal";
    modal.className = "modal";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");

    modal.innerHTML = `
      <div class="modal__card" role="dialog" aria-modal="true" aria-label="Modal">
        <div class="modal__head">
          <div>
            <div class="modal__title" id="modalTitle"></div>
            <div class="modal__subtitle muted" id="modalSubtitle"></div>
          </div>
          <button class="iconbtn" id="btnCloseModal" type="button" aria-label="Cerrar">✕</button>
        </div>
        <div class="modal__body" id="modalBody"></div>
        <div class="modal__actions" id="modalActions"></div>
      </div>
    `;

    document.body.appendChild(modal);
    dom.modal = modal;

    bindModalBaseEvents(modal);

    return modal;
  }

  function bindModalBaseEvents(modal) {
    modal.__bound = true;

    modal.addEventListener("click", (event) => {
      const card = event.target.closest?.(".modal__card");
      if (!card) closeModal();
    });

    modal.querySelector("#btnCloseModal")?.addEventListener("click", closeModal);
    modal.querySelector("#modalClose")?.addEventListener("click", closeModal);
  }

  function isModalOpen() {
    return Boolean(dom.modal && dom.modal.hidden === false);
  }

  function closeModal() {
    const modal = ensureModal();

    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");

    if (dom.drawer?.classList.contains("is-open")) {
      $("nombre")?.focus();
    }
  }

  function modalChoice({ title, subtitle, bodyHtml, buttons }) {
    return new Promise((resolve) => {
      const modal = ensureModal();
      const titleEl = modal.querySelector("#modalTitle");
      const subtitleEl = modal.querySelector("#modalSubtitle");
      const bodyEl = modal.querySelector("#modalBody");
      const actionsEl = modal.querySelector("#modalActions");

      safeText(titleEl, title || "Confirmación");
      safeText(subtitleEl, subtitle || "");
      safeHtml(bodyEl, bodyHtml || "");

      if (actionsEl) actionsEl.innerHTML = "";

      const buttonOptions = Array.isArray(buttons) && buttons.length
        ? buttons
        : [{ id: "close", label: "Cerrar", kind: "ghost" }];

      let done = false;

      const finish = (value) => {
        if (done) return;

        done = true;
        document.removeEventListener("keydown", onKey);
        closeModal();
        resolve(value);
      };

      const onKey = (event) => {
        if (event.key === "Escape") {
          finish(null);
        }
      };

      document.addEventListener("keydown", onKey);

      buttonOptions.forEach((button, index) => {
        const el = document.createElement("button");

        el.type = "button";
        el.className = btnClassFromKind(button.kind);
        el.textContent = String(button.label || "OK");

        el.addEventListener("click", () => {
          finish(button.id ?? button.value ?? String(index));
        });

        actionsEl?.appendChild(el);
      });

      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");

      setTimeout(() => {
        modal.querySelector(".modal__actions button")?.focus?.();
      }, 0);
    });
  }

  async function modalPrompt({ title, subtitle, placeholder, initialValue, okLabel }) {
    const id = `mp_${Math.random().toString(36).slice(2, 8)}`;
    let inputValue = String(initialValue || "");

    const choice = await new Promise((resolve) => {
      modalChoice({
        title: title || "Escribe",
        subtitle: "",
        bodyHtml: `
          <div style="display:grid; gap:10px;">
            <div class="muted" style="line-height:1.4">${escapeHtml(subtitle || "")}</div>
            <input
              id="${id}"
              class="input"
              type="text"
              placeholder="${escapeHtml(placeholder || "")}"
              value="${escapeHtml(inputValue)}"
            />
          </div>
        `,
        buttons: [
          { id: "ok", label: okLabel || "OK", kind: "primary" },
          { id: "cancel", label: "Cancelar", kind: "ghost" },
        ],
      }).then(resolve);

      setTimeout(() => {
        const input = document.getElementById(id);

        if (!input) return;

        input.focus();
        input.select?.();

        input.addEventListener("input", () => {
          inputValue = input.value;
        });

        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            inputValue = input.value;
            closeModal();
            resolve("ok");
          }
        });
      }, 0);
    });

    if (choice !== "ok") return "";

    const input = document.getElementById(id);

    return String(input?.value ?? inputValue ?? "").trim();
  }

  function btnClassFromKind(kind) {
    const value = String(kind || "").toLowerCase();

    if (value === "primary") return "btn btn--primary";
    if (value === "danger") return "btn btn--danger";
    if (value === "ghost") return "btn btn--ghost";

    return "btn";
  }

  /* =========================
     STATUS / TOAST
  ========================= */
  function setStatus(kind, text) {
    safeText(dom.statusText, text);

    dom.statusDot?.classList.remove("is-ok", "is-loading", "is-error");

    if (kind === "ok") {
      dom.statusDot?.classList.add("is-ok");
    } else if (kind === "loading") {
      dom.statusDot?.classList.add("is-loading");
    } else {
      dom.statusDot?.classList.add("is-error");
    }
  }

  function toast(message) {
    const text = String(message || "").trim();

    if (!text) return;

    let host = document.getElementById("toastHost");

    if (!host) {
      host = document.createElement("div");
      host.id = "toastHost";
      host.style.position = "fixed";
      host.style.left = "50%";
      host.style.bottom = "22px";
      host.style.transform = "translateX(-50%)";
      host.style.zIndex = "9999";
      host.style.display = "grid";
      host.style.gap = "8px";
      document.body.appendChild(host);
    }

    const el = document.createElement("div");

    el.textContent = text;
    el.style.padding = "10px 12px";
    el.style.borderRadius = "12px";
    el.style.background = "rgba(15,23,42,.88)";
    el.style.color = "white";
    el.style.fontSize = "13px";
    el.style.boxShadow = "0 10px 30px rgba(0,0,0,.25)";
    el.style.maxWidth = "92vw";
    el.style.textAlign = "center";
    el.style.backdropFilter = "blur(6px)";

    host.appendChild(el);

    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 180ms ease";

      setTimeout(() => {
        el.remove();
      }, 220);
    }, NET.toastMs);
  }

  /* =========================
     NORMALIZERS
  ========================= */
  function getCategoryKey(value) {
    const normalized = normalize(value);

    for (const key of Object.keys(CATEGORY_META)) {
      if (CATEGORY_META[key].aliases.includes(normalized)) {
        return key;
      }
    }

    return "";
  }

  function normalizeCategoria(value) {
    const key = getCategoryKey(value);

    if (key === "monster") return "Monster";
    if (key === "spell") return "Spell";
    if (key === "trap") return "Trap";

    return String(value || "").trim();
  }

  function isMonsterCategoria(value) {
    return getCategoryKey(value) === "monster";
  }

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  /* =========================
     GENERIC HELPERS
  ========================= */
  function debounce(fn, wait) {
    let timer = null;

    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function isFiniteInteger(value) {
    const n = Number(String(value).trim());
    return Number.isFinite(n) && Number.isInteger(n);
  }

  function isFiniteNumber(value) {
    const n = parseLooseNumber(value);
    return Number.isFinite(n);
  }

  function parseLooseNumber(value) {
    const raw = String(value ?? "").trim();

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

  function toInt(value, fallback = 0) {
    const n = parseLooseNumber(value);

    if (!Number.isFinite(n)) return fallback;

    return Math.floor(n);
  }

  function makeId() {
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);

    return `ygo_${time}_${rand}`;
  }

  function describeRow(row) {
    const name = String(getCell(row, "nombre") || "").trim();
    const setCode = String(getCell(row, "mazo") || "").trim();
    const edition = String(getCell(row, "edicion") || "").trim();
    const language = String(getCell(row, "idioma") || "").trim();
    const rarity = String(getCell(row, "rareza") || "").trim();

    return [name, setCode, edition, language, rarity].filter(Boolean).join(" · ");
  }

  function formatTimeAgo(timestamp) {
    const time = Number(timestamp || 0);

    if (!Number.isFinite(time) || time <= 0) return "";

    const diff = Date.now() - time;
    const seconds = Math.floor(diff / 1000);

    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);

    if (hours < 48) return `${hours}h`;

    const days = Math.floor(hours / 24);

    return `${days}d`;
  }

  function looksLikeUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function safeFilename(value) {
    return (
      String(value || "deck")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_\-.]/g, "")
        .slice(0, 80) || "deck"
    );
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement("input");

      input.type = "file";
      input.accept = accept || "*/*";
      input.style.display = "none";

      document.body.appendChild(input);

      input.addEventListener("change", () => {
        const file = input.files?.[0] || null;
        input.remove();
        resolve(file);
      });

      input.click();
    });
  }

  function downloadText(text, filename, mimeType = "text/plain") {
    const blob = new Blob([String(text || "")], {
      type: mimeType,
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename || "download.txt";

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(url);
  }
})();