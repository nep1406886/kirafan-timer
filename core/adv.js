// Bilingual dialogue engine.
//
// All four games need to put words on screen: B is nothing but this, A needs
// pre-battle exchanges, C needs the 図書館 framing, D needs residents talking.
// So this owns script interpretation, the text box, auto/skip, and choices --
// and nothing else.
//
// It deliberately does NOT own the visuals. Characters in this project are 3D
// models with a layer-based facial system (core/actor.js), backgrounds are
// adv/background images, and the town has neither. A stage adapter supplies
// those, so the same script runs against a 3D stage, a flat-image stage, or a
// text-only one in a test.
//
// Script format -- an array of commands, each an object. A command with `ja`
// or `zh` is a line; everything else is staging:
//
//   { speaker: "arcive", face: "calm", ja: "…", zh: "…", voice: "cue" }
//   { speaker: null, ja: "…", zh: "…" }          narration (no name plate)
//   { bg: "library", transition: "fade", ms: 900 }
//   { enter: "lamp", at: "left", face: "surprised", ms: 600 }
//   { exit: "lamp", ms: 400 }  |  { exit: "*" }   everyone
//   { face: "lamp", to: "excited" }               change face without a line
//   { turn: "kirara", to: "away" | "camera" }
//   { focus: "book" }                             prop close-up
//   { bgm: "bgm_adv_19_0", fade: 1200 }  |  { bgm: null }  stop
//   { se: "footsteps" }
//   { title: { ja:"…", zh:"…" }, kind: "title" | "chapter" }
//   { wait: 900 }                                 a beat of silence
//   { label: "afterChoice" }
//   { goto: "afterChoice" }
//   { choice: [ { ja:"…", zh:"…", goto:"…", set:{flag:true} } ] }
//   { if: "flagName", goto: "…" }                 branch on a flag
//   { set: { flagName: true } }
//   { call: function (ctx) { … } }                escape hatch for game code
//
// Names are never written into a script: `speaker` is a cast id, and the cast
// table supplies the bilingual display name. That way one line reads correctly
// in zh, ja and both modes without three copies of the script.

import * as i18n from "./i18n.js";

const DEFAULT_CPS = 45;             // characters per second for the typewriter
const DEFAULT_AUTO_HOLD_MS = 1400;  // pause after a line finishes, in auto mode
const MIN_AUTO_HOLD_MS = 600;

// A no-op stage, so a script can run (and be tested) with no visuals at all.
const NULL_STAGE = {
    background: function () { return Promise.resolve(); },
    enter: function () { return Promise.resolve(); },
    exit: function () { return Promise.resolve(); },
    face: function () {},
    turn: function () {},
    focus: function () { return Promise.resolve(); },
    title: function () { return Promise.resolve(); },
    speak: function () {},
    bgm: function () {},
    se: function () {}
};

// --- script indexing ----------------------------------------------------

function indexLabels(script) {
    const labels = new Map();
    script.forEach(function (command, i) {
        if (command && command.label) {
            labels.set(command.label, i);
        }
    });
    return labels;
}

function isLine(command) {
    return Boolean(command && (command.ja !== undefined || command.zh !== undefined));
}

// --- the player ---------------------------------------------------------

