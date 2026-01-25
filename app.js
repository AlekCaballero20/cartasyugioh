/* ============================
   Yu-Gi-Oh DB - Frontend App (vNext+++)
   - Read: TSV published
   - Write: Apps Script WebApp (POST add/update) WITHOUT CORS PRE-FLIGHT
   - UX/Robust:
     ✅ Offline-light: cache TSV en localStorage
     ✅ Status online/offline
     ✅ Debounce en búsqueda
     ✅ Render eficiente + tabla sin mostrar _id
     ✅ Column mapping por header (si cambias orden en Sheets, no muere)
     ✅ Monster-only fields: NIVEL ⭐ + ATK/DEF (solo Monstruos)
============================ */

(() => {
  "use strict";

  /* =========================
     CONFIG
  ========================= */
  const TSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTr_dlYQi8JAzT_PrHeXVPimnOnXYw4VmBmonSSZhbv_k7lKp10csg5YSX2fCGOUWMnLanIbddNjga7/pub?gid=2059687180&single=true&output=tsv";

  const API_URL =
    "https://script.google.com/macros/s/AKfycbxx2369sUDC1HNtwOFaeFtjdsn5aCZaZ-WW_2N7yVClTcfrUobf81j5ofOEmdIsTcnYgg/exec";

  const STORAGE = {
    tsvCache: "ygo_tsv_cache_v3",
    tsvCacheAt: "ygo_tsv_cache_at_v3",
  };

  const NET = {
    fetchTimeoutMs: 12000,
    toastMs: 2400,
    searchDebounceMs: 120,
  };

  /**
   * Mapeo por header (robusto).
   * Si cambias el orden de columnas en Sheets, esto sigue funcionando
   * mientras los nombres existan (o similares).
   */
  const HEADER_ALIASES = {
    _id: ["_id", "id", "uuid"],
    num: ["#", "num", "numero", "número"],
    edicion: ["edicion", "edición"],
    anio: ["anio", "año"],
    mazo: ["mazo", "set", "setcode", "set code", "codigo", "código"],
    nombre: ["nombre", "name"],
    categoria: ["categoria", "categoría", "category"],
    tipo: ["tipo", "type"],
    // ⭐ NUEVO: Nivel / Estrellas (columna en Sheets después de Tipo)
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

  // IDs de inputs del formulario (según tu index.html)
  const FORM_FIELDS = [
    "num",
    "anio",
    "nombre",
    "edicion",
    "mazo",
    "categoria",
    "tipo",
    // ⭐ nuevo
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
      // monsters
      "Normal",
      "Effect",
      "Fusion",
      "Synchro",
      "Xyz",
      "Link",
      "Ritual",
      "Pendulum",
      "Tuner",
      // spells & traps
      "Normal Spell",
      "Continuous Spell",
      "Quick-Play Spell",
      "Field Spell",
      "Ritual Spell",
      "Normal Trap",
      "Continuous Trap",
      "Counter Trap",
    ],
  };

  /* =========================
     DOM helpers
  ========================= */
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* =========================
     DOM refs
  ========================= */
  const dom = {
    table: $("dbTable"),
    search: $("search"),
    btnClearSearch: $("btnClearSearch"),
    countText: $("countText"),
    btnReload: $("btnReload"),
    btnNew: $("btnNew"),

    statusPill: $("statusPill"),
    statusDot: $("statusDot"),
    statusText: $("statusText"),

    drawer: $("drawer"),
    overlay: $("overlay"),
    btnCloseDrawer: $("btnCloseDrawer"),
    btnCancel: $("btnCancel"),
    btnDuplicate: $("btnDuplicate"),
    drawerTitle: $("drawerTitle"),
    drawerSubtitle: $("drawerSubtitle"),
    form: $("cardForm"),
    rowIndex: $("rowIndex"),
    formMeta: $("formMeta"),

    segmentedBtns: qsa(".segmented__btn"),
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

    // índices calculados desde el header
    col: {},
  };

  /* =========================
     INIT
  ========================= */
  init();

  function init() {
    bindUI();
    bindNetwork();
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
    dom.overlay?.addEventListener("click", closeDrawer);

    dom.btnDuplicate?.addEventListener("click", duplicateSelected);
    dom.form?.addEventListener("submit", onSave);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDrawer();
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
     TSV LOAD + CACHE
  ========================= */
  async function loadTSV(withBypassCache = false) {
    setStatus("loading", "Cargando…");

    // 1) intenta red
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

    // 2) fallback: cache local
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

    // 3) nada funciona
    setStatus("error", "Error");
    if (dom.table) dom.table.innerHTML = "";
    if (dom.countText) dom.countText.textContent = "0";
    toast("No se pudo cargar (sin red y sin caché).");
  }

  function applyRows(rows) {
    state.rows = rows;
    state.header = rows[0] || [];
    state.lastLoadedAt = Date.now();

    // construir índice de columnas basado en header
    state.col = buildColIndexFromHeader(state.header);

    // Alimenta datalists
    hydrateDatalistsFromRows(rows);

    applyFiltersAndRender();
  }

  function cacheTSV(tsvText) {
    try {
      localStorage.setItem(STORAGE.tsvCache, tsvText);
      localStorage.setItem(STORAGE.tsvCacheAt, String(Date.now()));
    } catch {
      // storage bloqueado: seguimos sin drama
    }
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
      const v = localStorage.getItem(STORAGE.tsvCacheAt);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
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

      // fallback: contiene texto
      if (idx === -1) {
        for (let i = 0; i < normHeader.length; i++) {
          const h = normHeader[i];
          if (!h) continue;
          if (aliases.some((a) => h.includes(a))) { idx = i; break; }
        }
      }

      if (idx !== -1) out[key] = idx;
    }

    // Compatibilidad: si no encuentra _id, asumimos que está en la 1ra
    if (out._id == null && (header?.[0] || "").trim()) out._id = 0;

    return out;
  }

  function col(key) {
    const idx = state.col?.[key];
    return Number.isInteger(idx) ? idx : -1;
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
     FILTERS + RENDER
  ========================= */
  function applyFiltersAndRender() {
    const all = state.rows;
    if (!all || all.length < 2) {
      if (dom.countText) dom.countText.textContent = "0";
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

    if (dom.countText) dom.countText.textContent = String(filtered.length);
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

    // columnas visibles (oculta _id)
    const visibleCols = header
      .map((_, i) => i)
      .filter((i) => i !== idIdx);

    // Thead
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    visibleCols.forEach((i) => {
      const th = document.createElement("th");
      th.textContent = header[i] || "";
      trh.appendChild(th);
    });
    thead.appendChild(trh);

    // Tbody
    const tbody = document.createElement("tbody");
    const frag = document.createDocumentFragment();

    for (const row of body) {
      const tr = document.createElement("tr");

      const id = idIdx >= 0 ? (row?.[idIdx] || "") : "";
      if (id) tr.dataset.id = id;

      visibleCols.forEach((i) => {
        const td = document.createElement("td");

        // ⭐ Render especial: Nivel -> estrellas si es número
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
    if (dom.drawerTitle) dom.drawerTitle.textContent = "Nueva carta";
    if (dom.drawerSubtitle) dom.drawerSubtitle.textContent = "Completa la info y guarda";
    if (dom.rowIndex) dom.rowIndex.value = "";

    clearFormFields();

    if (dom.btnDuplicate) dom.btnDuplicate.disabled = true;

    // default categoría
    if ($("categoria") && !$("categoria").value) $("categoria").value = "Monster";

    updateMonsterOnlyVisibility();

    setFormMeta("Nueva carta.");
    openDrawer();
  }

  function openEdit(row, sheetRowIndex) {
    state.selected = { rowArray: row, sheetRowIndex };

    if (dom.drawerTitle) dom.drawerTitle.textContent = "Editar carta";
    if (dom.drawerSubtitle) {
      dom.drawerSubtitle.textContent = sheetRowIndex ? `Fila #${sheetRowIndex}` : "Editando";
    }
    if (dom.rowIndex) dom.rowIndex.value = sheetRowIndex || "";

    fillFormFromRow(row);
    updateMonsterOnlyVisibility();

    if (dom.btnDuplicate) dom.btnDuplicate.disabled = false;

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
  }

  function clearFormFields() {
    FORM_FIELDS.forEach((f) => {
      const el = $(f);
      if (el) el.value = "";
    });
  }

  function fillFormFromRow(row) {
    const get = (k) => {
      const i = col(k);
      return i >= 0 ? (row?.[i] || "") : "";
    };

    $("num").value = get("num");
    $("edicion").value = get("edicion");
    $("anio").value = get("anio");
    $("mazo").value = get("mazo");
    $("nombre").value = get("nombre");
    $("categoria").value = get("categoria");
    $("tipo").value = get("tipo");
    // ⭐ nuevo
    if ($("nivel")) $("nivel").value = get("nivel");

    $("subtipo").value = get("subtipo");
    $("atributo").value = get("atributo");
    $("atk").value = get("atk");
    $("def").value = get("def");
    $("rareza").value = get("rareza");
    $("cantidad").value = get("cantidad");
    $("idioma").value = get("idioma");
    $("precio").value = get("precio");
    $("fecha_compra").value = get("fecha_compra");
    $("notas").value = get("notas");
    $("imagenurl").value = get("imagenurl");
  }

  function buildRowForSave() {
    const headerLen = (state.header || []).length || 0;
    if (!headerLen) throw new Error("No header loaded");

    const existingId = (() => {
      const idIdx = col("_id");
      if (idIdx < 0) return "";
      return state.selected?.rowArray?.[idIdx] || "";
    })();

    const _id = existingId || makeId();

    // Array exacto del tamaño del header actual
    const row = new Array(headerLen).fill("");

    // setters seguros
    const set = (k, value) => {
      const i = col(k);
      if (i < 0) return;
      row[i] = (value ?? "").toString().trim();
    };

    set("_id", _id);
    set("num", val("num"));
    set("edicion", val("edicion"));
    set("anio", val("anio"));
    set("mazo", val("mazo"));
    set("nombre", val("nombre"));
    set("categoria", normalizeCategoria(val("categoria")));
    set("tipo", val("tipo"));

    // Monster-only (Nivel + ATK/DEF)
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

  function val(id) {
    return ($(id)?.value || "").trim();
  }

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

        // Limpia monster-only cuando NO es monster
        if (!monster) {
          if (el.id === "atk" || el.id === "def" || el.id === "nivel") {
            el.value = "";
          }
        }
      });
    });
  }

  function setFormMeta(msg) {
    if (!dom.formMeta) return;
    dom.formMeta.textContent = msg;
  }

  function setStatus(kind, text) {
    if (!dom.statusText || !dom.statusDot) return;

    dom.statusText.textContent = text;
    dom.statusDot.classList.remove("is-ok", "is-loading", "is-error");

    if (kind === "ok") dom.statusDot.classList.add("is-ok");
    else if (kind === "loading") dom.statusDot.classList.add("is-loading");
    else dom.statusDot.classList.add("is-error");
  }

  /* =========================
     SAVE (NO PREFLIGHT)
  ========================= */
  async function onSave(e) {
    e.preventDefault();
    if (state.isSaving) return;

    const rowIndex = (dom.rowIndex?.value || "").trim();
    const action = rowIndex ? "update" : "add";

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

    // mini-validación monster-only
    if (isMonsterCategoria(val("categoria"))) {
      const lvl = val("nivel");
      const atk = val("atk");
      const def = val("def");

      if (lvl && !isFiniteInteger(lvl)) { toast("Nivel debe ser entero."); $("nivel")?.focus(); return; }
      if (atk && !isFiniteNumber(atk)) { toast("ATK debe ser número."); $("atk")?.focus(); return; }
      if (def && !isFiniteNumber(def)) { toast("DEF debe ser número."); $("def")?.focus(); return; }
    }

    let payloadRow;
    try {
      payloadRow = buildRowForSave();
    } catch (err) {
      console.error(err);
      toast("No se pudo preparar el registro (header no cargado).");
      return;
    }

    try {
      state.isSaving = true;
      lockSave(true);
      setFormMeta("Guardando…");

      const payload = {
        action,
        rowIndex: rowIndex || "",
        row: payloadRow,
      };

      const text = await postTextWithTimeout(API_URL, JSON.stringify(payload), NET.fetchTimeoutMs);

      let res = null;
      try { res = JSON.parse(text); } catch { /* ignore */ }

      if (!res?.ok) {
        throw new Error(res?.error || "No se pudo guardar");
      }

      toast(res.msg || "Guardado ✅");
      setFormMeta("Listo.");

      // Refresh TSV
      await loadTSV(true);

      if (action === "add") closeDrawer();
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
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // clave: evita preflight
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
    if (dom.drawerTitle) dom.drawerTitle.textContent = "Duplicar carta";
    if (dom.drawerSubtitle) dom.drawerSubtitle.textContent = "Se guardará como nueva";
    if (dom.rowIndex) dom.rowIndex.value = "";

    state.selected = null; // fuerza nuevo _id
    if (dom.btnDuplicate) dom.btnDuplicate.disabled = true;

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
  }

  /* =========================
     TOAST
  ========================= */
  let toastTimer = null;
  function toast(msg) {
    let el = qs(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("is-on");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-on"), NET.toastMs);
  }

  /* =========================
     UTIL
  ========================= */
  function makeId() {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 8);
    return `ygo_${t}_${r}`;
  }

  function norm(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function isFiniteNumber(x) {
    const n = Number(String(x).replace(",", "."));
    return Number.isFinite(n);
  }

  function isFiniteInteger(x) {
    const n = Number(String(x).replace(",", "."));
    return Number.isFinite(n) && Number.isInteger(n);
  }

  function formatTimeAgo(ts) {
    const diff = Math.max(0, Date.now() - ts);
    const m = Math.floor(diff / 60000);
    if (m < 1) return "hace segundos";
    if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    return `hace ${d} d`;
  }
})();
