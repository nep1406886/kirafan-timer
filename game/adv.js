// 序章 player: wires core/adv.js to core/advstage.js and runs asset/story.
//
// Everything specific to *this* chapter lives in the script data. What is here
// is the shell any chapter needs: preload, the render loop, language and
// auto/skip controls, and saving how far the reader got.

import * as adv from "../core/adv.js";
import * as advstage from "../core/advstage.js";
import * as audio from "../core/audio.js";
import * as i18n from "../core/i18n.js";
import * as save from "../core/save.js";
import { CAST } from "../asset/story/cast.js";
import { PROLOGUE, META } from "../asset/story/prologue.js";

const canvas = document.getElementById("canvas");
const overlay = document.getElementById("overlay");
const gate = document.getElementById("gate");
const startButton = document.getElementById("start");
const statusLine = document.getElementById("status");
const langButton = document.getElementById("lang");
const autoButton = document.getElementById("auto");
const skipButton = document.getElementById("skip");

let stage = null;
let view = null;
let player = null;
let last = 0;

function setStatus(text) {
    statusLine.textContent = text;
}

// --- progress -----------------------------------------------------------
//
// Story flags live under their own key rather than beside the bookkeeping.
// They used to share one object, which meant a script flag called `done`,
// `chapter` or `line` would quietly collide with the engine's own -- and
// `{ if: "done" }` would then read the "chapter finished" marker instead of
// whatever the writer meant. validate() cannot catch that, because both names
// are legal. Separating them costs one level of nesting and removes the class.

const PROGRESS_KEYS = ["chapter", "line", "done", "flags"];

function storedFlags() {
    const stored = save.get("adv") || {};
    if (stored.flags) {
        return Object.assign({}, stored.flags);
    }
    // A save written before the split: everything that is not bookkeeping was a
    // story flag. Recovered rather than dropped, so a reader who is mid-chapter
    // keeps the choices they already made.
    const flags = {};
    Object.keys(stored).forEach(function (key) {
        if (PROGRESS_KEYS.indexOf(key) === -1) {
            flags[key] = stored[key];
        }
    });
    return flags;
}

function saveProgress(index, finished) {
    save.set("adv", {
        chapter: META.id,
        line: index,
        done: Boolean(finished),
        flags: player ? Object.assign({}, player.context.flags) : {}
    });
}

// Validate before playing. A goto with no label or a line missing a language is
// silent at runtime -- the reader just sees the wrong thing -- so it is caught
// here where it can be printed.
function check() {
    const problems = adv.validate(PROLOGUE, CAST);
    if (problems.length) {
        console.warn("prologue script problems:\n" + problems.join("\n"));
        setStatus("剧本有 " + problems.length + " 处问题，见 console");
        return false;
    }
    return true;
}

function loop(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (stage) {
        stage.update(dt);
        stage.render();
    }
    requestAnimationFrame(loop);
}

function boot() {
    check();
    stage = advstage.create({ canvas: canvas, overlay: overlay, cast: CAST });
    return stage.init().then(function () {
        window.addEventListener("resize", function () { stage.resize(); });
        // Warm the three models the prologue needs before the first line, so a
        // portrait does not pop in three lines late. マッチ has no model, so
        // she is not in this list and costs nothing.
        setStatus("角色を読み込み中…");
        return Promise.all(META.cast.map(function (id) {
            if (!CAST[id] || !CAST[id].model) {
                return Promise.resolve();
            }
            // Loading via enter() at zero opacity puts the model in the scene
            // and immediately fades it out, which is also what warms the
            // shaders -- a first-frame compile stall on a portrait fade is
            // visible, and doing it behind the gate is free.
            return stage.enter(id, { at: "center", ms: 0 })
                .then(function () { return stage.exit(id, { ms: 0 }); });
        }));
    }).then(function () {
        setStatus("");
        startButton.disabled = false;
        startButton.textContent = "読みはじめる";
        requestAnimationFrame(loop);
    }).catch(function (error) {
        console.error(error);
        setStatus("読み込みに失敗しました: " + error.message);
    });
}

function start() {
    // Must be inside the click handler: this is the gesture that unlocks audio.
    audio.unlock();
    // Anything the stage queued while audio was locked can sound now.
    if (stage.flushSe) { stage.flushSe(); }
    gate.remove();

    view = adv.createView(document.getElementById("ui"));
    player = adv.run(PROLOGUE, {
        stage: stage,
        view: view,
        cast: CAST,
        flags: storedFlags(),
        onLine: function (command, index) {
            // Progress is stored per line index, so a reader who closes the tab
            // mid-chapter is not sent back to the beginning.
            saveProgress(index, false);
        }
    });

    player.finished.then(function () {
        saveProgress(PROLOGUE.length, true);
        // Tell the shared store, not just this chapter's own slot: the tower
        // draws its questions from chapters cleared here, and the town lights
        // buildings from the same list.
        save.clearChapter(META.id);
        // 序章 完. The hub is where a finished chapter hands back to.
        const end = document.createElement("div");
        end.id = "gate";
        end.innerHTML = '<h1>序章 完</h1>'
            + '<p>読み手さんは——どこまで、覚えていますか。</p>';
        const link = document.createElement("button");
        link.id = "start";
        link.type = "button";
        link.textContent = "もう一度読む";
        link.addEventListener("click", function () { location.reload(); });
        end.appendChild(link);
        document.body.appendChild(end);
    });
}

// --- controls -----------------------------------------------------------

const MODES = ["both", "ja", "zh"];

// Read from i18n rather than written into the HTML: the mode is remembered across
// visits, so a hardcoded label is wrong for everyone on their second reading.
function showLanguage() {
    langButton.textContent = "言語 " + i18n.getMode();
}
showLanguage();

function cycleLanguage() {
    const next = MODES[(MODES.indexOf(i18n.getMode()) + 1) % MODES.length];
    i18n.setMode(next);
    showLanguage();
    // The line on screen was resolved in the old mode, so it has to be redrawn.
    // Nudging the player re-renders the current line rather than advancing past
    // it, because a language switch is not a click to continue.
    if (player) {
        player.advance();
    }
}

langButton.addEventListener("click", cycleLanguage);

autoButton.addEventListener("click", function () {
    if (!player) { return; }
    const next = !player.context.auto;
    player.setAuto(next);
    autoButton.setAttribute("aria-pressed", String(next));
});

skipButton.addEventListener("click", function () {
    if (!player) { return; }
    // Held, not toggled: skip runs until the next choice, which is where a
    // reader has to make a decision anyway.
    player.skip(true);
    setTimeout(function () { player.skip(false); }, 60);
});

startButton.addEventListener("click", start);

// Exposed so a headless check can drive the scene: a backgrounded tab never
// fires requestAnimationFrame, so the loop above cannot be relied on there.
window.kirafanAdv = {
    get stage() { return stage; },
    get player() { return player; },
    get script() { return PROLOGUE; },
    validate: function () { return adv.validate(PROLOGUE, CAST); },
    step: function (dt) {
        if (stage) { stage.update(dt === undefined ? 1 / 60 : dt); }
    },
    renderOnce: function () { if (stage) { stage.render(); } },
    // Jump straight to a line, for checking a beat without reading to it.
    seek: function (index) {
        if (player) { player.context.index = index; player.advance(); }
    },
    start: start
};

boot();
