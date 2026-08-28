// The 3D stage an ADV script plays on.
//
// core/adv.js reads scripts and knows nothing about rendering; this is the other
// half. It answers the staging commands -- background, enter, exit, face, turn,
// focus, title -- against a three.js scene where each character is the same
// model the battle screen uses (決策 4 ①「3D 模型当立绘」), so an expression
// change is the real facial-layer system rather than a swapped image.
//
// Why 3D rather than the game's own standpic images: the conversion has 685
// models with 15 expressions each and full skeletons, and an ADV line can then
// have someone turn away, breathe, or blink while talking. Characters the
// original never modelled (マッチ) still fall back to a flat slot, because the
// original does the same thing with them.
//
// Cameras: an ADV shot is a chest-up framing, so the stage uses a narrow FOV
// pulled back rather than a wide one up close -- a wide lens at portrait
// distance distorts a face badly, and these faces are the whole point.

import * as loader from "./loader.js";
import * as actorModule from "./actor.js";
import * as audio from "./audio.js";
import { CAST, SLOTS } from "../asset/story/cast.js";

const BG_ROOT = "../asset/story/background/";
const STANDPIC_ROOT = "../asset/story/standpic/";
const STANDPIC_INDEX = "../asset/story/standpic-index.json";

// A full-height ADV portrait after conversion, and the share of the frame one
// fills. tools/convert_standpic.py caps output at 760px, so a character shorter
// than that in the source is meant to be shorter on screen too.
const STANDPIC_FULL_HEIGHT = 760;
const STANDPIC_FRAME_HEIGHT = 62;   // matches .adv-flat's height in the page CSS

// A 28mm-equivalent look would bend the faces; 30° vertical at ~4.6 units reads
// like a portrait lens and keeps three people in frame at the widths in SLOTS.
const FOV = 30;
const CAMERA_HEIGHT = 1.28;      // eye level for a ~1.4-unit-tall character
const CAMERA_DISTANCE = 4.6;
const LOOK_HEIGHT = 1.16;

// Framings the `focus` command selects. A close-up is the same camera moved,
// not a second camera, so a cut is always a move and never a jump.
const SHOTS = {
    // name:        [distance, height, lookHeight, fov]
    normal: [CAMERA_DISTANCE, CAMERA_HEIGHT, LOOK_HEIGHT, FOV],
    wide: [7.4, 1.55, 1.05, 34],
    close: [2.9, 1.3, 1.26, 26]
};

const IDLE_ACTION = "idle";

