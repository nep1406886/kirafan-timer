// Driver for game/uniqueskill.html -- the end-to-end check that the extracted
// timeline and the exported scene GLB agree.
//
// Nothing here is game logic; the reusable half lives in core/uniqueskill.js.
// This file is the harness: pick a character, load both halves, bind them,
// report anything that failed to bind, and run the clock.

import * as loader from "../core/loader.js";
import * as us from "../core/uniqueskill.js";
import * as cards from "../core/cards.js";

const stage = document.getElementById("stage");
const status = document.getElementById("status");
const pick = document.getElementById("pick");
const scrub = document.getElementById("scrub");
const playBtn = document.getElementById("play");
const againBtn = document.getElementById("again");
const frameLabel = document.getElementById("frameLabel");
const timeLabel = document.getElementById("timeLabel");
const statsBox = document.getElementById("stats");
const bindBox = document.getElementById("bind");
const logBox = document.getElementById("log");
const freecam = document.getElementById("freecam");
const showLoc = document.getElementById("showLoc");

let THREE = null;
let renderer = null;
let scene = null;
let camera = null;      // the authored orthographic camera
let freeCamera = null;  // OrbitControls camera for inspection
let controls = null;
let player = null;
let current = null;     // { root, timeline, locators }
let clock = 0;
let generation = 0;     // guards against a slow load finishing after a newer one

function say(text) {
    status.textContent = text;
}

function log(kind, text, frame) {
    const line = document.createElement("div");
    line.innerHTML = '<span class="f">' + String(Math.round(frame)).padStart(4, " ")
        + '</span> <span class="' + kind + '">' + text + "</span>";
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
    while (logBox.childElementCount > 400) {
        logBox.removeChild(logBox.firstChild);
    }
}

// --- character list -----------------------------------------------------

// A resourceID can be reached by more than one card (base and 進化 share the
// evolved model), so label by the first card that points at it and keep the
// list in ID order rather than card order.
function buildPicker(index) {
    const ids = Object.keys(index).sort();
    const labels = new Map();
    let list = [];
    try {
        list = cards.all();
    } catch (error) {
        // cards.js not loaded is survivable -- fall back to bare IDs.
    }
    list.forEach(function (card) {
        [card.resourceId, card.evolvedResourceId].forEach(function (rid) {
            if (rid === null || rid === undefined) {
                return;
            }
            const key = String(rid);
            if (!labels.has(key)) {
                labels.set(key, (card.characterZh || card.character || "")
                    + " / " + (card.character || "")
                    + " · " + (card.titleZh || card.title || ""));
            }
        });
    });
    ids.forEach(function (id) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = id + "  " + (labels.get(id) || "");
        pick.appendChild(option);
    });
    return ids;
}

// --- three.js setup -----------------------------------------------------

function setup(modules) {
    THREE = modules.THREE;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x05070c, 1);
    // The effect textures are authored in sRGB and the originals are composited
    // without tone mapping, so anything other than a straight sRGB write makes
    // the additive flares wash out.
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    stage.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    freeCamera = new THREE.PerspectiveCamera(35, 1, 0.05, 400);
    freeCamera.position.set(0, 1.2, 4.2);

    controls = new modules.OrbitControls(freeCamera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;
    controls.update();

    // Unlit materials need no lights, but a fill keeps any non-unlit stray
    // visible instead of pure black.
    scene.add(new THREE.AmbientLight(0xffffff, 1));

    resize();
    window.addEventListener("resize", resize);
    renderer.setAnimationLoop(tick);

    // This page exists to check the pipeline, so it exposes its own internals:
    // a headless check can seek and render one frame synchronously, which
    // requestAnimationFrame will not do for a backgrounded tab.
    window.kirafanUS = {
        get renderer() { return renderer; },
        get scene() { return scene; },
        get camera() { return freecam.checked ? freeCamera : camera; },
        get player() { return player; },
        renderOnce: function () { renderer.render(scene, this.camera); }
    };
}

function aspect() {
    const rect = stage.getBoundingClientRect();
    return rect.height > 0 ? rect.width / rect.height : 1;
}

function resize() {
    const rect = stage.getBoundingClientRect();
    // A hidden or not-yet-laid-out container reports 0x0, and a zero-size
    // drawing buffer makes every later readback look like a black frame.
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    freeCamera.aspect = aspect();
    freeCamera.updateProjectionMatrix();
    if (player) {
        // Re-seek so the orthographic frustum is rebuilt from the animated
        // camOrthoSize at the current frame, not from a stale aspect.
        player.setAspect(aspect());
        player.seek(player.frame);
    }
}

// --- locator markers ----------------------------------------------------

