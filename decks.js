/* =============================================================================
   decks.js — Yu-Gi-Oh! TCG DB Deck System (v1.2.0)
   - LocalStorage deck manager
   - Compatible con app.js vPRO.4
   - Storage alineado: ygo_decks_v2 / ygo_last_deck_id_v2
   - Migra formato legacy ygo_decks_v1
   - Create / rename / duplicate / delete decks
   - Add / remove / qty cards
   - Export JSON / text
   - Import deck JSON
   - Basic TCG-style validation helpers
   - ES Module + window.Decks fallback
============================================================================= */

export const Decks = (() => {
  "use strict";

  /* =========================
     STORAGE / CONSTANTS
  ========================= */
  const STORAGE = {
    decks: "ygo_decks_v2",
    active: "ygo_last_deck_id_v2",

    legacyDecks: "ygo_decks_v1",
    legacyActive: "ygo_decks_active_v1",

    backup: "ygo_decks_backup_v1",
  };

  const DEFAULTS = {
    deckName: "Nuevo deck",
    importedName: "Deck importado",
    firstDeckName: "Mi primer deck",
    maxQtyPerCard: 99,
  };

  const CATEGORY_ALIASES = {
    monster: ["monster", "monstruo", "monstruos"],
    spell: ["spell", "magia", "magias"],
    trap: ["trap", "trampa", "trampas"],
  };

  /* =========================
     PUBLIC: READ
  ========================= */

  function listDecks() {
    const decks = readDecks();
    return sortDecks(decks).map(clone);
  }

  function getDeck(deckId) {
    const decks = readDecks();
    const deck = decks.find((item) => item.id === String(deckId || ""));
    return deck ? clone(deck) : null;
  }

  function getActiveDeckId() {
    try {
      return localStorage.getItem(STORAGE.active) || "";
    } catch {
      return "";
    }
  }

  function getActiveDeck() {
    const activeId = getActiveDeckId();
    return activeId ? getDeck(activeId) : null;
  }

  function setActiveDeck(deckId) {
    const id = String(deckId || "").trim();
    const decks = readDecks();

    if (!id || !decks.some((deck) => deck.id === id)) {
      return false;
    }

    try {
      localStorage.setItem(STORAGE.active, id);
    } catch {}

    return true;
  }

  function ensureActiveDeck(options = {}) {
    const {
      createIfMissing = true,
      defaultName = DEFAULTS.firstDeckName,
    } = options;

    const activeId = getActiveDeckId();

    if (activeId && getDeck(activeId)) {
      return activeId;
    }

    const decks = listDecks();

    if (decks.length) {
      setActiveDeck(decks[0].id);
      return decks[0].id;
    }

    if (!createIfMissing) return "";

    const created = createDeck(defaultName);
    setActiveDeck(created.id);

    return created.id;
  }

  /* =========================
     PUBLIC: DECK CRUD
  ========================= */

  function createDeck(name = DEFAULTS.deckName, options = {}) {
    const decks = readDecks();
    const now = Date.now();

    const deck = normalizeDeck({
      id: options.id || makeId("deck"),
      name: name || DEFAULTS.deckName,
      createdAt: options.createdAt || now,
      updatedAt: options.updatedAt || now,
      notes: options.notes || "",
      cards: options.cards || [],
    });

    decks.unshift(deck);
    writeDecks(dedupeDecks(decks));
    setActiveDeck(deck.id);

    return clone(deck);
  }

  function renameDeck(deckId, newName) {
    const id = String(deckId || "").trim();
    const name = String(newName || "").trim();

    if (!id || !name) return false;

    const decks = readDecks();
    const deck = decks.find((item) => item.id === id);

    if (!deck) return false;

    deck.name = name;
    deck.updatedAt = Date.now();

    writeDecks(decks);

    return true;
  }

  function duplicateDeck(deckId, options = {}) {
    const source = getDeck(deckId);

    if (!source) {
      return {
        ok: false,
        error: "Deck no encontrado",
      };
    }

    const copyName = options.name || `${source.name} copia`;
    const now = Date.now();

    const copy = normalizeDeck({
      ...source,
      id: makeId("deck"),
      name: copyName,
      createdAt: now,
      updatedAt: now,
      cards: source.cards,
    });

    const decks = readDecks();
    decks.unshift(copy);

    writeDecks(decks);
    setActiveDeck(copy.id);

    return {
      ok: true,
      deck: clone(copy),
    };
  }

  function deleteDeck(deckId) {
    const id = String(deckId || "").trim();

    if (!id) return false;

    let decks = readDecks();
    const before = decks.length;

    decks = decks.filter((deck) => deck.id !== id);

    if (decks.length === before) return false;

    writeDecks(decks);

    const activeId = getActiveDeckId();

    if (activeId === id) {
      const next = sortDecks(decks)[0]?.id || "";

      try {
        if (next) {
          localStorage.setItem(STORAGE.active, next);
        } else {
          localStorage.removeItem(STORAGE.active);
        }
      } catch {}
    }

    return true;
  }

  function setDeckNotes(deckId, notes) {
    const id = String(deckId || "").trim();
    const decks = readDecks();
    const deck = decks.find((item) => item.id === id);

    if (!deck) return false;

    deck.notes = String(notes || "");
    deck.updatedAt = Date.now();

    writeDecks(decks);

    return true;
  }

  function clearDeck(deckId) {
    const id = String(deckId || "").trim();
    const decks = readDecks();
    const deck = decks.find((item) => item.id === id);

    if (!deck) return false;

    deck.cards = [];
    deck.updatedAt = Date.now();

    writeDecks(decks);

    return true;
  }

  /* =========================
     PUBLIC: CARD ACTIONS
  ========================= */

  /**
   * Agrega una carta al deck.
   *
   * @param {string} deckId
   * @param {string|object} card
   * @param {{
   *   qty?: number,
   *   meta?: object,
   *   onDuplicate?: (ctx: object) => Promise<"increment"|"replace"|"cancel"> | "increment"|"replace"|"cancel"
   * }} options
   */
  async function addCardToDeck(deckId, card, options = {}) {
    const id = String(deckId || "").trim();
    const decks = readDecks();
    const deck = decks.find((item) => item.id === id);

    if (!deck) {
      return {
        ok: false,
        error: "Deck no existe",
      };
    }

    const cardId = extractCardId(card);

    if (!cardId) {
      return {
        ok: false,
        error: "Carta sin id",
      };
    }

    const qtyToAdd = clampQty(options.qty ?? 1);

    if (qtyToAdd <= 0) {
      return {
        ok: false,
        error: "Cantidad inválida",
      };
    }

    const now = Date.now();
    const meta = {
      ...extractCardMeta(card),
      ...normalizeMeta(options.meta),
    };

    const existing = deck.cards.find((item) => item.id === cardId);

    if (!existing) {
      deck.cards.push({
        id: cardId,
        qty: qtyToAdd,
        addedAt: now,
        updatedAt: now,
        meta,
      });

      deck.updatedAt = now;
      writeDecks(decks);

      return {
        ok: true,
        mode: "added",
        deck: clone(deck),
      };
    }

    let decision = "increment";

    if (typeof options.onDuplicate === "function") {
      try {
        decision = await options.onDuplicate({
          deck: clone(deck),
          cardId,
          cardMeta: clone(meta),
          existingQty: existing.qty,
          addQty: qtyToAdd,
        });
      } catch {
        decision = "increment";
      }
    }

    decision = String(decision || "increment").toLowerCase();

    if (decision === "cancel") {
      return {
        ok: true,
        mode: "cancelled",
        deck: clone(deck),
      };
    }

    if (decision === "replace") {
      existing.qty = qtyToAdd;
      existing.updatedAt = now;
      existing.meta = mergeMeta(existing.meta, meta);
    } else {
      existing.qty = clampQty(existing.qty + qtyToAdd);
      existing.updatedAt = now;
      existing.meta = mergeMeta(existing.meta, meta);
    }

    deck.updatedAt = now;
    writeDecks(decks);

    return {
      ok: true,
      mode: decision === "replace" ? "replaced" : "incremented",
      deck: clone(deck),
    };
  }

  function removeCardFromDeck(deckId, cardId) {
    const id = String(deckId || "").trim();
    const cid = String(cardId || "").trim();

    if (!id || !cid) return false;

    const decks = readDecks();
    const deck = decks.find((item) => item.id === id);

    if (!deck) return false;

    const before = deck.cards.length;
    deck.cards = deck.cards.filter((item) => item.id !== cid);

    if (deck.cards.length === before) return false;

    deck.updatedAt = Date.now();

    writeDecks(decks);

    return true;
  }

  function setCardQty(deckId, cardId, qty) {
    const id = String(deckId || "").trim();
    const cid = String(cardId || "").trim();

    if (!id || !cid) return false;

    const decks = readDecks();
    const deck = decks.find((item) => item.id === id);

    if (!deck) return false;

    const card = deck.cards.find((item) => item.id === cid);

    if (!card) return false;

    const nextQty = clampQty(qty);

    if (nextQty <= 0) {
      deck.cards = deck.cards.filter((item) => item.id !== cid);
    } else {
      card.qty = nextQty;
      card.updatedAt = Date.now();
    }

    deck.updatedAt = Date.now();

    writeDecks(decks);

    return true;
  }

  function incrementCardQty(deckId, cardId, delta = 1) {
    const deck = getDeck(deckId);

    if (!deck) return false;

    const card = deck.cards.find((item) => item.id === String(cardId || ""));

    if (!card) return false;

    return setCardQty(deckId, cardId, clampQty(card.qty + Number(delta || 0)));
  }

  function getDeckCards(deckId, options = {}) {
    const deck = getDeck(deckId);

    if (!deck) return [];

    const {
      resolveCard = null,
    } = options;

    return deck.cards.map((cardRef) => {
      const resolved = typeof resolveCard === "function"
        ? resolveCard(cardRef.id)
        : null;

      return {
        cardId: cardRef.id,
        id: cardRef.id,
        qty: clampQty(cardRef.qty),
        addedAt: cardRef.addedAt || null,
        updatedAt: cardRef.updatedAt || null,
        meta: mergeMeta(cardRef.meta, resolved ? extractCardMeta(resolved) : {}),
        card: resolved || null,
      };
    });
  }

  function hasCard(deckId, cardId) {
    const deck = getDeck(deckId);
    if (!deck) return false;

    return deck.cards.some((item) => item.id === String(cardId || ""));
  }

  /* =========================
     PUBLIC: STATS / VALIDATION
  ========================= */

  function getDeckStats(deckId, options = {}) {
    const deck = getDeck(deckId);

    if (!deck) return null;

    const items = getDeckCards(deckId, options);
    const totalCopies = items.reduce((sum, item) => sum + clampQty(item.qty), 0);
    const uniqueCards = items.length;

    const byCategory = {};
    const byType = {};
    const byAttribute = {};
    const byRarity = {};
    const bySet = {};

    for (const item of items) {
      const qty = clampQty(item.qty);
      const meta = item.meta || {};

      incrementCounter(byCategory, normalizeCategoryLabel(meta.categoria || meta.category), qty);
      incrementCounter(byType, cleanLabel(meta.tipo || meta.type), qty);
      incrementCounter(byAttribute, cleanLabel(meta.atributo || meta.attribute), qty);
      incrementCounter(byRarity, cleanLabel(meta.rareza || meta.rarity), qty);
      incrementCounter(bySet, cleanLabel(meta.mazo || meta.set || meta.setcode), qty);
    }

    return {
      deckId: deck.id,
      name: deck.name,
      notes: deck.notes || "",
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,

      totalCopies,
      uniqueCards,

      byCategory: sortObjectDesc(byCategory),
      byType: sortObjectDesc(byType),
      byAttribute: sortObjectDesc(byAttribute),
      byRarity: sortObjectDesc(byRarity),
      bySet: sortObjectDesc(bySet),
    };
  }

  /**
   * Validación básica estilo Yu-Gi-Oh.
   * No incluye banlist oficial porque eso cambia y meterlo fijo sería tentar al caos.
   */
  function validateDeck(deckId, options = {}) {
    const {
      minCards = 40,
      maxCards = 60,
      maxCopies = 3,
      requireMinCards = false,
    } = options;

    const deck = getDeck(deckId);

    if (!deck) {
      return {
        ok: false,
        errors: ["Deck no encontrado."],
        warnings: [],
        stats: null,
      };
    }

    const stats = getDeckStats(deckId);
    const errors = [];
    const warnings = [];

    if (requireMinCards && stats.totalCopies < minCards) {
      errors.push(`El deck tiene ${stats.totalCopies} copias. Mínimo recomendado: ${minCards}.`);
    } else if (stats.totalCopies < minCards) {
      warnings.push(`El deck tiene ${stats.totalCopies} copias. Para un Main Deck normalmente se usan mínimo ${minCards}.`);
    }

    if (stats.totalCopies > maxCards) {
      errors.push(`El deck tiene ${stats.totalCopies} copias. Máximo recomendado: ${maxCards}.`);
    }

    for (const item of deck.cards) {
      if (item.qty > maxCopies) {
        warnings.push(`"${getCardNameFromRef(item)}" tiene ${item.qty} copias. Normalmente el máximo es ${maxCopies}, salvo excepciones de banlist.`);
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      stats,
    };
  }

  /* =========================
     PUBLIC: EXPORT
  ========================= */

  function exportDeckJSON(deckId) {
    const deck = getDeck(deckId);
    if (!deck) return "";

    return JSON.stringify(deck, null, 2);
  }

  function exportAllDecksJSON() {
    const payload = {
      exportedAt: Date.now(),
      version: "1.2.0",
      decks: listDecks(),
    };

    return JSON.stringify(payload, null, 2);
  }

  function exportDeckText(deckId, options = {}) {
    const {
      includeMeta = true,
      groupByCategory = true,
      resolveCard = null,
    } = options;

    const deck = getDeck(deckId);

    if (!deck) return "";

    const items = getDeckCards(deckId, { resolveCard });

    const stats = getDeckStats(deckId, { resolveCard });

    const lines = [];

    lines.push(`# ${deck.name}`);
    lines.push(`Total copias: ${stats.totalCopies} · Únicas: ${stats.uniqueCards}`);

    if (deck.notes) {
      lines.push(`Notas: ${deck.notes}`);
    }

    lines.push("");

    const sorted = sortDeckCardsForExport(items);

    if (!groupByCategory) {
      sorted.forEach((item) => {
        lines.push(formatDeckLine(item, includeMeta));
      });

      return lines.join("\n");
    }

    const groups = groupCardsByCategory(sorted);

    Object.keys(groups).forEach((category) => {
      lines.push(`## ${category}`);

      groups[category].forEach((item) => {
        lines.push(formatDeckLine(item, includeMeta));
      });

      lines.push("");
    });

    return lines.join("\n").trim();
  }

  function exportDeckCompactText(deckId) {
    const deck = getDeck(deckId);

    if (!deck) return "";

    return getDeckCards(deckId)
      .sort((a, b) => getCardName(a).localeCompare(getCardName(b), "es", { sensitivity: "base" }))
      .map((item) => `${item.qty}x ${getCardName(item)}`)
      .join("\n");
  }

  /* =========================
     PUBLIC: IMPORT
  ========================= */

  function importDeckJSON(jsonText, options = {}) {
    const {
      setActive = true,
      mode = "duplicate",
    } = options;

    const parsed = safeJsonParse(jsonText);

    if (!parsed || typeof parsed !== "object") {
      return {
        ok: false,
        error: "JSON inválido",
      };
    }

    if (Array.isArray(parsed.decks)) {
      return importAllDecksJSON(jsonText, options);
    }

    const imported = normalizeDeck(parsed, {
      forceNewId: mode !== "replace",
      fallbackName: DEFAULTS.importedName,
    });

    const decks = readDecks();

    if (mode === "replace") {
      const idx = decks.findIndex((deck) => deck.id === imported.id);

      if (idx >= 0) {
        decks[idx] = imported;
      } else {
        decks.unshift(imported);
      }
    } else {
      decks.unshift(imported);
    }

    writeDecks(dedupeDecks(decks));

    if (setActive) {
      setActiveDeck(imported.id);
    }

    return {
      ok: true,
      deck: clone(imported),
    };
  }

  function importAllDecksJSON(jsonText, options = {}) {
    const {
      setActive = true,
      mode = "append",
    } = options;

    const parsed = safeJsonParse(jsonText);

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.decks)) {
      return {
        ok: false,
        error: "JSON inválido o sin arreglo decks.",
      };
    }

    const incoming = parsed.decks.map((deck) =>
      normalizeDeck(deck, {
        forceNewId: mode !== "replace",
        fallbackName: DEFAULTS.importedName,
      })
    );

    let decks = readDecks();

    if (mode === "replace") {
      const map = new Map(decks.map((deck) => [deck.id, deck]));

      incoming.forEach((deck) => {
        map.set(deck.id, deck);
      });

      decks = Array.from(map.values());
    } else {
      decks = [...incoming, ...decks];
    }

    decks = dedupeDecks(decks);

    writeDecks(decks);

    if (setActive && incoming[0]) {
      setActiveDeck(incoming[0].id);
    }

    return {
      ok: true,
      count: incoming.length,
      decks: incoming.map(clone),
    };
  }

  function upsertDeck(deckLike, options = {}) {
    const {
      setActive = true,
    } = options;

    const deck = normalizeDeck(deckLike);
    const decks = readDecks();
    const idx = decks.findIndex((item) => item.id === deck.id);

    if (idx >= 0) {
      decks[idx] = deck;
    } else {
      decks.unshift(deck);
    }

    writeDecks(decks);

    if (setActive) {
      setActiveDeck(deck.id);
    }

    return clone(deck);
  }

  /* =========================
     PUBLIC: BACKUP / RESET
  ========================= */

  function backupDecks() {
    const payload = exportAllDecksJSON();

    try {
      localStorage.setItem(STORAGE.backup, payload);
    } catch {}

    return payload;
  }

  function restoreBackup(options = {}) {
    let raw = "";

    try {
      raw = localStorage.getItem(STORAGE.backup) || "";
    } catch {
      raw = "";
    }

    if (!raw) {
      return {
        ok: false,
        error: "No hay backup guardado.",
      };
    }

    return importAllDecksJSON(raw, {
      mode: options.mode || "replace",
      setActive: true,
    });
  }

  function clearAllDecks() {
    backupDecks();

    try {
      localStorage.removeItem(STORAGE.decks);
      localStorage.removeItem(STORAGE.active);
    } catch {}

    return true;
  }

  /* =========================
     STORAGE
  ========================= */

  function readDecks() {
    migrateLegacyIfNeeded();

    try {
      const raw = localStorage.getItem(STORAGE.decks);
      const parsed = raw ? JSON.parse(raw) : [];

      if (Array.isArray(parsed)) {
        return parsed.map((deck) => normalizeDeck(deck));
      }

      if (parsed && typeof parsed === "object" && Array.isArray(parsed.decks)) {
        return parsed.decks.map((deck) => normalizeDeck(deck));
      }

      if (parsed && typeof parsed === "object" && parsed.decks) {
        return Object.values(parsed.decks).map((deck) => normalizeDeck(deck));
      }
    } catch {}

    return [];
  }

  function writeDecks(decks) {
    const normalized = dedupeDecks(
      (Array.isArray(decks) ? decks : []).map((deck) => normalizeDeck(deck))
    );

    try {
      localStorage.setItem(STORAGE.decks, JSON.stringify(normalized));
    } catch {
      // Si localStorage falla, pues nada: la modernidad también tiene grietas.
    }

    return normalized;
  }

  function migrateLegacyIfNeeded() {
    let hasCurrent = false;

    try {
      hasCurrent = Boolean(localStorage.getItem(STORAGE.decks));
    } catch {
      hasCurrent = false;
    }

    if (hasCurrent) return;

    let legacyRaw = "";

    try {
      legacyRaw = localStorage.getItem(STORAGE.legacyDecks) || "";
    } catch {
      legacyRaw = "";
    }

    if (!legacyRaw) return;

    const legacy = safeJsonParse(legacyRaw);

    if (!legacy) return;

    let legacyDecks = [];

    if (Array.isArray(legacy)) {
      legacyDecks = legacy;
    } else if (Array.isArray(legacy.decks)) {
      legacyDecks = legacy.decks;
    } else if (legacy.decks && typeof legacy.decks === "object") {
      legacyDecks = Object.values(legacy.decks);
    }

    if (!legacyDecks.length) return;

    const migrated = legacyDecks.map((deck) => normalizeDeck(deck));

    writeDecks(migrated);

    try {
      const legacyActive = localStorage.getItem(STORAGE.legacyActive) || "";
      const activeExists = migrated.some((deck) => deck.id === legacyActive);

      if (activeExists) {
        localStorage.setItem(STORAGE.active, legacyActive);
      } else if (migrated[0]) {
        localStorage.setItem(STORAGE.active, migrated[0].id);
      }
    } catch {}
  }

  /* =========================
     NORMALIZERS
  ========================= */

  function normalizeDeck(deckLike, options = {}) {
    const now = Date.now();

    const {
      forceNewId = false,
      fallbackName = DEFAULTS.deckName,
    } = options;

    const id = forceNewId
      ? makeId("deck")
      : String(deckLike?.id || makeId("deck")).trim();

    const name = String(deckLike?.name || fallbackName || DEFAULTS.deckName).trim() || DEFAULTS.deckName;

    const cards = normalizeCards(deckLike?.cards);

    return {
      id,
      name,
      createdAt: toTimestamp(deckLike?.createdAt, now),
      updatedAt: toTimestamp(deckLike?.updatedAt, now),
      notes: String(deckLike?.notes || ""),
      cards,
    };
  }

  function normalizeCards(cardsLike) {
    if (!cardsLike) return [];

    let rawCards = [];

    if (Array.isArray(cardsLike)) {
      rawCards = cardsLike;
    } else if (typeof cardsLike === "object") {
      rawCards = Object.entries(cardsLike).map(([cardId, info]) => ({
        id: cardId,
        ...(info && typeof info === "object" ? info : {}),
      }));
    }

    const map = new Map();

    rawCards.forEach((item) => {
      const normalized = normalizeCardRef(item);
      if (!normalized.id || normalized.qty <= 0) return;

      const existing = map.get(normalized.id);

      if (existing) {
        existing.qty = clampQty(existing.qty + normalized.qty);
        existing.updatedAt = Math.max(existing.updatedAt || 0, normalized.updatedAt || 0) || Date.now();
        existing.meta = mergeMeta(existing.meta, normalized.meta);
      } else {
        map.set(normalized.id, normalized);
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      const an = getCardNameFromRef(a).toLowerCase();
      const bn = getCardNameFromRef(b).toLowerCase();

      return an.localeCompare(bn, "es", { sensitivity: "base" });
    });
  }

  function normalizeCardRef(cardLike) {
    const now = Date.now();
    const id = extractCardId(cardLike);
    const qty = clampQty(cardLike?.qty ?? cardLike?.cantidad ?? 1);

    return {
      id,
      qty,
      addedAt: toTimestamp(cardLike?.addedAt, now),
      updatedAt: toTimestamp(cardLike?.updatedAt, now),
      meta: extractCardMeta(cardLike),
    };
  }

  function normalizeMeta(metaLike) {
    if (!metaLike || typeof metaLike !== "object") return {};

    const meta = {};

    Object.entries(metaLike).forEach(([key, value]) => {
      const cleanKey = String(key || "").trim();
      const cleanValue = String(value ?? "").trim();

      if (!cleanKey || !cleanValue) return;

      meta[cleanKey] = cleanValue;
    });

    return meta;
  }

  function extractCardId(card) {
    if (typeof card === "string" || typeof card === "number") {
      return String(card).trim();
    }

    if (!card || typeof card !== "object") return "";

    return String(
      card._id ||
      card.id ||
      card.cardId ||
      card.card_id ||
      ""
    ).trim();
  }

  function extractCardMeta(card) {
    if (!card || typeof card !== "object") return {};

    const get = (...keys) => {
      for (const key of keys) {
        const value = card?.[key];

        if (value != null && String(value).trim()) {
          return String(value).trim();
        }
      }

      return "";
    };

    const meta = {
      nombre: get("nombre", "name", "title"),
      mazo: get("mazo", "set", "setcode", "setCode"),
      categoria: normalizeCategoryLabel(get("categoria", "category")),
      tipo: get("tipo", "type"),
      subtipo: get("subtipo", "subtype"),
      atributo: get("atributo", "attribute"),
      rareza: get("rareza", "rarity"),
      idioma: get("idioma", "language", "lang"),
      imagenurl: get("imagenurl", "imageurl", "imageUrl", "image", "url"),
    };

    Object.keys(meta).forEach((key) => {
      if (!meta[key]) delete meta[key];
    });

    return meta;
  }

  function normalizeCategoryLabel(value) {
    const raw = String(value || "").trim();

    if (!raw) return "—";

    const normalized = normalize(raw);

    if (CATEGORY_ALIASES.monster.includes(normalized)) return "Monster";
    if (CATEGORY_ALIASES.spell.includes(normalized)) return "Spell";
    if (CATEGORY_ALIASES.trap.includes(normalized)) return "Trap";

    return raw;
  }

  function cleanLabel(value) {
    const raw = String(value || "").trim();
    return raw || "—";
  }

  function mergeMeta(oldMeta, newMeta) {
    const a = oldMeta && typeof oldMeta === "object" ? oldMeta : {};
    const b = newMeta && typeof newMeta === "object" ? newMeta : {};

    return {
      ...a,
      ...b,
    };
  }

  function dedupeDecks(decks) {
    const map = new Map();

    (decks || []).forEach((deck) => {
      const normalized = normalizeDeck(deck);

      if (!normalized.id) return;

      map.set(normalized.id, normalized);
    });

    return sortDecks(Array.from(map.values()));
  }

  /* =========================
     EXPORT HELPERS
  ========================= */

  function sortDeckCardsForExport(items) {
    return (items || []).slice().sort((a, b) => {
      const ac = normalizeCategoryLabel(a.meta?.categoria);
      const bc = normalizeCategoryLabel(b.meta?.categoria);

      if (ac !== bc) {
        return categorySortWeight(ac) - categorySortWeight(bc);
      }

      return getCardName(a).localeCompare(getCardName(b), "es", {
        sensitivity: "base",
      });
    });
  }

  function groupCardsByCategory(items) {
    const out = {};

    items.forEach((item) => {
      const category = normalizeCategoryLabel(item.meta?.categoria);

      if (!out[category]) out[category] = [];
      out[category].push(item);
    });

    return out;
  }

  function formatDeckLine(item, includeMeta = true) {
    const qty = clampQty(item.qty);
    const name = getCardName(item);

    if (!includeMeta) {
      return `${qty}x ${name}`;
    }

    const meta = item.meta || {};
    const parts = [
      meta.mazo,
      meta.categoria,
      meta.tipo,
      meta.rareza,
      meta.idioma,
    ].filter(Boolean);

    return parts.length
      ? `${qty}x ${name} (${parts.join(" · ")})`
      : `${qty}x ${name}`;
  }

  function getCardName(item) {
    return String(
      item?.meta?.nombre ||
      item?.nombre ||
      item?.name ||
      item?.cardId ||
      item?.id ||
      "Carta sin nombre"
    ).trim();
  }

  function getCardNameFromRef(item) {
    return String(
      item?.meta?.nombre ||
      item?.nombre ||
      item?.name ||
      item?.id ||
      "Carta sin nombre"
    ).trim();
  }

  function categorySortWeight(category) {
    const normalized = normalizeCategoryLabel(category);

    if (normalized === "Monster") return 1;
    if (normalized === "Spell") return 2;
    if (normalized === "Trap") return 3;

    return 9;
  }

  /* =========================
     LOW-LEVEL HELPERS
  ========================= */

  function clampQty(value) {
    const n = Number(String(value ?? "").replace(",", "."));

    if (!Number.isFinite(n)) return 0;

    return Math.max(0, Math.min(DEFAULTS.maxQtyPerCard, Math.floor(n)));
  }

  function toTimestamp(value, fallback) {
    const n = Number(value);

    if (Number.isFinite(n) && n > 0) return n;

    return fallback;
  }

  function incrementCounter(target, key, amount = 1) {
    const label = cleanLabel(key);
    const qty = clampQty(amount);

    target[label] = (target[label] || 0) + qty;
  }

  function sortObjectDesc(obj) {
    const entries = Object.entries(obj || {}).sort((a, b) => {
      return Number(b[1] || 0) - Number(a[1] || 0);
    });

    const out = {};

    entries.forEach(([key, value]) => {
      out[key] = value;
    });

    return out;
  }

  function sortDecks(decks) {
    return (decks || []).slice().sort((a, b) => {
      const bu = Number(b?.updatedAt || 0);
      const au = Number(a?.updatedAt || 0);

      if (bu !== au) return bu - au;

      return String(a?.name || "").localeCompare(String(b?.name || ""), "es", {
        sensitivity: "base",
      });
    });
  }

  function makeId(prefix = "id") {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 8);

    return `${prefix}_${t}_${r}`;
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(String(text || ""));
    } catch {
      return null;
    }
  }

  function clone(value) {
    try {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
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
     PUBLIC API
  ========================= */
  return {
    STORAGE,

    listDecks,
    getDeck,
    getActiveDeckId,
    getActiveDeck,
    setActiveDeck,
    ensureActiveDeck,

    createDeck,
    renameDeck,
    duplicateDeck,
    deleteDeck,
    setDeckNotes,
    clearDeck,

    addCardToDeck,
    removeCardFromDeck,
    setCardQty,
    incrementCardQty,
    getDeckCards,
    hasCard,

    getDeckStats,
    validateDeck,

    exportDeckJSON,
    exportAllDecksJSON,
    exportDeckText,
    exportDeckCompactText,

    importDeckJSON,
    importAllDecksJSON,
    upsertDeck,

    backupDecks,
    restoreBackup,
    clearAllDecks,

    normalizeDeck,
    normalizeCards,
    normalizeCardRef,
    extractCardId,
    extractCardMeta,
  };
})();

/* =========================
   Window fallback
========================= */
try {
  if (typeof window !== "undefined") {
    window.Decks = Decks;
  }
} catch {
  // Nada que hacer. Qué novedad.
}