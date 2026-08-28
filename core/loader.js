// Model loading for the fan-game layer.
//
// Lifted out of models.js so the four games can share one loader without
// four of them editing that file. The material rules below are not
// guesses -- they are what the original engine's Unity material floats
// say, and getting them wrong produces the dark seams and vanishing
// face parts that models.js spent several commits chasing down. Keep
// them in sync with models.js:1804 if either side changes.

const THREE_BUILD = "0.180.0";

const MODULE_SOURCES = [
    {
        three: "../vendor/three/three.module.min.js",
        orbit: "../vendor/three/OrbitControls.js",
        gltf: "../vendor/three/GLTFLoader.js",
        meshopt: "../vendor/three/meshopt_decoder.module.js"
    },
    {
        three: "https://cdn.jsdelivr.net/npm/three@" + THREE_BUILD + "/build/three.module.js",
        orbit: "https://cdn.jsdelivr.net/npm/three@" + THREE_BUILD + "/examples/jsm/controls/OrbitControls.js",
        gltf: "https://cdn.jsdelivr.net/npm/three@" + THREE_BUILD + "/examples/jsm/loaders/GLTFLoader.js",
        meshopt: "https://cdn.jsdelivr.net/npm/three@" + THREE_BUILD + "/examples/jsm/libs/meshopt_decoder.module.js"
    }
];

let modulePromise = null;
let manifestPromise = null;

// Chrome gives file:// pages an opaque origin, so neither fetch nor XHR can
// read the manifest or any .glb.gz next to the page. Worth detecting up front
// so games can show a useful hint instead of a stack trace.
export const IS_LOCAL_FILE = window.location.protocol === "file:";
export const LOCAL_FILE_HINT = "本地直接打开页面时浏览器禁止读取同目录文件。请在项目目录运行 python -m http.server 8642 后访问 http://localhost:8642/game.html";

// Prefer the vendored copies so the games keep working where the CDN is
// unreachable.
export function loadModules() {
    if (modulePromise) {
        return modulePromise;
    }
    modulePromise = MODULE_SOURCES.reduce(function (chain, source) {
        return chain.catch(function () {
            return Promise.all([
                import(source.three),
                import(source.orbit),
                import(source.gltf),
                import(source.meshopt)
            ]);
        });
    }, Promise.reject()).then(function (parts) {
        return {
            THREE: parts[0],
            OrbitControls: parts[1].OrbitControls,
            GLTFLoader: parts[2].GLTFLoader,
            MeshoptDecoder: parts[3].MeshoptDecoder
        };
    });
    return modulePromise;
}

export function loadManifest() {
    if (manifestPromise) {
        return manifestPromise;
    }
    manifestPromise = fetch("../asset/models/manifest.json?v=fangame-1").then(function (response) {
        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }
        return response.json();
    });
    return manifestPromise;
}

// gzip'd GLB -> blob URL. onProgress receives a 0..1 fraction while the body
// streams, then null once we move on to decompression.
// Exported because the とっておき scenes live in their own index rather than the
// model manifest, and reimplementing the streaming + integrity check there
// would be the same code twice.
export function readModel(url, compression, onProgress) {
    return fetch(url).then(function (response) {
        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }
        const total = Number(response.headers.get("Content-Length") || 0);
        if (!total || !response.body) {
            return response.blob();
        }
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        function pump() {
            return reader.read().then(function (result) {
                if (result.done) {
                    return new Blob(chunks);
                }
                received += result.value.byteLength;
                if (onProgress) {
                    onProgress(Math.min(0.99, received / total));
                }
                chunks.push(result.value);
                return pump();
            });
        }
        return pump();
    }).then(function (blob) {
        if (compression !== "gzip") {
            return blob;
        }
        if (!("DecompressionStream" in window)) {
            throw new Error("gzip decompression is unavailable");
        }
        if (onProgress) {
            onProgress(null);
        }
        const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
        return new Response(stream).blob();
    }).then(function (blob) {
        // A truncated body still parses far enough to render garbage, so
        // compare the GLB's own declared length against what we hold.
        if (blob.size >= 20) {
            return blob.slice(0, 20).arrayBuffer().then(function (head) {
                const view = new DataView(head);
                const magic = String.fromCharCode(
                    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
                );
                const declared = view.getUint32(8, true);
                if (magic !== "glTF" || declared !== blob.size) {
                    console.warn("GLB integrity mismatch:", magic, "declared", declared, "actual", blob.size);
                }
                return blob;
            });
        }
        return blob;
    });
}

// gltfpack strips mesh names, so GLTFLoader falls back to "mesh_<index>".
// The real name survives on the wrapper node around a skinned mesh.
const GENERATED_MESH_NAME = /^mesh_\d+$/;

export function resolveNodeName(node) {
    if (node.name && !GENERATED_MESH_NAME.test(node.name)) {
        return node.name;
    }
    let parent = node.parent;
    while (parent) {
        if (parent.name && !GENERATED_MESH_NAME.test(parent.name)) {
            return parent.name;
        }
        parent = parent.parent;
    }
    return node.name || "";
}