// loc_MY_0..2 / loc_TGT_0..2 are where the original drops the caster and the
// targets. No character models here, so draw axes to show the frame the
// battle layer will mount actors into.
function buildLocators(root, timeline) {
    const group = new THREE.Group();
    group.visible = showLoc.checked;
    Object.keys(timeline.locators || {}).forEach(function (name) {
        const node = findByName(root, name);
        if (!node) {
            return;
        }
        const axes = new THREE.AxesHelper(0.35);
        axes.material.depthTest = false;
        node.add(axes);
        group.add(axes);
    });
    return group;
}

function findByName(root, name) {
    let found = null;
    root.traverse(function (child) {
        if (!found && child.name === name) {
            found = child;
        }
    });
    return found;
}

// --- bind report --------------------------------------------------------

// A channel that fails to resolve produces no error at runtime, it just does
// nothing -- which is indistinguishable from a channel the original left flat.
// So count them explicitly.
function bindReport(root, timeline) {
    const names = new Set();
    const materials = new Set();
    root.traverse(function (child) {
        if (child.name) {
            names.add(child.name);
        }
        const list = child.material
            ? (Array.isArray(child.material) ? child.material : [child.material])
            : [];
        list.forEach(function (material) {
            if (material.name) {
                materials.add(material.name);
            }
        });
    });

    let trsHit = 0;
    const trsPaths = Object.keys(timeline.trs || {});
    trsPaths.forEach(function (path) {
        if (names.has(path.split("/").pop())) {
            trsHit++;
        }
    });

    // Channels carry no "kind" -- the target string is what decides whether a
    // name is looked up among objects or materials, so classify the same way
    // core/uniqueskill.js does.
    const MESH_TARGETS = /^mesh(Visibility|Color)/;
    const MAT_TARGETS = /^(matColor|tex(Coverage|Translation|Offset|Rotate)UV)/;
    let meshHit = 0;
    let meshTotal = 0;
    let matHit = 0;
    let matTotal = 0;
    const missing = new Set();
    (timeline.channels || []).forEach(function (channel) {
        if (MAT_TARGETS.test(channel.target)) {
            matTotal++;
            if (materials.has(channel.name)) {
                matHit++;
            } else {
                missing.add("mat " + channel.name);
            }
        } else if (MESH_TARGETS.test(channel.target)) {
            meshTotal++;
            if (names.has(channel.name)) {
                meshHit++;
            } else {
                missing.add("mesh " + channel.name);
            }
        }
    });

    const camName = timeline.camera && timeline.camera.node
        ? timeline.camera.node.split("/").pop()
        : null;
    const camOk = camName ? names.has(camName) : false;

    function row(label, hit, total) {
        if (!total) {
            return "";
        }
        const cls = hit === total ? "ok" : "bad";
        return '<div class="' + cls + '">' + label + " " + hit + "/" + total + "</div>";
    }
    bindBox.innerHTML =
        row("TRS", trsHit, trsPaths.length)
        + row("mesh ch", meshHit, meshTotal)
        + row("mat ch", matHit, matTotal)
        + '<div class="' + (camOk ? "ok" : "bad") + '">camera ' + (camOk ? camName : "MISSING") + "</div>"
        + (missing.size
            ? '<div class="bad">unbound: ' + Array.from(missing).slice(0, 6).join(", ") + "</div>"
            : "");
}

// --- load one scene -----------------------------------------------------

function loadOne(resourceId) {
    const token = ++generation;
    if (player) {
        player.pause();
    }
    playBtn.disabled = true;
    againBtn.disabled = true;
    logBox.innerHTML = "";
    say("読み込み中 " + resourceId + " …");

    return Promise.all([
        us.loadTimeline(resourceId),
        us.loadScene(resourceId, {
            onProgress: function (fraction) {
                if (token === generation) {
                    say(fraction === null
                        ? "展開中… / 解压中…"
                        : "読み込み中 " + Math.round(fraction * 100) + "%");
                }
            }
        })
    ]).then(function (parts) {
        if (token !== generation) {
            return;     // a newer pick already won
        }
        const timeline = parts[0];
        const loaded = parts[1];

        if (current) {
            scene.remove(current.root);
            loader.disposeObject(current.root);
        }
        scene.add(loaded.scene);

        const audio = us.sceneAudio(resourceId);
        player = us.createPlayer({
            THREE: THREE,
            timeline: timeline,
            root: loaded.scene,
            camera: camera,
            audio: audio,
            aspect: aspect(),
            onEvent: function (event) {
                log("ev", event.event + "(" + event.args.join(",") + ")", event.frame);
            },
            onSe: function (cue) { log("se", "SE " + cue.cue, cue.frame); },
            onVoice: function (cue) { log("vo", "VO " + cue.cue, cue.frame); },
            onEmitter: function (index, active, frame) {
                log("pe", "emitter " + index + (active ? " on" : " off"), frame);
            }
        });

        current = {
            root: loaded.scene,
            timeline: timeline,
            locators: buildLocators(loaded.scene, timeline)
        };

        scrub.max = String(Math.max(0, player.frames - 1));
        scrub.value = "0";
        player.seek(0);

        const seCount = audio && audio.se && audio.se.frames ? audio.se.frames.length : 0;
        const voCount = audio && audio.voice && audio.voice.frames ? audio.voice.frames.length : 0;
        statsBox.innerHTML =
            "<div><span>frames</span><b>" + player.frames + " @ " + player.fps + "fps</b></div>"
            + "<div><span>duration</span><b>" + player.duration.toFixed(2) + "s</b></div>"
            + "<div><span>channels</span><b>" + (timeline.channels || []).length + "</b></div>"
            + "<div><span>events</span><b>" + player.events.length + "</b></div>"
            + "<div><span>SE / voice</span><b>" + seCount + " / " + voCount + "</b></div>"
            + "<div><span>GLB</span><b>" + Math.round((loaded.entry.bytes || 0) / 1024) + " KiB</b></div>";
        bindReport(loaded.scene, timeline);

        playBtn.disabled = false;
        againBtn.disabled = false;
        say((audio && audio.name ? audio.name : "とっておき") + "  ·  " + resourceId);
        updateLabels();
    }).catch(function (error) {
        if (token === generation) {
            say("失敗 / 加载失败: " + error.message);
            console.error(error);
        }
    });
}