// run(script, options) -> Promise<context>
//   options.stage    stage adapter (see NULL_STAGE for the shape)
//   options.view     DOM adapter: { line, name, choices, advance }
//   options.cast     { <id>: { ja, zh, actor? } }
//   options.flags    initial flag object; mutated in place and returned
//   options.cps      typewriter speed, 0 to disable
//   options.auto     start in auto-advance mode
//   options.onLine   called with (command, index) as each line starts
export function run(script, options) {
    const opts = options || {};
    const stage = opts.stage || NULL_STAGE;
    const view = opts.view || null;
    const cast = opts.cast || {};
    const flags = opts.flags || {};
    const labels = indexLabels(script);
    const cps = opts.cps === undefined ? DEFAULT_CPS : opts.cps;

    const context = {
        flags: flags,
        script: script,
        index: 0,
        auto: Boolean(opts.auto),
        skipping: false,
        done: false
    };

    // One pending resolver at a time: whatever the engine is waiting for
    // (a click, a timer, a choice) is stored here so advance() and skip() can
    // both release it without knowing which it was.
    let release = null;
    let cancelled = false;

    function waitFor(makeCanceller) {
        return new Promise(function (resolve) {
            let cancel = null;
            release = function () {
                if (cancel) {
                    cancel();
                }
                release = null;
                resolve();
            };
            cancel = makeCanceller ? makeCanceller(release) : null;
        });
    }

    function sleep(ms) {
        if (context.skipping || ms <= 0) {
            return Promise.resolve();
        }
        return waitFor(function (done) {
            const timer = setTimeout(done, ms);
            return function () { clearTimeout(timer); };
        });
    }

    // Wait for the player, or for the auto-advance timer, whichever comes
    // first. In skip mode neither is waited for.
    function waitForAdvance(holdMs) {
        if (context.skipping) {
            return Promise.resolve();
        }
        if (!view || !view.advance) {
            return sleep(context.auto ? holdMs : 0);
        }
        return waitFor(function (done) {
            const detach = view.advance(done);
            let timer = null;
            if (context.auto) {
                timer = setTimeout(done, holdMs);
            }
            return function () {
                if (detach) {
                    detach();
                }
                if (timer) {
                    clearTimeout(timer);
                }
            };
        });
    }

    // Reveal a line character by character. The two halves of `both` mode are
    // typed together on one clock so they finish at the same moment rather than
    // the Chinese lagging behind a longer Japanese line.
    function typeLine(parts, holdMs) {
        if (!view || !view.line) {
            return sleep(holdMs);
        }
        const longest = Math.max(
            parts.primary ? parts.primary.length : 0,
            parts.secondary ? parts.secondary.length : 0
        );
        if (!cps || context.skipping || longest === 0) {
            view.line(parts.primary, parts.secondary, true);
            return Promise.resolve();
        }
        const total = (longest / cps) * 1000;
        return waitFor(function (done) {
            const started = performance.now();
            let frame = 0;
            let detach = null;
            function step() {
                const fraction = Math.min(1, (performance.now() - started) / total);
                const cut = function (text) {
                    return text ? text.slice(0, Math.ceil(text.length * fraction)) : "";
                };
                view.line(cut(parts.primary), cut(parts.secondary), fraction >= 1);
                if (fraction >= 1) {
                    done();
                    return;
                }
                frame = requestAnimationFrame(step);
            }
            // A click during the typewriter completes the line instead of
            // advancing past it -- the standard ADV contract, and the reason
            // this resolves the same promise the advance wait would.
            if (view.advance) {
                detach = view.advance(function () {
                    view.line(parts.primary, parts.secondary, true);
                    done();
                });
            }
            frame = requestAnimationFrame(step);
            return function () {
                cancelAnimationFrame(frame);
                if (detach) {
                    detach();
                }
            };
        }).then(function () {
            // The line is fully shown; now wait for the player to move on.
            view.line(parts.primary, parts.secondary, true);
            return waitForAdvance(holdMs);
        });
    }

    function speakerName(id) {
        if (!id) {
            return null;
        }
        const entry = cast[id];
        return entry ? i18n.resolve(entry) : { primary: id, secondary: null };
    }

    function autoHold(parts) {
        const length = Math.max(
            parts.primary ? parts.primary.length : 0,
            parts.secondary ? parts.secondary.length : 0
        );
        // Longer lines need longer to read, so the hold scales with length
        // rather than being a flat pause that rushes the long ones.
        return Math.max(MIN_AUTO_HOLD_MS, DEFAULT_AUTO_HOLD_MS + length * 28);
    }

    function step(command) {
        if (isLine(command)) {
            const parts = i18n.resolve(command);
            const name = speakerName(command.speaker);
            if (view && view.name) {
                view.name(name ? name.primary : null, name ? name.secondary : null);
            }
            if (command.speaker && command.face) {
                stage.face(command.speaker, command.face);
            }
            stage.speak(command.speaker || null, command);
            if (opts.onLine) {
                opts.onLine(command, context.index);
            }
            return typeLine(parts, autoHold(parts));
        }

        if (command.bg !== undefined) {
            return Promise.resolve(stage.background(command.bg, command));
        }
        if (command.enter !== undefined) {
            return Promise.resolve(stage.enter(command.enter, command));
        }
        if (command.exit !== undefined) {
            return Promise.resolve(stage.exit(command.exit, command));
        }
        if (command.face !== undefined && command.to !== undefined) {
            stage.face(command.face, command.to);
            return Promise.resolve();
        }
        if (command.turn !== undefined) {
            stage.turn(command.turn, command.to || "camera");
            return Promise.resolve();
        }
        if (command.focus !== undefined) {
            return Promise.resolve(stage.focus(command.focus, command));
        }
        if (command.bgm !== undefined) {
            stage.bgm(command.bgm, command);
            return Promise.resolve();
        }
        if (command.se !== undefined) {
            stage.se(command.se, command);
            return Promise.resolve();
        }
        if (command.title !== undefined) {
            // A title card is a beat, so it is waited for even in auto mode --
            // but skip still blows through it.
            return Promise.resolve(stage.title(i18n.resolve(command.title), command))
                .then(function () { return sleep(command.ms || 1600); });
        }
        if (command.wait !== undefined) {
            return sleep(command.wait);
        }
        if (command.choice !== undefined) {
            return offerChoice(command);
        }
        if (command["if"] !== undefined) {
            if (flags[command["if"]] && labels.has(command.goto)) {
                context.index = labels.get(command.goto);
            }
            return Promise.resolve();
        }
        if (command.goto !== undefined) {
            if (labels.has(command.goto)) {
                context.index = labels.get(command.goto);
            } else {
                console.warn("adv: goto unknown label", command.goto);
            }
            return Promise.resolve();
        }
        if (command.set !== undefined) {
            Object.assign(flags, command.set);
            return Promise.resolve();
        }
        if (command.call !== undefined) {
            return Promise.resolve(command.call(context));
        }
        // `label` and anything unrecognised fall through: a label is a marker,
        // and an unknown key is more likely a future command than a bug worth
        // stopping a chapter for.
        return Promise.resolve();
    }

    // A choice is the one place skip has to stop: skipping past a branch would
    // silently pick the first option.
    function offerChoice(command) {
        context.skipping = false;
        // Keep the stage in step, or every fade after a branch would stay cut.
        if ("skipping" in stage) {
            stage.skipping = false;
        }
        const options = command.choice.map(function (option) {
            return { parts: i18n.resolve(option), option: option };
        });
        if (!view || !view.choices) {
            // Headless: take the first option so a script still completes.
            return applyChoice(command.choice[0]);
        }
        return new Promise(function (resolve) {
            release = null;
            view.choices(options, function (picked) {
                view.choices([], null);
                resolve(applyChoice(command.choice[picked]));
            });
        });
    }

    function applyChoice(option) {
        if (!option) {
            return Promise.resolve();
        }
        if (option.set) {
            Object.assign(flags, option.set);
        }
        if (option.goto !== undefined) {
            if (labels.has(option.goto)) {
                context.index = labels.get(option.goto);
            } else {
                console.warn("adv: choice goto unknown label", option.goto);
            }
        }
        return Promise.resolve();
    }

    function loop() {
        if (cancelled || context.index >= script.length) {
            context.done = true;
            if (view && view.line) {
                view.line("", null, true);
            }
            if (view && view.name) {
                view.name(null, null);
            }
            return context;
        }
        const command = script[context.index];
        // Advanced before running, so a goto inside step() overrides it rather
        // than being undone by an increment afterwards.
        const at = context.index;
        context.index = at + 1;
        return Promise.resolve(step(command || {})).then(loop);
    }

    // Controls handed back to the game. `finished` is the promise the caller
    // awaits; the rest are for the UI's buttons.
    const controller = {
        context: context,
        get index() { return context.index; },
        get done() { return context.done; },

        // Release whatever is being waited for -- click to advance, or to
        // finish a typing line.
        advance: function () {
            if (release) {
                release();
            } else if (stage.cut) {
                // Nothing here is waiting, so the click landed during a wait the
                // stage owns: a background fade or a title card. Cut it to its
                // end state, which is what a reader tapping through a slow fade
                // is asking for.
                stage.cut();
            }
            return controller;
        },

        setAuto: function (on) {
            context.auto = Boolean(on);
            // Turning auto on mid-line should not wait for the next line to
            // take effect.
            if (context.auto && release) {
                release();
            }
            return controller;
        },

        // Run without waiting until `stop` is called or a choice is reached.
        skip: function (on) {
            context.skipping = on === undefined ? true : Boolean(on);
            // The stage owns its own timed waits, so it needs the flag too --
            // otherwise skip races through the dialogue and then stalls three
            // seconds on the next background fade.
            if ("skipping" in stage) {
                stage.skipping = context.skipping;
            }
            if (context.skipping) {
                if (release) {
                    release();
                }
                if (stage.cut) {
                    stage.cut();
                }
            }
            return controller;
        },

        cancel: function () {
            cancelled = true;
            if (release) {
                release();
            }
            return controller;
        },

        finished: null
    };

    controller.finished = Promise.resolve().then(loop);
    return controller;
}

