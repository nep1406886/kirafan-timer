// Shared save state for the fan-game layer.
//
// One localStorage key holds all four games so the 図書館 hub can read across
// them: chapters cleared in the ADV feed the tower's question pool, characters
// recovered in the tower join the RPG's roster, chapters cleared in the RPG
// light up buildings in the town.

const STORAGE_KEY = "kirafan-fangame:save";
const VERSION = 1;

function blank() {
    return {
        version: VERSION,
        // Characters whose page has been read back -- the cross-game currency.
        // Card ids.
        recovered: [],
        // Chapter ids cleared in the ADV.
        chapters: [],
        rpg: {},
        adv: {},
        tower: {},
        town: {}
    };
}

let cache = null;

function read() {
    if (cache) {
        return cache;
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        cache = raw ? JSON.parse(raw) : blank();
    } catch (error) {
        cache = blank();
    }
    if (cache.version !== VERSION) {
        // No migrations to run yet; a future bump handles it here rather than
        // silently discarding a player's progress.
        cache.version = VERSION;
    }
    return cache;
}

function flush() {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(read()));
    } catch (error) {
        console.warn("save failed", error);
    }
}

export function get(scope) {
    const store = read();
    return scope ? (store[scope] || {}) : store;
}

export function set(scope, value) {
    const store = read();
    store[scope] = value;
    flush();
}

export function patch(scope, changes) {
    const store = read();
    store[scope] = Object.assign({}, store[scope] || {}, changes);
    flush();
}

// --- cross-game state ------------------------------------------------------

export function recover(cardId) {
    const store = read();
    const id = Number(cardId);
    if (store.recovered.indexOf(id) === -1) {
        store.recovered.push(id);
        flush();
    }
}

export function isRecovered(cardId) {
    return read().recovered.indexOf(Number(cardId)) !== -1;
}

export function recoveredIds() {
    return read().recovered.slice();
}

export function clearChapter(chapterId) {
    const store = read();
    if (store.chapters.indexOf(chapterId) === -1) {
        store.chapters.push(chapterId);
        flush();
    }
}

export function isChapterCleared(chapterId) {
    return read().chapters.indexOf(chapterId) !== -1;
}

export function reset() {
    cache = blank();
    flush();
}