// --- clock --------------------------------------------------------------

function updateLabels() {
    if (!player) {
        return;
    }
    frameLabel.textContent = Math.round(player.frame) + " / " + Math.max(0, player.frames - 1);
    timeLabel.textContent = (player.frame / player.fps).toFixed(2) + "s";
    playBtn.textContent = player.playing ? "⏸ 一時停止" : "▶ 再生";
    playBtn.classList.toggle("on", player.playing);
}

function tick(now) {
    const seconds = now / 1000;
    const dt = clock ? Math.min(0.1, seconds - clock) : 0;
    clock = seconds;

    if (player && player.playing) {
        player.update(dt);
        scrub.value = String(Math.round(player.frame));
        updateLabels();
    }
    if (controls) {
        controls.update();
    }
    if (renderer && scene) {
        renderer.render(scene, freecam.checked ? freeCamera : camera);
    }
}

// --- controls -----------------------------------------------------------

pick.addEventListener("change", function () {
    loadOne(pick.value);
});

playBtn.addEventListener("click", function () {
    if (!player) {
        return;
    }
    if (player.playing) {
        player.pause();
    } else {
        if (player.finished || player.frame >= player.frames - 1) {
            player.restart();
        } else {
            player.play();
        }
    }
    updateLabels();
});

againBtn.addEventListener("click", function () {
    if (player) {
        logBox.innerHTML = "";
        player.restart();
        updateLabels();
    }
});

scrub.addEventListener("input", function () {
    if (player) {
        player.pause();
        player.seek(Number(scrub.value));
        updateLabels();
    }
});

document.querySelectorAll(".spd").forEach(function (button) {
    button.addEventListener("click", function () {
        document.querySelectorAll(".spd").forEach(function (other) {
            other.classList.toggle("on", other === button);
        });
        if (player) {
            player.setSpeed(Number(button.dataset.s));
        }
    });
});

showLoc.addEventListener("change", function () {
    if (current && current.locators) {
        current.locators.visible = showLoc.checked;
        current.locators.children.forEach(function (child) {
            child.visible = showLoc.checked;
        });
    }
});

freecam.addEventListener("change", function () {
    controls.enabled = freecam.checked;
});

window.addEventListener("keydown", function (event) {
    if (!player || event.target.tagName === "SELECT") {
        return;
    }
    if (event.code === "Space") {
        event.preventDefault();
        playBtn.click();
    } else if (event.code === "ArrowRight") {
        player.pause();
        player.seek(player.frame + (event.shiftKey ? 10 : 1));
        scrub.value = String(Math.round(player.frame));
        updateLabels();
    } else if (event.code === "ArrowLeft") {
        player.pause();
        player.seek(player.frame - (event.shiftKey ? 10 : 1));
        scrub.value = String(Math.round(player.frame));
        updateLabels();
    }
});

// --- boot ---------------------------------------------------------------

Promise.all([loader.loadModules(), us.loadIndex()]).then(function (parts) {
    setup(parts[0]);
    controls.enabled = false;
    const ids = buildPicker(parts[1]);
    if (!ids.length) {
        say("timeline-index.json は空です / 索引为空");
        return;
    }
    const wanted = new URLSearchParams(location.search).get("id");
    pick.value = ids.indexOf(wanted) >= 0 ? wanted : ids[0];
    return loadOne(pick.value);
}).catch(function (error) {
    say("初期化失敗 / 初始化失败: " + error.message
        + (loader.IS_LOCAL_FILE ? "  " + loader.LOCAL_FILE_HINT : ""));
    console.error(error);
});