// --- DOM view -----------------------------------------------------------

// The standard text box, so four games do not each write one. Expects the
// markup this creates; a game wanting a different look can pass its own view
// object to run() instead.
export function createView(container) {
    const box = document.createElement("div");
    box.className = "adv-box";
    box.innerHTML =
        '<div class="adv-name"><span class="adv-name-primary"></span>'
        + '<span class="adv-name-secondary"></span></div>'
        + '<div class="adv-text"><p class="adv-primary"></p><p class="adv-secondary"></p></div>'
        + '<div class="adv-choices" hidden></div>'
        + '<div class="adv-next" hidden>▼</div>';
    container.appendChild(box);

    const nameRow = box.querySelector(".adv-name");
    const namePrimary = box.querySelector(".adv-name-primary");
    const nameSecondary = box.querySelector(".adv-name-secondary");
    const primary = box.querySelector(".adv-primary");
    const secondary = box.querySelector(".adv-secondary");
    const choicesBox = box.querySelector(".adv-choices");
    const next = box.querySelector(".adv-next");

    return {
        element: box,

        line: function (primaryText, secondaryText, complete) {
            primary.textContent = primaryText || "";
            secondary.textContent = secondaryText || "";
            secondary.hidden = !secondaryText;
            next.hidden = !complete || Boolean(primaryText) === false;
        },

        name: function (primaryName, secondaryName) {
            namePrimary.textContent = primaryName || "";
            nameSecondary.textContent = secondaryName || "";
            nameSecondary.hidden = !secondaryName;
            nameRow.hidden = !primaryName;
        },

        // Returns a detach function, because the engine attaches and detaches
        // this listener once per line.
        advance: function (handler) {
            function onClick(event) {
                // A click on a choice button must not also advance the line.
                if (event.target.closest && event.target.closest(".adv-choices")) {
                    return;
                }
                handler();
            }
            function onKey(event) {
                if (event.code === "Space" || event.code === "Enter") {
                    event.preventDefault();
                    handler();
                }
            }
            container.addEventListener("click", onClick);
            window.addEventListener("keydown", onKey);
            return function () {
                container.removeEventListener("click", onClick);
                window.removeEventListener("keydown", onKey);
            };
        },

        choices: function (options, onPick) {
            choicesBox.innerHTML = "";
            choicesBox.hidden = !options.length;
            options.forEach(function (entry, index) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "adv-choice";
                button.innerHTML = '<span class="adv-choice-primary"></span>'
                    + '<span class="adv-choice-secondary"></span>';
                button.querySelector(".adv-choice-primary").textContent = entry.parts.primary;
                const sub = button.querySelector(".adv-choice-secondary");
                sub.textContent = entry.parts.secondary || "";
                sub.hidden = !entry.parts.secondary;
                button.addEventListener("click", function (event) {
                    event.stopPropagation();
                    onPick(index);
                });
                choicesBox.appendChild(button);
            });
        }
    };
}

