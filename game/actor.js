// Driver for game/actor.html. Loads one card as an actor and exposes every
// clip, expression and weapon mode it has, so a binding failure is visible
// here instead of inside a battle.

import * as loader from "../core/loader.js";
import * as actorModule from "../core/actor.js";
import * as cards from "../core/cards.js";

const stage = document.getElementById("stage");
const status = document.getElementById("status");
const pick = document.getElementById("pick");
const actionsBox = document.getElementById("actions");
const facesBox = document.getElementById("faces");
const weaponsBox = document.getElementById("weapons");
const statsBox = document.getElementById("stats");

let THREE = null;
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let actor = null;
let clock = 0;
let generation = 0;
let weaponMode = "default";

function say(text) { status.textContent = text; }

function setup(modules) {
    THREE = modules.THREE;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x0b0e15, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    camera.position.set(0, 1.05, 3.4);

    controls = new modules.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.95, 0);
    controls.enableDamping = true;

    // Character materials are unlit-ish but not unlit, so a hemisphere plus a
    // key light matches how models.html reads them.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404860, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1.4, 2.6, 2.2);
    scene.add(key);

    const grid = new THREE.GridHelper(4, 8, 0x2a3040, 0x1a1f2b);
    grid.position.y = 0;
    scene.add(grid);

    resize();
    window.addEventListener("resize", resize);
    renderer.setAnimationLoop(tick);

    // Same reason as game/uniqueskill.js: a backgrounded tab never runs
    // requestAnimationFrame, so a headless check needs a synchronous handle.
    window.kirafanActor = {
        get renderer() { return renderer; },
        get scene() { return scene; },
        get camera() { return camera; },
        get actor() { return actor; },
        renderOnce: function () { renderer.render(scene, camera); },
        step: function (dt) { if (actor) { actor.update(dt); } }
    };
}

function resize() {
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

function tick(now) {
    const seconds = now / 1000;
    const dt = clock ? Math.min(0.1, seconds - clock) : 0;
    clock = seconds;
    if (actor) {
        actor.update(dt);
    }
    controls.update();
    renderer.render(scene, camera);
}

function chips(box, items, onPick, activeValue) {
    box.innerHTML = "";
    items.forEach(function (item) {
        const button = document.createElement("button");
        button.textContent = item.label;
        button.classList.toggle("on", item.value === activeValue);
        button.addEventListener("click", function () {
            Array.from(box.children).forEach(function (other) {
                other.classList.toggle("on", other === button);
            });
            onPick(item.value);
        });
        box.appendChild(button);
    });
}

function refreshPanels() {
    if (!actor) {
        return;
    }
    chips(actionsBox, actor.actionNames.map(function (name) {
        return { label: name, value: name };
    }), function (name) {
        actor.play(name, { loop: name.indexOf("skill") >= 0 || name === "attack" ? false : true });
        refreshStats();
    }, actor.action);

    const faces = actor.faceNames.map(function (label, index) {
        return { label: label.zh, value: index };
    });
    chips(facesBox, [{ label: "自動", value: -1 }].concat(faces), function (index) {
        if (index < 0) {
            actor.faceAuto();
        } else {
            actor.face(index);
        }
        refreshStats();
    }, -1);
}

function refreshStats() {
    if (!actor) {
        return;
    }
    let bones = 0;
    let meshes = 0;
    let weapons = 0;
    actor.object.traverse(function (child) {
        if (child.isBone) { bones++; }
        if (child.isMesh) { meshes++; }
    });
    ["Loc_L", "Loc_R", "Weapon_L", "Weapon_R"].forEach(function (name) {
        const socket = actor.object.getObjectByName(name);
        if (socket) {
            weapons += socket.children.length;
        }
    });
    const clipCount = actor.actionNames.length;
    const faceCount = actor.faceNames.length;
    statsBox.innerHTML =
        '<div class="' + (clipCount > 1 ? "ok" : "bad") + '"><span>clips</span><b>'
            + clipCount + "</b></div>"
        + '<div class="' + (faceCount ? "ok" : "bad") + '"><span>expressions</span><b>'
            + (faceCount || "no table") + "</b></div>"
        + "<div><span>meshes / bones</span><b>" + meshes + " / " + bones + "</b></div>"
        + '<div class="' + (weaponMode === "none" || weapons ? "ok" : "bad")
            + '"><span>weapon parts</span><b>' + weapons + "</b></div>"
        + "<div><span>action</span><b>" + (actor.action || "-") + "</b></div>"
        + "<div><span>face</span><b>" + actor.faceIndex + "</b></div>";
}

function loadOne(cardId) {
    const token = ++generation;
    const card = cards.byId(cardId);
    if (!card) {
        say("カードがありません / 找不到卡片 " + cardId);
        return Promise.resolve();
    }
    say("読み込み中 " + (card.characterZh || card.character) + " …");
    const evolved = Boolean(card.evolvedResourceId);
    return actorModule.create({
        resourceId: evolved ? card.evolvedResourceId : card.resourceId,
        classId: card["class"],
        headId: cards.headId(card, evolved),
        dedicatedWeapon: card.dedicatedWeapon,
        weapon: weaponMode,
        skillId: evolved ? card.evolvedResourceId : card.resourceId,
        onProgress: function (fraction) {
            if (token === generation && fraction !== null) {
                say("読み込み中 " + Math.round(fraction * 100) + "%");
            }
        }
    }).then(function (created) {
        if (token !== generation) {
            created.dispose();
            return;
        }
        if (actor) {
            actor.dispose();
        }
        actor = created;
        scene.add(actor.object);
        refreshPanels();
        refreshStats();
        say((card.characterZh || card.character) + " / " + card.character
            + "  ·  " + (card.titleZh || card.title));
    }).catch(function (error) {
        if (token === generation) {
            say("失敗 / 加载失败: " + error.message);
            console.error(error);
        }
    });
}

pick.addEventListener("change", function () { loadOne(Number(pick.value)); });

Array.from(weaponsBox.children).forEach(function (button) {
    button.addEventListener("click", function () {
        Array.from(weaponsBox.children).forEach(function (other) {
            other.classList.toggle("on", other === button);
        });
        weaponMode = button.dataset.w;
        if (actor) {
            actor.equip(weaponMode).then(refreshStats);
        }
    });
});

loader.loadModules().then(function (modules) {
    setup(modules);
    // Every card has a converted model, so list them all and let the rarity
    // show in the label -- restricting the list would hide exactly the cards a
    // binding bug is most likely to show up on.
    const list = cards.all().slice().sort(function (a, b) { return a.id - b.id; });
    list.forEach(function (card) {
        const option = document.createElement("option");
        option.value = String(card.id);
        option.textContent = "★".repeat(card.rarity) + " "
            + (card.characterZh || card.character)
            + " · " + (card.titleZh || card.title);
        pick.appendChild(option);
    });
    if (!list.length) {
        say("カードデータが空です / 卡片数据为空");
        return;
    }
    const wanted = new URLSearchParams(location.search).get("card");
    pick.value = wanted && cards.byId(wanted) ? wanted : String(list[0].id);
    return loadOne(Number(pick.value));
}).catch(function (error) {
    say("初期化失敗 / 初始化失败: " + error.message
        + (loader.IS_LOCAL_FILE ? "  " + loader.LOCAL_FILE_HINT : ""));
    console.error(error);
});
