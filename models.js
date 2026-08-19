(function () {
    "use strict";

    var DATABASE_URL = "https://database.kirafan.cn/assetBundle.json";
    var MODEL_MANIFEST_URL = "asset/models/manifest.json?v=20260819-4";
    var ASSET_HOST = "https://asset.kirafan.cn/";
    var INDEX_PAGE_SIZE = 30;
    var MODEL_PATH = /^model\/(player|enemy|weapon|shadow)\//;
    var MODEL_PREVIEWS = {};
    var CLASS_ACTION_PREVIEWS = {};
    var PLAYER_MODEL_META = {};
    var MODEL_TITLES = [];
    var manifestState = { loaded: false, error: false };
    var activeModelCleanup = null;
    var state = {
        allModels: [],
        filteredModels: [],
        selected: null,
        kind: "all",
        titleId: "all",
        query: "",
        page: 1,
        indexRequest: 0
    };

    var elements = {
        search: document.getElementById("modelSearch"),
        titleFilter: document.getElementById("modelTitleFilter"),
        status: document.getElementById("modelsStatus"),
        resultCount: document.getElementById("modelsResultCount"),
        list: document.getElementById("modelList"),
        pagination: document.getElementById("modelsPagination"),
        detail: document.getElementById("modelDetail")
    };

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (character) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                "\"": "&quot;",
                "'": "&#39;"
            }[character];
        });
    }

    function formatSize(bytes) {
        if (!Number.isFinite(bytes)) {
            return "大小未知";
        }
        if (bytes < 1024) {
            return bytes + " B";
        }
        if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(0) + " KB";
        }
        return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    }

    function pathParts(name) {
        var parts = name.split("/");
        return {
            kind: parts[1] || "other",
            file: parts[parts.length - 1] || name
        };
    }

    function buildPlayerMetadata() {
        var data = window.kirafanGachaData;
        if (!data || !Array.isArray(data.cards) || !Array.isArray(data.titles)) {
            return;
        }
        MODEL_TITLES = data.titles.slice();
        data.cards.forEach(function (card) {
            [
                {
                    resourceId: card.resourceId,
                    headId: card.headId,
                    dedicatedAnimType: card.dedicatedAnimType
                },
                {
                    resourceId: card.evolvedResourceId,
                    headId: card.evolvedHeadId,
                    dedicatedAnimType: card.evolvedDedicatedAnimType
                }
            ].forEach(function (form) {
                var resourceId = form.resourceId;
                if (!Number.isFinite(resourceId)) {
                    return;
                }
                PLAYER_MODEL_META[String(resourceId).padStart(6, "0")] = {
                    titleId: card.titleId,
                    title: card.title,
                    titleZh: card.titleZh,
                    character: card.character,
                    characterZh: card.characterZh,
                    class: card.class,
                    headId: form.headId,
                    dedicatedAnimType: form.dedicatedAnimType,
                    dedicatedWeapon: card.dedicatedWeapon || null
                };
            });
        });
    }

    function modelMetadata(model) {
        var match = /^model\/player\/model_pl_(\d+)\.muast$/.exec(model.name);
        return match ? PLAYER_MODEL_META[match[1]] || null : null;
    }

    function bilingualLabel(chinese, japanese) {
        if (!chinese || chinese === japanese) {
            return japanese || chinese || "";
        }
        return chinese + " / " + japanese;
    }

    function populateTitleFilter() {
        if (!elements.titleFilter) {
            return;
        }
        var counts = {};
        state.allModels.forEach(function (model) {
            var metadata = modelMetadata(model);
            if (metadata) {
                counts[metadata.titleId] = (counts[metadata.titleId] || 0) + 1;
            }
        });
        elements.titleFilter.innerHTML = "<option value='all'>全部作品</option>";
        MODEL_TITLES.filter(function (title) {
            return counts[title.id];
        }).sort(function (left, right) {
            return bilingualLabel(left.nameZh, left.name).localeCompare(
                bilingualLabel(right.nameZh, right.name),
                "zh-CN"
            );
        }).forEach(function (title) {
            var option = document.createElement("option");
            option.value = String(title.id);
            option.textContent = bilingualLabel(title.nameZh, title.name) + "（" + counts[title.id] + "）";
            elements.titleFilter.appendChild(option);
        });
    }

    function bucketFor(model) {
        return model.path ? model.path.charAt(model.path.length - 1) : "";
    }

    function modelIndexUrl(model) {
        var nameWithoutExtension = model.name.slice(0, -6);
        return "https://bucket-" + bucketFor(model) + "-asset.kirafan.cn/" + nameWithoutExtension + "/index.json";
    }

    function modelAssetUrl(model, spriteName) {
        var nameWithoutExtension = model.name.slice(0, -6);
        return "https://bucket-" + bucketFor(model) + "-asset.kirafan.cn/" + nameWithoutExtension + "/" + spriteName + ".png";
    }

    function rawAssetUrl(model) {
        return "https://bucket-" + bucketFor(model) + "-asset.kirafan.cn/" + model.name;
    }

    function detailUrl(model) {
        return "https://asset.kirafan.moe/#/" + model.name;
    }

    function setStatus(message, tone) {
        elements.status.textContent = message;
        elements.status.dataset.tone = tone || "";
    }

    function setHash(model) {
        if (!model) {
            return;
        }
        window.history.replaceState(null, "", "#" + encodeURIComponent(model.name));
    }

    function modelFromHash() {
        if (!window.location.hash) {
            return null;
        }
        var name = decodeURIComponent(window.location.hash.slice(1));
        return state.allModels.find(function (model) { return model.name === name; }) || null;
    }

    function updateCounts() {
        var counts = { all: state.allModels.length, ready: 0, player: 0, enemy: 0, weapon: 0 };
        state.allModels.forEach(function (model) {
            var kind = pathParts(model.name).kind;
            if (MODEL_PREVIEWS[model.name]) {
                counts.ready += 1;
            }
            if (Object.prototype.hasOwnProperty.call(counts, kind)) {
                counts[kind] += 1;
            }
        });
        Object.keys(counts).forEach(function (key) {
            var countElement = document.querySelector("[data-count='" + key + "']");
            if (countElement) {
                countElement.textContent = key === "ready" && manifestState.error
                    ? "加载失败"
                    : counts[key].toLocaleString("zh-CN");
            }
        });
        var readyButton = document.querySelector(".models-filter[data-kind='ready']");
        if (readyButton) {
            readyButton.disabled = manifestState.error;
            readyButton.title = manifestState.error ? "WebGL 清单未能载入，请刷新或检查部署文件" : "只显示可直接预览的模型";
        }
    }

    function applyFilter() {
        var query = state.query.trim().toLowerCase();
        state.filteredModels = state.allModels.filter(function (model) {
            var parts = pathParts(model.name);
            var metadata = modelMetadata(model);
            if (state.kind === "ready" && !MODEL_PREVIEWS[model.name]) {
                return false;
            }
            if (state.kind !== "all" && state.kind !== "ready" && parts.kind !== state.kind) {
                return false;
            }
            if (state.titleId !== "all" && (!metadata || String(metadata.titleId) !== state.titleId)) {
                return false;
            }
            if (!query) {
                return true;
            }
            var searchText = [
                model.name,
                metadata && metadata.title,
                metadata && metadata.titleZh,
                metadata && metadata.character,
                metadata && metadata.characterZh
            ].filter(Boolean).join(" ").toLowerCase();
            return searchText.indexOf(query) !== -1;
        });
        state.page = Math.min(state.page, Math.max(1, Math.ceil(state.filteredModels.length / INDEX_PAGE_SIZE)));
        renderList();
    }

    function renderList() {
        var start = (state.page - 1) * INDEX_PAGE_SIZE;
        var pageModels = state.filteredModels.slice(start, start + INDEX_PAGE_SIZE);
        var pageCount = Math.max(1, Math.ceil(state.filteredModels.length / INDEX_PAGE_SIZE));
        elements.resultCount.textContent = state.filteredModels.length.toLocaleString("zh-CN") + " 条 · " + pageCount + " 页";
        elements.list.innerHTML = "";

        if (pageModels.length === 0) {
            elements.list.innerHTML = "<div class='models-list-empty'>没有符合条件的模型。<br>可以换一个编号或分类。</div>";
        } else {
            pageModels.forEach(function (model) {
                var parts = pathParts(model.name);
                var metadata = modelMetadata(model);
                var item = document.createElement("button");
                item.type = "button";
                item.className = "model-list-item" + (state.selected && state.selected.name === model.name ? " is-selected" : "");
                item.setAttribute("role", "option");
                item.setAttribute("aria-selected", state.selected && state.selected.name === model.name ? "true" : "false");
                var previewLabel = MODEL_PREVIEWS[model.name] ? " · WEBGL" : "";
                var workLabel = metadata ? bilingualLabel(metadata.titleZh, metadata.title) + " · " : "";
                item.innerHTML = "<img class='model-list-icon' src='" + ASSET_HOST + encodeURI(model.name) + "?type=icon' alt='' loading='lazy'>" +
                    "<span class='model-list-copy'><strong>" + escapeHtml(parts.file.replace(/\.muast$/i, "")) + "</strong><small>" + escapeHtml(workLabel + parts.kind + " · " + formatSize(model.size) + previewLabel) + "</small></span><span class='model-list-arrow' aria-hidden='true'>›</span>";
                item.addEventListener("click", function () { selectModel(model); });
                elements.list.appendChild(item);
            });
            var selectedItem = elements.list.querySelector(".model-list-item.is-selected");
            if (selectedItem) {
                elements.list.scrollTop = Math.max(0, selectedItem.offsetTop - elements.list.offsetTop - 8);
            }
        }

        renderPagination();
    }

    function renderPagination() {
        var pageCount = Math.max(1, Math.ceil(state.filteredModels.length / INDEX_PAGE_SIZE));
        elements.pagination.innerHTML = "";
        if (pageCount <= 1) {
            return;
        }
        var previous = document.createElement("button");
        previous.type = "button";
        previous.textContent = "‹";
        previous.title = "上一页";
        previous.disabled = state.page === 1;
        previous.addEventListener("click", function () { state.page -= 1; renderList(); });
        elements.pagination.appendChild(previous);

        var label = document.createElement("span");
        label.textContent = "第 " + state.page + " / " + pageCount + " 页 · 共 " + state.filteredModels.length.toLocaleString("zh-CN") + " 条";
        elements.pagination.appendChild(label);

        var next = document.createElement("button");
        next.type = "button";
        next.textContent = "›";
        next.title = "下一页";
        next.disabled = state.page === pageCount;
        next.addEventListener("click", function () { state.page += 1; renderList(); });
        elements.pagination.appendChild(next);
    }

    function renderDetailShell(model, spriteNames) {
        var parts = pathParts(model.name);
        var spriteCount = spriteNames.length;
        var preview = MODEL_PREVIEWS[model.name];
        var metadata = modelMetadata(model);
        var hasPlayerActions = Boolean(preview && (preview.animations || metadata || parts.kind === "enemy"));
        var actionMarkup = hasPlayerActions
            ? "<section class='model-control-section'><div class='model-control-heading'><strong>动作</strong><small>" + (parts.kind === "enemy" && !preview.animations ? "动作预览" : "官方 AnimationClip") + "</small></div><div id='modelActionStrip' class='model-action-strip' role='group' aria-label='游戏动作'></div></section>"
            : "";
        var faceMarkup = preview
            ? "<section class='model-control-section' id='modelFaceInterface'" + (preview.expressions ? "" : " hidden") + "><div class='model-control-heading'><strong>表情</strong><small>状态层默认关闭</small></div><div class='model-face-strip' role='group' aria-label='表情预设'><button class='is-active' type='button' id='modelFaceAuto' aria-pressed='true'>跟随动作</button><button type='button' data-face-preset='normal' aria-pressed='false'>通常</button><button type='button' data-face-preset='smile' aria-pressed='false'>微笑</button><button type='button' data-face-preset='happy' aria-pressed='false'>开心</button><button type='button' data-face-preset='angry' aria-pressed='false'>生气</button><button type='button' data-face-preset='sad' aria-pressed='false'>难过</button><button type='button' data-face-preset='surprised' aria-pressed='false'>惊讶</button><button type='button' data-face-preset='abnormal' aria-pressed='false'>异常状态</button></div><details class='model-face-advanced' id='modelFaceAdvanced'><summary>表情组件</summary><div id='modelFaceControls' class='model-face-controls'></div></details></section>"
            : "";
        var unavailableMarkup = manifestState.error
            ? "<div class='model-conversion-note'><strong>WebGL 模型清单未能载入</strong><span>纹理索引正常；请刷新页面，或检查部署中是否包含 asset/models/manifest.json。</span></div>"
            : "<div class='model-conversion-note'><strong>该条目的原始模型包当前不可用</strong><span>源素材索引仍保留条目，但转换时无法取得 Unity 包；透明纹理仍可正常查看。</span></div>";
        var dedicatedWeapon = metadata && metadata.dedicatedWeapon;
        var dedicatedResources = dedicatedWeapon
            ? [dedicatedWeapon.resourceIdL, dedicatedWeapon.resourceIdR].filter(Number.isFinite)
            : [];
        var dedicatedAvailable = dedicatedResources.some(function (resourceId) {
            return Boolean(MODEL_PREVIEWS["model/weapon/wpn_" + resourceId + ".muast"]);
        });
        var weaponMarkup = metadata
            ? "<section class='model-control-section' id='modelWeaponInterface' data-default-mode='" + (dedicatedAvailable ? "dedicated" : "default") + "'><div class='model-control-heading'><strong>装备</strong><small id='modelWeaponStatus'>" + (dedicatedAvailable ? escapeHtml(dedicatedWeapon.name) : "职业默认武器") + "</small></div><div class='model-weapon-options' role='group' aria-label='武器显示'><button type='button' data-weapon-mode='none' aria-pressed='false'>不持有</button><button type='button' data-weapon-mode='default' aria-pressed='" + String(!dedicatedAvailable) + "' class='" + (dedicatedAvailable ? "" : "is-active") + "'>职业武器</button>" + (dedicatedAvailable ? "<button type='button' data-weapon-mode='dedicated' class='is-active' aria-pressed='true'>专用武器</button>" : "") + "</div></section>"
            : "";
        var adjustMarkup = preview
            ? "<section class='model-control-section model-view-controls'><div class='model-control-heading'><strong>构图</strong><small>画布视图</small></div><div class='model-adjust-drawer' id='modelAdjustDrawer'><label><span>模型大小</span><input id='modelScaleRange' type='range' min='60' max='160' value='100' step='1'><output id='modelScaleValue'>100%</output></label><label><span>上下位置</span><input id='modelVerticalRange' type='range' min='-50' max='50' value='0' step='1'><output id='modelVerticalValue'>0</output></label></div></section>"
            : "";
        var previewMarkup = preview
            ? "<section class='model-3d-card' aria-label='游戏模型预览'><div class='model-3d-toolbar'><div><span class='model-live-badge'><i aria-hidden='true'></i>LIVE WEBGL</span><strong>模型观察台</strong><small>" + escapeHtml(preview.label) + "</small></div><div class='model-3d-actions'>" + (hasPlayerActions ? "<button id='modelMotionToggle' type='button' aria-pressed='true' title='暂停或恢复动作'><span aria-hidden='true'>Ⅱ</span> 动作</button>" : "") + "<button id='modelViewReset' type='button' title='恢复模型位置和镜头'><span aria-hidden='true'>↺</span> 重置</button></div></div><div class='model-viewer-layout'><div class='model-viewer-stage'><div id='model3dCanvas' class='model-3d-canvas'><div class='model-3d-loading'><span class='model-spinner' aria-hidden='true'></span><p>正在读取模型数据……</p></div></div></div><aside class='model-viewer-inspector' aria-label='模型控制台'>" + weaponMarkup + actionMarkup + faceMarkup + adjustMarkup + "</aside></div></section>"
            : unavailableMarkup;
        var identityMarkup = metadata
            ? "<span>作品 <strong>" + escapeHtml(bilingualLabel(metadata.titleZh, metadata.title)) + "</strong></span><span>角色 <strong>" + escapeHtml(bilingualLabel(metadata.characterZh, metadata.character)) + "</strong></span>"
            : "";
        elements.detail.innerHTML = "<header class='model-detail-header'><div><span class='models-eyebrow'>" + escapeHtml(parts.kind.toUpperCase()) + " MODEL</span><h2 id='modelDetailTitle'>" + escapeHtml(parts.file.replace(/\.muast$/i, "")) + "</h2><p class='model-detail-path'>" + escapeHtml(model.name) + "</p></div><div class='model-detail-actions'><a href='" + detailUrl(model) + "' target='_blank' rel='noopener noreferrer'>官方详情 ↗</a><a href='" + rawAssetUrl(model) + "' target='_blank' rel='noopener noreferrer'>原始包 ↗</a></div></header>" +
            "<div class='model-meta'>" + identityMarkup + "<span>包大小 <strong>" + formatSize(model.size) + "</strong></span><span>可视纹理 <strong>" + spriteCount + " 个</strong></span><span>Bucket <strong>" + escapeHtml(bucketFor(model)) + "</strong></span></div>" +
            previewMarkup +
            "<div class='model-texture-heading'><div><span class='models-eyebrow'>SOURCE TEXTURES</span><h3>模型纹理图集</h3></div><p>用于核对模型使用的原始贴图，不等同于模型本身。</p></div><div class='model-texture-grid' id='modelTextureGrid'></div>";
        var grid = document.getElementById("modelTextureGrid");
        spriteNames.forEach(function (spriteName, index) {
            var card = document.createElement("figure");
            card.className = "model-texture-card";
            card.innerHTML = "<div class='model-texture-frame'><img src='" + modelAssetUrl(model, spriteName) + "' alt='" + escapeHtml(spriteName) + "' loading='lazy' decoding='async'></div><figcaption><strong>" + escapeHtml(spriteName.split("/").pop()) + "</strong><span>纹理 " + (index + 1) + " / " + spriteCount + "</span></figcaption>";
            grid.appendChild(card);
        });
        if (preview) {
            mount3DModel(preview, metadata, parts.kind);
        }
    }

    function mount3DModel(preview, metadata, modelKind) {
        var host = document.getElementById("model3dCanvas");
        var motionButton = document.getElementById("modelMotionToggle");
        var resetButton = document.getElementById("modelViewReset");
        var adjustButton = document.getElementById("modelAdjustToggle");
        var adjustDrawer = document.getElementById("modelAdjustDrawer");
        var scaleRange = document.getElementById("modelScaleRange");
        var scaleValue = document.getElementById("modelScaleValue");
        var verticalRange = document.getElementById("modelVerticalRange");
        var verticalValue = document.getElementById("modelVerticalValue");
        var actionStrip = document.getElementById("modelActionStrip");
        var faceControls = document.getElementById("modelFaceControls");
        var faceInterface = document.getElementById("modelFaceInterface");
        var faceAutoButton = document.getElementById("modelFaceAuto");
        var weaponInterface = document.getElementById("modelWeaponInterface");
        var weaponStatus = document.getElementById("modelWeaponStatus");
        var weaponButtons = Array.prototype.slice.call(document.querySelectorAll("[data-weapon-mode]"));
        var actionButtons = [];
        var faceButtons = Array.prototype.slice.call(document.querySelectorAll("[data-face-preset]"));
        if (!host || !resetButton) {
            return;
        }

        Promise.all([
            import("three"),
            import("three/addons/controls/OrbitControls.js"),
            import("three/addons/loaders/GLTFLoader.js"),
            import("three/addons/libs/meshopt_decoder.module.js")
        ]).then(function (modules) {
            var THREE = modules[0];
            var OrbitControls = modules[1].OrbitControls;
            var GLTFLoader = modules[2].GLTFLoader;
            var MeshoptDecoder = modules[3].MeshoptDecoder;
            if (!document.body.contains(host)) {
                return;
            }

            var scene = new THREE.Scene();
            var camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
            var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            var controls = new OrbitControls(camera, renderer.domElement);
            var resizeObserver = null;
            var modelObject = null;
            var mixer = null;
            var activeClipAction = null;
            var clipByName = {};
            var motionEnabled = true;
            var activeAction = "idle";
            var faceFollowsAction = true;
            var activeFaceSelection = null;
            var nextBlinkAt = window.performance.now() + 2800;
            var blinkUntil = 0;
            var blinkActive = false;
            var disposed = false;
            var animationFrame = 0;
            var previousFrame = window.performance.now();
            var objectUrls = [];
            var mountedWeaponParts = [];
            var weaponRequest = 0;
            var homeView = null;
            var modelHeight = 1;
            var baseRotationZ = 0;
            var lastViewportWidth = 0;
            var lastViewportHeight = 0;
            var enemyMotionTime = 0;
            var enemyMotionBasePosition = null;
            var enemyMotionBaseRotation = null;
            var faceParts = { eye: {}, eyebrow: {}, mouth: {}, overlay: {} };
            var enemyVisualParts = { eye: {}, mouth: {} };
            var faceSelects = {};
            var facePresets = {
                normal: { eye: "eye_A_1", eyebrow: "eyebrow_A", mouth: "mouth_A", overlay: "" },
                smile: { eye: "eye_A_1", eyebrow: "eyebrow_A", mouth: "mouth_B", overlay: "" },
                happy: { eye: "eye_C", eyebrow: "eyebrow_B", mouth: "mouth_F", overlay: "" },
                angry: { eye: "eye_I", eyebrow: "eyebrow_E", mouth: "mouth_I", overlay: "" },
                sad: { eye: "eye_H", eyebrow: "eyebrow_D", mouth: "mouth_H", overlay: "" },
                surprised: { eye: "eye_D", eyebrow: "eyebrow_D_2", mouth: "mouth_D", overlay: "" },
                abnormal: { eye: "eye_H", eyebrow: "eyebrow_D", mouth: "mouth_H", overlay: "sen_1" }
            };
            var actionFacePresets = {
                idle: "normal",
                damage: "sad",
                abnormal: "abnormal",
                dead: "abnormal"
            };

            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.setClearColor(0x000000, 0);
            host.innerHTML = "";
            host.appendChild(renderer.domElement);
            scene.add(new THREE.AmbientLight(0xffffff, 2));

            function resetView() {
                if (homeView) {
                    camera.position.copy(homeView.position);
                    controls.target.copy(homeView.target);
                } else {
                    camera.position.set(0, 0.5, 3);
                    controls.target.set(0, 0.5, 0);
                }
                controls.update();
            }

            function resetModelTransform() {
                if (!modelObject) {
                    return;
                }
                modelObject.position.set(0, 0, 0);
                modelObject.rotation.set(0, 0, baseRotationZ);
                modelObject.scale.setScalar(1);
                if (modelKind === "enemy") {
                    enemyMotionBasePosition = modelObject.position.clone();
                    enemyMotionBaseRotation = modelObject.rotation.clone();
                    enemyMotionTime = 0;
                }
                if (scaleRange) {
                    scaleRange.value = "100";
                    scaleValue.textContent = "100%";
                }
                if (verticalRange) {
                    verticalRange.value = "0";
                    verticalValue.textContent = "0";
                }
            }

            function fitModelView() {
                var bounds = new THREE.Box3().setFromObject(modelObject);
                if (bounds.isEmpty()) {
                    return;
                }
                var center = bounds.getCenter(new THREE.Vector3());
                var size = bounds.getSize(new THREE.Vector3());
                modelHeight = Math.max(size.y, 0.1);
                var visibleSize = Math.max(size.y, size.x / Math.max(0.4, camera.aspect), 0.1);
                var distance = (visibleSize * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
                distance *= 1.28;
                homeView = {
                    target: center,
                    position: new THREE.Vector3(center.x, center.y, center.z + distance)
                };
                controls.minDistance = Math.max(0.05, distance * 0.38);
                controls.maxDistance = Math.max(2, distance * 4);
                resetView();
            }

            function friendlyActionName(name) {
                return {
                    room_idle_L: "待机",
                    idle: "待机",
                    attack: "普通攻击",
                    class_skill_1: "职业技能 1",
                    class_skill_2: "职业技能 2",
                    class_skill_3: "职业技能 3",
                    battle_run: "战斗跑动",
                    damage: "受击",
                    kirarajump_0: "跳跃",
                    win_st_0: "胜利",
                    charge_skill: "技能蓄力",
                    skill_0: "技能 1",
                    skill_1: "技能 2",
                    dead: "倒下",
                    abnormal: "异常状态"
                }[name] || name.replace(/_/g, " ");
            }

            function mountActionControls(clips) {
                if (!actionStrip) {
                    return;
                }
                var displayClips = clips.slice();
                if (modelKind === "enemy" && displayClips.length === 0) {
                    // Some public enemy GLBs were published without their matching
                    // AnimationClip bundle. Keep the viewer useful with lightweight
                    // procedural fallbacks; official clips still take precedence.
                    displayClips = [
                        { name: "idle" },
                        { name: "damage" },
                        { name: "dead" },
                        { name: "skill_0" },
                        { name: "skill_1" },
                        { name: "charge_skill" },
                        { name: "abnormal" }
                    ];
                }
                actionStrip.querySelectorAll("button").forEach(function (button) { button.remove(); });
                actionButtons = [];
                var actionOrder = ["idle", "attack", "class_skill_1", "class_skill_2", "class_skill_3", "battle_run", "damage", "kirarajump_0", "win_st_0", "abnormal", "dead", "room_idle_L"];
                displayClips.sort(function (left, right) {
                    var leftIndex = actionOrder.indexOf(left.name);
                    var rightIndex = actionOrder.indexOf(right.name);
                    return (leftIndex < 0 ? actionOrder.length : leftIndex) - (rightIndex < 0 ? actionOrder.length : rightIndex);
                }).forEach(function (clip, index) {
                    var button = document.createElement("button");
                    button.type = "button";
                    button.dataset.modelAction = clip.name;
                    button.dataset.clip = clip.name;
                    button.setAttribute("aria-pressed", String(index === 0));
                    button.innerHTML = escapeHtml(friendlyActionName(clip.name)) + "<small>" + escapeHtml(clip.name) + "</small>";
                    button.addEventListener("click", function () {
                        if (!motionEnabled && motionButton) {
                            motionEnabled = true;
                            motionButton.setAttribute("aria-pressed", "true");
                            motionButton.textContent = "暂停动作";
                            mixer.timeScale = 1;
                        }
                        selectAction(clip.name);
                    });
                    actionButtons.push(button);
                    actionStrip.appendChild(button);
                });
            }

            function classifyEnemyVisualPart(name) {
                var lowered = String(name || "").toLowerCase();
                var eye = lowered.match(/^eye(?:_(close|fun|angry))?_obj$/);
                if (eye) {
                    return { kind: "eye", state: eye[1] || "normal" };
                }
                var mouth = lowered.match(/^mouth_([a-z])_obj$/);
                if (mouth) {
                    return { kind: "mouth", state: mouth[1] };
                }
                return null;
            }

            function isEnemyAlternatePart(name) {
                var lowered = String(name || "").toLowerCase();
                return /^arm_up_/.test(lowered)
                    || /^weapon_(?:close|[2-9])/.test(lowered)
                    || /_(?:close|close_half)(?:_|$)/.test(lowered)
                    || /_(?:[2-9])(?:_[ab])?_obj$/.test(lowered)
                    || /_b_obj$/.test(lowered);
            }

            function applyEnemyVisualState(action) {
                if (modelKind !== "enemy") {
                    return;
                }
                var expressionByAction = {
                    damage: { eye: "close", mouth: "e" },
                    dead: { eye: "close", mouth: "e" },
                    abnormal: { eye: "fun", mouth: "d" },
                    charge_skill: { eye: "angry", mouth: "c" },
                    skill_0: { eye: "angry", mouth: "c" },
                    skill_1: { eye: "angry", mouth: "c" }
                };
                var requested = expressionByAction[action] || { eye: "normal", mouth: "a" };
                Object.keys(enemyVisualParts).forEach(function (kind) {
                    var states = enemyVisualParts[kind];
                    var selectedState = states[requested[kind]] ? requested[kind]
                        : states.normal ? "normal"
                            : states.a ? "a" : Object.keys(states)[0];
                    Object.keys(states).forEach(function (stateName) {
                        states[stateName].forEach(function (node) {
                            node.visible = stateName === selectedState;
                        });
                    });
                });
            }

            function updateEnemyProceduralMotion(delta) {
                if (modelKind !== "enemy" || !modelObject || activeClipAction || !motionEnabled) {
                    return;
                }
                if (!enemyMotionBasePosition) {
                    enemyMotionBasePosition = modelObject.position.clone();
                    enemyMotionBaseRotation = modelObject.rotation.clone();
                }
                enemyMotionTime += delta;
                var t = enemyMotionTime;
                var action = activeAction;
                var bob = 0;
                var tilt = 0;
                var turn = 0;
                if (action === "damage") {
                    bob = Math.sin(t * 34) * 0.018;
                    tilt = Math.sin(t * 42) * 0.06;
                } else if (action === "dead") {
                    bob = -Math.min(0.28, t * 0.18);
                    tilt = -Math.min(0.95, t * 0.6);
                } else if (action === "skill_0" || action === "skill_1") {
                    bob = Math.sin(t * 8) * 0.06;
                    turn = Math.sin(t * 7) * 0.18;
                    tilt = Math.sin(t * 10) * 0.12;
                } else if (action === "charge_skill") {
                    bob = Math.sin(t * 5) * 0.04;
                    tilt = Math.sin(t * 5) * 0.08;
                } else if (action === "abnormal") {
                    bob = Math.sin(t * 11) * 0.025;
                    turn = Math.sin(t * 13) * 0.08;
                } else {
                    bob = Math.sin(t * 2.4) * 0.012;
                    turn = Math.sin(t * 1.5) * 0.025;
                }
                modelObject.position.copy(enemyMotionBasePosition);
                modelObject.position.y += bob;
                modelObject.rotation.copy(enemyMotionBaseRotation);
                modelObject.rotation.x += tilt;
                modelObject.rotation.y += turn;
            }

            function selectAction(action) {
                activeAction = action;
                if (modelKind === "enemy" && !clipByName[action]) {
                    enemyMotionTime = 0;
                }
                // Selecting a game action is an explicit request to show the
                // matching in-game expression. Manual component edits remain
                // available until the next action selection.
                faceFollowsAction = true;
                if (modelObject) {
                    selectFace(actionFacePresets[activeAction] || "normal", true);
                    applyEnemyVisualState(activeAction);
                }
                var selectedButton = null;
                actionButtons.forEach(function (button) {
                    var isActive = button.dataset.modelAction === activeAction;
                    button.classList.toggle("is-active", isActive);
                    button.setAttribute("aria-pressed", String(isActive));
                    if (isActive) {
                        selectedButton = button;
                    }
                });
                if (!mixer || !selectedButton) {
                    return;
                }
                var clip = clipByName[selectedButton.dataset.clip];
                if (!clip) {
                    return;
                }
                var nextAction = mixer.clipAction(clip);
                nextAction.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.18).play();
                if (activeClipAction && activeClipAction !== nextAction) {
                    activeClipAction.fadeOut(0.18);
                }
                activeClipAction = nextAction;
            }

            function applyFaceSelection(selectedParts, presetName, automatic, updateControls) {
                activeFaceSelection = Object.assign({}, selectedParts);
                if (faceAutoButton) {
                    faceAutoButton.classList.toggle("is-active", automatic);
                    faceAutoButton.setAttribute("aria-pressed", String(automatic));
                }
                faceButtons.forEach(function (button) {
                    var isActive = !automatic && button.dataset.facePreset === presetName;
                    button.classList.toggle("is-active", isActive);
                    button.setAttribute("aria-pressed", String(isActive));
                });
                if (updateControls !== false) {
                    Object.keys(faceSelects).forEach(function (kind) {
                        faceSelects[kind].value = selectedParts[kind] || "";
                    });
                }
                if (!modelObject) {
                    return;
                }
                modelObject.traverse(function (child) {
                    var facePart = child.userData && child.userData.facePart;
                    if (facePart) {
                        child.visible = selectedParts[facePart.kind] === facePart.name;
                    }
                });
            }

            function resolveFacePartName(kind, requested, allowNumberedVariant) {
                if (!requested || !faceParts[kind]) {
                    return "";
                }
                var aliases = [requested];
                if (kind === "eyebrow") {
                    aliases.push(requested.replace(/^eyebrow_/, "eyebrrow_"));
                    aliases.push(requested.replace(/^eyebrrow_/, "eyebrow_"));
                }
                var exact = aliases.find(function (name) { return faceParts[kind][name]; });
                if (exact) {
                    return exact;
                }
                if (!allowNumberedVariant) {
                    return "";
                }
                var variantPrefixes = aliases.map(function (name) { return name + "_"; });
                return Object.keys(faceParts[kind]).filter(function (name) {
                    return variantPrefixes.some(function (prefix) {
                        return name.indexOf(prefix) === 0 && /^\d+$/.test(name.slice(prefix.length));
                    });
                }).sort(function (a, b) {
                    return a.localeCompare(b, undefined, { numeric: true });
                })[0] || "";
            }

            function selectFace(presetName, automatic) {
                faceFollowsAction = Boolean(automatic);
                var preset = facePresets[presetName] || facePresets.normal;
                var selectedParts = {};
                Object.keys(faceParts).forEach(function (kind) {
                    var requested = preset[kind];
                    if (kind === "overlay") {
                        selectedParts[kind] = resolveFacePartName(kind, requested, false);
                        return;
                    }
                    var requestedPart = resolveFacePartName(kind, requested, true);
                    if (requestedPart) {
                        selectedParts[kind] = requestedPart;
                        return;
                    }
                    var normalPart = facePresets.normal[kind];
                    selectedParts[kind] = resolveFacePartName(kind, normalPart, true)
                        || Object.keys(faceParts[kind]).sort(function (a, b) {
                            return a.localeCompare(b, undefined, { numeric: true });
                        })[0]
                        || "";
                });
                applyFaceSelection(selectedParts, presetName, faceFollowsAction);
            }

            function mountFaceControls() {
                if (!faceControls) {
                    return;
                }
                var labels = { eye: "眼睛", eyebrow: "眉毛", mouth: "嘴型", overlay: "附加" };
                faceControls.innerHTML = "";
                Object.keys(labels).forEach(function (kind) {
                    var names = Object.keys(faceParts[kind]).sort(function (a, b) {
                        return a.localeCompare(b, undefined, { numeric: true });
                    });
                    if (names.length === 0) {
                        return;
                    }
                    var label = document.createElement("label");
                    var caption = document.createElement("span");
                    var select = document.createElement("select");
                    caption.textContent = labels[kind];
                    if (kind === "overlay") {
                        var emptyOption = document.createElement("option");
                        emptyOption.value = "";
                        emptyOption.textContent = "无";
                        select.appendChild(emptyOption);
                    }
                    names.forEach(function (name) {
                        var option = document.createElement("option");
                        option.value = name;
                        option.textContent = name.replace(/^(eye|eyebrow|eyebrrow|mouth)_/, "");
                        select.appendChild(option);
                    });
                    select.setAttribute("aria-label", labels[kind]);
                    select.addEventListener("change", function () {
                        faceFollowsAction = false;
                        var selectedParts = {};
                        Object.keys(faceSelects).forEach(function (partKind) {
                            selectedParts[partKind] = faceSelects[partKind].value;
                        });
                        selectedParts[kind] = select.value;
                        applyFaceSelection(selectedParts, "", false);
                    });
                    faceSelects[kind] = select;
                    label.appendChild(caption);
                    label.appendChild(select);
                    faceControls.appendChild(label);
                });
            }

            function resize() {
                var width = Math.max(1, host.clientWidth);
                var height = Math.max(1, host.clientHeight);
                var sizeChanged = width !== lastViewportWidth || height !== lastViewportHeight;
                lastViewportWidth = width;
                lastViewportHeight = height;
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
                renderer.setSize(width, height, false);
                if (sizeChanged && modelObject) {
                    fitModelView();
                }
            }

            resetView();
            resize();
            controls.enableDamping = true;
            controls.dampingFactor = 0.08;
            controls.enablePan = true;
            controls.screenSpacePanning = true;
            controls.minAzimuthAngle = -Math.PI / 12;
            controls.maxAzimuthAngle = Math.PI / 12;
            controls.minPolarAngle = Math.PI / 2 - Math.PI / 18;
            controls.maxPolarAngle = Math.PI / 2 + Math.PI / 18;

            function fetchModel(url) {
                return fetch(url).then(function (response) {
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status);
                    }
                    return response;
                });
            }

            function readModelResponse(url) {
                if (!("caches" in window)) {
                    return fetchModel(url);
                }
                return caches.open("kirafan-model-glb-v2").then(function (cache) {
                    return cache.match(url).then(function (cached) {
                        if (cached) {
                            return cached;
                        }
                        return fetchModel(url).then(function (response) {
                            return cache.put(url, response.clone()).catch(function () {
                                // Cache quotas must not prevent the selected model from rendering.
                            }).then(function () {
                                return response;
                            });
                        });
                    });
                }).catch(function () {
                    return fetchModel(url);
                });
            }

            function cacheModel(url, compression) {
                if (!compression && !("caches" in window)) {
                    return Promise.resolve(url);
                }
                return readModelResponse(url).then(function (response) {
                    return response.blob();
                }).then(function (blob) {
                    if (compression === "gzip") {
                        if (!("DecompressionStream" in window)) {
                            throw new Error("gzip decompression is unavailable");
                        }
                        var stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
                        return new Response(stream).blob();
                    }
                    return blob;
                }).then(function (blob) {
                    var objectUrl = URL.createObjectURL(blob);
                    objectUrls.push(objectUrl);
                    return objectUrl;
                });
            }

            function disposeObjectResources(object) {
                var materials = new Set();
                var textures = new Set();
                object.traverse(function (child) {
                    if (child.geometry) {
                        child.geometry.dispose();
                    }
                    (Array.isArray(child.material) ? child.material : [child.material]).forEach(function (material) {
                        if (!material || materials.has(material)) {
                            return;
                        }
                        materials.add(material);
                        Object.keys(material).forEach(function (key) {
                            var value = material[key];
                            if (value && value.isTexture && !textures.has(value)) {
                                textures.add(value);
                                value.dispose();
                            }
                        });
                        material.dispose();
                    });
                });
            }

            function clearMountedWeapon() {
                mountedWeaponParts.forEach(function (part) {
                    if (part.parent) {
                        part.parent.remove(part);
                    }
                    disposeObjectResources(part);
                });
                mountedWeaponParts = [];
            }

            function weaponDescriptors(mode) {
                if (!metadata || mode === "none") {
                    return [];
                }
                var resourceIds = [];
                if (mode === "dedicated" && metadata.dedicatedWeapon) {
                    resourceIds = [metadata.dedicatedWeapon.resourceIdL, metadata.dedicatedWeapon.resourceIdR];
                } else if (Number.isFinite(metadata.class)) {
                    resourceIds = [1000 + metadata.class * 100];
                }
                return resourceIds.filter(Number.isFinite).filter(function (resourceId, index, items) {
                    return items.indexOf(resourceId) === index;
                }).map(function (resourceId) {
                    return MODEL_PREVIEWS["model/weapon/wpn_" + resourceId + ".muast"] || null;
                }).filter(Boolean);
            }

            function updateWeaponControls(mode, loading) {
                weaponButtons.forEach(function (button) {
                    var active = button.dataset.weaponMode === mode;
                    button.classList.toggle("is-active", active);
                    button.setAttribute("aria-pressed", String(active));
                    button.disabled = Boolean(loading);
                });
                if (!weaponStatus) {
                    return;
                }
                if (loading) {
                    weaponStatus.textContent = "正在装载……";
                } else if (mode === "none") {
                    weaponStatus.textContent = "当前不显示武器";
                } else if (mode === "dedicated" && metadata && metadata.dedicatedWeapon) {
                    weaponStatus.textContent = metadata.dedicatedWeapon.name;
                } else {
                    weaponStatus.textContent = "职业默认武器";
                }
            }

            function attachWeaponMode(loader, mode) {
                var request = ++weaponRequest;
                var descriptors = weaponDescriptors(mode);
                clearMountedWeapon();
                updateWeaponControls(mode, descriptors.length > 0);
                if (descriptors.length === 0 || !modelObject) {
                    updateWeaponControls(mode, false);
                    if (modelObject) {
                        modelObject.updateMatrixWorld(true);
                        fitModelView();
                    }
                    return Promise.resolve();
                }
                return Promise.all(descriptors.map(function (weaponPreview) {
                    return cacheModel(weaponPreview.file, weaponPreview.compression).then(function (sourceUrl) {
                        return new Promise(function (resolve) {
                            loader.load(sourceUrl, function (weaponGltf) {
                                if (disposed || request !== weaponRequest) {
                                    disposeObjectResources(weaponGltf.scene);
                                    resolve();
                                    return;
                                }
                                weaponGltf.scene.children.slice().forEach(function (part) {
                                    if (!/_[LR]$/i.test(part.name)) {
                                        return;
                                    }
                                    var side = /_L$/i.test(part.name) ? "L" : "R";
                                    var socket = modelObject.getObjectByName("Loc_" + side)
                                        || modelObject.getObjectByName("Weapon_" + side);
                                    if (!socket) {
                                        return;
                                    }
                                    socket.add(part);
                                    part.position.set(0, 0, 0);
                                    part.rotation.set(0, 0, 0);
                                    part.scale.setScalar(1);
                                    part.traverse(function (child) {
                                        if (child.isMesh && child.material) {
                                            child.material.transparent = true;
                                            child.material.alphaTest = 0.015;
                                            child.material.depthWrite = true;
                                            child.material.depthTest = true;
                                            child.material.side = THREE.DoubleSide;
                                        }
                                    });
                                    mountedWeaponParts.push(part);
                                });
                                resolve();
                            }, undefined, resolve);
                        });
                    });
                })).then(function () {
                    if (request === weaponRequest) {
                        updateWeaponControls(mode, false);
                        modelObject.updateMatrixWorld(true);
                        fitModelView();
                    }
                }).catch(function () {
                    if (request === weaponRequest) {
                        updateWeaponControls(mode, false);
                    }
                });
            }

            function loadClassActionClips(loader) {
                if (!metadata || !Number.isFinite(metadata.class)) {
                    return Promise.resolve([]);
                }
                var headId = Number.isFinite(metadata.headId) ? metadata.headId : 0;
                var source = CLASS_ACTION_PREVIEWS[String(metadata.class) + ":" + headId]
                    || CLASS_ACTION_PREVIEWS[String(metadata.class) + ":0"];
                if (!source) {
                    return Promise.resolve([]);
                }
                return cacheModel(source.file, source.compression).then(function (sourceUrl) {
                    return new Promise(function (resolve) {
                        loader.load(sourceUrl, function (actionGltf) {
                            try {
                                function stableNodePath(node) {
                                    var names = [];
                                    var current = node;
                                    while (current && current !== actionGltf.scene && current !== modelObject) {
                                        var originalName = current.userData.name || current.name;
                                        if (originalName) {
                                            names.unshift(originalName);
                                        }
                                        if (originalName === "root" || originalName === "Head_root") {
                                            break;
                                        }
                                        current = current.parent;
                                    }
                                    return names.join("/");
                                }

                                var currentNodesByPath = {};
                                modelObject.traverse(function (node) {
                                    var path = stableNodePath(node);
                                    if (path && (path.indexOf("root") === 0 || path.indexOf("Head_root") === 0)) {
                                        currentNodesByPath[path] = node;
                                    }
                                });
                                var clips = actionGltf.animations.map(function (clip) {
                                    var tracks = clip.tracks.map(function (track) {
                                        var separator = track.name.lastIndexOf(".");
                                        var sourceName = separator >= 0 ? track.name.slice(0, separator) : track.name;
                                        var property = separator >= 0 ? track.name.slice(separator) : "";
                                        // Follow GLTFLoader's node lookup semantics so its sanitized,
                                        // unique track names resolve to the same source nodes here.
                                        var sourceNode = THREE.PropertyBinding.findNode(actionGltf.scene, sourceName);
                                        var targetNode = sourceNode && currentNodesByPath[stableNodePath(sourceNode)];
                                        if (!targetNode) {
                                            return null;
                                        }
                                        var retargeted = track.clone();
                                        retargeted.name = targetNode.uuid + property;
                                        return retargeted;
                                    }).filter(Boolean);
                                    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
                                }).filter(function (clip) { return clip.tracks.length > 0; });
                                resolve(clips);
                            } catch (error) {
                                console.warn("职业动作载入失败", error);
                                resolve([]);
                            } finally {
                                disposeObjectResources(actionGltf.scene);
                            }
                        }, undefined, function () { resolve([]); });
                    });
                }).catch(function () { return []; });
            }

            cacheModel(preview.file, preview.compression).then(function (sourceUrl) {
                var loader = new GLTFLoader();
                loader.setMeshoptDecoder(MeshoptDecoder);
                loader.load(sourceUrl, function (gltf) {
                    if (disposed) {
                        return;
                    }
                    modelObject = gltf.scene;
                    resetModelTransform();
                    modelObject.traverse(function (child) {
                        var isPlayer = Boolean(metadata);
                        var loweredName = String(child.name || "").toLowerCase();
                        if (!isPlayer && (/^[lrt]\d+_/.test(loweredName) && loweredName.indexOf("l30_") !== 0
                            || /(damage|abnormal|flash|blur)/.test(loweredName))) {
                            child.visible = false;
                        }
                        if (!child.userData.facePart && loweredName.indexOf("l30_") === 0) {
                            var partName = child.name.slice(4);
                            if (/^eye_/.test(partName)) {
                                child.userData.facePart = { kind: "eye", name: partName };
                            } else if (/^(?:eyebrow|eyebrrow)_/.test(partName)) {
                                child.userData.facePart = { kind: "eyebrow", name: partName };
                            } else if (/^mouth_/.test(partName)) {
                                child.userData.facePart = { kind: "mouth", name: partName };
                            } else if (partName === "cry" || /^(tere_|cheek_|cheeck_|sen_|shade|shadow)/.test(partName)) {
                                child.userData.facePart = { kind: "overlay", name: partName };
                            }
                        }
                        if (modelKind === "enemy" && child.isMesh) {
                            var enemyPart = classifyEnemyVisualPart(child.name);
                            if (enemyPart) {
                                enemyVisualParts[enemyPart.kind][enemyPart.state] = enemyVisualParts[enemyPart.kind][enemyPart.state] || [];
                                enemyVisualParts[enemyPart.kind][enemyPart.state].push(child);
                            } else if (isEnemyAlternatePart(child.name)) {
                                child.visible = false;
                            }
                        }
                        if (child.isMesh && child.material) {
                            // The original player shader uses SrcAlpha blending
                            // with depth writes and depth testing.  The converted
                            // meshes stay double-sided because mirrored left/right
                            // pieces do not share a reliable GLB winding direction.
                            child.material.transparent = true;
                            child.material.alphaTest = 0.01;
                            child.material.depthWrite = preview.depthWrite !== false;
                            child.material.depthTest = true;
                            child.material.side = THREE.DoubleSide;
                            child.renderOrder = Number(child.userData.renderOrder || (child.geometry && child.geometry.userData.renderOrder) || 0);
                            if (isPlayer && /hand/.test(loweredName)) {
                                child.material = child.material.clone();
                                child.material.transparent = false;
                                child.material.alphaTest = 0;
                            }
                        }
                        var facePart = child.userData && child.userData.facePart;
                        if (facePart && faceParts[facePart.kind]) {
                            faceParts[facePart.kind][facePart.name] = true;
                        }
                    });
                    scene.add(modelObject);
                    mixer = new THREE.AnimationMixer(modelObject);
                    mountFaceControls();
                    // Face overlays are exported visible in some source bundles.
                    // Apply the normal preset before the asynchronous class action
                    // download so shade/debuff layers never flash during loading.
                    selectFace("normal", true);
                    applyEnemyVisualState("idle");
                    gltf.animations.forEach(function (clip) {
                        clipByName[clip.name] = clip;
                    });
                    mountActionControls(gltf.animations);
                    activeAction = clipByName.room_idle_L
                        ? "room_idle_L"
                        : clipByName.idle
                            ? "idle"
                            : gltf.animations[0] && gltf.animations[0].name;
                    if (!activeAction && modelKind === "enemy") {
                        activeAction = "idle";
                    }
                    if (activeAction) {
                        selectAction(activeAction);
                        mixer.update(0);
                        modelObject.updateMatrixWorld(true);
                    }
                    if (faceInterface) {
                        faceInterface.hidden = !Object.keys(faceParts).some(function (kind) {
                            return Object.keys(faceParts[kind]).length > 0;
                        });
                    }
                    loadClassActionClips(loader).then(function (classClips) {
                        var clips = [];
                        clipByName = {};
                        classClips.concat(gltf.animations).forEach(function (clip) {
                            if (!clipByName[clip.name]) {
                                clipByName[clip.name] = clip;
                                clips.push(clip);
                            }
                        });
                        mountActionControls(clips);
                        activeAction = clipByName.idle ? "idle" : clipByName.room_idle_L ? "room_idle_L" : clips[0] && clips[0].name;
                        if (!activeAction && modelKind === "enemy") {
                            activeAction = "idle";
                        }
                        selectFace(actionFacePresets[activeAction] || "normal", true);
                        if (activeAction) {
                            selectAction(activeAction);
                        }
                        mixer.update(0);
                        modelObject.updateMatrixWorld(true);
                        weaponButtons.forEach(function (button) {
                            button.addEventListener("click", function () {
                                attachWeaponMode(loader, button.dataset.weaponMode);
                            });
                        });
                        var initialWeaponMode = weaponInterface ? weaponInterface.dataset.defaultMode : "none";
                        return attachWeaponMode(loader, initialWeaponMode);
                    }).then(function () {
                        modelObject.updateMatrixWorld(true);
                        fitModelView();
                        host.classList.add("is-ready");
                    });
                }, undefined, function () {
                    host.innerHTML = "<div class='model-3d-error'>GLB 模型加载失败，请刷新后重试。</div>";
                });
            }).catch(function () {
                host.innerHTML = "<div class='model-3d-error'>模型下载或缓存失败，请检查网络后重试。</div>";
            });

            if (motionButton) {
                motionButton.addEventListener("click", function () {
                    motionEnabled = !motionEnabled;
                    motionButton.setAttribute("aria-pressed", String(motionEnabled));
                    motionButton.textContent = motionEnabled ? "暂停动作" : "恢复动作";
                    if (mixer) {
                        mixer.timeScale = motionEnabled ? 1 : 0;
                    }
                });
            }
            resetButton.addEventListener("click", function () {
                resetModelTransform();
                resetView();
                if (clipByName.idle) {
                    selectAction("idle");
                } else if (clipByName.room_idle_L) {
                    selectAction("room_idle_L");
                }
            });
            if (adjustButton && adjustDrawer) {
                adjustButton.addEventListener("click", function () {
                    var expanded = adjustButton.getAttribute("aria-expanded") !== "true";
                    adjustButton.setAttribute("aria-expanded", String(expanded));
                    adjustDrawer.hidden = !expanded;
                });
            }
            if (scaleRange) {
                scaleRange.addEventListener("input", function () {
                    if (!modelObject) {
                        return;
                    }
                    var scale = Number(scaleRange.value) / 100;
                    modelObject.scale.setScalar(scale);
                    scaleValue.textContent = scaleRange.value + "%";
                });
            }
            if (verticalRange) {
                verticalRange.addEventListener("input", function () {
                    if (!modelObject) {
                        return;
                    }
                    modelObject.position.y = Number(verticalRange.value) / 100 * modelHeight;
                    if (modelKind === "enemy" && enemyMotionBasePosition) {
                        enemyMotionBasePosition.y = modelObject.position.y;
                    }
                    verticalValue.textContent = verticalRange.value;
                });
            }
            actionButtons.forEach(function (button) {
                button.addEventListener("click", function () {
                    if (!motionEnabled && motionButton) {
                        motionEnabled = true;
                        motionButton.setAttribute("aria-pressed", "true");
                        motionButton.textContent = "暂停动作";
                    }
                    selectAction(button.dataset.modelAction);
                });
            });
            faceButtons.forEach(function (button) {
                button.addEventListener("click", function () {
                    selectFace(button.dataset.facePreset, false);
                });
            });
            if (faceAutoButton) {
                faceAutoButton.addEventListener("click", function () {
                    selectFace(actionFacePresets[activeAction] || "normal", true);
                });
            }

            function renderFrame(time) {
                if (disposed) {
                    return;
                }
                var delta = Math.min(0.05, Math.max(0, (time - previousFrame) / 1000));
                previousFrame = time;
                if (mixer && motionEnabled) {
                    mixer.update(delta);
                }
                updateEnemyProceduralMotion(delta);
                if (faceFollowsAction && activeAction === "idle" && activeFaceSelection) {
                    var blinkEye = resolveFacePartName("eye", "eye_C", true);
                    if (!blinkActive && time >= nextBlinkAt && blinkEye) {
                        var blinkSelection = Object.assign({}, activeFaceSelection, { eye: blinkEye });
                        blinkActive = true;
                        blinkUntil = time + 115;
                        applyFaceSelection(blinkSelection, "", true, false);
                    } else if (blinkActive && time >= blinkUntil) {
                        blinkActive = false;
                        nextBlinkAt = time + 2800 + Math.random() * 2600;
                        selectFace(actionFacePresets[activeAction] || "normal", true);
                    }
                } else {
                    blinkActive = false;
                    nextBlinkAt = time + 2800;
                }
                controls.update();
                renderer.render(scene, camera);
                animationFrame = window.requestAnimationFrame(renderFrame);
            }
            animationFrame = window.requestAnimationFrame(renderFrame);

            if ("ResizeObserver" in window) {
                resizeObserver = new ResizeObserver(resize);
                resizeObserver.observe(host);
            } else {
                window.addEventListener("resize", resize);
            }

            activeModelCleanup = function () {
                disposed = true;
                window.cancelAnimationFrame(animationFrame);
                controls.dispose();
                if (mixer) {
                    mixer.stopAllAction();
                }
                if (modelObject) {
                    clearMountedWeapon();
                    var disposedMaterials = new Set();
                    var disposedTextures = new Set();
                    scene.remove(modelObject);
                    modelObject.traverse(function (child) {
                        if (child.geometry) {
                            child.geometry.dispose();
                        }
                        var materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(function (material) {
                            if (!material || disposedMaterials.has(material)) {
                                return;
                            }
                            disposedMaterials.add(material);
                            Object.keys(material).forEach(function (key) {
                                var value = material[key];
                                if (value && value.isTexture && !disposedTextures.has(value)) {
                                    disposedTextures.add(value);
                                    value.dispose();
                                }
                            });
                            material.dispose();
                        });
                    });
                }
                renderer.dispose();
                objectUrls.forEach(function (objectUrl) { URL.revokeObjectURL(objectUrl); });
                if (resizeObserver) {
                    resizeObserver.disconnect();
                } else {
                    window.removeEventListener("resize", resize);
                }
                activeModelCleanup = null;
            };
        }).catch(function () {
            if (document.body.contains(host)) {
                host.innerHTML = "<div class='model-3d-error'>WebGL 模块加载失败，请检查网络后重试。</div>";
            }
        });
    }

    function renderDetailError(model) {
        elements.detail.innerHTML = "<div class='model-error-state'><span aria-hidden='true'>!</span><h2>这个模型暂时没有可读的 Sprite 目录</h2><p>可以直接打开官方素材库查看原始条目，或稍后重试。</p><div><a href='" + detailUrl(model) + "' target='_blank' rel='noopener noreferrer'>打开官方详情 ↗</a><button id='retryModel' type='button'>重新读取</button></div></div>";
        document.getElementById("retryModel").addEventListener("click", function () { loadModelDetail(model); });
    }

    function loadModelDetail(model) {
        if (activeModelCleanup) {
            activeModelCleanup();
        }
        state.selected = model;
        state.indexRequest += 1;
        var requestId = state.indexRequest;
        setHash(model);
        renderList();
        elements.detail.innerHTML = "<div class='model-loading'><span class='model-spinner' aria-hidden='true'></span><h2>正在读取 Sprite 目录</h2><p>" + escapeHtml(model.name) + "</p></div>";
        fetch(modelIndexUrl(model), { mode: "cors" }).then(function (response) {
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }
            return response.json();
        }).then(function (spriteNames) {
            if (requestId !== state.indexRequest) {
                return;
            }
            if (!Array.isArray(spriteNames) || spriteNames.length === 0) {
                throw new Error("empty index");
            }
            renderDetailShell(model, spriteNames);
            if (manifestState.error) {
                setStatus("素材索引正常，但 WebGL 清单加载失败；可预览数量不会显示为错误的示例值", "error");
            } else {
                setStatus("已载入 " + state.allModels.length.toLocaleString("zh-CN") + " 个模型条目 · 当前显示 " + spriteNames.length + " 个纹理", "ready");
            }
        }).catch(function () {
            if (requestId !== state.indexRequest) {
                return;
            }
            renderDetailError(model);
            setStatus("模型目录读取失败，官方素材库仍可直接打开", "error");
        });
    }

    function selectModel(model) {
        loadModelDetail(model);
    }

    function bindControls() {
        elements.search.addEventListener("input", function () {
            state.query = elements.search.value;
            state.page = 1;
            applyFilter();
        });
        if (elements.titleFilter) {
            elements.titleFilter.addEventListener("change", function () {
                state.titleId = elements.titleFilter.value;
                state.page = 1;
                if (state.titleId !== "all") {
                    state.kind = "player";
                    document.querySelectorAll(".models-filter").forEach(function (item) {
                        item.classList.toggle("is-active", item.dataset.kind === "player");
                    });
                }
                applyFilter();
            });
        }
        document.querySelectorAll(".models-filter").forEach(function (button) {
            button.addEventListener("click", function () {
                document.querySelectorAll(".models-filter").forEach(function (item) { item.classList.remove("is-active"); });
                button.classList.add("is-active");
                state.kind = button.dataset.kind;
                if (state.kind === "enemy" || state.kind === "weapon") {
                    state.titleId = "all";
                    if (elements.titleFilter) {
                        elements.titleFilter.value = "all";
                    }
                }
                state.page = 1;
                applyFilter();
            });
        });
    }

    function showSelectedKind(model) {
        state.kind = pathParts(model.name).kind;
        state.page = 1;
        document.querySelectorAll(".models-filter").forEach(function (button) {
            button.classList.toggle("is-active", button.dataset.kind === state.kind);
        });
        applyFilter();
        var selectedIndex = state.filteredModels.findIndex(function (entry) {
            return entry.name === model.name;
        });
        if (selectedIndex >= 0) {
            state.page = Math.floor(selectedIndex / INDEX_PAGE_SIZE) + 1;
        }
    }

    function loadPreviewManifest() {
        return fetch(MODEL_MANIFEST_URL).then(function (response) {
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }
            return response.json();
        }).then(function (manifest) {
            if (!manifest || !manifest.models || typeof manifest.models !== "object") {
                throw new Error("invalid manifest");
            }
            Object.keys(manifest.models).forEach(function (name) {
                MODEL_PREVIEWS[name] = manifest.models[name];
            });
            Object.keys(manifest.classActions || {}).forEach(function (classId) {
                CLASS_ACTION_PREVIEWS[classId] = manifest.classActions[classId];
            });
            manifestState.loaded = true;
        }).catch(function () {
            manifestState.error = true;
        });
    }

    function loadDatabase() {
        fetch(DATABASE_URL, { mode: "cors" }).then(function (response) {
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }
            return response.json();
        }).then(function (entries) {
            state.allModels = entries.filter(function (entry) {
                return entry && typeof entry.name === "string" && MODEL_PATH.test(entry.name);
            }).sort(function (a, b) { return a.name.localeCompare(b.name); });
            populateTitleFilter();
            updateCounts();
            applyFilter();
            if (manifestState.error) {
                setStatus("已载入 " + state.allModels.length.toLocaleString("zh-CN") + " 个索引条目，但 WebGL 清单读取失败；请检查部署文件", "error");
            } else {
                setStatus("索引与 WebGL 清单已载入 · " + state.allModels.length.toLocaleString("zh-CN") + " 个条目 · " + Object.keys(MODEL_PREVIEWS).length.toLocaleString("zh-CN") + " 个可预览", "ready");
            }
            var hashModel = modelFromHash();
            var defaultModel = state.allModels.find(function (model) {
                return model.name === "model/player/model_pl_140106.muast";
            });
            if (hashModel) {
                showSelectedKind(hashModel);
                selectModel(hashModel);
            } else if (defaultModel || state.allModels.length > 0) {
                var initialModel = defaultModel || state.allModels[0];
                showSelectedKind(initialModel);
                selectModel(initialModel);
            }
        }).catch(function () {
            setStatus("素材索引暂时无法连接，请检查网络后刷新页面", "error");
            elements.list.innerHTML = "<div class='models-list-empty'>索引加载失败。<br>官方素材库：<a href='https://asset.kirafan.moe/' target='_blank' rel='noopener noreferrer'>asset.kirafan.moe ↗</a></div>";
        });
    }

    buildPlayerMetadata();
    bindControls();
    loadPreviewManifest().then(loadDatabase);
})();