// --- script validation --------------------------------------------------

// Every expression name a script may ask for.
//
// The game's own ten come first (core/actor.js GAME_EXPRESSIONS) and are safe on
// any character, because both renderers fall back through a shared chain when a
// model or a standpic cannot make one. The rest are ours, and are only as good as
// the cast map behind them -- a 3D character resolves them by inference, a
// standpic falls back to the nearest official name.
//
// Listed here rather than imported so validate() stays usable without loading a
// renderer: the check is a spelling check, and it is the whole reason a typo like
// "smilee" gets reported instead of silently rendering the resting face.
const FACE_NAMES = [
    "default", "angry", "happy", "joy", "shy", "sorrow", "surprise",
    "unique1", "unique2", "unique3",
    "talk", "serious", "blank", "cry", "shout", "blink", "abnormal", "hurt"
];

// Modifier suffixes: "happy-tired" is happy, one notch weaker.
const FACE_MODIFIERS = ["slight", "tired", "weak", "faint", "small"];

function faceNameProblem(value) {
    if (typeof value === "number") {
        return null;              // a raw state index, the escape hatch
    }
    const parts = String(value).toLowerCase().split("-");
    if (FACE_NAMES.indexOf(parts[0]) < 0) {
        return "unknown expression -- " + value;
    }
    for (let i = 1; i < parts.length; i++) {
        if (FACE_MODIFIERS.indexOf(parts[i]) < 0) {
            return "unknown expression modifier -- " + parts[i];
        }
    }
    return null;
}