function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// create(options) -> stage
//   options.canvas     the canvas to render into
//   options.overlay    a DOM element for backgrounds, titles and flat slots
//   options.cast       cast table (defaults to asset/story/cast.js)
export function create(options) {
    const opts = options || {};
    const cast = opts.cast || CAST;
    const overlay = opts.overlay || null;

    let modules = null;
    let renderer = null;
    let scene = null;
    let camera = null;
    let clock = 0;
    let disposed = false;
    // Filled by init(); an empty index means "ask for the file and see".
    let standpicIndex = { characters: {} };

    // Everyone currently on stage, by cast id.
    const present = new Map();
    // Loads in flight, so a script that enters the same character twice does
    // not download the model twice.
    const loading = new Map();

    let shot = "normal";
    let shotFrom = SHOTS.normal.slice();
    let shotTo = SHOTS.normal.slice();
    let shotProgress = 1;
    let shotDuration = 1;

    // Skip has to reach in here, not just into the script runner. A 3.2s
    // background fade and a title card's hold are both waits the stage owns, so
    // without this the runner would blow through the dialogue and then sit for
    // three seconds on the fade -- which reads as a freeze, not as skipping.
    // The runner mirrors its own flag onto `skipping` and calls cut() when the
    // reader clicks; every timed wait below checks both.
    let skipping = false;
    // Finishers for the waits currently in flight, so cut() can land them on
    // their end state instead of leaving a half-faded layer behind.
    const pendingCuts = new Set();

    // A wait that can be cut short. `settle` applies the finished state and is
    // called exactly once, whether the timer ran out or the reader skipped.
    function timed(ms, settle) {
        if (skipping || ms <= 0) {
            settle();
            return Promise.resolve();
        }
        return new Promise(function (resolve) {
            let finished = false;
            const done = function () {
                if (finished) {
                    return;
                }
                finished = true;
                clearTimeout(timer);
                pendingCuts.delete(done);
                settle();
                resolve();
            };
            const timer = setTimeout(done, ms);
            pendingCuts.add(done);
        });
    }

    const layers = overlay ? buildOverlay(overlay) : null;

    function buildOverlay(root) {
        root.classList.add("adv-stage-overlay");
        const bg = document.createElement("div");
        bg.className = "adv-bg";
        const bgNext = document.createElement("div");
        bgNext.className = "adv-bg adv-bg-next";
        const flats = document.createElement("div");
        flats.className = "adv-flats";
        const title = document.createElement("div");
        title.className = "adv-title";
        title.hidden = true;
        title.innerHTML = '<div class="adv-title-primary"></div>'
            + '<div class="adv-title-secondary"></div>';
        // Order matters: backgrounds behind, flat characters over them, the
        // title card over everything. The 3D canvas sits between flats and
        // title via CSS z-index, so a flat character cannot cover a 3D one.
        root.appendChild(bg);
        root.appendChild(bgNext);
        root.appendChild(flats);
        root.appendChild(title);
        return { bg: bg, bgNext: bgNext, flats: flats, title: title };
    }

    // Which standpic expressions each character has on disk. Fetched once, and a
    // failure is not fatal: without the index the flat renderer just asks for the
    // file it wants and lets a 404 fall back to the name placeholder.
    function loadStandpicIndex() {
        return fetch(STANDPIC_INDEX)
            .then(function (response) {
                return response.ok ? response.json() : { characters: {} };
            })
            .catch(function () { return { characters: {} }; })
            .then(function (index) {
                standpicIndex = index || { characters: {} };
            });
    }

    function init() {
        return Promise.all([loader.loadModules(), loadStandpicIndex()])
                .then(function (results) {
            modules = results[0];
            const THREE = modules.THREE;
            renderer = new THREE.WebGLRenderer({
                canvas: opts.canvas, antialias: true, alpha: true
            });
            renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
            renderer.outputColorSpace = THREE.SRGBColorSpace;

            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

            // Flat, even light: these models are drawn for a cel look and a
            // strong key light reads as a mistake on them.
            scene.add(new THREE.AmbientLight(0xffffff, 2.1));
            const fill = new THREE.DirectionalLight(0xffffff, 0.55);
            fill.position.set(0.4, 1.6, 2.2);
            scene.add(fill);

            applyShot(SHOTS.normal, 1, SHOTS.normal);
            resize();
            return stage;
        });
    }

    function resize() {
        if (!renderer || !opts.canvas) {
            return;
        }
        const rect = opts.canvas.getBoundingClientRect();
        // A hidden container reports 0x0, and a zero-size drawing buffer makes
        // every later readback look like a black frame.
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    function applyShot(target, progress, from) {
        const source = from || shotFrom;
        const lerp = function (a, b) { return a + (b - a) * progress; };
        const distance = lerp(source[0], target[0]);
        const height = lerp(source[1], target[1]);
        const look = lerp(source[2], target[2]);
        camera.fov = lerp(source[3], target[3]);
        camera.position.set(0, height, distance);
        camera.lookAt(0, look, 0);
        camera.updateProjectionMatrix();
    }

    // --- characters -----------------------------------------------------

    function slotFor(name) {
        return SLOTS[name] || SLOTS.center;
    }

    function loadCharacter(id) {
        if (present.has(id)) {
            return Promise.resolve(present.get(id));
        }
        if (loading.has(id)) {
            return loading.get(id);
        }
        const entry = cast[id];
        if (!entry) {
            return Promise.reject(new Error("adv stage: unknown cast id " + id));
        }
        if (!entry.model) {
            // No 3D model exists for this character in the original either.
            const flat = createFlat(id, entry);
            present.set(id, flat);
            return Promise.resolve(flat);
        }
        const card = opts.cards ? opts.cards.byId(entry.card) : null;
        const promise = actorModule.create({
            resourceId: entry.model,
            classId: card ? card["class"] : 0,
            headId: entry.head || 0,
            // Standing in a conversation, not fighting: the class actions carry
            // the idle that makes a portrait breathe, but the weapon would be
            // drawn and held through the whole scene.
            weapon: "none",
            faces: entry.faces || null
        }).then(function (actor) {
            if (disposed) {
                actor.dispose();
                return null;
            }
            const holder = {
                id: id, kind: "actor", actor: actor,
                object: actor.object, entry: entry,
                opacity: 0, targetOpacity: 0, fadeRate: 1,
                turn: 0, targetTurn: 0
            };
            actor.play(IDLE_ACTION, { loop: true });
            // Faces come from the script, not from the idle clip's own facial
            // events -- an ADV line's expression has to outlast the loop.
            actor.face("default");
            scene.add(actor.object);
            setOpacity(holder, 0);
            present.set(id, holder);
            loading.delete(id);
            return holder;
        });
        loading.set(id, promise);
        return promise;
    }

    // A character with no 3D model -- マッチ, and any NPC the original only ever
    // drew -- renders as the game's own ADV standpic instead.
    //
    // Each expression is its own file, composited offline by
    // tools/convert_standpic.py, and they are stacked as <img> elements with only
    // one opaque at a time rather than swapping a single src. Swapping src makes
    // the first use of every expression flash empty for a frame; stacking pays
    // the decode once and then every later change is free. Only the expressions a
    // scene actually asks for get fetched, so a character who spends a chapter
    // smiling never downloads their crying face.
    function createFlat(id, entry) {
        const element = document.createElement("div");
        element.className = "adv-flat";
        element.dataset.cast = id;

        const holder = {
            id: id, kind: "flat", element: element, entry: entry,
            opacity: 0, targetOpacity: 0, fadeRate: 1, turn: 0, targetTurn: 0,
            expressions: new Map(), expression: null, broken: false
        };

        if (!entry.standpic) {
            markPlaceholder(holder);
            if (layers) {
                layers.flats.appendChild(element);
            }
            return holder;
        }

        const known = (standpicIndex.characters || {})[entry.standpic];
        holder.available = known ? known.expressions : null;

        // Size from the source image rather than forcing every standpic to the
        // same height. A full-height ADV portrait is ~760px, and the game draws
        // マッチ at 211 -- she is a palm-sized sprite standing next to people, not
        // a person shown small. Stretching her to a portrait's height would both
        // blur her 2x and make her the wrong size for the scene.
        if (known && known.size) {
            const scale = Math.min(1, known.size[1] / STANDPIC_FULL_HEIGHT);
            element.style.height = (STANDPIC_FRAME_HEIGHT * scale).toFixed(2) + "%";
        }

        holder.face = function (which) { return flatFace(holder, which); };
        holder.face("default");

        if (layers) {
            layers.flats.appendChild(element);
        }
        return holder;
    }

    function markPlaceholder(holder) {
        holder.broken = true;
        holder.element.classList.add("adv-flat-placeholder");
        holder.element.textContent = holder.entry.ja || holder.id;
    }

    // Pick the file to show for an expression name. The index lists which ones
    // exist, so a name the character does not have falls back through the same
    // chain core/actor.js uses for 3D faces -- the two renderers agree on what
    // "sorrow" means even when one of them has to substitute for it.
    function flatExpression(holder, which) {
        const wanted = String(which || "default").split("-")[0];
        const have = holder.available;
        if (!have) {
            return wanted;
        }
        let key = wanted;
        for (let hop = 0; hop < 8; hop++) {
            if (have.indexOf(key) >= 0) {
                return key;
            }
            const next = actorModule.EMOTION_FALLBACK[key];
            if (!next) {
                return "default";
            }
            key = next;
        }
        return "default";
    }

    function flatFace(holder, which) {
        if (holder.broken) {
            return false;
        }
        const name = flatExpression(holder, which);
        if (name === holder.expression) {
            return true;
        }
        let image = holder.expressions.get(name);
        if (!image) {
            image = document.createElement("img");
            image.alt = "";
            image.className = "adv-flat-face";
            image.style.opacity = "0";
            image.src = STANDPIC_ROOT + holder.entry.standpic + "/" + name + ".webp";
            // If the conversion has not been run for this character the slot
            // shows their name rather than a broken image, so a scene still runs.
            image.addEventListener("error", function () {
                holder.expressions.delete(name);
                image.remove();
                if (!holder.expressions.size) {
                    markPlaceholder(holder);
                }
            });
            holder.expressions.set(name, image);
            holder.element.appendChild(image);
        }
        holder.expressions.forEach(function (other, key) {
            other.style.opacity = key === name ? "1" : "0";
        });
        holder.expression = name;
        return true;
    }

    function setOpacity(holder, value) {
        holder.opacity = value;
        if (holder.kind === "flat") {
            holder.element.style.opacity = String(value);
            return;
        }
        holder.object.visible = value > 0.01;
        holder.object.traverse(function (node) {
            if (!node.material) {
                return;
            }
            const list = Array.isArray(node.material) ? node.material : [node.material];
            list.forEach(function (material) {
                // The models are authored with an alpha cut, and turning on
                // blending for a fade would reorder them against each other.
                // Fading opacity while keeping the cut is close enough at the
                // speed a portrait fades, and does not disturb the sorting the
                // MsbHandler state set up.
                if (material.userData.baseOpacity === undefined) {
                    material.userData.baseOpacity = material.opacity;
                }
                material.transparent = value < 0.995 ? true : material.userData.baseTransparent;
                if (material.userData.baseTransparent === undefined) {
                    material.userData.baseTransparent = material.transparent;
                }
                material.opacity = material.userData.baseOpacity * value;
            });
        });
    }

    function place(holder, slotName) {
        const slot = slotFor(slotName);
        holder.slot = slot;
        holder.targetTurn = 0;
        if (holder.kind === "flat") {
            holder.element.style.setProperty("--adv-flat-x", slot.x.toFixed(3));
            return;
        }
        holder.object.position.set(slot.x, slot.y, slot.z);
        // Everyone angles slightly inward, so a line-up does not look like a
        // police lineup. Facing the camera dead-on is the `turn: camera` state.
        holder.baseRotation = (slot.turn || 0) * Math.PI / 180;
        holder.object.rotation.y = holder.baseRotation;
    }

    // --- commands -------------------------------------------------------

    const stage = {
        get renderer() { return renderer; },
        get scene() { return scene; },
        get camera() { return camera; },
        get present() { return present; },

        // The runner mirrors its skip flag here so stage-owned waits can bail.
        get skipping() { return skipping; },
        set skipping(on) { skipping = Boolean(on); },

        // Land every wait in flight on its finished state. Called when the
        // reader clicks through a fade and when skip turns on, so the visuals
        // jump to where the wait would have left them rather than freezing
        // part-way. Also snaps character fades and camera pushes, which are
        // driven by update() rather than by a timer.
        cut: function () {
            Array.from(pendingCuts).forEach(function (done) { done(); });
            // Snapshot first: a holder that was fading out gets removed here, and
            // deleting from the map mid-iteration is asking for trouble.
            Array.from(present.entries()).forEach(function (pair) {
                const key = pair[0];
                const holder = pair[1];
                holder.fadeRate = Infinity;
                setOpacity(holder, holder.targetOpacity);
                if (holder.targetOpacity === 0) {
                    removeHolder(key, holder);
                    return;
                }
                if (holder.kind === "actor" && holder.turn !== holder.targetTurn) {
                    holder.turn = holder.targetTurn;
                    holder.object.rotation.y = (holder.baseRotation || 0) + holder.turn;
                }
            });
            if (shotProgress < 1) {
                shotProgress = 1;
                applyShot(shotTo, 1, shotTo);
            }
        },

        init: init,
        resize: resize,

        background: function (name, command) {
            if (!layers) {
                return Promise.resolve();
            }
            const ms = command && command.ms !== undefined ? command.ms : 900;
            const next = layers.bgNext;
            next.className = "adv-bg adv-bg-next";
            if (name === null || name === undefined) {
                next.style.background = "transparent";
            } else if (name === "white") {
                // 画面全白 is a colour, not an image -- and it is the first
                // thing the prologue shows, so it must not wait on a fetch.
                next.style.background = "#ffffff";
                next.style.backgroundImage = "none";
            } else {
                next.style.backgroundImage = "url(" + BG_ROOT + name + ".webp)";
                next.style.backgroundColor = "#f6f4ef";
            }
            if (command && command.light) {
                next.classList.add("adv-bg-" + command.light);
            }
            return crossFade(ms);
        },

        enter: function (id, command) {
            const ms = command && command.ms !== undefined ? command.ms : 800;
            return loadCharacter(id).then(function (holder) {
                if (!holder) {
                    return;
                }
                place(holder, (command && command.at) || "center");
                if (command && command.face) {
                    stage.face(id, command.face);
                }
                if (command && command.turn) {
                    stage.turn(id, command.turn);
                }
                holder.targetOpacity = 1;
                holder.fadeRate = ms > 0 ? 1000 / ms : Infinity;
                if (ms <= 0) {
                    setOpacity(holder, 1);
                }
            });
        },

        exit: function (id, command) {
            const ms = command && command.ms !== undefined ? command.ms : 600;
            const targets = id === "*"
                ? Array.from(present.keys())
                : [id];
            targets.forEach(function (key) {
                const holder = present.get(key);
                if (!holder) {
                    return;
                }
                holder.targetOpacity = 0;
                holder.fadeRate = ms > 0 ? 1000 / ms : Infinity;
                if (ms <= 0) {
                    setOpacity(holder, 0);
                }
            });
            return Promise.resolve();
        },

        // The same name works on both kinds of character: a 3D actor resolves it
        // against its facial table, a standpic against the expressions it has.
        face: function (id, which) {
            const holder = present.get(id);
            if (!holder) {
                return false;
            }
            if (holder.kind === "flat") {
                return holder.face ? holder.face(which) : false;
            }
            return holder.actor.face(which);
        },

        // "camera" squares up to the lens, "away" shows their back. きらら
        // starts the second half turned away, which only works because these
        // are models rather than portraits.
        turn: function (id, to) {
            const holder = present.get(id);
            if (!holder) {
                return;
            }
            if (holder.kind === "flat") {
                holder.element.classList.toggle("adv-flat-away", to === "away");
                return;
            }
            const base = holder.baseRotation || 0;
            holder.targetTurn = to === "away" ? Math.PI : (to === "camera" ? -base : 0);
        },

        // A prop close-up has no prop assets yet, so a named focus that is not
        // a framing degrades to a slow push-in: the beat still lands, and the
        // script does not have to change when the props arrive.
        focus: function (name, command) {
            const ms = command && command.ms !== undefined ? command.ms : 1200;
            const framing = name === null || name === undefined
                ? "normal"
                : (SHOTS[name] ? name : "close");
            shotFrom = [camera.position.z, camera.position.y, SHOTS[shot][2], camera.fov];
            shotTo = SHOTS[framing].slice();
            shot = framing;
            shotProgress = ms > 0 ? 0 : 1;
            shotDuration = Math.max(1, ms);
            if (ms <= 0) {
                applyShot(shotTo, 1, shotTo);
            }
            return Promise.resolve();
        },

        title: function (parts, command) {
            if (!layers) {
                return Promise.resolve();
            }
            const node = layers.title;
            node.className = "adv-title adv-title-"
                + ((command && command.kind) || "title");
            node.querySelector(".adv-title-primary").textContent = parts.primary || "";
            const sub = node.querySelector(".adv-title-secondary");
            sub.textContent = parts.secondary || "";
            sub.hidden = !parts.secondary;
            node.hidden = false;
            // Two frames, so the transition has a starting value to animate
            // from rather than appearing already finished.
            requestAnimationFrame(function () {
                requestAnimationFrame(function () { node.classList.add("adv-title-in"); });
            });
            const hold = (command && command.ms) || 1600;
            return timed(hold, function () {
                node.classList.remove("adv-title-in");
            }).then(function () {
                return timed(600, function () { node.hidden = true; });
            });
        },

        // Called for every line. The mouth is not lip-synced -- there is no
        // viseme data -- but the speaker turning to the camera is what an ADV
        // shot actually does, and that much is authored.
        speak: function (id) {
            present.forEach(function (holder, key) {
                if (holder.kind !== "actor") {
                    return;
                }
                const base = holder.baseRotation || 0;
                holder.targetTurn = key === id && id ? -base * 0.55 : 0;
            });
            if (id && cast[id] && cast[id].voice) {
                audio.voice(cast[id].voice);
            }
        },

        bgm: function (track, command) {
            const fade = command && command.fade !== undefined ? command.fade : 900;
            if (track === null || track === undefined) {
                audio.stopBgm(fade);
                return;
            }
            audio.bgm(track, { fade: fade });
        },

        // Sound effects are extracted as cue names but the CRIWARE payload is
        // not decodable yet, so this records the cue instead of dropping it --
        // when the decoder lands, every scene already asks for the right ones.
        se: function (name) {
            if (audio.se) {
                audio.se(name);
                return;
            }
            (stage.pendingSe = stage.pendingSe || []).push(name);
        },

        // Advance animation and transitions. The game's own loop drives this.
        update: function (dt) {
            clock += dt;
            present.forEach(function (holder, key) {
                if (holder.kind === "actor") {
                    holder.actor.update(dt);
                }
                if (holder.opacity !== holder.targetOpacity) {
                    const step = dt * holder.fadeRate;
                    const next = holder.opacity < holder.targetOpacity
                        ? Math.min(holder.targetOpacity, holder.opacity + step)
                        : Math.max(holder.targetOpacity, holder.opacity - step);
                    setOpacity(holder, next);
                    if (next === 0 && holder.targetOpacity === 0) {
                        removeHolder(key, holder);
                    }
                }
                if (holder.kind === "actor" && holder.turn !== holder.targetTurn) {
                    // Turning takes about a third of a second either way, which
                    // is roughly how long the original's standpic flip reads.
                    const delta = holder.targetTurn - holder.turn;
                    const step = Math.sign(delta) * Math.min(Math.abs(delta), dt * 6);
                    holder.turn += step;
                    holder.object.rotation.y = (holder.baseRotation || 0) + holder.turn;
                }
            });
            if (shotProgress < 1) {
                shotProgress = Math.min(1, shotProgress + (dt * 1000) / shotDuration);
                applyShot(shotTo, easeInOut(shotProgress), shotFrom);
            }
        },

        render: function () {
            if (renderer && scene && camera) {
                renderer.render(scene, camera);
            }
        },

        dispose: function () {
            disposed = true;
            present.forEach(function (holder, key) { removeHolder(key, holder); });
            present.clear();
            if (renderer) {
                renderer.dispose();
            }
        }
    };

    function removeHolder(key, holder) {
        if (holder.kind === "actor") {
            scene.remove(holder.object);
            holder.actor.dispose();
        } else if (holder.element) {
            holder.element.remove();
        }
        present.delete(key);
    }

    function crossFade(ms) {
        if (!layers) {
            return Promise.resolve();
        }
        const from = layers.bg;
        const to = layers.bgNext;
        // Fold the finished layer down into the base one, so the next fade
        // always has a clean layer to come in on. Two layers total rather than
        // one per background. Cutting a fade short runs exactly this, which is
        // why it lives in its own function.
        const fold = function () {
            from.style.cssText = to.style.cssText;
            from.style.transition = "";
            from.style.opacity = "1";
            from.className = to.className.replace(" adv-bg-next", "");
            to.style.transition = "";
            to.style.opacity = "0";
        };
        if (skipping || ms <= 0) {
            fold();
            return Promise.resolve();
        }
        to.style.transition = "opacity " + ms + "ms ease";
        to.style.opacity = "0";
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { to.style.opacity = "1"; });
        });
        return timed(ms, fold);
    }

    return stage;
}
