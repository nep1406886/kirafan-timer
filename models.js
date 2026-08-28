(function () {
    "use strict";

    var DATABASE_URL = "https://database.kirafan.cn/assetBundle.json";
    var MODEL_MANIFEST_URL = "asset/models/manifest.json?v=20260826-1";
    var ASSET_HOST = "https://asset.kirafan.cn/";
    var INDEX_PAGE_SIZE = 30;
    var MODEL_PATH = /^model\/(player|enemy|weapon|shadow)\//;
    var MODEL_PREVIEWS = {};
    var CLASS_ACTION_PREVIEWS = {};
    // Per-character skill motion, keyed by the model id. とっておき (skill) and the
    // character's own battle skill live in their own GLBs because they are ~180
    // KiB each and only matter once someone asks for them. Written by
    // tools/build_skill_action_catalog.py.
    var SKILL_ACTION_PREVIEWS = {};
    var PLAYER_MODEL_META = {};
    var MODEL_TITLES = [];
    var manifestState = { loaded: false, error: false, offline: false };
    // Which facial ID each action asks for, and on which frame. Written by
    // tools/build_facial_table.py out of the MabAnimEvents in the motion clips,
    // so it is the game's own answer to "what face goes with this move".
    // The manifest overrides this with a cache-busted path.
    var FACIAL_ACTIONS_URL = "asset/models/facial/actions.json";
    var facialActionState = { promise: null, fps: 30, actions: {} };
    // Per-character expression tables, fetched on demand: one is ~1 KiB but
    // there are 238 of them, and a visitor opens a handful.
    var facialTableCache = {};
    // Chrome gives file:// pages an opaque origin, so neither fetch nor
    // XMLHttpRequest can read manifest.json or any .glb.gz next to the page.
    // 3D preview is impossible here no matter how the request is made.
    var IS_LOCAL_FILE = window.location.protocol === "file:";
    var LOCAL_FILE_HINT = "本地直接打开页面时浏览器禁止读取同目录文件，3D 预览不可用；请在项目目录运行 python -m http.server 8642 后访问 http://localhost:8642/models.html";
    var activeModelCleanup = null;
    var THREE_BUILD = "0.180.0";
    var MODULE_SOURCES = [
        {
            three: "./vendor/three/three.module.min.js",
            orbit: "./vendor/three/OrbitControls.js",
            gltf: "./vendor/three/GLTFLoader.js",
            meshopt: "./vendor/three/meshopt_decoder.module.js"
        },
        {
            three: "https://cdn.jsdelivr.net/npm/three@" + THREE_BUILD + "/build/three.module.js",
            orbit: "https://cdn.jsdelivr.net/npm/three@" + THREE_BUILD + "/examples/jsm/controls/OrbitControls.js",
            gltf: "https://cdn.jsdelivr.net/npm/three@" + THREE_BUILD + "/examples/jsm/loaders/GLTFLoader.js",
            meshopt: "https://cdn.jsdelivr.net/npm/three@" + THREE_BUILD + "/examples/jsm/libs/meshopt_decoder.module.js"
        }
    ];
    var viewerModules = null;

    // Prefer the vendored copies so the viewer keeps working where the CDN is
    // unreachable; the import map in models.html only backs up the fallback's
    // bare "three" specifier.
    function loadViewerModules() {
        if (viewerModules) {
            return viewerModules;
        }
        viewerModules = MODULE_SOURCES.reduce(function (chain, source) {
            return chain.catch(function () {
                return Promise.all([
                    import(source.three),
                    import(source.orbit),
                    import(source.gltf),
                    import(source.meshopt)
                ]);
            });
        }, Promise.reject()).catch(function (error) {
            viewerModules = null;
            throw error;
        });
        return viewerModules;
    }
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
                    ? (manifestState.offline ? "不可用" : "加载失败")
                    : counts[key].toLocaleString("zh-CN");
            }
        });
        var readyButton = document.querySelector(".models-filter[data-kind='ready']");
        if (readyButton) {
            readyButton.disabled = manifestState.error;
            readyButton.title = manifestState.offline
                ? LOCAL_FILE_HINT
                : (manifestState.error ? "WebGL 清单未能载入，请刷新或检查部署文件" : "只显示可直接预览的模型");
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
            ? "<div class='model-control-panel' id='modelPanelAction' data-inspector-panel='action' role='tabpanel' aria-labelledby='modelTabAction'><div id='modelActionStrip' class='model-action-groups' role='group' aria-label='游戏动作'></div><p class='model-control-hint'>" + (parts.kind === "enemy" && !preview.animations ? "该敌人包未附带 AnimationClip，以下为程序化预览。" : "动作取自游戏原始 AnimationClip，表情按官方表情表跟随。") + "</p></div>"
            : "";
        // 武器这类没有表情层的模型不该出现「表情」页，那一页会是空的。
        var faceMarkup = preview && preview.expressions
            ? "<div class='model-control-panel' id='modelPanelFace' data-inspector-panel='face' role='tabpanel' aria-labelledby='modelTabFace' hidden><section class='model-control-section' id='modelFaceInterface'><div class='model-control-heading'><strong>表情预设</strong><small>状态层默认关闭</small></div><div class='model-face-strip' role='group' aria-label='表情预设'><button class='is-active' type='button' id='modelFaceAuto' aria-pressed='true'>跟随动作</button><button type='button' data-face-preset='normal' aria-pressed='false'>通常</button><button type='button' data-face-preset='smile' aria-pressed='false'>微笑</button><button type='button' data-face-preset='happy' aria-pressed='false'>开心</button><button type='button' data-face-preset='angry' aria-pressed='false'>生气</button><button type='button' data-face-preset='sad' aria-pressed='false'>难过</button><button type='button' data-face-preset='surprised' aria-pressed='false'>惊讶</button><button type='button' data-face-preset='abnormal' aria-pressed='false'>异常状态</button></div><details class='model-face-advanced' id='modelFaceAdvanced'><summary>表情组件</summary><div id='modelFaceControls' class='model-face-controls'></div></details></section></div>"
            : "";
        var unavailableMarkup = manifestState.offline
            ? "<div class='model-conversion-note'><strong>本地直接打开时无法预览 3D 模型</strong><span>" + escapeHtml(LOCAL_FILE_HINT) + "</span></div>"
            : manifestState.error
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
        // 装备与构图都是「设置一次就不再动」的控制，合成一个标签页，
        // 让动作和表情各自独占一屏，不必再滚动侧栏。
        var setupMarkup = weaponMarkup || adjustMarkup
            ? "<div class='model-control-panel' id='modelPanelSetup' data-inspector-panel='setup' role='tabpanel' aria-labelledby='modelTabSetup' hidden>" + weaponMarkup + adjustMarkup + "</div>"
            : "";
        var inspectorTabs = [];
        if (actionMarkup) {
            inspectorTabs.push({ key: "action", label: "动作" });
        }
        if (faceMarkup) {
            inspectorTabs.push({ key: "face", label: "表情" });
        }
        if (setupMarkup) {
            inspectorTabs.push({ key: "setup", label: "装备构图" });
        }
        var tabsMarkup = inspectorTabs.length > 1
            ? "<div class='model-inspector-tabs' role='tablist' aria-label='模型控制台分页'>" + inspectorTabs.map(function (tab, index) {
                return "<button type='button' role='tab' id='modelTab" + tab.key.charAt(0).toUpperCase() + tab.key.slice(1)
                    + "' data-inspector-tab='" + tab.key + "' aria-controls='modelPanel" + tab.key.charAt(0).toUpperCase() + tab.key.slice(1) + "'"
                    + " aria-selected='" + String(index === 0) + "' class='" + (index === 0 ? "is-active" : "") + "'>" + escapeHtml(tab.label) + "</button>";
            }).join("") + "</div>"
            : "";
        // 播放条只在真有动画时出现：敌人程序化预览没有时间轴可拖。
        var transportMarkup = hasPlayerActions
            ? "<div class='model-transport' id='modelTransport'>"
                + "<button id='modelMotionToggle' type='button' class='model-transport-play' aria-pressed='true' title='播放 / 暂停（空格）'><span aria-hidden='true'>❙❙</span></button>"
                + "<div class='model-transport-track'><input id='modelTimeline' type='range' min='0' max='1000' value='0' step='1' aria-label='动作进度' title='拖动可逐帧检视（← →）'></div>"
                + "<span class='model-transport-time' id='modelTimeReadout'>0.00 / 0.00 s</span>"
                + "<div class='model-transport-speed' role='group' aria-label='播放速度'>"
                + "<button type='button' data-playback-rate='0.25'>¼×</button>"
                + "<button type='button' data-playback-rate='0.5'>½×</button>"
                + "<button type='button' data-playback-rate='1' class='is-active' aria-pressed='true'>1×</button>"
                + "</div>"
                + "<button id='modelLoopToggle' type='button' class='model-transport-loop is-active' aria-pressed='true' title='循环播放（L）'><span aria-hidden='true'>↻</span></button>"
                + "</div>"
            : "";
        var previewMarkup = preview
            ? "<section class='model-3d-card' aria-label='游戏模型预览'><div class='model-3d-toolbar'><div><span class='model-live-badge'><i aria-hidden='true'></i>LIVE WEBGL</span><strong>模型观察台</strong><small>" + escapeHtml(preview.label) + "</small></div><div class='model-3d-actions'><span class='model-shortcut-hint'>空格播放 · ←→ 逐帧 · R 重置</span><button id='modelViewReset' type='button' title='恢复模型位置和镜头（R）'><span aria-hidden='true'>↺</span> 重置</button></div></div><div class='model-viewer-layout'><div class='model-viewer-stage'><div id='model3dCanvas' class='model-3d-canvas'><div class='model-3d-loading'><span class='model-spinner' aria-hidden='true'></span><p>正在读取模型数据……</p></div></div>" + transportMarkup + "</div><aside class='model-viewer-inspector' aria-label='模型控制台'>" + tabsMarkup + "<div class='model-inspector-body'>" + actionMarkup + faceMarkup + setupMarkup + "</div></aside></div></section>"
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
        mountInspectorTabs();
        if (preview) {
            mount3DModel(preview, metadata, parts.kind);
        }
    }

    function mountInspectorTabs() {
        var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-inspector-tab]"));
        var panels = Array.prototype.slice.call(document.querySelectorAll("[data-inspector-panel]"));
        if (!panels.length) {
            return;
        }
        tabs.forEach(function (tab) {
            tab.addEventListener("click", function () {
                selectInspectorTab(tab.dataset.inspectorTab);
            });
        });
        // 打开哪一页由实际存在的面板决定，不能写死在标记里：武器没有动作页，
        // 若默认展开「动作」就会一页都不显示。
        selectInspectorTab(panels[0].dataset.inspectorPanel);
    }

    function selectInspectorTab(key) {
        document.querySelectorAll("[data-inspector-tab]").forEach(function (tab) {
            var isActive = tab.dataset.inspectorTab === key;
            tab.classList.toggle("is-active", isActive);
            tab.setAttribute("aria-selected", String(isActive));
        });
        document.querySelectorAll("[data-inspector-panel]").forEach(function (panel) {
            panel.hidden = panel.dataset.inspectorPanel !== key;
        });
    }

    // The exporter records each sprite layer's draw order in the glTF node
    // extras, but gltfpack strips mesh names and mesh extras, so the value only
    // survives on the wrapper node that GLTFLoader builds around a skinned
    // mesh. Reading it off the mesh alone left every layer at 0, which let
    // legs, feet and brows sort arbitrarily.
    // Blush, tear, pallor, anger-mark and effect-text layers ship visible and
    // belong to specific expressions. Naming is inconsistent across bundles
    // (cheek_A, cheeck1, tere, sen, blue, bule, aozame, angry, text_B), so all
    // spellings must be recognised or the unmatched ones stay burned onto every
    // face.
    var FACE_OVERLAY_PART = /^(?:cry|namida|tere|cheek|cheeck|sen|shade|shadow|blue|bule|aozame|pale|angry|sad|shy|question|black|red|text)(?:\d|_|$)/;
    var FACE_KIND_PATTERN = /^(eyebrow|mouth|eye)(.*)$/;

    // Layer names vary in case, in brow spelling (eyebrow / eyebrrow / eyeblow)
    // and in whether the variant suffix is separated (Eye_F2 vs eye_F_2). Every
    // lookup goes through one canonical key so presets written one way still
    // find parts named another.
    function canonicalFacePartKey(partName) {
        var lowered = String(partName).toLowerCase().replace(/^(?:eyebrrow|eyeblow)/, "eyebrow");
        var match = FACE_KIND_PATTERN.exec(lowered);
        if (!match) {
            return lowered;
        }
        var rest = match[2].replace(/^_+/, "").replace(/([a-z])(\d)/g, "$1_$2");
        return rest ? match[1] + "_" + rest : match[1];
    }

    function classifyFacePart(partName) {
        var canonical = canonicalFacePartKey(partName);
        // Glasses are worn, not blinked: "eyeglass" canonicalises to "eye_glass"
        // and would otherwise be taken for an eye variant, so picking any eye in
        // the expression panel would take the character's glasses off. The
        // authored tables that switch them address them by name instead.
        if (/^(?:eye_)?glass(?:es)?(?:_|$)/.test(canonical)) {
            return "";
        }
        // An eyelid sits over the eye rather than replacing it.
        if (/^eye_lid(?:_|$)/.test(canonical)) {
            return "overlay";
        }
        if (/^eyebrow(?:_|$)/.test(canonical)) {
            return "eyebrow";
        }
        if (/^eye(?:_|$)/.test(canonical)) {
            return "eye";
        }
        if (/^mouth(?:_|$)/.test(canonical)) {
            return "mouth";
        }
        if (FACE_OVERLAY_PART.test(canonical)) {
            return "overlay";
        }
        return "";
    }

    // gltfpack strips mesh names, so GLTFLoader falls back to "mesh_<index>"
    // and the authored name (body_obj, weapon_wand_obj, L30_eye_A_1) survives
    // only on the wrapper node it builds around the mesh. Every name-based rule
    // has to look there too, or it silently matches nothing — and worse, a rule
    // ending in a digit matches the generated names by accident.
    var GENERATED_MESH_NAME = /^mesh_\d+$/;

    function resolveNodeName(node) {
        var name = node.name || "";
        if (name && !GENERATED_MESH_NAME.test(name)) {
            return name;
        }
        var parent = node.parent;
        var parentName = parent && parent.name ? parent.name : "";
        if (parentName && !GENERATED_MESH_NAME.test(parentName)) {
            return parentName;
        }
        return name;
    }

    function resolveRenderOrder(mesh) {
        var candidates = [mesh, mesh.parent];
        for (var i = 0; i < candidates.length; i++) {
            var node = candidates[i];
            if (!node) {
                continue;
            }
            if (node.userData && node.userData.renderOrder !== undefined && node.userData.renderOrder !== null) {
                return Number(node.userData.renderOrder) || 0;
            }
        }
        var geometry = mesh.geometry;
        if (geometry && geometry.userData && geometry.userData.renderOrder !== undefined) {
            return Number(geometry.userData.renderOrder) || 0;
        }
        return 0;
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
        var timeline = document.getElementById("modelTimeline");
        var timeReadout = document.getElementById("modelTimeReadout");
        var loopButton = document.getElementById("modelLoopToggle");
        var rateButtons = Array.prototype.slice.call(document.querySelectorAll("[data-playback-rate]"));
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

        loadViewerModules().then(function (modules) {
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
            var actionChosenByUser = false;
            var playbackRate = 1;
            var loopPlayback = true;
            // 大招 GLB 只下载一次，无论用户点哪一段。
            var skillClipsRequested = false;
            var skillLoader = null;
            // 拖时间轴时不能让渲染循环把滑块拽回去。
            var scrubbing = false;
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
            var enemyMotionTime = 0;
            var enemyMotionBasePosition = null;
            var enemyMotionBaseRotation = null;
            var viewInteracted = false;
            var faceParts = { eye: {}, eyebrow: {}, mouth: {}, overlay: {} };
            var enemyVisualParts = {};
            var enemyVariantParts = [];
            var faceSelects = {};
            // The authoritative expression table for this character, or null for
            // a model that has none (enemies, and the 34 player models with no
            // CharacterListDB entry). Everything face-related checks this first
            // and only falls back to the letter heuristics below when it is
            // absent — those heuristics guess, this does not.
            var facialTable = null;
            var facialLayerNodes = {};
            var facialStateIndex = -1;
            var facialActions = null;
            // Which event of the active clip is currently applied, so the frame
            // it changes on is honoured without reapplying every frame.
            var facialEventIndex = -1;
            var facialOverrideSet = 0;
            // Letters index the head atlas layers, but their meaning is not
            // stable across characters and most bundles ship only a subset, so
            // every slot lists candidates in falling preference. Verified
            // against rendered contact sheets: eye_I is an iris-less oval and
            // mouth_F an untextured white block, so neither may be requested.
            //
            // Only reached for models with no authored table.
            var facePresets = {
                normal: { eye: ["eye_A_1", "eye_A"], eyebrow: ["eyebrow_A"], mouth: ["mouth_A", "mouth_B"], overlay: [] },
                smile: { eye: ["eye_A_1", "eye_A"], eyebrow: ["eyebrow_A"], mouth: ["mouth_L", "mouth_D", "mouth_B", "mouth_A"], overlay: [] },
                happy: { eye: ["eye_C", "eye_E", "eye_A_1", "eye_A"], eyebrow: ["eyebrow_B", "eyebrow_A"], mouth: ["mouth_D", "mouth_L", "mouth_C", "mouth_B"], overlay: ["tere", "cheek", "cheeck"] },
                angry: { eye: ["eye_J", "eye_F", "eye_D_2", "eye_A_1", "eye_A"], eyebrow: ["eyebrow_E", "eyebrow_D", "eyebrow_A"], mouth: ["mouth_I", "mouth_C_2", "mouth_C", "mouth_E"], overlay: ["angry"] },
                sad: { eye: ["eye_G", "eye_E", "eye_D", "eye_A_1", "eye_A"], eyebrow: ["eyebrow_D", "eyebrow_C", "eyebrow_A"], mouth: ["mouth_G", "mouth_H", "mouth_B"], overlay: ["cry", "namida"] },
                surprised: { eye: ["eye_F", "eye_B_1", "eye_B", "eye_D_2", "eye_A_1", "eye_A"], eyebrow: ["eyebrow_D_2", "eyebrow_D", "eyebrow_A"], mouth: ["mouth_C", "mouth_C_2", "mouth_D"], overlay: [] },
                abnormal: { eye: ["eye_G_2", "eye_G", "eye_E", "eye_K", "eye_A_1", "eye_A"], eyebrow: ["eyebrow_D", "eyebrow_C", "eyebrow_A"], mouth: ["mouth_G", "mouth_H", "mouth_B"], overlay: ["sen", "shade", "shadow"] }
            };
            // Fallback only, for models with no authored table. The real
            // action-to-face mapping is authored data and lives in
            // asset/models/facial/actions.json; where that exists it wins, and
            // it disagrees with these guesses (damage asks for the abnormal face
            // rather than a sad one, kirarajump for the winning face).
            var actionFacePresets = {
                idle: "normal",
                room_idle_L: "normal",
                battle_run: "normal",
                attack: "angry",
                charge_skill: "angry",
                skill_0: "angry",
                skill_1: "angry",
                class_skill_1: "angry",
                class_skill_2: "angry",
                class_skill_3: "angry",
                kirarajump_0: "smile",
                win_st_0: "smile",
                damage: "sad",
                abnormal: "abnormal",
                dead: "abnormal"
            };

            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.setClearColor(0x000000, 0);
            host.innerHTML = "";
            host.appendChild(renderer.domElement);
            // Keep a live loading overlay over the canvas: GLB downloads can
            // take seconds on slow links and a blank stage reads as breakage.
            var loadingNote = document.createElement("div");
            loadingNote.className = "model-3d-loading";
            loadingNote.innerHTML = "<span class='model-spinner' aria-hidden='true'></span><p>正在读取模型数据……</p>";
            host.appendChild(loadingNote);
            scene.add(new THREE.AmbientLight(0xffffff, 2));

            function setModelLoadNote(text) {
                var line = loadingNote.querySelector("p");
                if (line) {
                    line.textContent = text ? "正在读取模型数据…… " + text : "正在读取模型数据……";
                }
            }

            function hideModelLoadNote() {
                loadingNote.remove();
            }

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

            // Box3.setFromObject reads each mesh's bind-pose geometry bounds and
            // ignores skinning, so a posed character measured 0.76 tall when it
            // actually reaches 1.03 and the framing cut off the head. Sample
            // skinned vertices through the bone matrices instead.
            function measureModelBounds() {
                var bounds = new THREE.Box3();
                var vertex = new THREE.Vector3();
                modelObject.traverse(function (node) {
                    if (!node.isMesh || !node.visible || !node.geometry) {
                        return;
                    }
                    var position = node.geometry.attributes && node.geometry.attributes.position;
                    if (!position || !position.count) {
                        return;
                    }
                    var step = Math.max(1, Math.floor(position.count / 240));
                    for (var i = 0; i < position.count; i += step) {
                        vertex.fromBufferAttribute(position, i);
                        if (node.isSkinnedMesh && node.applyBoneTransform) {
                            node.applyBoneTransform(i, vertex);
                        }
                        node.localToWorld(vertex);
                        bounds.expandByPoint(vertex);
                    }
                });
                return bounds.isEmpty() ? new THREE.Box3().setFromObject(modelObject) : bounds;
            }

            function fitModelView(force) {
                if (!force && viewInteracted) {
                    return;
                }
                var bounds = measureModelBounds();
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

            var ACTION_LABELS = {
                room_idle_L: "房间待机",
                idle: "战斗待机",
                attack: "普通攻击",
                class_skill_1: "职业技能 1",
                class_skill_2: "职业技能 2",
                class_skill_3: "职业技能 3",
                battle_run: "战斗跑动",
                damage: "受击",
                kirarajump_0: "跳跃",
                win_st_0: "胜利",
                charge_skill: "技能蓄力",
                skill: "とっておき 大招",
                chara_skill_1: "角色技能",
                skill_0: "技能 1",
                skill_1: "技能 2",
                dead: "倒下",
                abnormal: "异常状态"
            };

            function friendlyActionName(name) {
                return ACTION_LABELS[name] || name.replace(/_/g, " ");
            }

            // 分组顺序即渲染顺序。大招单独一组并置顶，因为那是用户最想看的一段，
            // 也是唯一需要按需下载的一段。
            var ACTION_GROUPS = [
                { key: "ultimate", label: "必杀演出", note: "とっておき", names: ["skill", "chara_skill_1"] },
                { key: "daily", label: "日常", note: "待机与移动", names: ["room_idle_L", "idle", "battle_run", "kirarajump_0", "win_st_0"] },
                { key: "battle", label: "战斗", note: "攻击与职业技能", names: ["attack", "class_skill_1", "class_skill_2", "class_skill_3", "charge_skill", "skill_0", "skill_1"] },
                { key: "state", label: "状态", note: "受击与异常", names: ["damage", "abnormal", "dead"] }
            ];

            function actionGroupOf(name) {
                for (var i = 0; i < ACTION_GROUPS.length; i++) {
                    if (ACTION_GROUPS[i].names.indexOf(name) >= 0) {
                        return ACTION_GROUPS[i].key;
                    }
                }
                return "other";
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
                // 大招是独立 GLB，约 180 KiB，只在用户点它时才下载。这里先按
                // 目录里声明的名字挂占位按钮，点下去再取。
                var skillSource = skillActionSource();
                var pending = {};
                if (skillSource && !skillClipsRequested) {
                    (skillSource.animations || []).forEach(function (name) {
                        if (!clipByName[name]) {
                            pending[name] = true;
                            displayClips.push({ name: name });
                        }
                    });
                }
                actionStrip.innerHTML = "";
                actionButtons = [];
                var byGroup = {};
                displayClips.forEach(function (clip) {
                    var key = actionGroupOf(clip.name);
                    (byGroup[key] = byGroup[key] || []).push(clip);
                });
                var groups = ACTION_GROUPS.concat([{ key: "other", label: "其它", note: "包内其余片段", names: [] }]);
                groups.forEach(function (group) {
                    var groupClips = byGroup[group.key];
                    if (!groupClips || !groupClips.length) {
                        return;
                    }
                    groupClips.sort(function (left, right) {
                        var leftIndex = group.names.indexOf(left.name);
                        var rightIndex = group.names.indexOf(right.name);
                        return (leftIndex < 0 ? group.names.length : leftIndex) - (rightIndex < 0 ? group.names.length : rightIndex);
                    });
                    var section = document.createElement("section");
                    section.className = "model-action-group";
                    section.dataset.actionGroup = group.key;
                    var heading = document.createElement("div");
                    heading.className = "model-control-heading";
                    heading.innerHTML = "<strong>" + escapeHtml(group.label) + "</strong><small>" + escapeHtml(group.note) + "</small>";
                    section.appendChild(heading);
                    var strip = document.createElement("div");
                    strip.className = "model-action-strip";
                    strip.setAttribute("role", "group");
                    strip.setAttribute("aria-label", group.label + "动作");
                    groupClips.forEach(function (clip) {
                        var button = document.createElement("button");
                        button.type = "button";
                        button.dataset.modelAction = clip.name;
                        button.dataset.clip = clip.name;
                        var isActive = clip.name === activeAction;
                        button.className = isActive ? "is-active" : "";
                        button.setAttribute("aria-pressed", String(isActive));
                        button.innerHTML = escapeHtml(friendlyActionName(clip.name)) + "<small>" + escapeHtml(clip.name) + "</small>";
                        if (pending[clip.name]) {
                            button.classList.add("is-pending");
                            button.title = "首次播放需要下载这段演出";
                        }
                        button.addEventListener("click", function () {
                            actionChosenByUser = true;
                            setMotionEnabled(true);
                            if (pending[clip.name]) {
                                requestSkillClips(clip.name, button);
                                return;
                            }
                            selectAction(clip.name);
                        });
                        actionButtons.push(button);
                        strip.appendChild(button);
                    });
                    section.appendChild(strip);
                    actionStrip.appendChild(section);
                });
            }

            function requestSkillClips(wanted, button) {
                if (skillClipsRequested) {
                    return;
                }
                skillClipsRequested = true;
                button.classList.add("is-loading");
                button.disabled = true;
                loadSkillActionClips(skillLoader).then(function (skillClips) {
                    if (disposed) {
                        return;
                    }
                    var merged = [];
                    skillClips.forEach(function (clip) {
                        if (!clipByName[clip.name]) {
                            clipByName[clip.name] = clip;
                        }
                    });
                    Object.keys(clipByName).forEach(function (name) {
                        merged.push(clipByName[name]);
                    });
                    activeAction = clipByName[wanted] ? wanted : activeAction;
                    mountActionControls(merged);
                    if (clipByName[wanted]) {
                        selectAction(wanted);
                    } else {
                        // 目录声明了这段演出但取回失败，按钮就不该继续假装可播。
                        skillClipsRequested = true;
                    }
                }).catch(function () {
                    if (!disposed) {
                        button.classList.remove("is-loading");
                        button.disabled = false;
                        skillClipsRequested = false;
                    }
                });
            }

            function setMotionEnabled(enabled) {
                motionEnabled = enabled;
                if (mixer) {
                    mixer.timeScale = enabled ? playbackRate : 0;
                }
                if (motionButton) {
                    motionButton.setAttribute("aria-pressed", String(enabled));
                    motionButton.classList.toggle("is-paused", !enabled);
                    motionButton.title = enabled ? "暂停（空格）" : "播放（空格）";
                    motionButton.innerHTML = "<span aria-hidden='true'>" + (enabled ? "❙❙" : "▶") + "</span>";
                }
            }

            // Enemy sprites ship multiple expression states per feature plus a
            // complete SIDE_* duplicate set for side-facing battle poses.  The
            // viewer always faces the camera, so SIDE_* stays hidden and every
            // expression group shows one state at a time.  State vocabulary was
            // surveyed across all published enemy bundles.
            var ENEMY_EXPRESSION_KINDS = { eye: "eye", eyebrow: "eyebrow", eyebrrow: "eyebrow", eyebroo: "eyebrow", mouth: "mouth" };
            var ENEMY_EXPRESSION_STATES = {
                a: 1, b: 1, c: 1, d: 1, e: 1,
                anger: 1, angry: 1, close: 1, damaga: 1, damage: 1,
                default: 1, fun: 1, joy: 1, normal: 1, open: 1,
                ridicule: 1, wait: 1, front: 1
            };
            var ENEMY_DEFAULT_STATES = ["", "normal", "default", "wait", "front", "open", "a", "b", "c", "d", "e", "fun", "joy", "anger", "angry", "ridicule", "damaga", "damage", "close"];
            var ENEMY_ACTION_STATES = {
                damage: ["close"],
                dead: ["close"],
                abnormal: ["fun", "ridicule", "close"],
                charge_skill: ["angry", "anger", "joy"],
                skill_0: ["angry", "anger", "joy"],
                skill_1: ["angry", "anger", "joy"]
            };

            function classifyEnemyVisualPart(name) {
                var match = /^(eye|eyebrow|eyebrrow|eyebroo|mouth)(?:_([a-z0-9]+))?(?:_([lr]))?_obj$/.exec(String(name || "").toLowerCase());
                if (!match) {
                    return null;
                }
                var kind = ENEMY_EXPRESSION_KINDS[match[1]];
                var state = match[2] || "";
                if (state && !ENEMY_EXPRESSION_STATES[state]) {
                    // Positional pieces (mouth_upper/lower/front/back, jaw
                    // halves, ...) complement each other instead of switching.
                    return null;
                }
                return { kind: kind, group: kind + (match[3] ? ":" + match[3] : ""), state: state };
            }

            function enemyDefaultState(states) {
                var candidates = ENEMY_DEFAULT_STATES.filter(function (state) {
                    return states[state];
                });
                // The unsuffixed state is named "" and ranks first, but it is
                // falsy — `||` skipped it and fell through to whatever the
                // traverse happened to reach first, which showed angry eyes on
                // idle.
                return candidates.length ? candidates[0] : Object.keys(states)[0];
            }

            // Enemy bundles ship grip/pose alternates of the same limb as
            // sibling nodes: hand_R_obj + hand_R_2_obj, hand_R_A/B/C_obj,
            // wing_L_obj + wing_L_open_obj, weapon_wand_obj + weapon_wand_2_obj.
            // Hiding anything that merely *looks* like a variant deletes unique
            // geometry (bodu_B_obj with no bodu_obj is the only torso some
            // models have), so a node is only hidden when a sibling sharing its
            // base name is present and ranks ahead of it.

            function enemyVariantKey(name) {
                var base = String(name || "").toLowerCase().replace(/_obj$/, "");
                var rank = 0;
                // Suffixes stack (hand_R_A_2), so peel every trailing token and
                // keep the worst rank: a plain limb outranks _A, which outranks
                // _2, which outranks an _open/_grip pose.
                for (;;) {
                    var match = /_(?:([a-c])|([2-9])|(open|close_half|close|grip))$/.exec(base);
                    if (!match) {
                        break;
                    }
                    var tokenRank = match[1]
                        ? match[1].charCodeAt(0) - 96
                        : (match[2] ? 10 + Number(match[2]) : 20);
                    rank = Math.max(rank, tokenRank);
                    base = base.slice(0, match.index);
                }
                return { base: base, rank: rank };
            }

            function hideEnemyDuplicateVariants() {
                var groups = {};
                enemyVariantParts.forEach(function (entry) {
                    var key = enemyVariantKey(entry.name);
                    entry.rank = key.rank;
                    groups[key.base] = groups[key.base] || [];
                    groups[key.base].push(entry);
                });
                Object.keys(groups).forEach(function (base) {
                    var members = groups[base];
                    if (members.length < 2) {
                        return;
                    }
                    var best = members.reduce(function (winner, entry) {
                        return entry.rank < winner.rank ? entry : winner;
                    }, members[0]);
                    members.forEach(function (entry) {
                        if (entry !== best) {
                            entry.node.visible = false;
                        }
                    });
                });
            }

            function applyEnemyVisualState(action) {
                if (modelKind !== "enemy") {
                    return;
                }
                var requested = ENEMY_ACTION_STATES[action] || [];
                Object.keys(enemyVisualParts).forEach(function (group) {
                    var states = enemyVisualParts[group];
                    var selected = "";
                    requested.some(function (want) {
                        if (states[want]) {
                            selected = want;
                        } else if (want === "angry" && states.anger) {
                            selected = "anger";
                        } else if (want === "anger" && states.angry) {
                            selected = "angry";
                        } else if (want === "damage" && states.damaga) {
                            selected = "damaga";
                        }
                        return Boolean(selected);
                    });
                    if (!selected) {
                        selected = enemyDefaultState(states);
                    }
                    Object.keys(states).forEach(function (stateName) {
                        states[stateName].forEach(function (node) {
                            node.visible = stateName === selected;
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
                    selectAutomaticFace();
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
                    // 敌人程序化预览没有 AnimationClip，也就没有时间轴可拖。
                    if (activeClipAction) {
                        activeClipAction.fadeOut(0.18);
                        activeClipAction = null;
                    }
                    updateTransport(true);
                    return;
                }
                var nextAction = mixer.clipAction(clip);
                nextAction.reset();
                applyLoopMode(nextAction);
                nextAction.fadeIn(0.18).play();
                if (activeClipAction && activeClipAction !== nextAction) {
                    activeClipAction.fadeOut(0.18);
                }
                activeClipAction = nextAction;
                updateTransport(true);
            }

            function applyLoopMode(action) {
                if (loopPlayback) {
                    action.setLoop(THREE.LoopRepeat, Infinity);
                    action.clampWhenFinished = false;
                } else {
                    // 单次播放要停在最后一帧，否则大招放完角色会瞬间弹回第一帧。
                    action.setLoop(THREE.LoopOnce, 1);
                    action.clampWhenFinished = true;
                }
            }

            function formatSeconds(value) {
                return (Math.round(value * 100) / 100).toFixed(2);
            }

            function updateTransport(force) {
                if (!timeline || !timeReadout) {
                    return;
                }
                var clip = activeClipAction && activeClipAction.getClip();
                var duration = clip ? clip.duration : 0;
                if (!duration) {
                    if (force) {
                        timeline.value = "0";
                        timeline.disabled = true;
                        timeReadout.textContent = "程序化预览";
                    }
                    return;
                }
                timeline.disabled = false;
                var elapsed = duration > 0 ? activeClipAction.time % duration : 0;
                if (!scrubbing) {
                    timeline.value = String(Math.round(elapsed / duration * 1000));
                }
                timeReadout.textContent = formatSeconds(elapsed) + " / " + formatSeconds(duration) + " s";
            }

            function scrubTo(ratio) {
                if (!activeClipAction) {
                    return;
                }
                var clip = activeClipAction.getClip();
                if (!clip || !clip.duration) {
                    return;
                }
                activeClipAction.paused = false;
                activeClipAction.time = Math.max(0, Math.min(clip.duration, ratio * clip.duration));
                // timeScale 为 0 时 mixer.update 不会推进，但仍会把新时间写进骨骼。
                mixer.update(0);
                // 拖到某一帧时表情也要跟到那一帧，否则大招中段的表情是错的。
                updateFacialFromClip();
                updateTransport();
            }

            function nudgeFrame(direction) {
                if (!activeClipAction) {
                    return;
                }
                var clip = activeClipAction.getClip();
                if (!clip || !clip.duration) {
                    return;
                }
                setMotionEnabled(false);
                var step = 1 / 30;
                var next = activeClipAction.time + direction * step;
                if (next < 0) {
                    next += clip.duration;
                } else if (next > clip.duration) {
                    next -= clip.duration;
                }
                scrubTo(next / clip.duration);
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
                var wanted = Array.isArray(requested) ? requested : [requested];
                for (var c = 0; c < wanted.length; c++) {
                    var hit = resolveOneFacePartName(kind, wanted[c], allowNumberedVariant);
                    if (hit) {
                        return hit;
                    }
                }
                return "";
            }

            function resolveOneFacePartName(kind, requested, allowNumberedVariant) {
                if (!requested) {
                    return "";
                }
                var available = faceParts[kind];
                var wanted = canonicalFacePartKey(requested);
                if (available[wanted]) {
                    return available[wanted];
                }
                if (!allowNumberedVariant) {
                    return "";
                }
                var prefix = wanted + "_";
                var variant = Object.keys(available).filter(function (key) {
                    return key.indexOf(prefix) === 0 && /^\d+$/.test(key.slice(prefix.length));
                }).sort(function (a, b) {
                    return a.localeCompare(b, undefined, { numeric: true });
                })[0];
                return variant ? available[variant] : "";
            }

            // Overlay names carry their meaning globally — cheek/tere is blush,
            // cry/namida a tear, sen/shade cast shade, angry the anger mark —
            // unlike the eye and mouth letters, which vary by character. A
            // preset lists the overlays it should light; the first one the model
            // actually has wins, so a bundle without blush shows none instead of
            // a blank placeholder.
            function resolveOverlayPart(prefixes) {
                var available = faceParts.overlay;
                if (!available) {
                    return "";
                }
                if (!Array.isArray(prefixes)) {
                    prefixes = prefixes ? [prefixes] : [];
                }
                for (var i = 0; i < prefixes.length; i++) {
                    var wanted = canonicalFacePartKey(prefixes[i]);
                    if (!wanted) {
                        continue;
                    }
                    var match = Object.keys(available).filter(function (key) {
                        return key === wanted || key.indexOf(wanted + "_") === 0;
                    }).sort(function (a, b) {
                        return a.localeCompare(b, undefined, { numeric: true });
                    })[0];
                    if (match) {
                        return available[match];
                    }
                }
                return "";
            }

            // Models without the standard preset parts (hybrid enemies with
            // player-style faces) need a neutral fallback: prefer explicit
            // default/normal variants over damage states, which sort first
            // alphabetically but read as broken eyes and mouths.
            function fallbackFacePart(kind) {
                var available = faceParts[kind];
                var keys = Object.keys(available);
                if (!keys.length) {
                    return "";
                }
                var preferences = ["default", "normal", "open", "wait", "a"];
                for (var i = 0; i < preferences.length; i++) {
                    var wanted = kind + "_" + preferences[i];
                    if (available[wanted]) {
                        return available[wanted];
                    }
                    var variants = keys.filter(function (key) {
                        return key.indexOf(wanted + "_") === 0;
                    }).sort(function (a, b) {
                        return a.localeCompare(b, undefined, { numeric: true });
                    });
                    if (variants.length) {
                        return available[variants[0]];
                    }
                }
                return available[keys.sort(function (a, b) {
                    return a.localeCompare(b, undefined, { numeric: true });
                })[0]];
            }

            // Index the head layers by the name the facial table addresses them
            // by. One authored layer can arrive as several nodes (mirrored
            // pieces, and the separate outline material), so each name keeps a
            // list rather than a single node.
            function indexFacialLayers() {
                facialLayerNodes = {};
                if (!facialTable || !modelObject) {
                    return;
                }
                modelObject.traverse(function (child) {
                    var name = resolveNodeName(child);
                    if (name.slice(0, 4).toLowerCase() !== "l30_") {
                        return;
                    }
                    var layer = name.slice(4);
                    (facialLayerNodes[layer] = facialLayerNodes[layer] || []).push(child);
                });
            }

            // Apply one row of the table: every layer it lists goes visible,
            // every other switched layer goes hidden, and the layers the table
            // records as never used in this direction stay hidden for good.
            //
            // Layers the table does not mention at all are the head base — hair,
            // face, backhead — which is on for every expression and must not be
            // touched.
            function applyFacialState(index, automatic) {
                if (!facialTable) {
                    return false;
                }
                var state = facialTable.states[index];
                if (!state) {
                    return false;
                }
                var wanted = {};
                state.forEach(function (layerIndex) {
                    var layer = facialTable.layers[layerIndex];
                    if (layer) {
                        wanted[layer] = true;
                    }
                });
                facialTable.layers.forEach(function (layer) {
                    (facialLayerNodes[layer] || []).forEach(function (node) {
                        node.visible = Boolean(wanted[layer]);
                    });
                });
                (facialTable.hide || []).forEach(function (layer) {
                    (facialLayerNodes[layer] || []).forEach(function (node) {
                        node.visible = false;
                    });
                });
                facialStateIndex = index;
                faceFollowsAction = Boolean(automatic);
                updateFacialControls(automatic);
                return true;
            }

            // facialID -> state index, through the override sets the action
            // events carry. CharacterFacialDB gives two characters a different
            // face for the same event, and a zero set means no override.
            function facialStateForId(facialId, overrideSet) {
                if (!facialTable) {
                    return -1;
                }
                if (overrideSet && facialTable.overrides) {
                    var replaced = facialTable.overrides[String(overrideSet)];
                    if (replaced !== undefined && replaced >= 0) {
                        return replaced;
                    }
                }
                var index = facialTable.ids[facialId];
                return index === undefined ? -1 : index;
            }

            // Name a state from the evidence the builder recorded. The layer
            // letters cannot be read for meaning — eye_C is a different eye on
            // every character, and the direction blocks do not even agree with
            // each other — so a state is named only when an action or a
            // CharacterDefine constant asks for it, and by its number otherwise.
            var FACIAL_TAG_LABELS = {
                "default": "通常",
                blink: "闭眼",
                abnormal: "异常状态",
                "action:win_st": "胜利",
                "action:win_lp": "胜利",
                "action:kirarajump": "跳跃",
                "action:damage": "受击",
                "action:dead": "倒下",
                "action:abnormal": "异常状态",
                "action:battle_in": "登场",
                "action:battle_out": "退场",
                "action:battle_run": "跑动",
                "action:room_idle_R": "待机"
            };

            function facialStateLabel(index) {
                var tags = (facialTable && facialTable.tags && facialTable.tags[index]) || [];
                // A CharacterDefine tag says what the face *is*; an action tag
                // only says who asks for it. One state is often both — the blink
                // is also what win_st_2 shows partway through — and "闭眼"
                // describes it where "胜利" would not.
                var intrinsic = ["default", "blink", "abnormal"];
                for (var i = 0; i < intrinsic.length; i++) {
                    if (tags.indexOf(intrinsic[i]) >= 0) {
                        return FACIAL_TAG_LABELS[intrinsic[i]];
                    }
                }
                for (var j = 0; j < tags.length; j++) {
                    if (FACIAL_TAG_LABELS[tags[j]]) {
                        return FACIAL_TAG_LABELS[tags[j]];
                    }
                }
                return "表情 " + (index + 1);
            }

            // Rebuild the preset strip out of the states this character actually
            // has. The old strip offered seven fixed presets every character was
            // assumed to own; the table says how many there really are (12 to 17)
            // and the buttons now match one to one.
            function mountFacialStates() {
                var strip = document.querySelector(".model-face-strip");
                if (!strip || !facialTable) {
                    return;
                }
                strip.querySelectorAll("[data-face-preset], [data-facial-state]")
                    .forEach(function (button) { button.remove(); });
                faceButtons = [];
                facialTable.states.forEach(function (_state, index) {
                    var button = document.createElement("button");
                    button.type = "button";
                    button.dataset.facialState = String(index);
                    button.setAttribute("aria-pressed", "false");
                    button.textContent = facialStateLabel(index);
                    // 多数状态只能按编号叫（层名的字母在每个角色身上含义都不同），
                    // 所以把它实际点亮的层写进 tooltip，让编号至少可以被辨认。
                    var layers = (facialTable.states[index] || [])
                        .map(function (layerIndex) { return facialTable.layers[layerIndex]; })
                        .filter(Boolean);
                    button.title = "表情 " + (index + 1) + " / " + facialTable.states.length
                        + (layers.length ? "\n" + layers.join(" + ") : "");
                    button.addEventListener("click", function () {
                        applyFacialState(index, false);
                    });
                    strip.appendChild(button);
                });
            }

            function updateFacialControls(automatic) {
                if (faceAutoButton) {
                    faceAutoButton.classList.toggle("is-active", Boolean(automatic));
                    faceAutoButton.setAttribute("aria-pressed", String(Boolean(automatic)));
                }
                var strip = document.querySelector(".model-face-strip");
                if (!strip) {
                    return;
                }
                strip.querySelectorAll("[data-facial-state]").forEach(function (button) {
                    var isActive = !automatic
                        && Number(button.dataset.facialState) === facialStateIndex;
                    button.classList.toggle("is-active", isActive);
                    button.setAttribute("aria-pressed", String(isActive));
                });
            }

            // The face an action asks for on frame 0, used when the action is
            // selected and whenever "跟随动作" is pressed.
            function facialStateForAction(action) {
                var events = facialActions && facialActions[action];
                if (!events || !events.length) {
                    return -1;
                }
                return facialStateForId(events[0][1], events[0][2]);
            }

            // The face the action wants *right now* — the event the timeline has
            // reached, or the resting face for an action that authors none. This
            // is what a blink has to hand back when it ends: win_st_0 is neutral
            // until frame 7 and the winning face after it, so restoring the
            // frame-0 face would undo the win.
            function facialWantedState() {
                var events = facialActions && facialActions[activeAction];
                if (!events || !events.length) {
                    return facialTable ? facialTable["default"] : -1;
                }
                var event = events[facialEventIndex >= 0 ? facialEventIndex : 0];
                var state = facialStateForId(event[1], event[2]);
                return state >= 0 ? state : (facialTable ? facialTable["default"] : -1);
            }

            // Blinking is the one thing the clips do not author: CharacterAnim
            // runs it on a timer of its own, moving between the open and closed
            // halves of FACIAL_ID_BLINK. It may only interrupt a resting face, so
            // a move that asked for a specific expression keeps it.
            function updateFacialBlink(time) {
                if (!facialTable) {
                    return;
                }
                // What the action wants, not what is on screen: the blink itself
                // changes what is on screen, so testing that would make the face
                // stop resting the instant it blinked and leave the eye shut.
                var wanted = facialWantedState();
                var canBlink = faceFollowsAction
                    && wanted === facialTable["default"]
                    && facialTable.blink >= 0
                    && facialTable.blink !== facialTable["default"];
                if (canBlink) {
                    if (!blinkActive && time >= nextBlinkAt) {
                        blinkActive = true;
                        blinkUntil = time + 115;
                        applyFacialState(facialTable.blink, true);
                    } else if (blinkActive && time >= blinkUntil) {
                        blinkActive = false;
                        nextBlinkAt = time + 2800 + Math.random() * 2600;
                        applyFacialState(wanted, true);
                    }
                } else {
                    if (blinkActive) {
                        // Interrupted mid-blink by a move that wants its own face;
                        // hand the face back rather than leaving the eye shut.
                        applyFacialState(wanted, true);
                    }
                    blinkActive = false;
                    nextBlinkAt = time + 2800;
                }
                // The clip must not overwrite a closed eye, so it only advances
                // between blinks.
                if (!blinkActive) {
                    updateFacialFromClip();
                }
            }

            // Walk the active clip's own timeline. CharacterAnim changes the face
            // partway through a move — damage asks for three faces across its
            // first 14 frames — so the event frame has to be honoured rather than
            // applying only the first one.
            function updateFacialFromClip() {
                if (!facialTable || !faceFollowsAction || !activeClipAction) {
                    return;
                }
                var events = facialActions && facialActions[activeAction];
                if (!events || !events.length) {
                    return;
                }
                var clip = activeClipAction.getClip();
                var duration = clip && clip.duration;
                var time = activeClipAction.time;
                if (duration) {
                    // A looping clip restarts, and so does the event sequence.
                    time = time % duration;
                }
                // Nudge by a thousandth of a frame before comparing. Accumulating
                // 1/30 fourteen times and scaling back gives 13.9999996, so an
                // event authored on frame 14 would otherwise land on 15.
                var frame = time * (facialActionState.fps || 30) + 0.001;
                var index = 0;
                for (var i = 0; i < events.length; i++) {
                    if (events[i][0] <= frame) {
                        index = i;
                    }
                }
                if (index === facialEventIndex) {
                    return;
                }
                var state = facialStateForId(events[index][1], events[index][2]);
                if (state >= 0) {
                    facialEventIndex = index;
                    facialOverrideSet = events[index][2];
                    applyFacialState(state, true);
                }
            }

            // Put the face back under the action's control. With a table that
            // means the face the clip asks for on its own timeline; without one
            // it falls back to the guessed presets.
            function selectAutomaticFace() {
                if (facialTable) {
                    facialEventIndex = -1;
                    faceFollowsAction = true;
                    var state = facialStateForAction(activeAction);
                    // An action with no authored facial event leaves the face
                    // alone in game too, so the resting face is the right answer.
                    applyFacialState(state >= 0 ? state : facialTable["default"], true);
                    return;
                }
                selectFace(actionFacePresets[activeAction] || "normal", true);
            }

            function selectFace(presetName, automatic) {
                faceFollowsAction = Boolean(automatic);
                if (facialTable) {
                    // Reached only by the load-time call, before the table has
                    // been consulted; the preset names have no meaning here.
                    applyFacialState(facialTable["default"], Boolean(automatic));
                    return;
                }
                var preset = facePresets[presetName] || facePresets.normal;
                var selectedParts = {};
                Object.keys(faceParts).forEach(function (kind) {
                    var requested = preset[kind];
                    if (kind === "overlay") {
                        selectedParts[kind] = resolveOverlayPart(requested);
                        return;
                    }
                    var requestedPart = resolveFacePartName(kind, requested, true);
                    if (requestedPart) {
                        selectedParts[kind] = requestedPart;
                        return;
                    }
                    var normalPart = facePresets.normal[kind];
                    selectedParts[kind] = resolveFacePartName(kind, normalPart, true)
                        || fallbackFacePart(kind);
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
                    var keys = Object.keys(faceParts[kind]).sort(function (a, b) {
                        return a.localeCompare(b, undefined, { numeric: true });
                    });
                    if (keys.length === 0) {
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
                    keys.forEach(function (key) {
                        var option = document.createElement("option");
                        option.value = faceParts[kind][key];
                        option.textContent = key.replace(/^(eye|eyebrow|mouth)_/, "");
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
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
                renderer.setSize(width, height, false);
                // Reframe only while the visitor has not taken manual control of
                // the camera, so mobile browser chrome and panel resizes never
                // yank the view (or drift while an animation plays).
                if (modelObject && !viewInteracted) {
                    fitModelView(true);
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
            controls.addEventListener("start", function () {
                viewInteracted = true;
            });

            function fetchModel(url) {
                return fetch(url).then(function (response) {
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status);
                    }
                    if (!response.body || typeof Response === "undefined") {
                        return response;
                    }
                    var total = Number(response.headers.get("Content-Length") || 0);
                    if (!total) {
                        return response;
                    }
                    var reader = response.body.getReader();
                    var chunks = [];
                    var received = 0;
                    function pump() {
                        return reader.read().then(function (result) {
                            if (result.done) {
                                return new Response(new Blob(chunks), {
                                    status: response.status,
                                    headers: response.headers
                                });
                            }
                            received += result.value.byteLength;
                            setModelLoadNote(Math.min(99, Math.round((received / total) * 100)) + "%");
                            chunks.push(result.value);
                            return pump();
                        });
                    }
                    return pump();
                });
            }

            function readModelResponse(url) {
                // Plain fetch: the Cache API put/clone detour corrupted a few
                // texture bodies under load, and the browser HTTP cache already
                // covers repeat visits on the deployment.
                return fetch(url).then(function (response) {
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status);
                    }
                    return response;
                });
            }

            function cacheModel(url, compression) {
                return readModelResponse(url).then(function (response) {
                    return response.blob();
                }).then(function (blob) {
                    if (compression === "gzip") {
                        if (!("DecompressionStream" in window)) {
                            throw new Error("gzip decompression is unavailable");
                        }
                        setModelLoadNote("解压中……");
                        var stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
                        return new Response(stream).blob();
                    }
                    return blob;
                }).then(function (blob) {
                    setModelLoadNote("");
                    if (blob.size >= 20) {
                        return blob.slice(0, 20).arrayBuffer().then(function (head) {
                            var view = new DataView(head);
                            var magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
                            var total = view.getUint32(8, true);
                            if (magic !== "glTF" || total !== blob.size) {
                                console.warn("GLB integrity mismatch:", magic, "declared", total, "actual", blob.size);
                            }
                            return blob;
                        });
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
                                            // Opaque with an alpha cut, matching the
                                            // character materials above.
                                            child.material.transparent = false;
                                            child.material.alphaTest = 0.015;
                                            child.material.depthWrite = true;
                                            child.material.depthTest = true;
                                            // Weapons carry a cartoon outline as an
                                            // inverted hull: a scaled-up shell whose
                                            // faces point inward and map to a black
                                            // texel. Rendering it double-sided draws
                                            // that shell over the weapon, so the whole
                                            // model turns black.
                                            child.material.side = THREE.FrontSide;
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
                return loadRetargetedClips(loader, source, "职业动作");
            }

            // とっておき and the character's own battle skill, from the GLB
            // tools/build_skill_action_catalog.py publishes for this model id.
            // Fetched only when asked for: each is ~180 KiB, far more than the
            // shared class actions, because the clips run 15 seconds.
            function skillActionSource() {
                // The catalog is keyed by the numeric model id, which the only
                // identifier in scope here carries: preview.file always reads
                // asset/models/model_pl_<id>/model.glb.gz.
                var match = /model_pl_(\d+)/.exec(String(preview.file || ""));
                return (match && SKILL_ACTION_PREVIEWS[match[1]]) || null;
            }

            function loadSkillActionClips(loader) {
                return loadRetargetedClips(loader, skillActionSource(), "大招动作");
            }

            function loadRetargetedClips(loader, source, what) {
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
                                console.warn(what + "载入失败", error);
                                resolve([]);
                            } finally {
                                disposeObjectResources(actionGltf.scene);
                            }
                        }, undefined, function () { resolve([]); });
                    });
                }).catch(function () { return []; });
            }

            function showViewerError(message) {
                if (disposed || !document.body.contains(host)) {
                    return;
                }
                host.innerHTML = "<div class='model-3d-error'><p>" + escapeHtml(message) + "</p><button type='button'>重试加载</button></div>";
                host.querySelector("button").addEventListener("click", function () {
                    if (activeModelCleanup) {
                        activeModelCleanup();
                    }
                    mount3DModel(preview, metadata, modelKind);
                });
            }

            cacheModel(preview.file, preview.compression).then(function (sourceUrl) {
                var loader = new GLTFLoader();
                loader.setMeshoptDecoder(MeshoptDecoder);
                // 大招按需加载时要用同一个 loader（已装好 meshopt 解码器）。
                skillLoader = loader;
                loader.load(sourceUrl, function (gltf) {
                    if (disposed) {
                        return;
                    }
                    modelObject = gltf.scene;
                    resetModelTransform();
                    modelObject.traverse(function (child) {
                        var isPlayer = Boolean(metadata);
                        var loweredName = String(child.name || "").toLowerCase();
                        var isFaceLayer = loweredName.indexOf("l30_") === 0;
                        if (!isPlayer && ((/^[lrt]\d+_/.test(loweredName) && !isFaceLayer)
                            || (!isFaceLayer && /(damage|abnormal|flash|blur)/.test(loweredName)))) {
                            child.visible = false;
                        }
                        if (!child.userData.facePart && loweredName.indexOf("l30_") === 0) {
                            var partName = child.name.slice(4);
                            var partKind = classifyFacePart(partName);
                            if (partKind) {
                                child.userData.facePart = { kind: partKind, name: partName };
                            }
                        }
                        if (modelKind === "enemy" && child.isMesh) {
                            var enemyName = resolveNodeName(child);
                            var enemyPart = classifyEnemyVisualPart(enemyName);
                            if (enemyPart) {
                                enemyVisualParts[enemyPart.group] = enemyVisualParts[enemyPart.group] || {};
                                enemyVisualParts[enemyPart.group][enemyPart.state] = enemyVisualParts[enemyPart.group][enemyPart.state] || [];
                                enemyVisualParts[enemyPart.group][enemyPart.state].push(child);
                            } else if (/^side_/i.test(enemyName)) {
                                // SIDE_* is a complete duplicate set for the
                                // side-facing battle pose; the viewer always
                                // faces the camera.
                                child.visible = false;
                            } else {
                                enemyVariantParts.push({ node: child, name: enemyName });
                            }
                        }
                        if (child.isMesh && child.material) {
                            // Each bundle carries two kinds of material, and the
                            // Unity material floats say they render differently.
                            //
                            // The main body/head materials do not blend at all:
                            // _Mode=0 (opaque), _SrcBlend=One/_DstBlend=Zero,
                            // _ZWrite=1, with MsbHandler supplying
                            // m_AlphaTestRefValue=0.01.  Blending them put every
                            // layer in three.js's transparent queue, where the
                            // first-drawn piece blended its anti-aliased edge
                            // against the background and then wrote depth, so
                            // later layers behind it were depth-rejected and the
                            // edge kept that background colour.  That is the dark
                            // seam where model_pl_140007's hat brim meets the hair
                            // (hat_L draws at renderOrder 2, the hair at 4152 up).
                            //
                            // The "_outline" material is the genuinely translucent
                            // one (_Mode=3, _DstBlend=OneMinusSrcAlpha, _ZWrite=0)
                            // and covers the pieces meant to read as see-through —
                            // on 140007 that is the crystal ball, the far arm and
                            // the sleeves.  It must keep blending and must not
                            // write depth.
                            //
                            // Meshes stay double-sided because mirrored left/right
                            // pieces do not share a reliable GLB winding direction.
                            var blended = /_outline$/i.test(child.material.name || "");
                            child.material.transparent = blended;
                            child.material.alphaTest = blended ? 0 : 0.01;
                            child.material.depthWrite = !blended
                                && preview.depthWrite !== false;
                            child.material.depthTest = true;
                            // Weapons carry their cartoon outline as an inverted
                            // hull mapped to a black texel, so they must cull
                            // back faces or the shell hides the weapon.
                            child.material.side = modelKind === "weapon" ? THREE.FrontSide : THREE.DoubleSide;
                            // Kept for the layers the atlas really does blend
                            // (m_eRenderStage 7 draws behind the body), and as the
                            // tie-break the engine authored via m_HieIndex.
                            child.renderOrder = resolveRenderOrder(child);
                            // Skinned vertices follow their bones, but frustum
                            // culling uses the node's bounding sphere, which
                            // stays at the skeleton origin for these exports —
                            // zooming onto the face culled eyes, brows, and
                            // mouths. Skinned pieces must never be culled.
                            if (child.isSkinnedMesh) {
                                child.frustumCulled = false;
                            }
                        }
                        var facePart = child.userData && child.userData.facePart;
                        if (facePart && faceParts[facePart.kind]) {
                            faceParts[facePart.kind][canonicalFacePartKey(facePart.name)] = facePart.name;
                        }
                    });
                    scene.add(modelObject);
                    // Test hook for tools/check_faces.py, which asserts that a
                    // model shows one eye/brow/mouth layer and no overlays.
                    if (new URLSearchParams(window.location.search).get("debug") === "1") {
                        window.__modelDebug = modelObject;
                        // Enough of the facial engine to check it from outside:
                        // which row is applied, which clip event drove it, and the
                        // clip clock that decides when the next one lands.
                        // requestAnimationFrame is throttled to nothing in a
                        // hidden tab, so the render loop cannot be used to check
                        // the event schedule. This advances the clip by an exact
                        // delta and runs the same update the loop would.
                        window.__facialStep = function (delta, now) {
                            if (mixer) {
                                mixer.update(delta);
                            }
                            // Same path the render loop takes, so the blink and the
                            // clip events are exercised together rather than in
                            // isolation. `now` stands in for the rAF timestamp.
                            if (now === undefined) {
                                updateFacialFromClip();
                            } else {
                                updateFacialBlink(now);
                            }
                            return {
                                blinking: blinkActive,
                                clipTime: activeClipAction && activeClipAction.time,
                                frame: activeClipAction
                                    && activeClipAction.time * (facialActionState.fps || 30),
                                eventIndex: facialEventIndex,
                                stateIndex: facialStateIndex,
                                face: (facialTable && facialTable.states[facialStateIndex] || [])
                                    .map(function (i) { return facialTable.layers[i]; })
                            };
                        };
                        // The skill clips are retargeted onto this model's bones by
                        // uuid, so nothing about them is visible in the DOM. This
                        // reports how many tracks actually bound and how far the rig
                        // travels across the clip, which is what tells a real
                        // retarget from a clip that loaded and drives nothing.
                        window.__clipDebug = function (name) {
                            var clip = clipByName[name];
                            if (!clip) {
                                return { known: Object.keys(clipByName) };
                            }
                            var bound = 0;
                            clip.tracks.forEach(function (track) {
                                var binding = THREE.PropertyBinding.parseTrackName(track.name);
                                if (THREE.PropertyBinding.findNode(modelObject, binding.nodeName)) {
                                    bound += 1;
                                }
                            });
                            var action = mixer.clipAction(clip);
                            var previous = activeClipAction;
                            if (previous && previous !== action) {
                                previous.stop();
                            }
                            action.reset().play();
                            var samples = [0, 0.25, 0.5, 0.75].map(function (fraction) {
                                action.time = clip.duration * fraction;
                                mixer.update(0);
                                modelObject.updateMatrixWorld(true);
                                var box = new THREE.Box3().setFromObject(modelObject);
                                return [Number(box.min.y.toFixed(4)), Number(box.max.y.toFixed(4)),
                                        Number(box.max.x.toFixed(4))];
                            });
                            action.stop();
                            if (previous && previous !== action) {
                                previous.reset().play();
                                mixer.update(0);
                            }
                            return { tracks: clip.tracks.length, bound: bound, duration: clip.duration, samples: samples };
                        };
                        window.__facialDebug = function () {
                            return {
                                table: facialTable,
                                stateIndex: facialStateIndex,
                                eventIndex: facialEventIndex,
                                followsAction: faceFollowsAction,
                                action: activeAction,
                                events: facialActions && facialActions[activeAction],
                                fps: facialActionState.fps,
                                clipTime: activeClipAction && activeClipAction.time,
                                clipDuration: activeClipAction && activeClipAction.getClip().duration,
                                loop: activeClipAction && activeClipAction.loop
                            };
                        };
                    }
                    mixer = new THREE.AnimationMixer(modelObject);
                    mountFaceControls();
                    // Face overlays are exported visible in some source bundles.
                    // Apply the normal preset before the asynchronous class action
                    // download so shade/debuff layers never flash during loading.
                    selectFace("normal", true);
                    // Then swap the guessed face for the authored one as soon as
                    // the character's table arrives. Loading it here rather than
                    // ahead of the GLB keeps the model itself first on the wire.
                    if (preview.facial) {
                        Promise.all([loadFacialTable(preview.facial), loadFacialActions()])
                            .then(function (results) {
                                if (disposed || !results[0] || !modelObject) {
                                    return;
                                }
                                facialTable = results[0];
                                facialActions = results[1].actions;
                                indexFacialLayers();
                                mountFacialStates();
                                selectAutomaticFace();
                            });
                    }
                    hideEnemyDuplicateVariants();
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
                    // Frame the model as soon as it exists; the asynchronous
                    // class-action and weapon downloads must not leave the
                    // canvas staring at the default camera.
                    hideModelLoadNote();
                    modelObject.updateMatrixWorld(true);
                    fitModelView(true);
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
                        if (!actionChosenByUser) {
                            activeAction = clipByName.idle ? "idle" : clipByName.room_idle_L ? "room_idle_L" : clips[0] && clips[0].name;
                            if (!activeAction && modelKind === "enemy") {
                                activeAction = "idle";
                            }
                        }
                        if (faceFollowsAction) {
                            selectAutomaticFace();
                        }
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
                    showViewerError("GLB 模型解析失败，文件可能已损坏或下载不完整。");
                });
            }).catch(function () {
                showViewerError("模型下载或解压失败，请检查网络后重试。");
            });

            if (motionButton) {
                motionButton.addEventListener("click", function () {
                    setMotionEnabled(!motionEnabled);
                });
            }
            if (timeline) {
                timeline.addEventListener("pointerdown", function () { scrubbing = true; });
                timeline.addEventListener("input", function () {
                    scrubbing = true;
                    // 拖动即暂停，否则松手瞬间动作会从拖到的位置继续跑，看不清单帧。
                    setMotionEnabled(false);
                    scrubTo(Number(timeline.value) / 1000);
                });
                ["pointerup", "pointercancel", "blur"].forEach(function (event) {
                    timeline.addEventListener(event, function () { scrubbing = false; });
                });
            }
            rateButtons.forEach(function (button) {
                button.addEventListener("click", function () {
                    playbackRate = Number(button.dataset.playbackRate) || 1;
                    rateButtons.forEach(function (other) {
                        var isActive = other === button;
                        other.classList.toggle("is-active", isActive);
                        other.setAttribute("aria-pressed", String(isActive));
                    });
                    setMotionEnabled(true);
                });
            });
            if (loopButton) {
                loopButton.addEventListener("click", function () {
                    loopPlayback = !loopPlayback;
                    loopButton.classList.toggle("is-active", loopPlayback);
                    loopButton.setAttribute("aria-pressed", String(loopPlayback));
                    loopButton.title = loopPlayback ? "循环播放（L）" : "单次播放（L）";
                    if (activeClipAction) {
                        applyLoopMode(activeClipAction);
                        activeClipAction.reset().play();
                        setMotionEnabled(true);
                    }
                });
            }
            resetButton.addEventListener("click", resetViewerState);

            function resetViewerState() {
                resetModelTransform();
                resetView();
                if (scaleRange) {
                    scaleRange.value = "100";
                    scaleValue.textContent = "100%";
                }
                if (verticalRange) {
                    verticalRange.value = "0";
                    verticalValue.textContent = "0";
                }
                setMotionEnabled(true);
                if (clipByName.idle) {
                    selectAction("idle");
                } else if (clipByName.room_idle_L) {
                    selectAction("room_idle_L");
                }
            }

            // 快捷键只在观察台可见、且焦点不在输入控件里时生效。
            function onViewerKeydown(event) {
                if (disposed || !document.body.contains(host)) {
                    return;
                }
                if (event.metaKey || event.ctrlKey || event.altKey) {
                    return;
                }
                var target = event.target;
                var tag = target && target.tagName ? target.tagName.toLowerCase() : "";
                if (tag === "input" || tag === "textarea" || tag === "select" || (target && target.isContentEditable)) {
                    return;
                }
                var handled = true;
                switch (event.key) {
                    case " ":
                    case "Spacebar":
                        setMotionEnabled(!motionEnabled);
                        break;
                    case "ArrowLeft":
                        nudgeFrame(-1);
                        break;
                    case "ArrowRight":
                        nudgeFrame(1);
                        break;
                    case "l":
                    case "L":
                        if (loopButton) {
                            loopButton.click();
                        }
                        break;
                    case "r":
                    case "R":
                        resetViewerState();
                        break;
                    default:
                        handled = false;
                }
                if (handled) {
                    event.preventDefault();
                }
            }
            window.addEventListener("keydown", onViewerKeydown);
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
            faceButtons.forEach(function (button) {
                button.addEventListener("click", function () {
                    selectFace(button.dataset.facePreset, false);
                });
            });
            if (faceAutoButton) {
                faceAutoButton.addEventListener("click", function () {
                    selectAutomaticFace();
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
                    updateTransport();
                }
                updateEnemyProceduralMotion(delta);
                if (facialTable) {
                    updateFacialBlink(time);
                } else if (faceFollowsAction && activeAction === "idle" && activeFaceSelection) {
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
                window.removeEventListener("keydown", onViewerKeydown);
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
                host.innerHTML = "<div class='model-3d-error'><p>WebGL 模块加载失败，本地内置模块与 CDN 均不可达，请检查网络后重试。</p><button type='button'>重试加载</button></div>";
                host.querySelector("button").addEventListener("click", function () {
                    mount3DModel(preview, metadata, modelKind);
                });
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
            if (manifestState.offline) {
                setStatus(LOCAL_FILE_HINT, "error");
            } else if (manifestState.error) {
                setStatus("素材索引正常，但 WebGL 清单加载失败；可预览数量不会显示为错误的示例值", "error");
            } else {
                setStatus("已载入 " + state.allModels.length.toLocaleString("zh-CN") + " 个模型条目 · 当前显示 " + spriteNames.length + " 个纹理", "ready");
            }
        }).catch(function () {
            if (requestId !== state.indexRequest) {
                return;
            }
            // The sprite index lives on the official CDN, but the 3D preview
            // only needs the local GLB. A missing index must not hide a model
            // that is perfectly previewable.
            if (MODEL_PREVIEWS[model.name]) {
                renderDetailShell(model, []);
                setStatus("纹理目录读取失败，仍可预览 3D 模型", "error");
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

    // Both facial fetches retry like the manifest does: a stale CDN edge or a
    // read racing a rebuild must not leave a model stuck with no face.
    function fetchJsonWithRetry(url, attempt) {
        attempt = attempt || 0;
        return fetch(url, { cache: "default" }).then(function (response) {
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }
            return response.json();
        }).catch(function (error) {
            if (attempt < 2) {
                return new Promise(function (resolve) {
                    window.setTimeout(resolve, 900 * (attempt + 1));
                }).then(function () {
                    return fetchJsonWithRetry(url, attempt + 1);
                });
            }
            throw error;
        });
    }

    // One file for every character, so it is fetched once per page.
    function loadFacialActions() {
        if (!facialActionState.promise) {
            facialActionState.promise = fetchJsonWithRetry(FACIAL_ACTIONS_URL).then(function (data) {
                facialActionState.fps = data.fps || 30;
                facialActionState.actions = data.actions || {};
                return facialActionState;
            }).catch(function () {
                // Without it the viewer still shows every expression; only the
                // automatic action-driven face is lost, so fail quietly.
                return facialActionState;
            });
        }
        return facialActionState.promise;
    }

    function loadFacialTable(url) {
        if (!url) {
            return Promise.resolve(null);
        }
        if (!facialTableCache[url]) {
            facialTableCache[url] = fetchJsonWithRetry(url).catch(function () {
                // Let a later attempt try again rather than caching the failure.
                delete facialTableCache[url];
                return null;
            });
        }
        return facialTableCache[url];
    }

    // The manifest ships with the deployment and is rewritten whenever models
    // are rebuilt; a read racing that rewrite (or a stale CDN edge) must not
    // permanently disable every 3D preview, so retry a few times.
    function loadPreviewManifest(attempt) {
        if (IS_LOCAL_FILE) {
            manifestState.offline = true;
            manifestState.error = true;
            return Promise.resolve();
        }
        attempt = attempt || 0;
        return fetch(MODEL_MANIFEST_URL, { cache: "reload" }).then(function (response) {
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
            Object.keys(manifest.skillActions || {}).forEach(function (modelId) {
                SKILL_ACTION_PREVIEWS[modelId] = manifest.skillActions[modelId];
            });
            if (manifest.facialActions) {
                FACIAL_ACTIONS_URL = manifest.facialActions;
            }
            manifestState.loaded = true;
        }).catch(function () {
            if (attempt < 2) {
                return new Promise(function (resolve) {
                    window.setTimeout(resolve, 1200 * (attempt + 1));
                }).then(function () {
                    return loadPreviewManifest(attempt + 1);
                });
            }
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
            if (manifestState.offline) {
                setStatus("已载入 " + state.allModels.length.toLocaleString("zh-CN") + " 个索引条目 · " + LOCAL_FILE_HINT, "error");
            } else if (manifestState.error) {
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
            setStatus("素材索引暂时无法连接，请检查网络后重试", "error");
            elements.list.innerHTML = "<div class='models-list-empty'>索引加载失败。<br>官方素材库：<a href='https://asset.kirafan.moe/' target='_blank' rel='noopener noreferrer'>asset.kirafan.moe ↗</a><br><button id='retryDatabase' type='button'>重新连接</button></div>";
            var retry = document.getElementById("retryDatabase");
            if (retry) {
                retry.addEventListener("click", function () {
                    retry.disabled = true;
                    retry.textContent = "连接中……";
                    setStatus("正在重新连接 KiraFan Assets 素材索引……", "");
                    loadDatabase();
                });
            }
        });
    }

    buildPlayerMetadata();
    bindControls();
    loadPreviewManifest().then(loadDatabase);
})();