// Catches the mistakes that are silent at runtime: a goto with no label, a
// speaker with no cast entry, a line missing one language, a misspelt expression.
// Worth running over every chapter in a check rather than discovering it three
// chapters in.
export function validate(script, cast) {
    const labels = indexLabels(script);
    const problems = [];
    const known = cast || {};
    script.forEach(function (command, i) {
        if (!command) {
            problems.push(i + ": empty command");
            return;
        }
        if (isLine(command)) {
            if (!command.ja) {
                problems.push(i + ": line missing ja");
            }
            if (!command.zh) {
                problems.push(i + ": line missing zh");
            }
            if (command.speaker && !known[command.speaker]) {
                problems.push(i + ": speaker not in cast -- " + command.speaker);
            }
        }
        const targets = [];
        if (command.goto !== undefined && command["if"] === undefined) {
            targets.push(command.goto);
        }
        if (command["if"] !== undefined) {
            targets.push(command.goto);
        }
        (command.choice || []).forEach(function (option) {
            if (option.goto !== undefined) {
                targets.push(option.goto);
            }
            if (!option.ja || !option.zh) {
                problems.push(i + ": choice missing a language");
            }
        });
        targets.forEach(function (target) {
            if (target !== undefined && !labels.has(target)) {
                problems.push(i + ": goto unknown label -- " + target);
            }
        });
        // Which keys name a character depends on which command this is, because
        // several keys do double duty: `turn` is a cast id on its own but a
        // direction when it rides along on an `enter`, and `face` is a cast id
        // paired with `to` but an expression when it rides along on a line or an
        // `enter`. Checked in the same order step() dispatches, so validate()
        // reads a command the way the engine will run it.
        let idKeys = [];
        if (command.enter !== undefined) {
            idKeys = ["enter"];
        } else if (command.exit !== undefined) {
            idKeys = ["exit"];
        } else if (command.face !== undefined && command.to !== undefined) {
            idKeys = ["face"];
        } else if (command.turn !== undefined) {
            idKeys = ["turn"];
        } else if (command.focus !== undefined) {
            // focus also accepts a prop or a shot name, so an unknown value is
            // not an error -- the stage degrades it to a push-in.
            idKeys = [];
        }
        idKeys.forEach(function (key) {
            const id = command[key];
            if (id && id !== "*" && !known[id]) {
                problems.push(i + ": " + key + " unknown cast id -- " + id);
            }
        });

        // Expression names, from wherever this command carries one: `to` on a
        // standalone face command, `face` everywhere else (a line, an enter).
        const faceValue = idKeys[0] === "face" ? command.to : command.face;
        if (faceValue !== undefined && faceValue !== null) {
            const bad = faceNameProblem(faceValue);
            if (bad) {
                problems.push(i + ": " + bad);
            }
        }
    });
    return problems;
}
