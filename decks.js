/* ============================
   decks.js — Deck System (LocalStorage) (v1.0)
   - Create / rename / delete decks
   - Add card to deck with duplicate handling:
       - increment qty / replace qty / cancel
       - handled via callback (no UI hardcoded)
   - Export deck (JSON / text)
   - Works as ES Module + window fallback
============================ */

export const Decks = (() => {
  "use strict";

  const LS = {
    decks: "ygo_decks_v1",
    active: "ygo_decks_active_v1",
  };

  // -------------------------
  // Public API
  // -------------------------
  function listDecks() {
    const db = readDB_();
    return sortDecks_(Object.values(db.decks || {}));
  }

  function getDeck(deckId) {
    const db = readDB_();
    return clone_(db.decks?.[deckId] || null);
  }

  function getActiveDeckId() {
    try {
      return localStorage.getItem(LS.active) || "";
    } catch {
      return "";
    }
  }

  function setActiveDeck(deckId) {
    const db = readDB_();
    if (!db.decks?.[deckId]) return false;
    try {
      localStorage.setItem(LS.active, String(deckId));
    } catch {}
    return true;
  }

  function ensureActiveDeck() {
    // Si no hay activo, crea uno por defecto.
    const active = getActiveDeckId();
    if (active && getDeck(active)) return active;

    const decks = listDecks();
    if (decks.length) {
      setActiveDeck(decks[0].id);
      return decks[0].id;
    }

    const d = createDeck("Mi primer deck");
    setActiveDeck(d.id);
    return d.id;
  }

  function createDeck(name = "Nuevo deck") {
    const db = readDB_();
    const id = makeId_("deck");
    const now = Date.now();

    const deck = {
      id,
      name: String(name || "Nuevo deck").trim() || "Nuevo deck",
      createdAt: now,
      updatedAt: now,
      notes: "",
      // cards: { [cardId]: { qty, addedAt, updatedAt, meta } }
      cards: {},
    };

    db.decks[id] = deck;
    writeDB_(db);
    return clone_(deck);
  }

  function renameDeck(deckId, newName) {
    const db = readDB_();
    const deck = db.decks?.[deckId];
    if (!deck) return false;

    deck.name = String(newName || "").trim() || deck.name;
    deck.updatedAt = Date.now();
    writeDB_(db);
    return true;
  }

  function deleteDeck(deckId) {
    const db = readDB_();
    if (!db.decks?.[deckId]) return false;

    delete db.decks[deckId];
    writeDB_(db);

    // si borraste el activo, escoge otro
    const active = getActiveDeckId();
    if (active === deckId) {
      const left = sortDecks_(Object.values(db.decks));
      const next = left[0]?.id || "";
      try {
        if (next) localStorage.setItem(LS.active, next);
        else localStorage.removeItem(LS.active);
      } catch {}
    }

    return true;
  }

  function setDeckNotes(deckId, notes) {
    const db = readDB_();
    const deck = db.decks?.[deckId];
    if (!deck) return false;
    deck.notes = String(notes || "");
    deck.updatedAt = Date.now();
    writeDB_(db);
    return true;
  }

  /**
   * addCardToDeck(deckId, card, options)
   *
   * card: objeto con al menos:
   *   - _id (string)  ✅ (o id)
   *   - nombre/name (opcional pero útil)
   *   - mazo/set, categoria, tipo, etc (lo guardamos como meta light)
   *
   * options:
   *   - qty: number (default 1)
   *   - onDuplicate: async (ctx) => "increment"|"replace"|"cancel"
   *       ctx = { deck, cardId, cardMeta, existingQty, addQty }
   *
   * Devuelve:
   *   { ok, mode: "added"|"incremented"|"replaced"|"cancelled", deck }
   */
  async function addCardToDeck(deckId, card, options = {}) {
    const db = readDB_();
    const deck = db.decks?.[deckId];
    if (!deck) return { ok: false, error: "Deck no existe" };

    const cardId = extractCardId_(card);
    if (!cardId) return { ok: false, error: "Carta sin _id/id" };

    const addQty = clampQty_(options.qty ?? 1);
    if (addQty <= 0) return { ok: false, error: "Cantidad inválida" };

    const now = Date.now();
    const existing = deck.cards?.[cardId] || null;

    const meta = extractCardMeta_(card);

    if (!deck.cards) deck.cards = {};

    if (!existing) {
      deck.cards[cardId] = {
        qty: addQty,
        addedAt: now,
        updatedAt: now,
        meta,
      };
      deck.updatedAt = now;
      writeDB_(db);
      return { ok: true, mode: "added", deck: clone_(deck) };
    }

    // Ya existe: decidir qué hacer
    const existingQty = clampQty_(existing.qty ?? 0);
    const onDuplicate = typeof options.onDuplicate === "function" ? options.onDuplicate : null;

    let decision = "increment"; // default razonable: sumar
    if (onDuplicate) {
      try {
        decision = await onDuplicate({
          deck: clone_(deck),
          cardId,
          cardMeta: meta,
          existingQty,
          addQty,
        });
      } catch {
        decision = "increment";
      }
    }

    decision = String(decision || "").toLowerCase();

    if (decision === "cancel") {
      return { ok: true, mode: "cancelled", deck: clone_(deck) };
    }

    if (decision === "replace") {
      deck.cards[cardId] = {
        qty: addQty,
        addedAt: existing.addedAt || now,
        updatedAt: now,
        meta: mergeMeta_(existing.meta, meta),
      };
      deck.updatedAt = now;
      writeDB_(db);
      return { ok: true, mode: "replaced", deck: clone_(deck) };
    }

    // increment
    deck.cards[cardId] = {
      qty: clampQty_(existingQty + addQty),
      addedAt: existing.addedAt || now,
      updatedAt: now,
      meta: mergeMeta_(existing.meta, meta),
    };
    deck.updatedAt = now;
    writeDB_(db);
    return { ok: true, mode: "incremented", deck: clone_(deck) };
  }

  function removeCardFromDeck(deckId, cardId) {
    const db = readDB_();
    const deck = db.decks?.[deckId];
    if (!deck || !deck.cards?.[cardId]) return false;

    delete deck.cards[cardId];
    deck.updatedAt = Date.now();
    writeDB_(db);
    return true;
  }

  function setCardQty(deckId, cardId, qty) {
    const db = readDB_();
    const deck = db.decks?.[deckId];
    if (!deck || !deck.cards?.[cardId]) return false;

    const q = clampQty_(qty);
    if (q <= 0) {
      delete deck.cards[cardId];
    } else {
      deck.cards[cardId].qty = q;
      deck.cards[cardId].updatedAt = Date.now();
    }

    deck.updatedAt = Date.now();
    writeDB_(db);
    return true;
  }

  function clearDeck(deckId) {
    const db = readDB_();
    const deck = db.decks?.[deckId];
    if (!deck) return false;

    deck.cards = {};
    deck.updatedAt = Date.now();
    writeDB_(db);
    return true;
  }

  function getDeckCards(deckId) {
    const deck = getDeck(deckId);
    if (!deck) return [];
    const cards = deck.cards || {};
    return Object.entries(cards).map(([cardId, info]) => ({
      cardId,
      qty: clampQty_(info?.qty ?? 0),
      addedAt: info?.addedAt ?? null,
      updatedAt: info?.updatedAt ?? null,
      meta: info?.meta || {},
    }));
  }

  function getDeckStats(deckId) {
    // Stats básicos (sin ponerse a inventar reglas TCG)
    const deck = getDeck(deckId);
    if (!deck) return null;

    const items = getDeckCards(deckId);
    const totalCopies = items.reduce((acc, it) => acc + (it.qty || 0), 0);
    const uniqueCards = items.length;

    const byCategory = {};
    const byType = {};
    const byAttr = {};

    for (const it of items) {
      const meta = it.meta || {};
      const cat = (meta.categoria || "").trim() || "—";
      const type = (meta.tipo || "").trim() || "—";
      const attr = (meta.atributo || "").trim() || "—";

      byCategory[cat] = (byCategory[cat] || 0) + it.qty;
      byType[type] = (byType[type] || 0) + it.qty;
      byAttr[attr] = (byAttr[attr] || 0) + it.qty;
    }

    return {
      deckId: deck.id,
      name: deck.name,
      updatedAt: deck.updatedAt,
      totalCopies,
      uniqueCards,
      byCategory: sortObjDesc_(byCategory),
      byType: sortObjDesc_(byType),
      byAttr: sortObjDesc_(byAttr),
    };
  }

  function exportDeckJSON(deckId) {
    const deck = getDeck(deckId);
    if (!deck) return "";
    return JSON.stringify(deck, null, 2);
  }

  function exportDeckText(deckId, { includeMeta = true } = {}) {
    const deck = getDeck(deckId);
    if (!deck) return "";

    const items = getDeckCards(deckId)
      .sort((a, b) => {
        const an = (a.meta?.nombre || "").toLowerCase();
        const bn = (b.meta?.nombre || "").toLowerCase();
        return an.localeCompare(bn, undefined, { sensitivity: "base" });
      });

    const lines = [];
    lines.push(`# ${deck.name}`);
    lines.push(`Total copias: ${items.reduce((acc, it) => acc + it.qty, 0)} · Únicas: ${items.length}`);
    if (deck.notes) lines.push(`Notas: ${deck.notes}`);
    lines.push("");

    for (const it of items) {
      const n = it.meta?.nombre || it.cardId;
      const qty = it.qty || 0;
      if (!includeMeta) {
        lines.push(`${qty}x ${n}`);
      } else {
        const parts = [];
        if (it.meta?.mazo) parts.push(it.meta.mazo);
        if (it.meta?.categoria) parts.push(it.meta.categoria);
        if (it.meta?.tipo) parts.push(it.meta.tipo);
        const extra = parts.length ? ` (${parts.join(" · ")})` : "";
        lines.push(`${qty}x ${n}${extra}`);
      }
    }

    return lines.join("\n");
  }

  function importDeckJSON(jsonText, { setActive = false } = {}) {
    const parsed = safeJsonParse_(jsonText);
    if (!parsed || typeof parsed !== "object") return { ok: false, error: "JSON inválido" };

    const db = readDB_();
    const id = makeId_("deck");
    const now = Date.now();

    const deck = {
      id,
      name: String(parsed.name || "Deck importado").trim() || "Deck importado",
      createdAt: now,
      updatedAt: now,
      notes: String(parsed.notes || ""),
      cards: typeof parsed.cards === "object" && parsed.cards ? parsed.cards : {},
    };

    db.decks[id] = deck;
    writeDB_(db);

    if (setActive) setActiveDeck(id);
    return { ok: true, deck: clone_(deck) };
  }

  // -------------------------
  // Storage
  // -------------------------
  function readDB_() {
    try {
      const raw = localStorage.getItem(LS.decks);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") {
        if (!parsed.decks) parsed.decks = {};
        return parsed;
      }
    } catch {}
    return { decks: {} };
  }

  function writeDB_(db) {
    try {
      localStorage.setItem(LS.decks, JSON.stringify(db || { decks: {} }));
    } catch {
      // Si storage muere, pues... vive sin persistencia. Triste, pero humano.
    }
  }

  // -------------------------
  // Helpers
  // -------------------------
  function extractCardId_(card) {
    if (!card) return "";
    const id = String(card._id || card.id || "").trim();
    return id;
  }

  function extractCardMeta_(card) {
    // Guarda lo mínimo útil para mostrar, buscar, exportar
    const get = (k) => String(card?.[k] ?? "").trim();

    const meta = {
      nombre: get("nombre") || get("name"),
      mazo: get("mazo") || get("set") || get("setcode"),
      categoria: get("categoria") || get("category"),
      tipo: get("tipo") || get("type"),
      atributo: get("atributo") || get("attribute"),
      rareza: get("rareza") || get("rarity"),
      idioma: get("idioma") || get("language"),
      // por si luego quieres mostrar imagen en deck UI
      imagenurl: get("imagenurl") || get("imageurl") || get("image"),
    };

    // limpia llaves vacías para no llenar storage con humo
    Object.keys(meta).forEach((k) => {
      if (!meta[k]) delete meta[k];
    });

    return meta;
  }

  function mergeMeta_(oldMeta, newMeta) {
    const a = oldMeta && typeof oldMeta === "object" ? oldMeta : {};
    const b = newMeta && typeof newMeta === "object" ? newMeta : {};
    // preferimos valores nuevos si existen
    return { ...a, ...b };
  }

  function clampQty_(q) {
    const n = Number(String(q).replace(",", "."));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  }

  function makeId_(prefix) {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 8);
    return `${prefix || "id"}_${t}_${r}`;
  }

  function safeJsonParse_(txt) {
    try {
      return JSON.parse(String(txt || ""));
    } catch {
      return null;
    }
  }

  function clone_(obj) {
    try {
      return obj ? JSON.parse(JSON.stringify(obj)) : obj;
    } catch {
      return obj;
    }
  }

  function sortDecks_(arr) {
    return (arr || []).slice().sort((a, b) => {
      const au = a?.updatedAt ?? 0;
      const bu = b?.updatedAt ?? 0;
      return bu - au; // más recientes arriba
    });
  }

  function sortObjDesc_(obj) {
    const entries = Object.entries(obj || {}).sort((a, b) => (b[1] || 0) - (a[1] || 0));
    const out = {};
    for (const [k, v] of entries) out[k] = v;
    return out;
  }

  // -------------------------
  // Exposed
  // -------------------------
  return {
    listDecks,
    getDeck,
    getActiveDeckId,
    setActiveDeck,
    ensureActiveDeck,

    createDeck,
    renameDeck,
    deleteDeck,
    setDeckNotes,

    addCardToDeck,
    removeCardFromDeck,
    setCardQty,
    clearDeck,

    getDeckCards,
    getDeckStats,

    exportDeckJSON,
    exportDeckText,
    importDeckJSON,
  };
})();

// Fallback para proyectos sin import/export (scripts normales)
try {
  if (typeof window !== "undefined") window.Decks = Decks;
} catch {}