function resolveRenderOrder(mesh) {
    let node = mesh;
    while (node) {
        if (node.userData && node.userData.renderOrder !== undefined && node.userData.renderOrder !== null) {
            return Number(node.userData.renderOrder) || 0;
        }
        node = node.parent;
    }
    const geometry = mesh.geometry;
    if (geometry && geometry.userData && geometry.userData.renderOrder !== undefined) {
        return Number(geometry.userData.renderOrder) || 0;
    }
    return 0;
}

// Apply the engine's own alpha/depth rules.
//
// Body and head materials do not blend: _Mode=0 (opaque), _SrcBlend=One /
// _DstBlend=Zero, _ZWrite=1, with MsbHandler supplying an alpha test ref of
// 0.01. Blending them pushes every layer into three.js's transparent queue,
// where the first-drawn piece blends its anti-aliased edge against the
// background and then writes depth -- later layers behind it get depth-
// rejected and the edge keeps that background colour. That is the dark seam
// where a hat brim meets hair.
//
// The "_outline" material is the genuinely translucent one (_Mode=3,
// _DstBlend=OneMinusSrcAlpha, _ZWrite=0) and covers pieces meant to read as
// see-through: crystal balls, far arms, sleeves. It must keep blending and
// must not write depth.
export function applyMaterialRules(root, THREE, options) {
    const opts = options || {};
    const kind = opts.kind || "player";
    const depthWrite = opts.depthWrite !== false;
    root.traverse(function (child) {
        if (!child.isMesh || !child.material) {
            return;
        }
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(function (material) {
            const blended = /_outline$/i.test(material.name || "");
            material.transparent = blended;
            material.alphaTest = blended ? 0 : 0.01;
            material.depthWrite = !blended && depthWrite;
            material.depthTest = true;
            // Weapons carry their cartoon outline as an inverted hull mapped to
            // a black texel, so they must cull back faces or the shell hides
            // the weapon. Characters stay double-sided because mirrored
            // left/right pieces have no reliable GLB winding direction.
            material.side = kind === "weapon" ? THREE.FrontSide : THREE.DoubleSide;
        });
        child.renderOrder = resolveRenderOrder(child);
        // Skinned vertices follow their bones, but frustum culling uses the
        // node's bounding sphere, which stays at the skeleton origin in these
        // exports -- zooming onto a face culled the eyes, brows and mouth.
        if (child.isSkinnedMesh) {
            child.frustumCulled = false;
        }
    });
}

const objectUrls = [];

// Load one asset key from the manifest (e.g. "model/player/model_pl_140106.muast").
// Returns { scene, animations, entry }. Materials are already corrected.
export function load(assetKey, options) {
    const opts = options || {};
    return Promise.all([loadModules(), loadManifest()]).then(function (parts) {
        const modules = parts[0];
        const manifest = parts[1];
        const entry = manifest.models[assetKey];
        if (!entry) {
            throw new Error("asset not in manifest: " + assetKey);
        }
        return readModel("../" + entry.file, entry.compression, opts.onProgress).then(function (blob) {
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            const loader = new modules.GLTFLoader();
            if (entry.meshopt) {
                loader.setMeshoptDecoder(modules.MeshoptDecoder);
            }
            return new Promise(function (resolve, reject) {
                loader.load(url, resolve, undefined, reject);
            }).then(function (gltf) {
                applyMaterialRules(gltf.scene, modules.THREE, {
                    kind: opts.kind || assetKey.split("/")[1],
                    depthWrite: entry.depthWrite
                });
                return { scene: gltf.scene, animations: gltf.animations || [], entry: entry };
            });
        });
    });
}

// Load a class-action bundle: the shared idle/attack/class_skill_1..3 clips
// for a class + head combination. These are what make the RPG's battle
// animations free -- they map one-to-one onto the original command layout.
export function loadClassActions(classId, headId) {
    return Promise.all([loadModules(), loadManifest()]).then(function (parts) {
        const modules = parts[0];
        const manifest = parts[1];
        const key = String(classId) + ":" + String(headId || 0);
        const entry = (manifest.classActions || {})[key]
            || (manifest.classActions || {})[String(classId) + ":0"];
        if (!entry) {
            throw new Error("no class actions for " + key);
        }
        return readModel("../" + entry.file, entry.compression).then(function (blob) {
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            const loader = new modules.GLTFLoader();
            if (entry.meshopt) {
                loader.setMeshoptDecoder(modules.MeshoptDecoder);
            }
            return new Promise(function (resolve, reject) {
                loader.load(url, resolve, undefined, reject);
            }).then(function (gltf) {
                return { animations: gltf.animations || [], names: entry.animations || [] };
            });
        });
    });
}

export function disposeObject(object) {
    const materials = new Set();
    const textures = new Set();
    object.traverse(function (child) {
        if (child.geometry) {
            child.geometry.dispose();
        }
        if (!child.material) {
            return;
        }
        (Array.isArray(child.material) ? child.material : [child.material]).forEach(function (material) {
            materials.add(material);
            Object.keys(material).forEach(function (key) {
                const value = material[key];
                if (value && value.isTexture) {
                    textures.add(value);
                }
            });
        });
    });
    textures.forEach(function (texture) { texture.dispose(); });
    materials.forEach(function (material) { material.dispose(); });
}

export function revokeUrls() {
    while (objectUrls.length) {
        URL.revokeObjectURL(objectUrls.pop());
    }
}
