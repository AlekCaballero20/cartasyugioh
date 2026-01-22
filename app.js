/* ============================
   Yu-Gi-Oh DB - Frontend App (vNext+ PWA Ready)
   - Read: TSV published
   - Write: Apps Script WebApp (POST add/update) WITHOUT CORS PRE-FLIGHT
   - UX/Robust:
     ✅ Offline-light: cache TSV en localStorage (última copia)
     ✅ Status online/offline + eventos online/offline
     ✅ Debounce en búsqueda
     ✅ Render más eficiente (event delegation en tbody)
     ✅ Segmented: aria-selected actualizado
     ✅ Mejor manejo de errores + timeouts
============================ */

(() => {
  "use strict";

  /* =========================
     CONFIG
  ========================= */
  const TSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTr_dlYQi8JAzT_PrHeXVPimnOnXYw4VmBmonSSZhbv_k7lKp10csg5YSX2fCGOUWMnLanIbddNjga7/pub?gid=2059687180&single=true&output=tsv";

  const API_URL =
    "https://script.google.com/macros/s/AKfycbxO2gLI_HIAxukEdzxqeV7PBDxaXGutcqUD1B_fG5-zsrxjv12PdaKfNqMdr3WNTFWEbw/exec";

  const STORAGE = {
    tsvCache: "ygo_tsv_cache_v1",
    tsvCacheAt: "ygo_tsv_cache_at_v1",
  };

  const NET = {
    fetchTimeoutMs: 12000,
    toastMs: 2400,
    searchDebounceMs: 120,
  };

  /**
   * Column mapping (A–Q) según columnas fijas:
   * _id | # | Edición | Año | Mazo | Nombre | Categoría | Tipo | Subtipo | Atributo
   * Rareza | Cantidad | Idioma | Precio | Fecha compra | Notas | ImagenURL
   */
  const COL = {
    _id: 0,
    num: 1,
    edicion: 2,
    anio: 3,
    mazo: 4,
    nombre: 5,
    categoria: 6,
    tipo: 7,
    subtipo: 8,
    atributo: 9,
    rareza: 10,
    cantidad: 11,
    idioma: 12,
    precio: 13,
    fecha_compra: 14,
    notas: 15,
    imagenurl: 16,
  };

  // IDs de inputs del formulario (de tu index.html actualizado)
  const FORM_FIELDS = [
    "num",
    "anio",
    "nombre",
    "edicion",
    "mazo",
    "categoria",
    "tipo",
    "subtipo",
    "atributo",
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

  // Defaults “por si la base está vacía” (no reemplaza lo que ya tengas en TSV)
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
  };

  /* =========================
     INIT
  ========================= */
  init();

  function init() {
    bindUI();
    bindNetwork();
    loadTSV(false); // primer load
  }

  function bindNetwork() {
    window.addEventListener("online", () => {
      state.isOnline = true;
      // No recargamos automático para no “saltarle” al usuario; solo avisamos
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

    // UX hint: Spell/Trap normalmente sin atributo
    $("categoria")?.addEventListener("change", () => {
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

      // OK: guardar en estado + cache local
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

    // Alimenta datalists con valores únicos
    hydrateDatalistsFromRows(rows);

    applyFiltersAndRender();
  }

  function cacheTSV(tsvText) {
    try {
      localStorage.setItem(STORAGE.tsvCache, tsvText);
      localStorage.setItem(STORAGE.tsvCacheAt, String(Date.now()));
    } catch {
      // si storage está bloqueado, no hacemos drama
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
    return (tsv || "")
      .trim()
      .split("\n")
      .map((line) => line.split("\t").map((x) => (x ?? "").trim()));
  }

  /* =========================
     DATALISTS
  ========================= */
  function hydrateDatalistsFromRows(rows) {
    const data = (rows || []).slice(1);

    const uniq = (idx) =>
      uniqueSorted(data.map((r) => (r?.[idx] || "").trim()).filter(Boolean));

    const values = {
      edicion: uniq(COL.edicion),
      anio: uniq(COL.anio),
      mazo: uniq(COL.mazo),
      categoria: uniq(COL.categoria),
      tipo: uniq(COL.tipo),
      subtipo: uniq(COL.subtipo),
      atributo: uniq(COL.atributo),
      rareza: uniq(COL.rareza),
      idioma: uniq(COL.idioma),
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

    const cat = norm(row?.[COL.categoria] || "");

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

    // Thead
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    header.forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h || "";
      trh.appendChild(th);
    });
    thead.appendChild(trh);

    // Tbody (con data-id y delegación)
    const tbody = document.createElement("tbody");

    body.forEach((row) => {
      const tr = document.createElement("tr");
      const id = row?.[COL._id] || "";
      if (id) tr.dataset.id = id;

      row.forEach((cell) => {
        const td = document.createElement("td");
        td.textContent = cell || "";
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    // Delegación: un solo listener (más rápido)
    tbody.addEventListener("click", (e) => {
      const tr = e.target?.closest?.("tr");
      if (!tr) return;

      const id = tr.dataset.id || "";
      const row = id ? findRowById(id) : null;
      if (!row) return;

      const sheetRowIndex = resolveSheetRowIndexById(id);
      openEdit(row, sheetRowIndex);
    });

    dom.table.innerHTML = "";
    dom.table.appendChild(thead);
    dom.table.appendChild(tbody);
  }

  function findRowById(_id) {
    const all = state.rows || [];
    const idx = all.findIndex((r, i) => i > 0 && (r?.[COL._id] || "") === _id);
    return idx >= 1 ? all[idx] : null;
  }

  function resolveSheetRowIndexById(_id) {
    const all = state.rows || [];
    const idx = all.findIndex((r, i) => i > 0 && (r?.[COL._id] || "") === _id);
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
    if (dom.btnDuplicate) dom.btnDuplicate.disabled = false;

    setFormMeta("Editando.");
    openDrawer();
  }

  function openDrawer() {
    if (!dom.drawer) return;
    dom.drawer.classList.add("is-open");
    dom.drawer.setAttribute("aria-hidden", "false");
    if (dom.overlay) dom.overlay.hidden = false;

    // foco
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
    $("num").value = row?.[COL.num] || "";
    $("edicion").value = row?.[COL.edicion] || "";
    $("anio").value = row?.[COL.anio] || "";
    $("mazo").value = row?.[COL.mazo] || "";
    $("nombre").value = row?.[COL.nombre] || "";
    $("categoria").value = row?.[COL.categoria] || "";
    $("tipo").value = row?.[COL.tipo] || "";
    $("subtipo").value = row?.[COL.subtipo] || "";
    $("atributo").value = row?.[COL.atributo] || "";
    $("rareza").value = row?.[COL.rareza] || "";
    $("cantidad").value = row?.[COL.cantidad] || "";
    $("idioma").value = row?.[COL.idioma] || "";
    $("precio").value = row?.[COL.precio] || "";
    $("fecha_compra").value = row?.[COL.fecha_compra] || "";
    $("notas").value = row?.[COL.notas] || "";
    $("imagenurl").value = row?.[COL.imagenurl] || "";
  }

  function buildRowForSave() {
    const existingId = state.selected?.rowArray?.[COL._id] || "";
    const _id = existingId || makeId();

    // Siempre array exacto (17 cols)
    const row = new Array(17).fill("");

    row[COL._id] = _id;
    row[COL.num] = val("num");
    row[COL.edicion] = val("edicion");
    row[COL.anio] = val("anio");
    row[COL.mazo] = val("mazo");
    row[COL.nombre] = val("nombre");
    row[COL.categoria] = normalizeCategoria(val("categoria"));
    row[COL.tipo] = val("tipo");
    row[COL.subtipo] = val("subtipo");
    row[COL.atributo] = val("atributo");
    row[COL.rareza] = val("rareza");
    row[COL.cantidad] = val("cantidad");
    row[COL.idioma] = val("idioma");
    row[COL.precio] = val("precio");
    row[COL.fecha_compra] = val("fecha_compra");
    row[COL.notas] = val("notas");
    row[COL.imagenurl] = val("imagenurl");

    return row;
  }

  function val(id) {
    return ($(id)?.value || "").trim();
  }

  function normalizeCategoria(x) {
    const n = norm(x);
    if (!n) return "";
    if (n === "monster" || n === "monstruo" || n === "monstruos") return "Monster";
    if (n === "spell" || n === "magia" || n === "magias") return "Spell";
    if (n === "trap" || n === "trampa" || n === "trampas") return "Trap";
    return (x || "").trim();
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

    const payloadRow = buildRowForSave();

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

      // Refresh TSV (bypass cache)
      await loadTSV(true);

      // Si fue add, cerramos
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
        headers: { "Content-Type": "text/plain;charset=utf-8" },
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
