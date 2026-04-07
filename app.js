/* ============================
   Yu-Gi-Oh DB - Frontend App (vPRO.3)
   - Read: TSV published (cache localStorage)
   - Write: Apps Script WebApp (POST add/update) no-preflight
   - Features:
     ✅ Debounce search + fast table render
     ✅ Header-based column mapping (robusto)
     ✅ Monster-only fields: Nivel ⭐ + ATK/DEF
     ✅ Anti-duplicados al guardar (suma cantidad o crea nueva fila)
     ✅ Decks (LocalStorage): crear / agregar / quitar / sumar cantidades
     ✅ Asignar carta seleccionada a deck desde el drawer
     ✅ Stats panel (si existe HTML)
     ✅ Advanced search (si existe HTML)
     ✅ View switcher (si existe HTML con .view y botones data-view)
================================ */

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
    tsvCache: "ygo_tsv_cache_v4",
    tsvCacheAt: "ygo_tsv_cache_at_v4",

    // Decks
    decks: "ygo_decks_v1",
    lastDeckId: "ygo_last_deck_id_v1",
  };

  const NET = {
    fetchTimeoutMs: 12000,
    toastMs: 2400,
    searchDebounceMs: 120,
  };

  /**
   * Mapeo por header (robusto).
   * Si cambias el orden de columnas en Sheets, sigue funcionando
   * mientras existan nombres (o similares).
   */
  const HEADER_ALIASES = {
    _id: ["_id", "id", "uuid"],
    num: ["#", "num", "numero", "número"],
    edicion: ["edicion", "edición"],
    anio: ["anio", "año", "year"],
    mazo: ["mazo", "set", "setcode", "set code", "codigo", "código"],
    nombre: ["nombre", "name"],
    categoria: ["categoria", "categoría", "category"],
    tipo: ["tipo", "type"],
    nivel: ["nivel", "level", "estrellas", "stars"],
    subtipo: ["subtipo", "sub type", "subtype"],
    atributo: ["atributo", "attribute"],
    atk: ["atk"],
    def: ["def"],
    escalaTipo: ["escalatipo", "escala tipo", "scale type", "scale"],
    escalaValor: ["escalavalor", "escala valor", "scale value"],
    rareza: ["rareza", "rarity"],
    cantidad: ["cantidad", "qty", "quantity"],
    idioma: ["idioma", "language", "lang"],
    precio: ["precio", "price", "valor"],
    fecha_compra: ["fecha_compra", "fecha compra", "fecha", "fecha ingreso", "fecha de ingreso"],
    notas: ["notas", "notes"],
    imagenurl: ["imagenurl", "imagen url", "image", "imageurl", "image url", "url imagen", "url"],
  };

  // IDs de inputs del formulario (según tu index.html base)
  const FORM_FIELDS = [
    "num","anio","nombre","edicion","mazo","categoria","tipo","nivel",
    "subtipo","atributo","atk","def","rareza","cantidad","idioma","precio",
    "fecha_compra","notas","imagenurl",
  ];

  // datalists (ids)
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

  // Defaults “por si la base está vacía”
  const DEFAULTS = {
    edicion: ["1st", "Unlimited", "Limited"],
    categoria: ["Monster", "Spell", "Trap"],
    idioma: ["EN", "ES", "JP", "DE", "FR", "IT", "PT"],
    atributo: ["Light", "Dark", "Fire", "Water", "Earth", "Wind", "Divine"],
    rareza: [
      "Common","Rare","Super Rare","Ultra Rare","Secret Rare","Ultimate Rare",
      "Collector's Rare","Ghost Rare","Starlight Rare","Quarter Century Secret Rare",
    ],
    subtipo: [
      "Normal","Effect","Fusion","Synchro","Xyz","Link","Ritual","Pendulum","Tuner",
      "Normal Spell","Continuous Spell","Quick-Play Spell","Field Spell","Ritual Spell",
      "Normal Trap","Continuous Trap","Counter Trap",
    ],
  };

  /* =========================
    DOM helpers
  ========================= */
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function safeText(el, txt){ if (el) el.textContent = String(txt ?? ""); }

  /* =========================
    DOM refs (tolerante)
  ========================= */
  const dom = {
    // Cards/table
    table: $("dbTable"),
    search: $("search"),
    btnClearSearch: $("btnClearSearch"),
    countText: $("countText"),
    btnReload: $("btnReload"),
    btnNew: $("btnNew"),

    // Status
    statusPill: $("statusPill"),
    statusDot: $("statusDot"),
    statusText: $("statusText"),

    // Drawer
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

    segmentedBtns: qsa(".segmented__btn"),

    // Views (si existen)
    viewBtns: qsa("[data-view]"),
    views: qsa(".view"),

    // Advanced search (si existen)
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

    // Decks (si existen)
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

    // Stats (si existen)
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
      topTypes: $("statTopTypes"),
      topSets: $("statTopSets"),
      topRarities: $("statTopRarities"),
      topAttributes: $("statTopAttributes"),
    },

    // Modal host (si existe; si no, lo creamos)
    modal: $("modal"),
  };

  /* =========================
    STATE
  ========================= */
  const state = {
    header: [],
    rows: [],      // [header, ...data]
    viewRows: [],  // [header, ...filtered]
    filter: "all", // all | monster | spell | trap
    query: "",
    isSaving: false,
    selected: null, // { sheetRowIndex, rowArray }
    isOnline: navigator.onLine,
    lastLoadedAt: null,
    col: {},

    // Decks state
    decks: [],
    activeDeckId: null,
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
    syncAssignToDeckButton();
    loadTSV(false);
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

  function bindUI() {
    // search (debounced)
    const onSearch = debounce((value) => {
      state.query = (value || "").trim();
      applyFiltersAndRender();
    }, NET.searchDebounceMs);

    dom.search?.addEventListener("input", (e) => onSearch(e.target.value));

    dom.btnClearSearch?.addEventListener("click", () => {
      if (dom.search) dom.search.value = "";
      state.query = "";
      applyFiltersAndRender();
      dom.search?.focus();
    });

    // Segmented (category filter)
    dom.segmentedBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        dom.segmentedBtns.forEach((b) => {
          b.classList.remove("is-active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("is-active");
        btn.setAttribute("aria-selected", "true");
        state.filter = btn.dataset.filter || "all";
        applyFiltersAndRender();
      });
    });

    dom.btnReload?.addEventListener("click", () => loadTSV(true));
    dom.btnNew?.addEventListener("click", () => openNew());

    dom.btnCloseDrawer?.addEventListener("click", closeDrawer);
    dom.btnCancel?.addEventListener("click", closeDrawer);
    dom.overlay?.addEventListener("click", () => {
      if (isModalOpen()) return;
      closeDrawer();
    });

    dom.btnDuplicate?.addEventListener("click", duplicateSelected);
    dom.btnAssignToDeck?.addEventListener("click", handleAssignToDeckClick);
    dom.form?.addEventListener("submit", onSave);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (isModalOpen()) { closeModal(); return; }
        closeDrawer();
      }
    });

    // Click en tabla (delegación)
    dom.table?.addEventListener("click", (e) => {
      const tr = e.target?.closest?.("tbody tr");
      if (!tr) return;

      const id = tr.dataset.id || "";
      if (!id) return;

      const row = findRowById(id);
      if (!row) return;

      const sheetRowIndex = resolveSheetRowIndexById(id);
      openEdit(row, sheetRowIndex);
    });

    // Categoria: mostrar/ocultar monster-only + tip
    $("categoria")?.addEventListener("input", () => {
      updateMonsterOnlyVisibility();
      const cat = norm($("categoria")?.value);
      if (cat === "spell" || cat === "trap") {
        const atr = ($("atributo")?.value || "").trim();
        if (atr) toast("Tip: Atributo normalmente aplica solo a Monstruos 😉");
      }
    });
  }

  /* =========================
    VIEWS (opcional)
  ========================= */
  function initViews(){
    if (!dom.viewBtns?.length || !dom.views?.length) return;

    dom.viewBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.view;
        if (!target) return;
        switchView(target);

        if (target === "stats") renderStats();
        if (target === "decks") renderDecksUI();
      });
    });

    const active = dom.viewBtns.find(b => b.classList.contains("is-active"))?.dataset.view;
    if (active) switchView(active);
  }

  function switchView(viewName){
    dom.viewBtns.forEach(b => {
      const on = (b.dataset.view === viewName);
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });

    dom.views.forEach(v => {
      const name = v.dataset.view || v.id || "";
      const on = (name === viewName) || (v.id === `view${capitalize(viewName)}`);
      v.classList.toggle("is-active", on);
      v.hidden = !on;
    });
  }

  function capitalize(s){ return String(s||"").slice(0,1).toUpperCase() + String(s||"").slice(1); }

  /* =========================
    TSV LOAD + CACHE
  ========================= */
  async function loadTSV(withBypassCache = false) {
    setStatus("loading", "Cargando…");

    try {
      const url = withBypassCache ? cacheBust(TSV_URL) : TSV_URL;
      const text = await fetchTextWithTimeout(url, NET.fetchTimeoutMs);
      const rows = tsvToArray(text);
      if (!rows.length || rows.length < 1) throw new Error("TSV vacío");

      applyRows(rows);
      cacheTSV(text);

      setStatus("ok", "Listo");
      return;
    } catch (err) {
      console.warn("TSV fetch failed:", err);
    }

    const cached = getCachedTSV();
    if (cached) {
      try {
        const rows = tsvToArray(cached);
        if (!rows.length) throw new Error("Cache TSV inválido");
        applyRows(rows);
        const at = getCachedTSVAt();
        setStatus("error", at ? `Offline (cache ${formatTimeAgo(at)})` : "Offline (cache)");
        return;
      } catch (e) {
        console.warn("Cache parse failed:", e);
      }
    }

    setStatus("error", "Error");
    if (dom.table) dom.table.innerHTML = "";
    safeText(dom.countText, "0");
    toast("No se pudo cargar (sin red y sin caché).");
  }

  function applyRows(rows) {
    state.rows = rows;
    state.header = rows[0] || [];
    state.lastLoadedAt = Date.now();

    state.col = buildColIndexFromHeader(state.header);
    hydrateDatalistsFromRows(rows);

    applyFiltersAndRender();
    renderStats();
    renderDecksUI();
    syncAssignToDeckButton();
  }

  function cacheTSV(tsvText) {
    try {
      localStorage.setItem(STORAGE.tsvCache, tsvText);
      localStorage.setItem(STORAGE.tsvCacheAt, String(Date.now()));
    } catch {}
  }
  function getCachedTSV() {
    try { return localStorage.getItem(STORAGE.tsvCache) || ""; } catch { return ""; }
  }
  function getCachedTSVAt() {
    try {
      const v = localStorage.getItem(STORAGE.tsvCacheAt);
      return v ? Number(v) : null;
    } catch { return null; }
  }

  async function fetchTextWithTimeout(url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!r.ok) throw new Error("TSV no disponible");
      return await r.text();
    } finally {
      clearTimeout(t);
    }
  }

  function cacheBust(url) {
    const u = new URL(url);
    u.searchParams.set("_ts", String(Date.now()));
    return u.toString();
  }

  function tsvToArray(tsv) {
    const clean = String(tsv || "").replace(/\r/g, "").trim();
    if (!clean) return [];
    return clean.split("\n").map((line) => line.split("\t").map((x) => (x ?? "").trim()));
  }

  /* =========================
    COLUMN INDEX (HEADER-BASED)
  ========================= */
  function buildColIndexFromHeader(header) {
    const normHeader = (header || []).map((h) => norm(h));
    const out = {};

    for (const key of Object.keys(HEADER_ALIASES)) {
      const aliases = HEADER_ALIASES[key].map((a) => norm(a));
      let idx = -1;

      for (let i = 0; i < normHeader.length; i++) {
        const h = normHeader[i];
        if (!h) continue;
        if (aliases.includes(h)) { idx = i; break; }
      }

      if (idx === -1) {
        for (let i = 0; i < normHeader.length; i++) {
          const h = normHeader[i];
          if (!h) continue;
          if (aliases.some((a) => h.includes(a))) { idx = i; break; }
        }
      }

      if (idx !== -1) out[key] = idx;
    }

    if (out._id == null && (header?.[0] || "").trim()) out._id = 0;
    return out;
  }

  function col(key) {
    const idx = state.col?.[key];
    return Number.isInteger(idx) ? idx : -1;
  }

  function getCell(row, k){
    const i = col(k);
    return i >= 0 ? (row?.[i] ?? "") : "";
  }

  function setRowCell(rowArr, k, value){
    const i = col(k);
    if (i >= 0 && Array.isArray(rowArr)) rowArr[i] = String(value ?? "").trim();
  }

  /* =========================
    DATALISTS
  ========================= */
  function hydrateDatalistsFromRows(rows) {
    const data = (rows || []).slice(1);

    const uniq = (idx) => {
      if (idx < 0) return [];
      return uniqueSorted(data.map((r) => (r?.[idx] || "").trim()).filter(Boolean));
    };

    const values = {
      edicion: uniq(col("edicion")),
      anio: uniq(col("anio")),
      mazo: uniq(col("mazo")),
      categoria: uniq(col("categoria")),
      tipo: uniq(col("tipo")),
      subtipo: uniq(col("subtipo")),
      atributo: uniq(col("atributo")),
      rareza: uniq(col("rareza")),
      idioma: uniq(col("idioma")),
    };

    for (const k of Object.keys(values)) {
      const merged = mergeUnique(values[k], DEFAULTS[k] || []);
      renderDatalist(DLIST[k], merged);
    }
  }

  function renderDatalist(datalistId, items) {
    const dl = $(datalistId);
    if (!dl) return;
    dl.innerHTML = "";
    (items || []).forEach((val) => {
      const opt = document.createElement("option");
      opt.value = val;
      dl.appendChild(opt);
    });
  }

  function mergeUnique(primary, fallback) {
    const seen = new Set();
    const out = [];
    [...(primary || []), ...(fallback || [])].forEach((x) => {
      const v = (x || "").trim();
      if (!v) return;
      const key = v.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(v);
    });
    return out;
  }

  function uniqueSorted(arr) {
    const seen = new Set();
    const out = [];
    (arr || []).forEach((x) => {
      const v = (x || "").trim();
      if (!v) return;
      const key = v.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(v);
    });
    return out.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
  }

  /* =========================
    FILTERS + RENDER (cards)
  ========================= */
  function applyFiltersAndRender() {
    const all = state.rows;
    if (!all || all.length < 2) {
      safeText(dom.countText, "0");
      renderTable([state.header || [], ...[]]);
      return;
    }

    const header = all[0];
    const dataRows = all.slice(1);
    const q = (state.query || "").toLowerCase();

    const filtered = dataRows
      .filter((row) => passesCategoryFilter(row, state.filter))
      .filter((row) => {
        if (!q) return true;
        return row.some((cell) => (cell || "").toLowerCase().includes(q));
      });

    state.viewRows = [header, ...filtered];
    renderTable(state.viewRows);

    safeText(dom.countText, String(filtered.length));
  }

  function passesCategoryFilter(row, filter) {
    if (!filter || filter === "all") return true;

    const idxCat = col("categoria");
    const cat = norm(idxCat >= 0 ? (row?.[idxCat] || "") : "");

    const isMonster = cat === "monster" || cat === "monstruo" || cat === "monstruos";
    const isSpell = cat === "spell" || cat === "magia" || cat === "magias";
    const isTrap = cat === "trap" || cat === "trampa" || cat === "trampas";

    if (filter === "monster") return isMonster;
    if (filter === "spell") return isSpell;
    if (filter === "trap") return isTrap;

    return true;
  }

  function renderTable(rows) {
    if (!dom.table) return;

    const header = rows[0] || [];
    const body = rows.slice(1);

    const idIdx = col("_id");
    const nivelIdx = col("nivel");

    const visibleCols = header
      .map((_, i) => i)
      .filter((i) => i !== idIdx);

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    visibleCols.forEach((i) => {
      const th = document.createElement("th");
      th.textContent = header[i] || "";
      trh.appendChild(th);
    });
    thead.appendChild(trh);

    const tbody = document.createElement("tbody");
    const frag = document.createDocumentFragment();

    for (const row of body) {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;

      const id = idIdx >= 0 ? (row?.[idIdx] || "") : "";
      if (id) tr.dataset.id = id;

      visibleCols.forEach((i) => {
        const td = document.createElement("td");

        if (i === nivelIdx) {
          const raw = (row?.[i] || "").toString().trim();
          const n = parseInt(raw, 10);
          if (Number.isFinite(n) && n > 0) {
            td.textContent = "⭐".repeat(Math.min(n, 13));
            td.title = `Nivel: ${n}`;
          } else {
            td.textContent = raw;
          }
        } else {
          td.textContent = row?.[i] || "";
        }

        tr.appendChild(td);
      });

      frag.appendChild(tr);
    }

    tbody.appendChild(frag);

    dom.table.innerHTML = "";
    dom.table.appendChild(thead);
    dom.table.appendChild(tbody);
  }

  function findRowById(_id) {
    const all = state.rows || [];
    const idIdx = col("_id");
    if (idIdx < 0) return null;

    const idx = all.findIndex((r, i) => i > 0 && (r?.[idIdx] || "") === _id);
    return idx >= 1 ? all[idx] : null;
  }

  function resolveSheetRowIndexById(_id) {
    const all = state.rows || [];
    const idIdx = col("_id");
    if (idIdx < 0) return "";

    const idx = all.findIndex((r, i) => i > 0 && (r?.[idIdx] || "") === _id);
    return idx >= 1 ? idx + 1 : "";
  }

  /* =========================
    DRAWER / FORM
  ========================= */
  function openNew() {
    state.selected = null;
    safeText(dom.drawerTitle, "Nueva carta");
    safeText(dom.drawerSubtitle, "Completa la info y guarda");
    if (dom.rowIndex) dom.rowIndex.value = "";

    clearFormFields();

    if (dom.btnDuplicate) dom.btnDuplicate.disabled = true;
    syncAssignToDeckButton();

    if ($("categoria") && !$("categoria").value) $("categoria").value = "Monster";
    updateMonsterOnlyVisibility();

    setFormMeta("Nueva carta.");
    openDrawer();
  }

  function openEdit(row, sheetRowIndex) {
    state.selected = { rowArray: row, sheetRowIndex };

    safeText(dom.drawerTitle, "Editar carta");
    safeText(dom.drawerSubtitle, sheetRowIndex ? `Fila #${sheetRowIndex}` : "Editando");
    if (dom.rowIndex) dom.rowIndex.value = sheetRowIndex || "";

    fillFormFromRow(row);
    updateMonsterOnlyVisibility();

    if (dom.btnDuplicate) dom.btnDuplicate.disabled = false;
    syncAssignToDeckButton();

    setFormMeta("Editando.");
    openDrawer();
  }

  function openDrawer() {
    if (!dom.drawer) return;
    dom.drawer.classList.add("is-open");
    dom.drawer.setAttribute("aria-hidden", "false");
    if (dom.overlay) dom.overlay.hidden = false;
    setTimeout(() => $("nombre")?.focus(), 0);
  }

  function closeDrawer() {
    if (!dom.drawer) return;
    dom.drawer.classList.remove("is-open");
    dom.drawer.setAttribute("aria-hidden", "true");
    if (dom.overlay) dom.overlay.hidden = true;
    syncAssignToDeckButton();
  }

  function clearFormFields() {
    FORM_FIELDS.forEach((f) => {
      const el = $(f);
      if (el) el.value = "";
    });
  }

  function fillFormFromRow(row) {
    setVal("num", getCell(row,"num"));
    setVal("edicion", getCell(row,"edicion"));
    setVal("anio", getCell(row,"anio"));
    setVal("mazo", getCell(row,"mazo"));
    setVal("nombre", getCell(row,"nombre"));
    setVal("categoria", getCell(row,"categoria"));
    setVal("tipo", getCell(row,"tipo"));
    if ($("nivel")) setVal("nivel", getCell(row,"nivel"));

    setVal("subtipo", getCell(row,"subtipo"));
    setVal("atributo", getCell(row,"atributo"));
    setVal("atk", getCell(row,"atk"));
    setVal("def", getCell(row,"def"));
    setVal("rareza", getCell(row,"rareza"));
    setVal("cantidad", getCell(row,"cantidad"));
    setVal("idioma", getCell(row,"idioma"));
    setVal("precio", getCell(row,"precio"));
    setVal("fecha_compra", getCell(row,"fecha_compra"));
    setVal("notas", getCell(row,"notas"));
    setVal("imagenurl", getCell(row,"imagenurl"));
  }

  function setVal(id, value){
    const el = $(id);
    if (el) el.value = String(value ?? "");
  }

  function buildRowForSave({ forceNewId = false } = {}) {
    const headerLen = (state.header || []).length || 0;
    if (!headerLen) throw new Error("No header loaded");

    const existingId = (() => {
      const idIdx = col("_id");
      if (idIdx < 0) return "";
      return state.selected?.rowArray?.[idIdx] || "";
    })();

    const _id = (!forceNewId && existingId) ? existingId : makeId();
    const row = new Array(headerLen).fill("");

    const set = (k, value) => setRowCell(row, k, (value ?? "").toString().trim());

    set("_id", _id);
    set("num", val("num"));
    set("edicion", val("edicion"));
    set("anio", val("anio"));
    set("mazo", val("mazo"));
    set("nombre", val("nombre"));
    set("categoria", normalizeCategoria(val("categoria")));
    set("tipo", val("tipo"));

    const isMonster = isMonsterCategoria(val("categoria"));
    set("nivel", isMonster ? val("nivel") : "");
    set("subtipo", val("subtipo"));
    set("atributo", val("atributo"));
    set("atk", isMonster ? val("atk") : "");
    set("def", isMonster ? val("def") : "");

    set("rareza", val("rareza"));
    set("cantidad", val("cantidad"));
    set("idioma", val("idioma"));
    set("precio", val("precio"));
    set("fecha_compra", val("fecha_compra"));
    set("notas", val("notas"));
    set("imagenurl", val("imagenurl"));

    return row;
  }

  function val(id) { return ($(id)?.value || "").trim(); }

  function isMonsterCategoria(x) {
    const n = norm(x);
    return n === "monster" || n === "monstruo" || n === "monstruos";
  }

  function normalizeCategoria(x) {
    const n = norm(x);
    if (!n) return "";
    if (n === "monster" || n === "monstruo" || n === "monstruos") return "Monster";
    if (n === "spell" || n === "magia" || n === "magias") return "Spell";
    if (n === "trap" || n === "trampa" || n === "trampas") return "Trap";
    return (x || "").trim();
  }

  function updateMonsterOnlyVisibility() {
    const monster = isMonsterCategoria(val("categoria"));

    const nodes = qsa('[data-only="monster"]');
    nodes.forEach((wrap) => {
      wrap.style.display = monster ? "" : "none";

      const inputs = qsa("input,select,textarea", wrap);
      inputs.forEach((el) => {
        el.disabled = !monster;
        if (!monster) {
          if (el.id === "atk" || el.id === "def" || el.id === "nivel") el.value = "";
        }
      });
    });
  }

  function setFormMeta(msg) { safeText(dom.formMeta, msg); }

  function setStatus(kind, text) {
    safeText(dom.statusText, text);
    dom.statusDot?.classList.remove("is-ok", "is-loading", "is-error");
    if (kind === "ok") dom.statusDot?.classList.add("is-ok");
    else if (kind === "loading") dom.statusDot?.classList.add("is-loading");
    else dom.statusDot?.classList.add("is-error");
  }

  function syncAssignToDeckButton() {
    if (!dom.btnAssignToDeck) return;
    const hasSelected = !!state.selected?.rowArray;
    dom.btnAssignToDeck.disabled = !hasSelected;
  }

  /* =========================
    DUPLICATE DETECTION (Cards)
  ========================= */
  function canonicalKeyFromRow(row){
    const name = norm(getCell(row,"nombre"));
    const setc = norm(getCell(row,"mazo"));
    const ed = norm(getCell(row,"edicion"));
    const lang = norm(getCell(row,"idioma"));
    const rar = norm(getCell(row,"rareza"));
    return [name, setc, ed, lang, rar].join("|");
  }

  function canonicalKeyFromForm(){
    const name = norm(val("nombre"));
    const setc = norm(val("mazo"));
    const ed = norm(val("edicion"));
    const lang = norm(val("idioma"));
    const rar = norm(val("rareza"));
    return [name, setc, ed, lang, rar].join("|");
  }

  function findDuplicateRowForAdd(){
    const key = canonicalKeyFromForm();
    if (!key || key.startsWith("|")) return null;

    const data = (state.rows || []).slice(1);
    if (!data.length) return null;

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

  /* =========================
    SAVE (NO PREFLIGHT) + DUPLICADOS
  ========================= */
  async function onSave(e) {
    e.preventDefault();
    if (state.isSaving) return;

    const rowIndex = (dom.rowIndex?.value || "").trim();
    let action = rowIndex ? "update" : "add";

    const name = val("nombre");
    if (!name) {
      toast("Falta el nombre.");
      $("nombre")?.focus();
      return;
    }

    if (!state.isOnline) {
      toast("Estás offline. No se puede guardar ahora 📴");
      setFormMeta("Offline: no guardó.");
      return;
    }

    if (isMonsterCategoria(val("categoria"))) {
      const lvl = val("nivel");
      const atk = val("atk");
      const def = val("def");

      if (lvl && !isFiniteInteger(lvl)) { toast("Nivel debe ser entero."); $("nivel")?.focus(); return; }
      if (atk && !isFiniteNumber(atk)) { toast("ATK debe ser número."); $("atk")?.focus(); return; }
      if (def && !isFiniteNumber(def)) { toast("DEF debe ser número."); $("def")?.focus(); return; }
    }

    // ADD: chequea duplicados y pregunta
    if (!rowIndex) {
      const dup = findDuplicateRowForAdd();
      if (dup) {
        const dupInfo = describeRow(dup);
        const qtyIncoming = toInt(val("cantidad"), 0);
        const qtyExisting = toInt(getCell(dup, "cantidad"), 0);

        const choice = await modalChoice({
          title: "Esa carta ya existe 👀",
          subtitle: "¿Qué hacemos con este duplicado?",
          bodyHtml: `
            <div class="emptyState">
              <div style="font-weight:900; margin-bottom:6px;">Encontrada:</div>
              <div class="muted" style="line-height:1.4">${escapeHtml(dupInfo)}</div>
              <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
                <span class="chip">Cantidad actual: <b>${qtyExisting}</b></span>
                <span class="chip">Nueva cantidad: <b>${qtyIncoming}</b></span>
              </div>
              <div style="margin-top:10px" class="muted">
                Si eliges “Sumar”, actualizo la fila existente sumando cantidad.
              </div>
            </div>
          `,
          buttons: [
            { id: "sum", label: "Sumar cantidad", kind: "primary" },
            { id: "new", label: "Crear otra fila (duplicado)", kind: "ghost" },
            { id: "cancel", label: "Cancelar", kind: "ghost" },
          ],
        });

        if (choice === "cancel" || !choice) {
          toast("Guardado cancelado.");
          setFormMeta("Cancelado.");
          return;
        }

        if (choice === "sum") {
          const dupId = String(getCell(dup, "_id") || "").trim();
          const dupRowIndex = resolveSheetRowIndexById(dupId);

          const payloadRow = buildRowForSave({ forceNewId: true });
          setRowCell(payloadRow, "_id", dupId);

          const summed = Math.max(0, qtyExisting + qtyIncoming);
          setRowCell(payloadRow, "cantidad", String(summed));

          action = "update";
          await doSave({ action, rowIndex: String(dupRowIndex || ""), row: payloadRow, closeOnAdd: false });
          return;
        }

        // "new" -> sigue normal add
      }
    }

    let payloadRow;
    try {
      payloadRow = buildRowForSave();
    } catch (err) {
      console.error(err);
      toast("No se pudo preparar el registro (header no cargado).");
      return;
    }

    await doSave({ action, rowIndex: rowIndex || "", row: payloadRow, closeOnAdd: true });
  }

  async function doSave({ action, rowIndex, row, closeOnAdd }) {
    try {
      state.isSaving = true;
      lockSave(true);
      setFormMeta("Guardando…");

      const payload = { action, rowIndex: rowIndex || "", row };
      const text = await postTextWithTimeout(API_URL, JSON.stringify(payload), NET.fetchTimeoutMs);

      let res = null;
      try { res = JSON.parse(text); } catch {}

      if (!res?.ok) throw new Error(res?.error || "No se pudo guardar");

      toast(res.msg || "Guardado ✅");
      setFormMeta("Listo.");

      await loadTSV(true);

      if (action === "add" && closeOnAdd) closeDrawer();
    } catch (err) {
      console.error(err);
      toast("No se pudo guardar (conexión o bloqueo).");
      setFormMeta("No guardó. Reintenta.");
    } finally {
      state.isSaving = false;
      lockSave(false);
    }
  }

  async function postTextWithTimeout(url, body, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita preflight
        redirect: "follow",
        body,
        signal: ctrl.signal,
      });
      return await resp.text();
    } finally {
      clearTimeout(t);
    }
  }

  function duplicateSelected() {
    if (!state.selected?.rowArray) {
      toast("No hay nada para duplicar.");
      return;
    }
    safeText(dom.drawerTitle, "Duplicar carta");
    safeText(dom.drawerSubtitle, "Se guardará como nueva");
    if (dom.rowIndex) dom.rowIndex.value = "";

    state.selected = null;
    if (dom.btnDuplicate) dom.btnDuplicate.disabled = true;
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
    if (dom.btnAssignToDeck) dom.btnAssignToDeck.disabled = lock || !state.selected?.rowArray;
  }

  /* =========================
    DECKS (LocalStorage)
  ========================= */
  function initDecks(){
    state.decks = loadDecks();
    state.activeDeckId = loadLastDeckId() || (state.decks[0]?.id ?? null);

    dom.decks.btnNew?.addEventListener("click", async () => {
      const name = await modalPrompt({
        title: "Nuevo deck",
        subtitle: "Ponle un nombre decente (o no, es tu vida).",
        placeholder: "Ej: Dark Magician Control",
        okLabel: "Crear",
      });
      if (!name) return;
      createDeck(name);
      renderDecksUI();
      toast("Deck creado ✅");
    });

    dom.decks.btnRename?.addEventListener("click", async () => {
      const d = getActiveDeck();
      if (!d) { toast("No hay deck activo."); return; }
      const name = await modalPrompt({
        title: "Renombrar deck",
        subtitle: "Cambiarle el nombre a las cosas no arregla la vida, pero ayuda.",
        placeholder: "Nuevo nombre",
        initialValue: d.name,
        okLabel: "Guardar",
      });
      if (!name) return;
      d.name = name.trim();
      saveDecks();
      renderDecksUI();
      toast("Renombrado ✅");
    });

    dom.decks.btnDelete?.addEventListener("click", async () => {
      const d = getActiveDeck();
      if (!d) { toast("No hay deck activo."); return; }
      const choice = await modalChoice({
        title: "Eliminar deck",
        subtitle: `Vas a borrar "${escapeHtml(d.name)}"`,
        bodyHtml: `<div class="emptyState">Esto no tiene undo. Como muchas decisiones humanas.</div>`,
        buttons: [
          { id: "del", label: "Eliminar", kind: "primary" },
          { id: "cancel", label: "Cancelar", kind: "ghost" },
        ],
      });
      if (choice !== "del") return;
      deleteDeck(d.id);
      renderDecksUI();
      toast("Deck eliminado 🗑️");
    });

    dom.decks.btnExport?.addEventListener("click", () => {
      const d = getActiveDeck();
      if (!d) { toast("No hay deck activo."); return; }
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `deck_${safeFilename(d.name || d.id)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    dom.decks.btnImport?.addEventListener("click", async () => {
      const file = await pickFile(".json,application/json");
      if (!file) return;
      const txt = await file.text();
      let data;
      try { data = JSON.parse(txt); } catch { toast("JSON inválido."); return; }
      if (!data || !data.id || !Array.isArray(data.cards)) { toast("Formato de deck inválido."); return; }
      upsertDeck(data);
      renderDecksUI();
      toast("Deck importado ✅");
    });

    dom.decks.select?.addEventListener("change", (e) => {
      setActiveDeckId(String(e.target.value || ""));
      renderDecksUI();
    });

    renderDecksUI();
  }

  function loadDecks(){
    try {
      const raw = localStorage.getItem(STORAGE.decks);
      const decks = raw ? JSON.parse(raw) : [];
      return Array.isArray(decks) ? decks : [];
    } catch { return []; }
  }

  function saveDecks(){
    try { localStorage.setItem(STORAGE.decks, JSON.stringify(state.decks || [])); } catch {}
  }

  function loadLastDeckId(){
    try { return localStorage.getItem(STORAGE.lastDeckId) || ""; } catch { return ""; }
  }
  function saveLastDeckId(id){
    try { localStorage.setItem(STORAGE.lastDeckId, String(id||"")); } catch {}
  }

  function setActiveDeckId(id){
    state.activeDeckId = id || null;
    saveLastDeckId(state.activeDeckId || "");
  }

  function getActiveDeck(){
    const id = state.activeDeckId;
    return (state.decks || []).find(d => d.id === id) || null;
  }

  function createDeck(name){
    const deck = {
      id: `deck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`,
      name: String(name || "Nuevo deck").trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      notes: "",
      cards: [],
    };
    state.decks.unshift(deck);
    setActiveDeckId(deck.id);
    saveDecks();
  }

  function deleteDeck(id){
    state.decks = (state.decks || []).filter(d => d.id !== id);
    if (state.activeDeckId === id) state.activeDeckId = state.decks[0]?.id ?? null;
    saveDecks();
    saveLastDeckId(state.activeDeckId || "");
  }

  function upsertDeck(deck){
    const idx = (state.decks || []).findIndex(d => d.id === deck.id);
    const normalized = {
      id: String(deck.id),
      name: String(deck.name || "Deck"),
      createdAt: Number(deck.createdAt || Date.now()),
      updatedAt: Date.now(),
      notes: String(deck.notes || ""),
      cards: Array.isArray(deck.cards) ? deck.cards.map(c => ({
        id: String(c.id || ""),
        qty: Math.max(0, toInt(c.qty, 1)),
      })).filter(c => c.id) : [],
    };
    if (idx >= 0) state.decks[idx] = normalized;
    else state.decks.unshift(normalized);

    setActiveDeckId(normalized.id);
    saveDecks();
  }

  function addCardToActiveDeck(card, qty = 1){
    const d = getActiveDeck();
    if (!d) return false;

    const cardId = String(getCell(card, "_id") || "").trim();
    if (!cardId) return false;

    const normalizedQty = Math.max(1, toInt(qty, 1));
    const existing = d.cards.find(c => c.id === cardId);

    if (existing) {
      existing.qty = Math.max(1, toInt(existing.qty, 1) + normalizedQty);
    } else {
      d.cards.push({ id: cardId, qty: normalizedQty });
    }

    d.updatedAt = Date.now();
    saveDecks();
    renderDecksUI();
    return true;
  }

  function removeCardFromActiveDeck(cardId){
    const d = getActiveDeck();
    if (!d) return;
    d.cards = d.cards.filter(c => c.id !== cardId);
    d.updatedAt = Date.now();
    saveDecks();
    renderDecksUI();
  }

  async function handleAssignToDeckClick() {
    if (!state.selected?.rowArray) {
      toast("Selecciona una carta primero.");
      return;
    }

    if (!state.decks.length) {
      toast("Crea un deck primero.");
      return;
    }

    const card = state.selected.rowArray;
    const cardName = String(getCell(card, "nombre") || "").trim() || "(sin nombre)";

    if (!state.activeDeckId) setActiveDeckId(state.decks[0].id);
    const activeDeck = getActiveDeck();

    const choice = await modalChoice({
      title: "Agregar al deck",
      subtitle: `"${cardName}" → "${activeDeck?.name || "Deck"}"`,
      bodyHtml: `
        <div style="display:flex; flex-direction:column; gap:10px;">
          <label style="font-size:13px;">Deck destino:</label>
          <select id="modalDeckSelect" class="select" style="width:100%">
            ${state.decks.map(d =>
              `<option value="${escapeHtml(d.id)}" ${d.id === state.activeDeckId ? "selected" : ""}>${escapeHtml(d.name)}</option>`
            ).join("")}
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

    const selectedDeckId = $("modalDeckSelect")?.value || state.activeDeckId;
    const qty = Math.max(1, toInt($("modalDeckQty")?.value || "1", 1));

    if (selectedDeckId !== state.activeDeckId) {
      setActiveDeckId(selectedDeckId);
    }

    const ok = addCardToActiveDeck(card, qty);
    if (!ok) {
      toast("No se pudo agregar la carta al deck.");
      return;
    }

    toast(`✅ Agregada al deck "${getActiveDeck()?.name || "Deck"}"`);
  }

  function renderDecksUI(){
    if (!dom.decks.root) return;

    if (!state.activeDeckId && (state.decks[0]?.id)) setActiveDeckId(state.decks[0].id);

    if (dom.decks.select) {
      dom.decks.select.innerHTML = "";
      (state.decks || []).forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.id;
        opt.textContent = d.name;
        if (d.id === state.activeDeckId) opt.selected = true;
        dom.decks.select.appendChild(opt);
      });
    }

    if (dom.decks.list) {
      dom.decks.list.innerHTML = "";
      const frag = document.createDocumentFragment();

      if (!state.decks.length) {
        const div = document.createElement("div");
        div.className = "emptyState";
        div.textContent = "No hay decks. Crea uno y deja de sufrir.";
        dom.decks.list.appendChild(div);
      } else {
        state.decks.forEach(d => {
          const item = document.createElement("div");
          item.className = "deckItem" + (d.id === state.activeDeckId ? " is-active" : "");
          item.innerHTML = `
            <div class="deckItem__main">
              <div class="deckItem__name">${escapeHtml(d.name)}</div>
              <div class="deckItem__sub">${escapeHtml(d.notes || "Sin notas")}</div>
            </div>
            <div class="deckItem__meta">
              <div class="deckCount">${deckTotalQty(d)}</div>
              <div class="muted" style="font-size:11px">${formatTimeAgo(d.updatedAt || d.createdAt)}</div>
            </div>
          `;
          item.addEventListener("click", () => {
            setActiveDeckId(d.id);
            renderDecksUI();
          });
          frag.appendChild(item);
        });
        dom.decks.list.appendChild(frag);
      }
    }

    const deck = getActiveDeck();
    safeText(dom.decks.title, deck?.name || "Decks");
    safeText(dom.decks.meta, deck ? `${deck.cards.length} cartas · ${deckTotalQty(deck)} copias` : "Sin deck activo");

    if (dom.decks.cards) {
      dom.decks.cards.innerHTML = "";

      if (!deck) {
        dom.decks.cards.innerHTML = `<div class="emptyState">Crea o selecciona un deck.</div>`;
        return;
      }

      if (!deck.cards.length) {
        dom.decks.cards.innerHTML = `<div class="emptyState">Vacío. Como el alma de un Excel sin fórmulas.</div>`;
        return;
      }

      const table = document.createElement("table");
      table.className = "deckCardsTable";
      table.innerHTML = `
        <thead>
          <tr>
            <th>ID</th>
            <th>Nombre</th>
            <th style="text-align:right">Qty</th>
            <th style="text-align:right">Acciones</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector("tbody");
      deck.cards.forEach(c => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(c.id)}</td>
          <td>${escapeHtml(getCardLabel(c.id))}</td>
          <td style="text-align:right">${c.qty}</td>
          <td>
            <div class="deckCardsRowActions">
              <button class="smallbtn" data-act="minus">-1</button>
              <button class="smallbtn" data-act="plus">+1</button>
              <button class="smallbtn smallbtn--danger" data-act="del">Quitar</button>
            </div>
          </td>
        `;
        tr.querySelectorAll("button").forEach(btn => {
          btn.addEventListener("click", () => {
            const act = btn.dataset.act;
            if (act === "del") return removeCardFromActiveDeck(c.id);
            if (act === "plus") {
              c.qty += 1;
              deck.updatedAt = Date.now();
              saveDecks();
              renderDecksUI();
              return;
            }
            if (act === "minus") {
              c.qty = Math.max(1, c.qty - 1);
              deck.updatedAt = Date.now();
              saveDecks();
              renderDecksUI();
              return;
            }
          });
        });
        tbody.appendChild(tr);
      });

      dom.decks.cards.appendChild(table);
    }
  }

  function deckTotalQty(deck){
    return (deck?.cards || []).reduce((sum, c) => sum + Math.max(0, toInt(c.qty, 0)), 0);
  }

  function getCardLabel(cardId){
    const row = findRowById(cardId);
    if (!row) return "(no encontrada en TSV)";
    const name = String(getCell(row,"nombre") || "").trim();
    const setc = String(getCell(row,"mazo") || "").trim();
    const ed = String(getCell(row,"edicion") || "").trim();
    return [name, setc, ed].filter(Boolean).join(" · ") || cardId;
  }

  /* =========================
    STATS
  ========================= */
  function renderStats(){
    if (!dom.stats.root) return;

    const data = (state.rows || []).slice(1);
    if (!data.length) return;

    const idIdx = col("_id");
    const qtyIdx = col("cantidad");
    const priceIdx = col("precio");

    const catIdx = col("categoria");
    const typeIdx = col("tipo");
    const setIdx = col("mazo");
    const rarIdx = col("rareza");
    const atrIdx = col("atributo");
    const imgIdx = col("imagenurl");

    const totalRows = data.length;
    const unique = new Set();
    const cats = { monster:0, spell:0, trap:0 };
    let totalQty = 0;
    let totalValue = 0;
    let noImg = 0;

    const countMap = (idx) => {
      const m = new Map();
      if (idx < 0) return m;
      for (const r of data) {
        const k = String(r?.[idx] || "").trim();
        if (!k) continue;
        m.set(k, (m.get(k)||0) + 1);
      }
      return m;
    };

    for (const r of data) {
      const id = idIdx >= 0 ? String(r?.[idIdx] || "") : "";
      if (id) unique.add(id);

      const cat = norm(catIdx >= 0 ? r?.[catIdx] : "");
      if (cat === "monster" || cat === "monstruo" || cat === "monstruos") cats.monster++;
      else if (cat === "spell" || cat === "magia" || cat === "magias") cats.spell++;
      else if (cat === "trap" || cat === "trampa" || cat === "trampas") cats.trap++;

      const q = toInt(qtyIdx >= 0 ? r?.[qtyIdx] : 0, 0);
      totalQty += Math.max(0, q);

      const p = toFloat(priceIdx >= 0 ? r?.[priceIdx] : 0, 0);
      totalValue += Math.max(0, p) * Math.max(1, q || 1);

      const img = imgIdx >= 0 ? String(r?.[imgIdx] || "").trim() : "";
      if (!img) noImg++;
    }

    safeText(dom.stats.totalCards, totalRows);
    safeText(dom.stats.uniqueCards, unique.size);
    safeText(dom.stats.totalQty, totalQty);
    safeText(dom.stats.totalValue, money(totalValue));
    safeText(dom.stats.monsters, cats.monster);
    safeText(dom.stats.spells, cats.spell);
    safeText(dom.stats.traps, cats.trap);
    safeText(dom.stats.noImg, noImg);

    renderTopList(dom.stats.topTypes, countMap(typeIdx), 8);
    renderTopList(dom.stats.topSets, countMap(setIdx), 8);
    renderTopList(dom.stats.topRarities, countMap(rarIdx), 8);
    renderTopList(dom.stats.topAttributes, countMap(atrIdx), 8);
  }

  function renderTopList(container, map, limit = 8){
    if (!container) return;
    const items = Array.from(map.entries()).sort((a,b) => b[1]-a[1]).slice(0, limit);
    if (!items.length) { container.innerHTML = `<div class="muted">Sin datos.</div>`; return; }
    container.innerHTML = items.map(([k,v]) =>
      `<div style="display:flex; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid rgba(148,163,184,.08)">
        <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(k)}</span>
        <span class="chip">${v}</span>
      </div>`
    ).join("");
  }

  /* =========================
    ADVANCED SEARCH
  ========================= */
  function initAdvancedSearch(){
    dom.adv.btnApply?.addEventListener("click", () => applyAdvancedSearch());
    dom.adv.btnReset?.addEventListener("click", () => resetAdvancedSearch());
  }

  function resetAdvancedSearch(){
    const fields = Object.values(dom.adv).filter(el => el && (el.tagName === "INPUT" || el.tagName === "SELECT"));
    fields.forEach(el => { if (el) el.value = ""; });
    safeText(dom.adv.countText, "0");
    if (dom.adv.table) dom.adv.table.innerHTML = "";
    toast("Filtros limpiados.");
  }

  function applyAdvancedSearch(){
    const all = (state.rows || []);
    if (all.length < 2) return;

    const header = all[0];
    const data = all.slice(1);

    const filters = {
      q: (dom.adv.q?.value || "").trim().toLowerCase(),
      nombre: (dom.adv.nombre?.value || "").trim().toLowerCase(),
      mazo: (dom.adv.mazo?.value || "").trim().toLowerCase(),
      categoria: (dom.adv.categoria?.value || "").trim().toLowerCase(),
      tipo: (dom.adv.tipo?.value || "").trim().toLowerCase(),
      subtipo: (dom.adv.subtipo?.value || "").trim().toLowerCase(),
      atributo: (dom.adv.atributo?.value || "").trim().toLowerCase(),
      rareza: (dom.adv.rareza?.value || "").trim().toLowerCase(),
      idioma: (dom.adv.idioma?.value || "").trim().toLowerCase(),
      edicion: (dom.adv.edicion?.value || "").trim().toLowerCase(),

      anioMin: toInt(dom.adv.anioMin?.value, null),
      anioMax: toInt(dom.adv.anioMax?.value, null),
      lvlMin: toInt(dom.adv.lvlMin?.value, null),
      lvlMax: toInt(dom.adv.lvlMax?.value, null),
      atkMin: toInt(dom.adv.atkMin?.value, null),
      atkMax: toInt(dom.adv.atkMax?.value, null),
      defMin: toInt(dom.adv.defMin?.value, null),
      defMax: toInt(dom.adv.defMax?.value, null),
      qtyMin: toInt(dom.adv.qtyMin?.value, null),
      qtyMax: toInt(dom.adv.qtyMax?.value, null),
      priceMin: toFloat(dom.adv.priceMin?.value, null),
      priceMax: toFloat(dom.adv.priceMax?.value, null),
    };

    const getText = (row, k) => String(getCell(row, k) || "").toLowerCase();
    const getNum = (row, k) => toFloat(getCell(row, k), null);

    const out = data.filter(row => {
      if (filters.q) {
        const hit = row.some(cell => String(cell||"").toLowerCase().includes(filters.q));
        if (!hit) return false;
      }
      if (filters.nombre && !getText(row,"nombre").includes(filters.nombre)) return false;
      if (filters.mazo && !getText(row,"mazo").includes(filters.mazo)) return false;

      if (filters.categoria) {
        const c = norm(getCell(row,"categoria"));
        if (!c.includes(filters.categoria)) return false;
      }

      if (filters.tipo && !getText(row,"tipo").includes(filters.tipo)) return false;
      if (filters.subtipo && !getText(row,"subtipo").includes(filters.subtipo)) return false;
      if (filters.atributo && !getText(row,"atributo").includes(filters.atributo)) return false;
      if (filters.rareza && !getText(row,"rareza").includes(filters.rareza)) return false;
      if (filters.idioma && !getText(row,"idioma").includes(filters.idioma)) return false;
      if (filters.edicion && !getText(row,"edicion").includes(filters.edicion)) return false;

      if (!inRange(getNum(row,"anio"), filters.anioMin, filters.anioMax)) return false;
      if (!inRange(getNum(row,"nivel"), filters.lvlMin, filters.lvlMax)) return false;
      if (!inRange(getNum(row,"atk"), filters.atkMin, filters.atkMax)) return false;
      if (!inRange(getNum(row,"def"), filters.defMin, filters.defMax)) return false;
      if (!inRange(getNum(row,"cantidad"), filters.qtyMin, filters.qtyMax)) return false;
      if (!inRange(getNum(row,"precio"), filters.priceMin, filters.priceMax)) return false;

      return true;
    });

    safeText(dom.adv.countText, String(out.length));

    if (dom.adv.table) {
      renderAnyTable(dom.adv.table, [header, ...out], { hideKeys: ["_id"] });
    }

    toast(`Resultados avanzados: ${out.length}`);
  }

  function inRange(v, min, max){
    if (v == null || Number.isNaN(v)) {
      if (min != null || max != null) return false;
      return true;
    }
    if (min != null && v < min) return false;
    if (max != null && v > max) return false;
    return true;
  }

  function renderAnyTable(tableEl, rows, { hideKeys = [] } = {}){
    if (!tableEl) return;

    const header = rows[0] || [];
    const body = rows.slice(1);

    const hideIdx = new Set();
    hideKeys.forEach(k => {
      const idx = col(k);
      if (idx >= 0) hideIdx.add(idx);
    });

    const visibleCols = header.map((_,i)=>i).filter(i => !hideIdx.has(i));

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    visibleCols.forEach(i => {
      const th = document.createElement("th");
      th.textContent = header[i] || "";
      trh.appendChild(th);
    });
    thead.appendChild(trh);

    const tbody = document.createElement("tbody");
    const frag = document.createDocumentFragment();

    body.forEach(row => {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      const id = String(getCell(row,"_id") || "").trim();
      if (id) tr.dataset.id = id;

      visibleCols.forEach(i => {
        const td = document.createElement("td");
        td.textContent = row?.[i] || "";
        tr.appendChild(td);
      });

      tr.addEventListener("click", () => {
        const id = tr.dataset.id || "";
        if (!id) return;
        const r = findRowById(id);
        if (!r) return;
        openEdit(r, resolveSheetRowIndexById(id));
      });

      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
    tableEl.innerHTML = "";
    tableEl.appendChild(thead);
    tableEl.appendChild(tbody);
  }

  /* =========================
    MODAL (reusable) - robusto
  ========================= */
  function ensureModal(){
    let modal = dom.modal;

    // Si existe en HTML, igual “amarramos” handlers 1 vez.
    if (modal) {
      if (!modal.__bound) {
        modal.__bound = true;

        modal.addEventListener("click", (e) => {
          const card = e.target.closest?.(".modal__card");
          if (!card) closeModal();
        });

        // soporta ambos ids
        modal.querySelector("#btnCloseModal")?.addEventListener("click", closeModal);
        modal.querySelector("#modalClose")?.addEventListener("click", closeModal);
      }
      return modal;
    }

    // si no existe, lo creamos
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

    modal.__bound = true;
    modal.addEventListener("click", (e) => {
      const card = e.target.closest?.(".modal__card");
      if (!card) closeModal();
    });
    modal.querySelector("#btnCloseModal")?.addEventListener("click", closeModal);

    return modal;
  }

  function isModalOpen(){
    return !!dom.modal && dom.modal.hidden === false;
  }

  function closeModal(){
    const modal = ensureModal();
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    if (dom.drawer?.classList.contains("is-open")) $("nombre")?.focus();
  }

  function btnClassFromKind(kind){
    const k = String(kind || "").toLowerCase();
    if (k === "primary") return "btn btn--primary";
    if (k === "danger") return "btn btn--danger";
    if (k === "ghost") return "btn btn--ghost";
    return "btn";
  }

  function modalChoice({ title, subtitle, bodyHtml, buttons }){
    return new Promise((resolve) => {
      const modal = ensureModal();

      const $t = modal.querySelector("#modalTitle");
      const $s = modal.querySelector("#modalSubtitle");
      const $b = modal.querySelector("#modalBody");
      const $a = modal.querySelector("#modalActions");

      if ($t) $t.textContent = String(title ?? "Confirmación");
      if ($s) $s.textContent = String(subtitle ?? "");
      if ($b) $b.innerHTML = String(bodyHtml ?? "");
      if ($a) $a.innerHTML = "";

      const opts = Array.isArray(buttons) && buttons.length
        ? buttons
        : [{ id: "close", label: "Cerrar", kind: "ghost" }];

      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        closeModal();
        resolve(value);
      };

      const onKey = (e) => { if (e.key === "Escape") finish(null); };
      document.addEventListener("keydown", onKey, { once: true });

      opts.forEach((btn, idx) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = btnClassFromKind(btn.kind);
        el.textContent = String(btn.label ?? "OK");
        el.addEventListener("click", () => finish(btn.id ?? btn.value ?? String(idx)));
        $a?.appendChild(el);
      });

      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      setTimeout(() => modal.querySelector(".modal__actions button")?.focus?.(), 0);
    });
  }

  async function modalPrompt({ title, subtitle, placeholder, initialValue, okLabel }){
    const id = `mp_${Math.random().toString(36).slice(2,8)}`;
    const choice = await new Promise((resolve) => {
      const bodyHtml = `
        <div style="display:grid; gap:10px;">
          <div class="muted" style="line-height:1.4">${escapeHtml(subtitle || "")}</div>
          <input id="${id}" class="input" type="text" placeholder="${escapeHtml(placeholder || "")}" value="${escapeHtml(initialValue || "")}" />
        </div>
      `;
      modalChoice({
        title: title || "Escribe",
        subtitle: "",
        bodyHtml,
        buttons: [
          { id: "ok", label: okLabel || "OK", kind: "primary" },
          { id: "cancel", label: "Cancelar", kind: "ghost" },
        ],
      }).then(resolve);

      setTimeout(() => {
        const el = document.getElementById(id);
        if (el) {
          el.focus();
          el.select?.();
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              const v = el.value;
              closeModal();
              resolve("ok:" + v);
            }
          });
        }
      }, 0);
    });

    if (!choice) return "";
    if (String(choice).startsWith("ok:")) return String(choice).slice(3).trim();

    if (choice !== "ok") return "";
    const el = document.getElementById(id);
    return (el?.value || "").trim();
  }

  /* =========================
    HELPERS / UTIL
  ========================= */
  function debounce(fn, wait){
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function toast(msg){
    const m = String(msg || "").trim();
    if (!m) return;

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
    el.textContent = m;
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
      setTimeout(() => el.remove(), 220);
    }, NET.toastMs);
  }

  function escapeHtml(s){
    return String(s ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function norm(s){
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"")
      .replace(/\s+/g," ");
  }

  function isFiniteInteger(v){
    const n = Number(String(v).trim());
    return Number.isFinite(n) && Number.isInteger(n);
  }

  function isFiniteNumber(v){
    const n = Number(String(v).trim().replace(",", "."));
    return Number.isFinite(n);
  }

  function toInt(v, fallback = 0){
    if (v == null) return fallback;
    const n = parseInt(String(v).trim().replace(/[^\d\-]/g,""), 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function toFloat(v, fallback = 0){
    if (v == null) return fallback;
    const n = Number(String(v).trim().replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function makeId(){
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 8);
    return `ygo_${t}_${r}`;
  }

  function describeRow(row){
    const name = String(getCell(row,"nombre") || "").trim();
    const setc = String(getCell(row,"mazo") || "").trim();
    const ed = String(getCell(row,"edicion") || "").trim();
    const lang = String(getCell(row,"idioma") || "").trim();
    const rar = String(getCell(row,"rareza") || "").trim();
    return [name, setc, ed, lang, rar].filter(Boolean).join(" · ");
  }

  function formatTimeAgo(ts){
    const t = Number(ts || 0);
    if (!Number.isFinite(t) || t <= 0) return "";
    const diff = Date.now() - t;
    const sec = Math.floor(diff/1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec/60);
    if (min < 60) return `${min}m`;
    const h = Math.floor(min/60);
    if (h < 48) return `${h}h`;
    const d = Math.floor(h/24);
    return `${d}d`;
  }

  function money(v){
    const n = toFloat(v, 0);
    try {
      return new Intl.NumberFormat("es-CO", { style:"currency", currency:"COP", maximumFractionDigits:0 }).format(n);
    } catch {
      return `$${Math.round(n).toLocaleString("es-CO")}`;
    }
  }

  function safeFilename(s){
    return String(s || "deck")
      .trim()
      .toLowerCase()
      .replace(/\s+/g,"_")
      .replace(/[^a-z0-9_\-\.]/g,"")
      .slice(0, 80) || "deck";
  }

  function pickFile(accept){
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept || "*/*";
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener("change", () => {
        const f = input.files?.[0] || null;
        input.remove();
        resolve(f);
      });
      input.click();
    });
  }

})(); // ✅ cierre del IIFE, sin drama