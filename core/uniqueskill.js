// とっておき (unique skill) cinematic playback.
//
// Consumes asset/uniqueskill/timeline/<resourceID>.json, produced by
// tools/extract_uniqueskill_timeline.py, and reproduces the original engine's
// schedule: Unity TRS curves for node motion, Meige MabCurve channels for
// everything Unity has no channel for (mesh visibility, mesh colour, UV
// scroll, particle-emitter enable, orthographic camera size), and the frame-
// stamped m_AnimEvArray gameplay events.
//
// Two clocks would be a bug, so the extractor already converted Unity curve
// times into frames. Everything here runs on one frame counter at
// timeline.fps.
//
// The channel semantics below are transcribed from the decompiled engine, not
// guessed -- MabAnimNodeHandler.Animate for the writes, MabCurve.CalcValue for
// the interpolation, MsbObjectHandler.UpdateParam for how mesh colour reaches
// a material, MsbMaterialHandler.MsbTextureParam.UpdateParam for the UV
// matrix, and MsbCameraHandler for the /354 orthographic size.

import * as loader from "./loader.js";

const TIMELINE_ROOT = "../asset/uniqueskill/timeline/";
const SCENE_ROOT = "../asset/uniqueskill/scene/";

// tools/export_uniqueskill_scene.py writes shared textures by content digest
// and references them as "us_tex/<digest>.png". The GLB itself is handed to
// GLTFLoader as a blob: URL, which has no base path, so the prefix is rewritten
// through a LoadingManager instead of being resolved as a relative path.
const TEXTURE_URI_PREFIX = "us_tex/";
const TEXTURE_ROOT = "../asset/uniqueskill/texture/";

// MabAnimNodeHandler.eAnimControlType
const CTRL_LINEAR = 0;
const CTRL_BOOL = 1;
const CTRL_CONSTANT = 2;

// MsbCameraHandler: orthographicSize = m_OrthographicsSize / 354.
const ORTHO_DIVISOR = 354;

let indexPromise = null;
let scenePromise = null;

// The scene index carries the per-scene GLB entries plus where the shared
// textures live: { textureDir, textureCount, textureBytes, scenes }.
export function loadSceneIndex() {
    if (!scenePromise) {
        scenePromise = fetch("../asset/uniqueskill/scene-index.json")
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("scene index " + response.status);
                }
                return response.json();
            })
            .catch(function (error) {
                scenePromise = null;
                throw error;
            });
    }
    return scenePromise;
}

// Loads the effect geometry for one とっておき and applies the authored
// MsbHandler state, so the first frame already looks like frame 0 of the
// original rather than a pile of untinted opaque quads.
export function loadScene(resourceId, options) {
    const opts = options || {};
    const key = String(resourceId);
    return Promise.all([loader.loadModules(), loadSceneIndex()]).then(function (parts) {
        const modules = parts[0];
        const index = parts[1];
        const entry = (index.scenes || index)[key];
        if (!entry) {
            throw new Error("no unique skill scene for " + key);
        }
        const texRoot = index.textureDir
            ? "../" + index.textureDir
            : TEXTURE_ROOT;
        return loader.readModel("../" + entry.file, entry.compression, opts.onProgress)
            .then(function (blob) { return blob.arrayBuffer(); })
            .then(function (buffer) {
                const manager = new modules.THREE.LoadingManager();
                // three.js hands the modifier `path + uri`, and the path can be
                // anything depending on how the GLB was handed over, so match
                // the marker anywhere rather than only at the start.
                manager.setURLModifier(function (uri) {
                    const at = uri.indexOf(TEXTURE_URI_PREFIX);
                    if (at >= 0) {
                        return texRoot + uri.slice(at + TEXTURE_URI_PREFIX.length);
                    }
                    return uri;
                });
                const gltf = new modules.GLTFLoader(manager);
                return new Promise(function (resolve, reject) {
                    // parse() with an empty base path: the buffer is already in
                    // hand, so there is no document URL to resolve against and
                    // the modifier above is the only thing that maps textures.
                    gltf.parse(buffer, "", resolve, reject);
                }).then(function (result) {
                    applySceneState(result.scene, modules.THREE);
                    return {
                        scene: result.scene,
                        animations: result.animations || [],
                        entry: entry,
                        modules: modules
                    };
                });
            });
    });
}

export function loadIndex() {
    if (!indexPromise) {
        indexPromise = fetch("../asset/uniqueskill/timeline-index.json")
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("timeline index " + response.status);
                }
                return response.json();
            });
    }
    return indexPromise;
}

const timelineCache = new Map();

// resourceID is the character's m_ResourceID, e.g. 100003 for Yuno 5*.
export function loadTimeline(resourceId) {
    const key = String(resourceId);
    if (!timelineCache.has(key)) {
        timelineCache.set(key, fetch(TIMELINE_ROOT + key + ".json")
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("no unique skill timeline for " + key);
                }
                return response.json();
            })
            .catch(function (error) {
                timelineCache.delete(key);
                throw error;
            }));
    }
    return timelineCache.get(key);
}

// The SE/voice cue tables live in asset/battle/uniqueskill.js, keyed
// PL_<resourceID>_0, and are loaded as a plain script that assigns
// window.kirafanUniqueSkillData.
export function sceneAudio(resourceId) {
    const data = typeof window !== "undefined" ? window.kirafanUniqueSkillData : null;
    if (!data || !data.scenes) {
        return null;
    }
    return data.scenes["PL_" + resourceId + "_0"] || null;
}

// --- curve evaluation ---------------------------------------------------

// MathFunc.Hermite_CalcValue. The derivatives are used raw against a
// normalised t, with no rescaling by the key interval -- matching the engine
// exactly matters more than matching a textbook Hermite here.
function hermite(p0, d0, p1, d1, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p0
        + (-2 * t3 + 3 * t2) * p1
        + (t3 - 2 * t2 + t) * d0
        + (t3 - t2) * d1;
}

function segmentIndex(keys, frame) {
    let lo = 0;
    let hi = keys.length - 2;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (keys[mid][0] <= frame) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo;
}

// One Meige channel key list: [frame, value, ctrl] or
// [frame, value, ctrl, leftDeriv, rightDeriv].
function evalMeige(keys, frame) {
    if (keys.length <= 1) {
        return keys[0][1];
    }
    const last = keys[keys.length - 1][0];
    // The clip plays with WrapMode.ClampForever, so hold the ends rather than
    // wrapping the way UpdateProcessIndex does for looping clips.
    if (frame <= keys[0][0]) {
        return keys[0][1];
    }
    if (frame >= last) {
        return keys[keys.length - 1][1];
    }
    const i = segmentIndex(keys, frame);
    const a = keys[i];
    const b = keys[i + 1];
    const ctrl = a[2];
    if (ctrl === CTRL_BOOL || ctrl === CTRL_CONSTANT) {
        return a[1];
    }
    const span = b[0] - a[0];
    const t = span > 0 ? (frame - a[0]) / span : 0;
    if (ctrl === CTRL_LINEAR) {
        return a[1] + (b[1] - a[1]) * t;
    }
    return hermite(a[1], a[4] || 0, b[1], b[3] || 0, t);
}

// One Unity TRS curve: [frame, [v...]] or [frame, [v...], [in...], [out...]].
// Tangents were already divided by fps by the extractor, so they are per-frame
// here and the standard Unity cubic applies.
function evalUnity(keys, frame, out) {
    const n = keys.length;
    const width = out.length;
    if (n === 1 || frame <= keys[0][0]) {
        for (let c = 0; c < width; c++) {
            out[c] = keys[0][1][c];
        }
        return out;
    }
    if (frame >= keys[n - 1][0]) {
        for (let c = 0; c < width; c++) {
            out[c] = keys[n - 1][1][c];
        }
        return out;
    }
    const i = segmentIndex(keys, frame);
    const a = keys[i];
    const b = keys[i + 1];
    const span = b[0] - a[0];
    if (span <= 0) {
        for (let c = 0; c < width; c++) {
            out[c] = a[1][c];
        }
        return out;
    }
    const t = (frame - a[0]) / span;
    const hasSlopes = a.length > 2;
    for (let c = 0; c < width; c++) {
        if (!hasSlopes) {
            out[c] = a[1][c] + (b[1][c] - a[1][c]) * t;
        } else {
            // Unity's cubic uses tangents scaled by the segment length.
            out[c] = hermite(a[1][c], a[3][c] * span, b[1][c], b[2][c] * span, t);
        }
    }
    return out;
}

// --- scene binding ------------------------------------------------------

function collectByName(root) {
    const nodes = new Map();
    root.traverse(function (child) {
        if (child.name && !nodes.has(child.name)) {
            nodes.set(child.name, child);
        }
    });
    return nodes;
}

// Materials are shared between meshes in a GLB, but meshColor is per-object in
// the original engine (MsbObjectHandler owns the work, the material is only
// the sink). Clone on first write so one animated mesh cannot tint its
// neighbours.
function ownMaterials(mesh) {
    if (mesh.userData.__usOwnMaterials) {
        return;
    }
    if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(function (m) { return m.clone(); });
    } else if (mesh.material) {
        mesh.material = mesh.material.clone();
    }
    mesh.userData.__usOwnMaterials = true;
}

function eachMaterial(object, fn) {
    object.traverse(function (child) {
        if (!child.isMesh || !child.material) {
            return;
        }
        ownMaterials(child);
        const list = Array.isArray(child.material) ? child.material : [child.material];
        list.forEach(fn);
    });
}

function baseColor(material) {
    if (!material.userData.__usBase) {
        // MsbHandler's authored m_Diffuse, when the scene GLB carries it, is
        // the value the animation multiplies against. Without it the base
        // would be whatever glTF happened to bake into baseColorFactor.
        const msb = material.userData.msb || {};
        const diffuse = msb.diffuse;
        material.userData.__usBase = {
            r: diffuse ? diffuse[0] : (material.color ? material.color.r : 1),
            g: diffuse ? diffuse[1] : (material.color ? material.color.g : 1),
            b: diffuse ? diffuse[2] : (material.color ? material.color.b : 1),
            a: diffuse ? diffuse[3] : (material.opacity !== undefined ? material.opacity : 1),
            transparent: material.transparent,
            depthWrite: material.depthWrite
        };
    }
    return material.userData.__usBase;
}

// Meige blend modes, from MeigeShaderUtility.m_blendComponent. Only the modes
// the effect scenes actually use are mapped to a three.js equivalent; the rest
// fall back to normal blending rather than silently rendering as opaque.
const BLEND_SETUP = {
    none: function (material, THREE) {
        material.blending = THREE.NoBlending;
        material.transparent = false;
    },
    srcOne: function (material, THREE) {
        material.blending = THREE.NoBlending;
        material.transparent = false;
    },
    std: function (material, THREE) {
        material.blending = THREE.NormalBlending;
        material.transparent = true;
    },
    // src*srcAlpha + dst*1: the glow mode, and the one that matters most --
    // rendering these as normal blending turns every flare into a grey card.
    add: function (material, THREE) {
        material.blending = THREE.CustomBlending;
        material.blendEquation = THREE.AddEquation;
        material.blendSrc = THREE.SrcAlphaFactor;
        material.blendDst = THREE.OneFactor;
        material.transparent = true;
        material.depthWrite = false;
    },
    sub: function (material, THREE) {
        material.blending = THREE.CustomBlending;
        material.blendEquation = THREE.ReverseSubtractEquation;
        material.blendSrc = THREE.SrcAlphaFactor;
        material.blendDst = THREE.OneFactor;
        material.transparent = true;
        material.depthWrite = false;
    },
    mul: function (material, THREE) {
        material.blending = THREE.CustomBlending;
        material.blendEquation = THREE.AddEquation;
        material.blendSrc = THREE.DstColorFactor;
        material.blendDst = THREE.ZeroFactor;
        material.transparent = true;
        material.depthWrite = false;
    },
    dstOne: function (material, THREE) {
        material.blending = THREE.CustomBlending;
        material.blendEquation = THREE.AddEquation;
        material.blendSrc = THREE.ZeroFactor;
        material.blendDst = THREE.OneFactor;
        material.transparent = true;
        material.depthWrite = false;
    }
};

// Apply the authored MsbHandler state that the scene GLB carries in extras.
// Call once after loading a scene, before the first frame is sampled.
export function applySceneState(root, THREE) {
    root.traverse(function (child) {
        const msb = child.userData ? child.userData.msb : null;
        if (msb && msb.visible === false) {
            child.visible = false;
        }
        if (msb && msb.renderOrder !== undefined) {
            child.renderOrder = msb.renderOrder;
        }
        if (!child.isMesh || !child.material) {
            return;
        }
        const list = Array.isArray(child.material) ? child.material : [child.material];
        list.forEach(function (material) {
            const state = material.userData ? material.userData.msb : null;
            if (!state) {
                return;
            }
            const blend = state.blend && state.blend.name;
            const setup = BLEND_SETUP[blend];
            if (setup) {
                setup(material, THREE);
            }
            if (blend === "none" || blend === "srcOne") {
                material.alphaTest = state.alphaTestRef || 0.01;
            }
            baseColor(material);
            if (material.color && state.diffuse) {
                material.color.setRGB(state.diffuse[0], state.diffuse[1], state.diffuse[2]);
                material.opacity = state.diffuse[3];
            }
        });
    });
}

export function createPlayer(options) {
    const opts = options || {};
    const THREE = opts.THREE;
    const timeline = opts.timeline;
    const root = opts.root;
    if (!THREE || !timeline || !root) {
        throw new Error("createPlayer needs THREE, timeline and root");
    }

    const fps = timeline.fps || 30;
    const lastFrame = Math.max(0, (timeline.frames || 1) - 1);
    const byName = collectByName(root);

    // Nodes the Unity curves address by slash path. The timeline carries the
    // rest pose of every one of them so binding does not depend on the GLB
    // agreeing about hierarchy order.
    const trsBindings = [];
    Object.keys(timeline.trs || {}).forEach(function (path) {
        const leaf = path.split("/").pop();
        const node = byName.get(leaf);
        if (!node) {
            return;
        }
        const curves = timeline.trs[path];
        trsBindings.push({
            node: node,
            t: curves.t || null,
            r: curves.r || null,
            s: curves.s || null,
            vec3: [0, 0, 0],
            vec4: [0, 0, 0, 0]
        });
    });

    // Meige channels, grouped so each object/material is written once per
    // frame instead of once per component.
    const objectChannels = new Map();   // mesh name -> { visibility, color[4] }
    const materialChannels = new Map(); // material name -> { color[4], uv }
    const cameraChannels = [];
    const emitterChannels = [];

    function objectSlot(name) {
        if (!objectChannels.has(name)) {
            const node = byName.get(name);
            const msb = node && node.userData ? node.userData.msb : null;
            const authored = msb && msb.meshColor ? msb.meshColor : [1, 1, 1, 1];
            objectChannels.set(name, {
                name: name,
                node: node || null,
                visibility: null,
                color: [null, null, null, null],
                halfVertexColor: !!(msb && msb.halfVertexColor),
                state: {
                    r: authored[0], g: authored[1], b: authored[2], a: authored[3],
                    visible: null
                }
            });
        }
        return objectChannels.get(name);
    }

    function materialSlot(name) {
        if (!materialChannels.has(name)) {
            const targets = [];
            eachMaterial(root, function (material) {
                if (material.name === name) {
                    targets.push(material);
                }
            });
            // A texOffsetUV channel writes an absolute value, but only for the
            // component it owns; the other components keep whatever the artist
            // authored. Seeding from the scene's msb extras is what keeps a
            // U-only scroll from resetting V to zero.
            const authored = targets.length && targets[0].userData
                ? targets[0].userData.msb : null;
            const tex = authored && authored.textures && authored.textures[0];
            materialChannels.set(name, {
                name: name,
                materials: targets,
                color: [null, null, null, null],
                coverage: [null, null],
                translation: [null, null],
                offset: [null, null],
                rotate: null,
                state: {
                    coverage: tex ? tex.coverageUV.slice() : [1, 1],
                    translation: tex ? tex.translationUV.slice() : [0, 0],
                    offset: tex ? tex.offsetUV.slice() : [0, 0],
                    rotate: tex ? tex.rotateUV : 0
                }
            });
        }
        return materialChannels.get(name);
    }

    (timeline.channels || []).forEach(function (channel) {
        const target = channel.target;
        const comp = channel.comp || 0;
        const keys = channel.keys;
        if (!keys || !keys.length) {
            return;
        }
        switch (target) {
        case "meshVisibility":
            objectSlot(channel.name).visibility = keys;
            break;
        case "meshColor":
            objectSlot(channel.name).color[comp] = keys;
            break;
        case "meshColor.r":
        case "meshColor.g":
        case "meshColor.b":
        case "meshColor.a":
            objectSlot(channel.name).color["rgba".indexOf(target.slice(-1))] = keys;
            break;
        case "matColor":
            materialSlot(channel.name).color[comp] = keys;
            break;
        case "matColor.r":
        case "matColor.g":
        case "matColor.b":
        case "matColor.a":
            materialSlot(channel.name).color["rgba".indexOf(target.slice(-1))] = keys;
            break;
        case "texCoverageUV":
            materialSlot(channel.name).coverage[comp] = keys;
            break;
        case "texTranslationUV":
            materialSlot(channel.name).translation[comp] = keys;
            break;
        case "texOffsetUV":
            materialSlot(channel.name).offset[comp] = keys;
            break;
        case "texRotateUV":
            materialSlot(channel.name).rotate = keys;
            break;
        case "camOrthoSize":
        case "focalLength":
            cameraChannels.push({ target: target, keys: keys });
            break;
        case "peActive":
            // Particle emitters have no three.js equivalent in the GLB, so
            // they are surfaced as callbacks keyed by emitter index rather
            // than silently dropped.
            emitterChannels.push({ index: channel.p ? channel.p[0] : 0, keys: keys });
            break;
        default:
            break;
        }
    });

    const emitterState = new Map();

    // Events and audio cues both fire on frame crossing, so they share one
    // cursor discipline: sorted once, replayed from a cursor that resets on
    // any backwards seek.
    const events = (timeline.events || [])
        .filter(function (event) { return !event.inert; })
        .slice()
        .sort(function (a, b) { return a.frame - b.frame; });

    // An explicit `audio: null` means "no cues"; only an absent key falls back
    // to the shared cue table.
    const audio = opts.audio !== undefined ? opts.audio : sceneAudio(opts.resourceId);
    const cues = [];
    if (audio) {
        ["se", "voice"].forEach(function (kind) {
            const group = audio[kind];
            if (!group || !group.frames) {
                return;
            }
            group.frames.forEach(function (pair) {
                cues.push({ kind: kind, frame: pair[0], sheet: group.sheet, cue: pair[1] });
            });
        });
        cues.sort(function (a, b) { return a.frame - b.frame; });
    }

    const state = {
        frame: 0,
        playing: false,
        speed: 1,
        eventCursor: 0,
        cueCursor: 0,
        finished: false
    };

    const tmpQuat = THREE && THREE.Quaternion ? new THREE.Quaternion() : null;

    function applyTrs(frame) {
        for (let i = 0; i < trsBindings.length; i++) {
            const bind = trsBindings[i];
            if (bind.t) {
                const v = evalUnity(bind.t, frame, bind.vec3);
                bind.node.position.set(v[0], v[1], v[2]);
            }
            if (bind.r) {
                const q = evalUnity(bind.r, frame, bind.vec4);
                tmpQuat.set(q[0], q[1], q[2], q[3]).normalize();
                bind.node.quaternion.copy(tmpQuat);
            }
            if (bind.s) {
                const v = evalUnity(bind.s, frame, bind.vec3);
                bind.node.scale.set(v[0], v[1], v[2]);
            }
        }
    }

    function applyObjects(frame) {
        objectChannels.forEach(function (slot) {
            if (!slot.node) {
                return;
            }
            if (slot.visibility) {
                // MsbObjectHandler: renderer.enabled = (value == 1).
                const visible = Math.trunc(evalMeige(slot.visibility, frame)) === 1;
                if (slot.state.visible !== visible) {
                    slot.node.visible = visible;
                    slot.state.visible = visible;
                }
                if (!visible) {
                    return;
                }
            }
            let dirty = false;
            for (let c = 0; c < 4; c++) {
                if (!slot.color[c]) {
                    continue;
                }
                const value = evalMeige(slot.color[c], frame);
                const key = "rgba"[c];
                if (slot.state[key] !== value) {
                    slot.state[key] = value;
                    dirty = true;
                }
            }
            if (!dirty) {
                return;
            }
            // Final colour is materialDiffuse * meshColor, alpha included.
            // m_bHalfVertexColor doubles rgb afterwards, which is how the
            // brighter-than-white flashes are authored.
            const gain = slot.halfVertexColor ? 2 : 1;
            eachMaterial(slot.node, function (material) {
                const base = baseColor(material);
                if (material.color) {
                    material.color.setRGB(
                        base.r * slot.state.r * gain,
                        base.g * slot.state.g * gain,
                        base.b * slot.state.b * gain
                    );
                }
                const alpha = base.a * slot.state.a;
                material.opacity = alpha;
                if (alpha < 1) {
                    material.transparent = true;
                    material.depthWrite = false;
                } else {
                    material.transparent = base.transparent;
                    material.depthWrite = base.depthWrite;
                }
            });
        });
    }

    // MsbMaterialHandler.MsbTextureParam.UpdateParam, as a UV matrix.
    // Reproduced multiplication by multiplication because the centre-of-
    // rotation offsets use 1/coverage, not 0.5, and getting that wrong shifts
    // every scrolling effect texture off its mesh.
    const uvMatrix = THREE && THREE.Matrix3 ? new THREE.Matrix3() : null;
    const uvRot = THREE && THREE.Matrix3 ? new THREE.Matrix3() : null;
    const uvTmp = THREE && THREE.Matrix3 ? new THREE.Matrix3() : null;

    function translation3(x, y) {
        return uvTmp.set(1, 0, x, 0, 1, y, 0, 0, 1);
    }

    function applyUv(slot) {
        if (!uvMatrix || !slot.materials.length) {
            return;
        }
        const st = slot.state;
        const invU = st.coverage[0] !== 0 ? 1 / st.coverage[0] : 1;
        const invV = st.coverage[1] !== 0 ? 1 / st.coverage[1] : 1;
        const rad = st.rotate * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        uvRot.set(cos, -sin, 0, sin, cos, 0, 0, 0, 1);

        uvMatrix.identity();
        uvMatrix.multiply(uvTmp.set(invU, 0, 0, 0, invV, 0, 0, 0, 1));
        uvMatrix.multiply(translation3(-0.5 * invU, 0.5 * invV));
        uvMatrix.multiply(uvRot);
        uvMatrix.multiply(translation3(0.5 * invU, -0.5 * invV));
        // offset and -translation are both rotated by the same matrix before
        // being applied as translations.
        const ox = uvRot.elements[0] * st.offset[0] + uvRot.elements[3] * st.offset[1];
        const oy = uvRot.elements[1] * st.offset[0] + uvRot.elements[4] * st.offset[1];
        uvMatrix.multiply(translation3(ox, oy));
        const nx = -st.translation[0];
        const ny = -st.translation[1];
        const tx = uvRot.elements[0] * nx + uvRot.elements[3] * ny;
        const ty = uvRot.elements[1] * nx + uvRot.elements[4] * ny;
        uvMatrix.multiply(translation3(tx, ty));

        slot.materials.forEach(function (material) {
            const map = material.map;
            if (!map) {
                return;
            }
            map.matrixAutoUpdate = false;
            map.matrix.copy(uvMatrix);
        });
    }

    function applyMaterials(frame) {
        materialChannels.forEach(function (slot) {
            if (!slot.materials.length) {
                return;
            }
            for (let c = 0; c < 4; c++) {
                if (!slot.color[c]) {
                    continue;
                }
                const value = evalMeige(slot.color[c], frame);
                slot.materials.forEach(function (material) {
                    const base = baseColor(material);
                    if (c === 3) {
                        material.opacity = value;
                        material.transparent = value < 1 ? true : base.transparent;
                        material.depthWrite = value < 1 ? false : base.depthWrite;
                    } else if (material.color) {
                        material.color["rgb"[c]] = value;
                    }
                });
            }
            let uvDirty = false;
            for (let c = 0; c < 2; c++) {
                if (slot.coverage[c]) {
                    slot.state.coverage[c] = evalMeige(slot.coverage[c], frame);
                    uvDirty = true;
                }
                if (slot.translation[c]) {
                    // Animate() negates the V component on write.
                    const v = evalMeige(slot.translation[c], frame);
                    slot.state.translation[c] = c === 1 ? -v : v;
                    uvDirty = true;
                }
                if (slot.offset[c]) {
                    const v = evalMeige(slot.offset[c], frame);
                    slot.state.offset[c] = c === 1 ? -v : v;
                    uvDirty = true;
                }
            }
            if (slot.rotate) {
                slot.state.rotate = evalMeige(slot.rotate, frame);
                uvDirty = true;
            }
            if (uvDirty) {
                applyUv(slot);
            }
        });
    }

    function applyCamera(frame) {
        const camera = opts.camera;
        const meta = timeline.camera || {};
        if (!camera) {
            return;
        }
        for (let i = 0; i < cameraChannels.length; i++) {
            const channel = cameraChannels[i];
            const value = evalMeige(channel.keys, frame);
            if (channel.target === "camOrthoSize" && camera.isOrthographicCamera) {
                const size = value / (meta.orthoDivisor || ORTHO_DIVISOR);
                const aspect = opts.aspect || 1;
                camera.top = size;
                camera.bottom = -size;
                camera.left = -size * aspect;
                camera.right = size * aspect;
                camera.updateProjectionMatrix();
            } else if (channel.target === "focalLength" && camera.isPerspectiveCamera) {
                camera.setFocalLength(value);
            }
        }
        // The camera node is animated by a TRS curve, but MsbCameraHandler
        // hard-sets rotation for the orthographic path and ignores the
        // animated rotation entirely.
        const node = meta.node ? byName.get(meta.node.split("/").pop()) : null;
        if (node) {
            node.updateWorldMatrix(true, false);
            node.getWorldPosition(camera.position);
            if (camera.isOrthographicCamera && meta.fixedEulerY !== undefined) {
                camera.rotation.set(0, meta.fixedEulerY * Math.PI / 180, 0);
            } else {
                node.getWorldQuaternion(camera.quaternion);
            }
        }
    }

    function applyEmitters(frame) {
        for (let i = 0; i < emitterChannels.length; i++) {
            const channel = emitterChannels[i];
            const active = Math.trunc(evalMeige(channel.keys, frame)) === 1;
            if (emitterState.get(channel.index) === active) {
                continue;
            }
            emitterState.set(channel.index, active);
            if (opts.onEmitter) {
                opts.onEmitter(channel.index, active, frame);
            }
        }
    }

    function fireEvents(frame) {
        while (state.eventCursor < events.length && events[state.eventCursor].frame <= frame) {
            const event = events[state.eventCursor++];
            if (opts.onEvent) {
                opts.onEvent(event);
            }
        }
    }

    function fireCues(frame) {
        while (state.cueCursor < cues.length && cues[state.cueCursor].frame <= frame) {
            const cue = cues[state.cueCursor++];
            const handler = cue.kind === "se" ? opts.onSe : opts.onVoice;
            if (handler) {
                handler(cue);
            }
        }
    }

    function rewindCursors(frame) {
        state.eventCursor = 0;
        while (state.eventCursor < events.length && events[state.eventCursor].frame < frame) {
            state.eventCursor++;
        }
        state.cueCursor = 0;
        while (state.cueCursor < cues.length && cues[state.cueCursor].frame < frame) {
            state.cueCursor++;
        }
    }

    function sample(frame) {
        applyTrs(frame);
        applyObjects(frame);
        applyMaterials(frame);
        applyCamera(frame);
        applyEmitters(frame);
    }

    return {
        timeline: timeline,
        fps: fps,
        frames: timeline.frames || 0,
        duration: timeline.duration || (timeline.frames || 0) / fps,
        events: events,
        cues: cues,
        get frame() { return state.frame; },
        get playing() { return state.playing; },
        get finished() { return state.finished; },

        // Pose the scene at a frame without firing events or audio. Use for
        // scrubbing and for the initial pose before play().
        seek: function (frame) {
            state.frame = Math.max(0, Math.min(lastFrame, frame));
            state.finished = false;
            rewindCursors(state.frame);
            sample(state.frame);
            return this;
        },

        play: function () {
            state.playing = true;
            state.finished = false;
            return this;
        },

        pause: function () {
            state.playing = false;
            return this;
        },

        // Restart from frame 0 with every cursor armed, so a replay fires the
        // same events and cues as the first run.
        restart: function () {
            state.frame = 0;
            state.eventCursor = 0;
            state.cueCursor = 0;
            state.finished = false;
            state.playing = true;
            sample(0);
            fireEvents(0);
            fireCues(0);
            return this;
        },

        setSpeed: function (value) {
            state.speed = Number(value) || 1;
            return this;
        },

        setAspect: function (value) {
            opts.aspect = Number(value) || 1;
            return this;
        },

        // dt in seconds. Returns true while the cinematic is still running.
        update: function (dt) {
            if (!state.playing) {
                return !state.finished;
            }
            state.frame += (dt || 0) * fps * state.speed;
            if (state.frame >= lastFrame) {
                state.frame = lastFrame;
                state.playing = false;
                state.finished = true;
            }
            sample(state.frame);
            fireEvents(state.frame);
            fireCues(state.frame);
            if (state.finished && opts.onFinish) {
                opts.onFinish();
            }
            return !state.finished;
        }
    };
}
