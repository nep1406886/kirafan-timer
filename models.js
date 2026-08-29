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
    // Per-model rarity and とっておき ownership, keyed by the numeric model id.
    // Written by tools/build_rarity_table.py out of CharacterList.m_Rare and
    // SkillList_PL.m_UniqueSkillScene. The game only grants an ultimate from ★4
    // up, and a skill.glb.gz exists for some models that never had one, so the
    // catalog cannot be the gate -- this table is.
    var MODEL_RARITY = {};
    // ★4 is the lowest rarity the game gives a とっておき to. Keep in step with
    // TOTTEOKI_MIN_RARITY in tools/build_rarity_table.py.
    var TOTTEOKI_MIN_RARITY = 4;
    var RARITY_TABLE_URL = "asset/models/rarity.json?v=20260829-1";
    // Per-clip node visibility, from the game's own MeigeAnimClip tracks. glTF
    // has no channel for "hide this node", so the exported GLB draws all twelve
    // leg silhouettes and both hats at once; the table says which single one the
    // clip means. Written by tools/build_visibility_table.py.
    var VISIBILITY_TABLE = null;
    var VISIBILITY_TABLE_URL = "asset/models/visibility.json?v=20260829-1";
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
    // とっておき 演出。core/uniqueskill.js 已经把游戏自己的调度实现完了
    // （Unity TRS 曲线 + Meige 的 meshVisibility/meshColor/UV/相机通道 +
    // 帧事件），原本只有 game/uniqueskill.html 那个诊断页在用。观察台这边
    // 之前只把角色的大招动作重定向到模型上播，背景、云、光、以及那台被
    // 动画驱动的正交相机全都没有 —— 所以看起来就是个人在空场里挥手。
    //
    // 单独按需 import：177 个演出场景平均 24 KiB，加上模块本身，只有真的
    // 点了「演出」才值得下载。
    var cinematicModule = null;
    function loadCinematicModule() {
        if (!cinematicModule) {
            cinematicModule = import("./core/uniqueskill.js").catch(function (error) {
                cinematicModule = null;
                throw error;
            });
        }
        return cinematicModule;
    }

    // 贴图 alpha 斜坡的颜色修复。core/texture-fringe.js 里记着量出来的
    // 数字：model_en_7000 的 512×512 主图有 55.6% 的纹素 alpha 不满，
    // 而它们的亮度随 alpha 一路掉到 18 —— cutoff 0.01 把这一截全留下并
    // 按不透明画出来，放大三倍之后就是头发和嘴周围那圈黑边。
    //
    // models.js 是普通脚本不是模块，所以按需 import；拿不到就照旧渲染，
    // 只是黑边还在，不至于整个观察台打不开。
    var fringeModule = null;
    function loadFringeModule() {
        if (!fringeModule) {
            fringeModule = import("./core/texture-fringe.js").catch(function (error) {
                fringeModule = null;
                throw error;
            });
        }
        return fringeModule;
    }
    var fringeHelpers = null;
    // 默认关掉。开关留着（?fringe=1 打开，?nofringe=1 强制关掉），因为要靠它
    // 做前后对照 —— 改代码再刷新的话两次的相机和姿势对不齐，量出来的差值没有
    // 意义。
    //
    // 为什么默认关：判定线只看 alpha，而这批素材里 alpha 低的地方不一定是合成
    // 痕迹。alphaFloor 0.98 在 m_Model_EN_7000 上把 51.35% 的着墨像素判成可写，
    // 一张图集的柔边不可能占一半，被刷掉的是画师自己画的半透明（蕾丝、纱、
    // 扇面）。同一帧同一机位量下来，开修复之后头部区域的梯度能量只剩不开的
    // 40.2%，也就是细节掉了六成 —— 这正是反馈里说的「更加粗糙」。
    //
    // 试过按「离图集空白多远」来区分痕迹和画（痕迹一定贴着空白，成片的半透明
    // 不贴），d2 能保住 98.6% 的细节但黑边基本没动，d4 之后黑边下去了细节也跟着
    // 掉到 57.6%。这条界线目前分不开这两样东西，所以先不开；黑边该怎么修还没
    // 定论，见下面 alphaTest 那一段。
    var FRINGE_QUERY = new URLSearchParams(window.location.search);
    var FRINGE_DISABLED = FRINGE_QUERY.get("fringe") !== "1"
        || FRINGE_QUERY.get("nofringe") === "1";
    // ?fringefloor=0.5 改判定线，用来扫参数。斜坡里 alpha 高的那一段可能是
    // 画师真画的柔和过渡，不是合成留下的痕迹，判定线定在哪里得量出来。
    var FRINGE_FLOOR = Number(FRINGE_QUERY.get("fringefloor"));
    var FRINGE_OPTIONS = {};
    if (Number.isFinite(FRINGE_FLOOR) && FRINGE_FLOOR > 0) {
        FRINGE_OPTIONS.alphaFloor = FRINGE_FLOOR;
    }
    // ?fringemode=solidify 用无条件填充，默认只允许提亮。哪个对得看量出来的
    // 结果，所以两个都留着。
    if (FRINGE_QUERY.get("fringemode")) {
        FRINGE_OPTIONS.mode = FRINGE_QUERY.get("fringemode");
    }
    var FRINGE_PASSES = Number(FRINGE_QUERY.get("fringepasses"));
    if (Number.isFinite(FRINGE_PASSES) && FRINGE_PASSES > 0) {
        FRINGE_OPTIONS.passes = FRINGE_PASSES;
    }
    // ?fringedist=3 改「离空白多远还算合成痕迹」这条界线，0 表示不限制（也就是
    // 旧行为）。判定线只看 alpha 的时候会把画师真画的半透明（蕾丝、纱、扇面）
    // 当成痕迹一起刷掉 —— model_en_7000 的主图集有 51% 的着墨像素被判成可写，
    // 细节因此掉了一半。这个参数是用来扫那条界线的。
    var FRINGE_DIST = Number(FRINGE_QUERY.get("fringedist"));
    if (Number.isFinite(FRINGE_DIST) && FRINGE_DIST >= 0) {
        FRINGE_OPTIONS.emptyDistance = FRINGE_DIST;
    }
    // 预热：模型解析完就要用，等到那时候再 await 一个网络请求会让第一帧
    // 先用没修的贴图画出来再跳变。
    if (!FRINGE_DISABLED) {
        loadFringeModule().then(function (module) {
            fringeHelpers = module;
        }).catch(function () {
            fringeHelpers = null;
        });
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

    // 没自带动作的敌人，去同族的基础模型借。返回借得到的那份 preview，借不到
    // 是 null。
    //
    // 604 个敌人里 465 个 animations:false，而有动作的那 139 个正好是每族的基础
    // 号：model_en_10000 有 damage/abnormal/skill_0/skill_1/idle/dead 六段，
    // 10001..10005 一段都没有。变体是基础模型的换色换件，动作包只挂在基础号上。
    //
    // 骨架是同一套，所以借得过来。10001 对 10000 逐节点比过：各 38 个节点，名字
    // 不同的只有以模型号命名的三个网格容器节点（MeshRoot_Model_EN_1000x /
    // Model_EN_1000x / Model_EN_1000x(Clone)），关节一个不差，基础包里 16 个被
    // 动画寻址的节点在变体上 16 个全部解析成功。10103 对 10100 同样是 16/16。
    // 借完实测：10001 六段 28..31 条轨道全部绑定，10103 是 25..43 条全部绑定。
    //
    // 借不到的话 mountActionControls 会摆七个程序生成的假动作顶上，而那七个只是
    // 把整个模型按正弦上下平移加倾斜，一根骨头都不动 —— 那才是「很多动作有问题」
    // 的来源。407 个敌人本来能放真动作。剩下 58 个（12600..12605、12700.. 这些）
    // 本族没有基础号，只能继续用假的。
    function enemyBaseActionSource(kind, preview) {
        if (kind !== "enemy" || !preview || preview.animations) {
            return null;
        }
        var match = /model_en_(\d+)/.exec(String(preview.file || ""));
        if (!match) {
            return null;
        }
        var id = match[1];
        if (id.length <= 2) {
            return null;
        }
        var baseId = id.slice(0, -2) + "00";
        if (baseId === id) {
            return null;
        }
        var base = MODEL_PREVIEWS["model/enemy/model_en_" + baseId + ".muast"];
        return (base && base.animations) ? base : null;
    }

    // Accepts anything that carries the id: a database entry name, or the
    // preview's file path (asset/models/model_pl_<id>/model.glb.gz).
    function rarityOf(source) {
        var match = /model_pl_(\d+)/.exec(String(source || ""));
        return (match && MODEL_RARITY[match[1]]) || null;
    }

    function hasTotteoki(source) {
        var entry = rarityOf(source);
        if (!entry) {
            // No table entry means no rarity claim either way. Enemies and
            // weapons land here, and they have no とっておき to gate.
            return false;
        }
        return entry.totteoki === true;
    }

    function rarityStars(entry) {
        if (!entry || !Number.isFinite(entry.rarity)) {
            return "";
        }
        return new Array(entry.rarity + 1).join("★");
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
        // 三种情况要说三句话：自带动作的、跟同族基础模型借到动作的、以及本族没有
        // 基础号只能用程序化预览的那 58 个。原先只分两种，于是 407 个借到了真动作
        // 的敌人也被说成「程序化预览」。
        var borrowedFrom = enemyBaseActionSource(parts.kind, preview);
        var actionHint = "动作取自游戏原始 AnimationClip，表情按官方表情表跟随。";
        if (parts.kind === "enemy" && preview && !preview.animations) {
            actionHint = borrowedFrom
                ? "该敌人包未附带 AnimationClip，以下动作借自同族基础模型（骨架相同）。"
                : "该敌人包未附带 AnimationClip，且本族没有基础模型可借，以下为程序化预览。";
        }
        var actionMarkup = hasPlayerActions
            ? "<div class='model-control-panel' id='modelPanelAction' data-inspector-panel='action' role='tabpanel' aria-labelledby='modelTabAction'><div id='modelActionStrip' class='model-action-groups' role='group' aria-label='游戏动作'></div><p class='model-control-hint'>" + actionHint + "</p></div>"
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
        // 构图改成直接在画布上操作 + 一排定点视角。
        //
        // 原本这里是「模型大小」和「上下位置」两根滑块,它们动的是模型自身的
        // scale 和 position,而不是镜头;加上当时方位角锁在 ±15°,画布上拖不
        // 动,于是想换个角度只能来拉滑块 —— 而滑块又转不了圈,鞋底和背面根本
        // 到不了。现在镜头限制已经放开,拖拽/滚轮/右键就是完整的三轴操作,滑
        // 块没有存在意义了。
        //
        // 保留一排按钮是因为「回到正面」「看鞋底」这种需求用拖拽反而慢,而且
        // 按钮可用键盘直达。
        var adjustMarkup = preview
            ? "<section class='model-control-section model-view-controls'><div class='model-control-heading'><strong>视角</strong><small>画布可直接拖拽</small></div>"
                + "<div class='model-view-presets' role='group' aria-label='定点视角'>"
                + "<button type='button' data-view-preset='front' class='is-active' aria-pressed='true'>正面</button>"
                + "<button type='button' data-view-preset='left' aria-pressed='false'>左侧</button>"
                + "<button type='button' data-view-preset='right' aria-pressed='false'>右侧</button>"
                + "<button type='button' data-view-preset='back' aria-pressed='false'>背面</button>"
                + "<button type='button' data-view-preset='top' aria-pressed='false'>俯视</button>"
                + "<button type='button' data-view-preset='bottom' aria-pressed='false'>仰视</button>"
                + "</div>"
                + "<div class='model-view-zooms' role='group' aria-label='取景'>"
                + "<button type='button' data-view-zoom='full' class='is-active' aria-pressed='true'>全身</button>"
                + "<button type='button' data-view-zoom='face' aria-pressed='false'>脸部</button>"
                + "<button type='button' data-view-zoom='feet' aria-pressed='false'>足部</button>"
                + "</div>"
                + "<p class='model-control-hint'>左键拖拽转动 · 滚轮缩放 · 右键或 Shift 拖拽平移 · 双击画布复位</p></section>"
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
        // 重置 / 铺满 原本在观察台自己那条 62px 的工具条上。那条工具条整个去掉了
        // （标题和页签重复，而高度是从画布里扣的），按钮并到播放条右端。
        var viewerActionsMarkup = "<div class='model-3d-actions'>"
            + "<span class='model-shortcut-hint'>拖拽转动 · 滚轮缩放 · 1-6 视角 · 空格播放 · R 重置 · F 铺满 · [ ] 收放列表</span>"
            + "<button id='modelViewReset' type='button' title='恢复模型位置和镜头（R）'><span aria-hidden='true'>↺</span> 重置</button>"
            + "<button id='modelFocusToggle' type='button' aria-pressed='false' title='工作台铺满窗口，列表仍在左侧（F）'><span aria-hidden='true'>⛶</span> 铺满窗口</button>"
            + "</div>";
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
                + viewerActionsMarkup
                + "</div>"
            : "<div class='model-transport model-transport-bare'>" + viewerActionsMarkup + "</div>";
        // 观察台自己那条工具条取消了。
        //
        // 它原本占 62px，内容是「LIVE WEBGL / 模型观察台 / 素材名」加两个按钮 ——
        // 标题和上面的页签重复，素材名和详情头重复，而这 62px 是直接从画布高度里
        // 扣的。实测 950px 窗口下画布只剩 399px，舞台上方的各种条加起来吃掉 498px。
        // 现在按钮并进播放条右端，标题交给页签。
        var previewMarkup = preview
            ? "<section class='model-3d-card' aria-label='游戏模型预览'><div class='model-viewer-layout'><div class='model-viewer-stage'><div id='model3dCanvas' class='model-3d-canvas'><div class='model-3d-loading'><span class='model-spinner' aria-hidden='true'></span><p>正在读取模型数据……</p></div></div>" + transportMarkup + "</div><aside class='model-viewer-inspector' aria-label='模型控制台'>" + tabsMarkup + "<div class='model-inspector-body'>" + actionMarkup + faceMarkup + setupMarkup + "</div></aside></div></section>"
            : unavailableMarkup;
        var identityMarkup = metadata
            ? "<span>作品 <strong>" + escapeHtml(bilingualLabel(metadata.titleZh, metadata.title)) + "</strong></span><span>角色 <strong>" + escapeHtml(bilingualLabel(metadata.characterZh, metadata.character)) + "</strong></span>"
            : "";
        // Say the rarity out loud: it decides whether 必杀演出 appears at all, and
        // a missing group is otherwise indistinguishable from a broken catalog.
        var rarityEntry = rarityOf(model.name);
        var rarityMarkup = rarityEntry
            ? "<span>稀有度 <strong class='model-rarity'>" + escapeHtml(rarityStars(rarityEntry)) + "</strong></span>"
                + "<span>とっておき <strong>" + (rarityEntry.totteoki ? "有" : "无（★3 无大招）") + "</strong></span>"
            : "";
        // 观察台和纹理图集分成两个视图页签。
        //
        // 它们原本上下排在同一个滚动容器里：想看纹理要滚详情区，而右边控制台又在
        // 同一片区域里自己滚，再加上页面本身的滚动条，三层嵌在一起 —— 反馈里
        // 「竖着的滚动条很容易和浏览器本身的滚动条冲突」就是这么来的。分开之后
        // 舞台那一页完全不滚（高度由 grid 给满），只有纹理页是滚动区。
        var assetsMarkup = "<div class='model-detail-view' data-detail-panel='assets' role='tabpanel' aria-labelledby='modelViewTabAssets'"
            + (preview ? " hidden" : "") + ">"
            + (preview ? "" : unavailableMarkup)
            + "<div class='model-meta'>"
            + "<span>路径 <strong class='model-detail-path'>" + escapeHtml(model.name) + "</strong></span>"
            + identityMarkup + rarityMarkup
            + "<span>包大小 <strong>" + formatSize(model.size) + "</strong></span>"
            + "<span>可视纹理 <strong>" + spriteCount + " 个</strong></span>"
            + "<span>Bucket <strong>" + escapeHtml(bucketFor(model)) + "</strong></span></div>"
            + "<div class='model-texture-heading'><div><span class='models-eyebrow'>SOURCE TEXTURES</span><h3>模型纹理图集</h3></div><p>用于核对模型使用的原始贴图，不等同于模型本身。</p></div>"
            + "<div class='model-texture-grid' id='modelTextureGrid'></div></div>";
        var stageMarkup = preview
            ? "<div class='model-detail-view' data-detail-panel='stage' role='tabpanel' aria-labelledby='modelViewTabStage'>" + previewMarkup + "</div>"
            : "";
        var viewTabs = [];
        if (stageMarkup) {
            viewTabs.push({ key: "stage", label: "模型观察台" });
        }
        viewTabs.push({ key: "assets", label: "纹理图集 " + spriteCount });
        var viewTabsMarkup = viewTabs.length > 1
            ? "<div class='model-detail-views' role='tablist' aria-label='详情视图'>" + viewTabs.map(function (tab, index) {
                var cap = tab.key.charAt(0).toUpperCase() + tab.key.slice(1);
                return "<button type='button' role='tab' id='modelViewTab" + cap + "' data-detail-tab='" + tab.key + "'"
                    + " aria-controls='modelViewPanel" + cap + "' aria-selected='" + String(index === 0) + "'"
                    + " class='" + (index === 0 ? "is-active" : "") + "'>" + escapeHtml(tab.label) + "</button>";
            }).join("") + "</div>"
            : "";
        // 标题、身份信息、视图页签合成一条。
        //
        // 原来是三块竖着排：detail-header 103px + model-meta 62px（含外边距）+
        // detail-views 37px = 202px，全从画布高度里扣。名字、作品、稀有度这些是
        // 一行字的量，不需要各占一块。完整的元数据（包大小、Bucket、纹理数）挪进
        // 纹理页 —— 那一页本来就是「核对素材」用的。
        var titleText = parts.file.replace(/\.muast$/i, "");
        var headBits = [];
        if (metadata) {
            headBits.push("<span>" + escapeHtml(bilingualLabel(metadata.characterZh, metadata.character)) + "</span>");
            headBits.push("<span>" + escapeHtml(bilingualLabel(metadata.titleZh, metadata.title)) + "</span>");
        }
        if (rarityEntry) {
            headBits.push("<span class='model-rarity'>" + escapeHtml(rarityStars(rarityEntry)) + "</span>");
        }
        elements.detail.innerHTML = "<header class='model-detail-header'>"
            + "<div class='model-detail-ident'>"
            + "<h2 id='modelDetailTitle'>" + escapeHtml(titleText) + "</h2>"
            + (headBits.length ? "<div class='model-detail-tags'>" + headBits.join("") + "</div>" : "")
            + "</div>"
            + viewTabsMarkup
            + "<div class='model-detail-actions'><a href='" + detailUrl(model) + "' target='_blank' rel='noopener noreferrer'>官方详情 ↗</a><a href='" + rawAssetUrl(model) + "' target='_blank' rel='noopener noreferrer'>原始包 ↗</a></div>"
            + "</header>"
            + stageMarkup + assetsMarkup;
        var grid = document.getElementById("modelTextureGrid");
        spriteNames.forEach(function (spriteName, index) {
            var card = document.createElement("figure");
            card.className = "model-texture-card";
            card.innerHTML = "<div class='model-texture-frame'><img src='" + modelAssetUrl(model, spriteName) + "' alt='" + escapeHtml(spriteName) + "' loading='lazy' decoding='async'></div><figcaption><strong>" + escapeHtml(spriteName.split("/").pop()) + "</strong><span>纹理 " + (index + 1) + " / " + spriteCount + "</span></figcaption>";
            grid.appendChild(card);
        });
        mountInspectorTabs();
        mountDetailViewTabs();
        if (preview) {
            mount3DModel(preview, metadata, parts.kind);
        }
    }

    // 详情区的两个视图页签（观察台 / 纹理图集）。
    // 切回观察台时要通知渲染器重算尺寸：hidden 期间容器的 clientWidth 是 0，
    // 那段时间里如果发生过 resize，缓冲区就还停在 0 上。
    function mountDetailViewTabs() {
        var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-detail-tab]"));
        var panels = Array.prototype.slice.call(document.querySelectorAll("[data-detail-panel]"));
        if (!tabs.length || !panels.length) {
            return;
        }
        tabs.forEach(function (tab) {
            tab.addEventListener("click", function () {
                var key = tab.dataset.detailTab;
                tabs.forEach(function (other) {
                    var on = other === tab;
                    other.classList.toggle("is-active", on);
                    other.setAttribute("aria-selected", String(on));
                });
                panels.forEach(function (panel) {
                    panel.hidden = panel.dataset.detailPanel !== key;
                });
                if (key === "stage" && typeof viewerResizeHook === "function") {
                    viewerResizeHook();
                }
            });
        });
    }

    // mount3DModel 内部的 resize() 需要被外面（页签切换、全屏）叫到。
    var viewerResizeHook = null;

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

    // 抗锯齿这条路已经量到底了,结论是现状(alpha-to-coverage)就是对的,
    // 不要再改。留下这段是因为三个看起来很有道理的方案都被数据否掉了:
    //
    // 1. 提高 pixelRatio。1/2/3/4/6 倍下锯齿指标 0.2307/0.2345/0.2294/
    //    0.2308/0.2290,完全不动。
    // 2. 在 shader 里按 fwidth 把 alpha 斜坡重新锐化成一个像素宽。图集
    //    alpha 不是距离场:内部还有画出来的半透明(叠发、缎带、锁链),那里
    //    fwidth 约等于 0,除下去直接夹到 1.0,前面那层变全不透明把后面整个
    //    盖掉,锁链描线断成一节一节。按梯度设闸门之后轮廓也只是换了个贴着
    //    纹素方格走的方式,依旧是台阶。那条双线性斜坡本身就是这些图集自带
    //    的抗锯齿,轮廓的亚像素位置全写在它的灰阶里,动它就是在删信息。
    // 3. 换成真正的 alpha 混合(8 bit,而 4 采样的 coverage 只有 5 档)。
    //    这个一开始量出来是赢的,但那是把混合的结果拿混合自己的超采样版当
    //    基准 —— 循环论证。改成交叉比对(两种模式各出一份 4 倍超采样基准)
    //    之后:
    //      model_en_7000    1x 覆盖率 vs coverage@4x  0.2652
    //                       1x 混合   vs coverage@4x  0.3211
    //      model_pl_140007  两者打平(0.3173 / 0.3170)
    //    而且两份基准本身有 5% 的像素不一致 —— 混合把材质挪进透明队列,画
    //    的就不是同一张图了(140007 的袖子从深红变成半透明)。游戏自己写的
    //    是 _Mode=0 / _SrcBlend=One / _DstBlend=Zero / _ZWrite=1,不透明才
    //    是原意。
    //
    // 真正的上限是纹理:一张 512x512 摊到三个物理像素上(实测 2.75~3.40,
    // 中位 3.02)。要更细只能从源头拿到更多像素,渲染这一侧没有余量了。

    function mount3DModel(preview, metadata, modelKind) {
        var host = document.getElementById("model3dCanvas");
        var motionButton = document.getElementById("modelMotionToggle");
        var resetButton = document.getElementById("modelViewReset");
        var focusButton = document.getElementById("modelFocusToggle");
        var viewPresetButtons = Array.prototype.slice.call(document.querySelectorAll("[data-view-preset]"));
        var viewZoomButtons = Array.prototype.slice.call(document.querySelectorAll("[data-view-zoom]"));
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
        var modelRarity = rarityOf(preview.file);
        var modelHasTotteoki = hasTotteoki(preview.file);
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
            // とっておき 演出（背景 + 特效 + 过场相机）。
            //
            // cinematic 为 null 表示当前在普通观察模式：镜头是那台透视相机，
            // OrbitControls 可用。进入演出后换成时间轴里那台被 camOrthoSize
            // 驱动的正交相机，控件停掉 —— 过场的构图是作品的一部分,让用户
            // 中途拖镜头只会看到穿帮。
            var cinematic = null;
            var cinematicRequest = 0;
            var cinematicAvailable = false;
            var cinematicWanted = true;
            var cinematicButton = null;
            var cinematicStatus = null;
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
            // 取景按钮要按身体比例定注视点,所以整个包围盒都得留着,不只是高度。
            var modelBounds = null;
            var viewTween = null;
            // 重置要能把武器恢复成默认那件,而 attachWeaponMode 需要 loader,
            // 它原本只活在 load 回调里。
            var activeLoader = null;
            var baseRotationZ = 0;
            var enemyMotionTime = 0;
            var enemyMotionBasePosition = null;
            var enemyMotionBaseRotation = null;
            var viewInteracted = false;
            var faceParts = { eye: {}, eyebrow: {}, mouth: {}, overlay: {} };
            var enemyVisualParts = {};
            var enemyVariantParts = [];
            var facingVariantsHidden = 0;
            var duplicateMeshesHidden = 0;
            // {node name: [Object3D, ...]} for every node the visibility table
            // governs on this model, and the track set for the clip now playing.
            var visibilityNodes = {};
            // {variant set: how many members this model owns}. A set with one
            // member has nothing to switch to, so its curve must not hide it.
            var visibilitySets = {};
            var visibilityTracks = null;
            var visibilityFrame = -1;
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

            // 渲染精度。素材是 512x512 贴图（敌人里有 234 个只有 256x256），角色
            // 在台上约 600-700 px 高，等于把贴图放大着看，所以采样质量决定了成像
            // 是否清晰。
            //
            // 两条底线：每个 CSS 像素至少 2 个采样点（1x 屏幕点对点采样的话，头发
            // 丝和扇骨这类一像素宽的结构直接碎掉），以及绘制缓冲永远不小于画布真正
            // 占据的物理像素数。
            //
            // 原来写的是 max(2, min(dpr, 2))，里层的 min 先把值压到 2，外层的 max
            // 就再也起不了作用 —— 无论什么屏幕都恒等于 2。实测：dpr 1 得到 2.000
            // 倍（符合注释），dpr 2 得到 1.000 倍（等于原生，根本没有超采样），
            // dpr 3 得到 0.667 倍，也就是渲染得比原生还小，再由浏览器放大回去，
            // 比什么都不做更糊。
            //
            // 上限 3 是为了控制填充开销：缓冲面积按倍率平方增长，而 dpr 3 的设备
            // 通常是手机。
            // A/B 测量要能把倍率按住不动，而 resize 会跟着 dpr 重算 —— 没有这个
            // 开关，__rendererDebug.setPixelRatio 设下的值会被 resize 立刻盖掉。
            var sampleRatioOverride = null;
            function sampleRatio() {
                if (sampleRatioOverride) {
                    return sampleRatioOverride;
                }
                return Math.min(Math.max(2, window.devicePixelRatio || 1), 3);
            }
            renderer.setPixelRatio(sampleRatio());
            // 由显卡上报上限决定，不写死：桌面通常是 16，移动端常见 2 或 4。
            var maxAnisotropy = renderer.capabilities.getMaxAnisotropy
                ? renderer.capabilities.getMaxAnisotropy()
                : 1;
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
            }

            // 三处按钮组(视角、取景、以后的武器)选中态的写法一样,收成一处,
            // 顺便保证 aria-pressed 不会漏掉 —— 之前重置只改了 class。
            function markActive(buttons, datasetKey, value) {
                buttons.forEach(function (button) {
                    var isActive = button.dataset[datasetKey] === value;
                    button.classList.toggle("is-active", isActive);
                    button.setAttribute("aria-pressed", String(isActive));
                });
            }

            function clearActive(buttons) {
                buttons.forEach(function (button) {
                    button.classList.remove("is-active");
                    button.setAttribute("aria-pressed", "false");
                });
            }

            // 定点视角。方位/俯仰是球坐标,半径沿用当前的取景距离,所以切角度
            // 不会顺带改变远近;取景按钮反过来只改半径和注视点。
            var viewAzimuth = 0;
            var viewPolar = Math.PI / 2;
            var viewZoom = "full";

            // 脸部取景要对准的那个盒子，从五官网格本身量出来。
            //
            // 之前是按比例猜的：modelBounds.max.y 往下 9% 身高，注释写「脸大概占
            // 身高的 1/7」。这批模型上不成立 —— max.y 含发饰和双马尾，头身比也
            // 不是 1/7。model_en_7000 实测：这么算出来的目标在 y≈0.918，而嘴在
            // 0.665、眼在 0.68..0.82，镜头对准的是头发顶。1708x1300 的缓冲里嘴
            // 落在 y≈1560，也就是画面底边以下，眼睛只进来一半。
            //
            // 顶点位置必须过一遍蒙皮。五官是贴在头骨上的小片，Box3.setFromObject
            // 只读 geometry 和 matrixWorld，拿到的是 bind pose —— 同一个模型上它
            // 报的嘴在 y=1508，和蒙皮后的位置差了整个画面。applyBoneTransform 做
            // 的正是顶点着色器做的事，所以这里读到的就是真正被光栅化的位置。
            var FACE_PART_NAME = /(^|_)(eye|eyebrow|eyebrrow|eyeblow|mouth|cheek)(_|$)/i;
            // 五官要按 alpha 混合画，而图集是和身体共用的，所以得给五官单独一份
            // 材质。按原材质做键缓存，一个图集只克隆一次。
            var faceDecalMaterials = new WeakMap();
            function faceAnchorBox() {
                if (!modelObject) {
                    return null;
                }
                var box = new THREE.Box3();
                var vertex = new THREE.Vector3();
                modelObject.traverse(function (child) {
                    if (!child.isMesh || !child.visible || !FACE_PART_NAME.test(child.name)) {
                        return;
                    }
                    var parent = child.parent;
                    while (parent) {
                        if (!parent.visible) { return; }
                        parent = parent.parent;
                    }
                    var position = child.geometry && child.geometry.attributes.position;
                    if (!position) {
                        return;
                    }
                    var skinned = child.isSkinnedMesh
                        && child.geometry.attributes.skinWeight;
                    for (var i = 0; i < position.count; i++) {
                        vertex.fromBufferAttribute(position, i);
                        if (skinned) {
                            child.applyBoneTransform(i, vertex);
                        }
                        child.localToWorld(vertex);
                        box.expandByPoint(vertex);
                    }
                });
                return box.isEmpty() ? null : box;
            }

            function applyView(animated) {
                if (!homeView) {
                    return;
                }
                var span = modelBounds && !modelBounds.isEmpty()
                    ? modelBounds.getSize(new THREE.Vector3())
                    : new THREE.Vector3(1, 1, 1);
                var target = homeView.target.clone();
                var radius = homeView.position.distanceTo(homeView.target);
                if (viewZoom === "face") {
                    // 每次按下都重新量：头会跟着动作走，用挂载时的那份会漂。
                    var face = faceAnchorBox();
                    if (face) {
                        var faceSize = face.getSize(new THREE.Vector3());
                        face.getCenter(target);
                        // 五官盒子只框住眼鼻嘴，上下留 2.4 倍余量，把额头、
                        // 下巴和两侧头发一起收进画面。
                        var want = Math.max(faceSize.x, faceSize.y) * 2.4;
                        radius = (want * 0.5)
                            / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
                    } else {
                        // 没有五官网格的（武器、道具）退回按比例估。
                        target.y = modelBounds.max.y - span.y * 0.09;
                        radius *= 0.26;
                    }
                } else if (viewZoom === "feet") {
                    target.y = modelBounds.min.y + span.y * 0.06;
                    radius *= 0.3;
                }
                radius = Math.min(Math.max(radius, controls.minDistance), controls.maxDistance);
                var next = new THREE.Vector3(
                    target.x + radius * Math.sin(viewPolar) * Math.sin(viewAzimuth),
                    target.y + radius * Math.cos(viewPolar),
                    target.z + radius * Math.sin(viewPolar) * Math.cos(viewAzimuth)
                );
                if (animated === false) {
                    camera.position.copy(next);
                    controls.target.copy(target);
                } else {
                    viewTween = {
                        from: camera.position.clone(),
                        to: next,
                        fromTarget: controls.target.clone(),
                        toTarget: target,
                        start: (window.performance || Date).now(),
                        duration: 260
                    };
                }
                controls.update();
                viewInteracted = true;
            }

            var VIEW_PRESETS = {
                front: [0, Math.PI / 2],
                left: [-Math.PI / 2, Math.PI / 2],
                right: [Math.PI / 2, Math.PI / 2],
                back: [Math.PI, Math.PI / 2],
                // 不用正上/正下:极点处方位角退化,镜头会绕着自己转。
                top: [0, Math.PI / 7],
                bottom: [0, Math.PI - Math.PI / 7]
            };

            function selectViewPreset(key) {
                var preset = VIEW_PRESETS[key];
                if (!preset) {
                    return;
                }
                viewAzimuth = preset[0];
                viewPolar = preset[1];
                markActive(viewPresetButtons, "viewPreset", key);
                applyView(true);
            }

            function selectViewZoom(key) {
                viewZoom = key;
                markActive(viewZoomButtons, "viewZoom", key);
                applyView(true);
            }

            // 定点视角之间瞬移会让人分不清转到哪一面了,尤其正面和背面这两个
            // 差 180° 的。260ms 的缓动够看出转向,又不至于等。
            function stepViewTween(time) {
                if (!viewTween) {
                    return;
                }
                var progress = (time - viewTween.start) / viewTween.duration;
                if (progress >= 1) {
                    camera.position.copy(viewTween.to);
                    controls.target.copy(viewTween.toTarget);
                    viewTween = null;
                    return;
                }
                var eased = progress < 0.5
                    ? 2 * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                camera.position.lerpVectors(viewTween.from, viewTween.to, eased);
                controls.target.lerpVectors(viewTween.fromTarget, viewTween.toTarget, eased);
            }

            // 从画布上拖过之后,球坐标要跟上镜头的实际位置,否则下一次点定点
            // 视角会从一个陈旧的角度插值过去,看起来像是跳了一下。
            function syncViewFromCamera() {
                var offset = camera.position.clone().sub(controls.target);
                var radius = offset.length();
                if (radius < 1e-6) {
                    return;
                }
                viewAzimuth = Math.atan2(offset.x, offset.z);
                viewPolar = Math.acos(Math.min(1, Math.max(-1, offset.y / radius)));
                clearActive(viewPresetButtons);
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
                modelBounds = bounds;
                modelHeight = Math.max(size.y, 0.1);
                var visibleSize = Math.max(size.y, size.x / Math.max(0.4, camera.aspect), 0.1);
                var distance = (visibleSize * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
                distance *= 1.28;
                homeView = {
                    target: center,
                    position: new THREE.Vector3(center.x, center.y, center.z + distance)
                };
                // 0.38 倍还看不清鞋底和裙摆内侧这种指头大的地方。近裁面是
                // 0.01,推到 0.12 倍仍然差一个数量级,不会穿进模型里。
                controls.minDistance = Math.max(0.05, distance * 0.12);
                controls.maxDistance = Math.max(2, distance * 4);
                resetView();
                // 换武器、换动作都会改变跨度,影子要跟着重新贴。
                positionGroundShadow();
            }

            // 地面阴影。
            //
            // 原本这块是 .model-3d-canvas::before 的一个 CSS 椭圆,钉在画布
            // bottom:10%。它贴的是视口而不是脚下:镜头一动,人和影子就分开,
            // 俯视时更是直接飘在半空。镜头限制放开之后这个问题从"看不出来"
            // 变成"每个角度都不对"。
            //
            // 游戏自己有 model/shadow/shadow_battle.muast:一张 4 顶点的贴片,
            // unlit、BLEND、depthWrite=false,就是张地面贴花。直接用它,位置
            // 跟着包围盒底面走,于是影子永远在脚下。
            var shadowObject = null;


            // shadow_battle.muast 的贴片不是平的。四个顶点是
            // (±0.2238, -0.0873, +0.2061) 和 (±0.2238, +0.0873, -0.2061),
            // 法线 (0, 0.921, 0.390),绕 X 倾了 23°。游戏里战斗镜头俯角固定,
            // 一张按那个俯角倾斜的贴片正好看着像贴在地上;这里镜头能自由转,
            // 倾斜就露出来了 —— 玩家模型上是脚下一团斜着的暗影(垂直跨度实测
            // 0.312),敌人 model_en_6230 上因为还被放到了脚底下 0.3,直接变成
            // 模型下方一块独立的深色斜板,也就是反馈里问的"模型下面是什么"。
            //
            // 角度从几何本身算,不写死 23°:同一份贴片将来若换了版本,这里跟着变。
            // 量的是世界法线而不是局部法线 —— 贴片和它所在的根之间还有
            // MeshRoot_Shadow_battle / Shadow_battle(Clone) 两层,它们自己带变换,
            // 按局部法线转会把倾斜转反(实测垂直跨度从 0.337 变成 0.620)。
            function shadowQuadWorldNormal(root) {
                var mesh = null;
                root.traverse(function (child) {
                    if (!mesh && child.isMesh && child.geometry
                        && child.geometry.attributes && child.geometry.attributes.position) {
                        mesh = child;
                    }
                });
                if (!mesh) {
                    return null;
                }
                var position = mesh.geometry.attributes.position;
                if (position.count < 3) {
                    return null;
                }
                mesh.updateWorldMatrix(true, false);
                var a = new THREE.Vector3().fromBufferAttribute(position, 0).applyMatrix4(mesh.matrixWorld);
                var b = new THREE.Vector3().fromBufferAttribute(position, 1).applyMatrix4(mesh.matrixWorld);
                var c = new THREE.Vector3().fromBufferAttribute(position, 2).applyMatrix4(mesh.matrixWorld);
                var normal = new THREE.Vector3()
                    .subVectors(b, a)
                    .cross(new THREE.Vector3().subVectors(c, a));
                if (normal.lengthSq() < 1e-12) {
                    return null;
                }
                normal.normalize();
                if (normal.y < 0) {
                    normal.negate();
                }
                return normal;
            }

            // 贴片放进场景、位置和缩放都定好之后再压平:此时世界矩阵是最终的那份。
            function flattenGroundShadow() {
                if (!shadowObject) {
                    return;
                }
                shadowObject.rotation.set(0, 0, 0);
                shadowObject.updateMatrixWorld(true);
                var normal = shadowQuadWorldNormal(shadowObject);
                if (!normal) {
                    return;
                }
                var turn = new THREE.Quaternion().setFromUnitVectors(
                    normal,
                    new THREE.Vector3(0, 1, 0)
                );
                shadowObject.quaternion.premultiply(turn);
                shadowObject.updateMatrixWorld(true);
            }

            function mountGroundShadow() {
                if (shadowObject || disposed || !modelObject || !activeLoader) {
                    return Promise.resolve();
                }
                var shadowPreview = MODEL_PREVIEWS["model/shadow/shadow_battle.muast"];
                if (!shadowPreview) {
                    return Promise.resolve();
                }
                return cacheModel(shadowPreview.file, shadowPreview.compression)
                    .then(function (sourceUrl) {
                        return new Promise(function (resolve) {
                            activeLoader.load(sourceUrl, function (gltf) {
                                if (disposed || !modelObject) {
                                    disposeObjectResources(gltf.scene);
                                    resolve();
                                    return;
                                }
                                shadowObject = gltf.scene;
                                shadowObject.traverse(function (child) {
                                    if (!child.isMesh || !child.material) {
                                        return;
                                    }
                                    // 贴花:混合、不写深度、不参与拾取。渲染顺序
                                    // 压到 -1,保证先画在所有角色层之前。
                                    child.material.transparent = true;
                                    child.material.depthWrite = false;
                                    child.material.depthTest = true;
                                    child.material.side = THREE.DoubleSide;
                                    child.renderOrder = -1;
                                    child.frustumCulled = false;
                                });
                                scene.add(shadowObject);
                                positionGroundShadow();
                                resolve();
                            }, undefined, resolve);
                        });
                    })
                    .catch(function () { /* 影子缺失不该拖垮模型本身 */ });
            }

            function positionGroundShadow() {
                if (!shadowObject || !modelBounds || modelBounds.isEmpty()) {
                    return;
                }
                var size = modelBounds.getSize(new THREE.Vector3());
                var center = modelBounds.getCenter(new THREE.Vector3());
                // 贴片自身约 0.45 宽。按站姿的横向跨度定尺寸,再放宽一点让影子
                // 比脚略大;敌人体型差得很远,固定倍数会明显不对。
                var footprint = Math.max(size.x, size.z) * 1.15;
                shadowObject.scale.setScalar(Math.max(0.2, footprint / 0.4476));
                // 高度用模型自己的原点平面 y=0,不用 modelBounds.min.y。
                // modelBounds 是按骨骼采样的,包含隐藏部件和伸到地面以下的骨头:
                // model_pl_130402 的 min.y 是 -0.009(脚就在地上,凑巧对得上),
                // 而 model_en_6230 的是 -0.319,它的脚其实在 -0.011 —— 按 min.y
                // 放就把影子丢到脚下 0.3 处,成了一块单独的板。角色是按站在
                // y=0 上做的,那才是地面。
                shadowObject.position.set(center.x, size.y * 0.002, center.z);
                flattenGroundShadow();
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
                // ★3 never had a とっておき, but a skill.glb.gz was published for
                // some of them anyway, so the catalog would happily offer one.
                // Drop the ultimate group for anyone the rarity table says has
                // no claim to it, whether the clip is already loaded or pending.
                if (modelKind === "player" && !modelHasTotteoki) {
                    displayClips = displayClips.filter(function (clip) {
                        if (actionGroupOf(clip.name) !== "ultimate") {
                            return true;
                        }
                        delete pending[clip.name];
                        return false;
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
                    // 演出开关只挂在大招那一组，而且只在这个角色真的导出过演出
                    // 场景时出现。关掉是为了能单看动作本身 —— 过场的相机会怼到
                    // 脸上，想检查动作反而看不见。
                    if (group.key === "ultimate" && cinematicAvailable) {
                        var stageRow = document.createElement("div");
                        stageRow.className = "model-cinematic-row";
                        cinematicButton = document.createElement("button");
                        cinematicButton.type = "button";
                        cinematicButton.dataset.cinematicToggle = "1";
                        cinematicButton.title = "播放游戏原本的过场：背景、特效和被动画驱动的正交相机";
                        cinematicButton.addEventListener("click", toggleCinematic);
                        cinematicStatus = document.createElement("small");
                        cinematicStatus.className = "model-cinematic-status";
                        stageRow.appendChild(cinematicButton);
                        stageRow.appendChild(cinematicStatus);
                        section.appendChild(stageRow);
                        syncCinematicButton();
                    }
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

            // _L / _R is two different things depending on the part. leg_L_A and
            // leg_R_A are a genuine pair — left leg, right leg, disjoint in x, both
            // belong on screen. hat_L and hat_R are the same hat authored twice for
            // the two facing directions: same 241 triangles, same y and z, x
            // -0.214..0.173 against -0.198..0.201. Drawing both puts two
            // alpha-masked shells in the same place, and that is the head flicker
            // on model_en_6230.
            //
            // Naming cannot tell the two cases apart, so this does not try: it
            // compares the world boxes. A real left/right pair barely overlaps; a
            // facing variant sits almost exactly on top of its partner.
            //
            // Measured over the whole catalogue. 1859 bundles have 188 models with
            // a matched _L/_R mesh pair, but 182 of those are player models whose
            // hat pair the visibility table already governs, so the exposure here
            // is six enemies:
            //
            //   model_en_4200  en_4200_weapon   IoU 0.000   1500 / 1098 tris
            //   model_en_4230  en_4200_weapon   IoU 0.000   1500 / 1098 tris
            //   model_en_5000  en_5000_weapon   IoU 0.000    630 /  216 tris
            //   model_en_6100  en_6100_weapon   IoU 0.241    260 / 1028 tris
            //   model_en_6130  en_6100_weapon   IoU 0.244    260 / 1028 tris
            //   model_en_6230  hat              IoU 0.867    241 /  241 tris
            //
            // The gap between 0.244 and 0.867 is empty, so 0.5 is not a tuned
            // number. Triangle counts say the same thing independently: the five
            // genuine pairs are different meshes, the facing variant is the same
            // mesh twice.
            function boxOverlapRatio(a, b) {
                var inter = 1;
                var union = 0;
                for (var axis = 0; axis < 3; axis += 1) {
                    var lo = Math.max(a.min[axis], b.min[axis]);
                    var hi = Math.min(a.max[axis], b.max[axis]);
                    inter *= Math.max(0, hi - lo);
                }
                var volA = (a.max[0] - a.min[0]) * (a.max[1] - a.min[1]) * (a.max[2] - a.min[2]);
                var volB = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
                union = volA + volB - inter;
                return union > 0 ? inter / union : 0;
            }

            function worldBoxOf(node, THREE) {
                var box = new THREE.Box3().setFromObject(node);
                if (box.isEmpty()) {
                    return null;
                }
                return { min: box.min.toArray(), max: box.max.toArray() };
            }

            var FACING_VARIANT_OVERLAP = 0.5;

            function hideEnemyFacingVariants(THREE) {
                var pairs = {};
                enemyVariantParts.forEach(function (entry) {
                    var match = /^(.*)_([lr])$/.exec(String(entry.name || "").toLowerCase());
                    if (!match) {
                        return;
                    }
                    pairs[match[1]] = pairs[match[1]] || {};
                    pairs[match[1]][match[2]] = entry;
                });
                var hidden = 0;
                Object.keys(pairs).forEach(function (base) {
                    var left = pairs[base].l;
                    var right = pairs[base].r;
                    if (!left || !right || !left.node.visible || !right.node.visible) {
                        return;
                    }
                    var boxL = worldBoxOf(left.node, THREE);
                    var boxR = worldBoxOf(right.node, THREE);
                    if (!boxL || !boxR) {
                        return;
                    }
                    var ratio = boxOverlapRatio(boxL, boxR);
                    if (ratio < FACING_VARIANT_OVERLAP) {
                        return;
                    }
                    // Keep _L, matching the l30_ face layers the viewer already
                    // treats as the front-facing set.
                    right.node.visible = false;
                    right.node.userData.facingVariantOf = left.name;
                    hidden += 1;
                });
                return hidden;
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

            // Every player bundle draws each leg card six times over: the
            // exporter emits leg_L_A/_B/_C plus a leg_L_A_2/_B_2/_C_2 for each,
            // and the _2 nodes are byte-identical to their partner — same
            // POSITION/NORMAL/TEXCOORD_0/JOINTS_0/WEIGHTS_0 accessors, same
            // index buffer, same material, same skeleton. (The exporter dedupes
            // accessors by content, so identical accessor indices prove the
            // source Unity meshes were identical too.) Six coincident
            // alpha-masked double-sided draws is not just wasted fill: the
            // cut-out edge is composited against itself and z-fights, which is
            // the muddy fringe at the feet.
            //
            // The test is content, not naming: two meshes are redundant when
            // they would rasterise the same pixels — same geometry buffers,
            // same material, same skeleton, same world transform. That catches
            // the leg pairs without a rule that could ever hide the one copy of
            // a part whose name merely looks like a variant.
            var arrayIds = new WeakMap();
            var nextArrayId = 1;

            function bufferIdentity(attribute) {
                if (!attribute) {
                    return "-";
                }
                // Compare the backing store, not the BufferAttribute wrapper:
                // three.js clones the wrapper for skinned meshes (it normalises
                // skin weights in place) while both clones keep pointing at the
                // one typed array the loader decoded.
                var array = attribute.array;
                if (!arrayIds.has(array)) {
                    arrayIds.set(array, nextArrayId++);
                }
                return arrayIds.get(array)
                    + ":" + attribute.itemSize
                    + ":" + attribute.count
                    + ":" + (attribute.offset || 0);
            }

            function geometryIdentity(geometry) {
                if (!geometry) {
                    return "-";
                }
                var parts = [bufferIdentity(geometry.index)];
                Object.keys(geometry.attributes).sort().forEach(function (name) {
                    parts.push(name + "=" + bufferIdentity(geometry.attributes[name]));
                });
                Object.keys(geometry.morphAttributes || {}).sort().forEach(function (name) {
                    parts.push("morph:" + name + "="
                        + geometry.morphAttributes[name].map(bufferIdentity).join(","));
                });
                return parts.join("|");
            }

            function materialIdentity(material) {
                return Array.isArray(material)
                    ? material.map(function (entry) { return entry && entry.uuid; }).join(",")
                    : (material && material.uuid) || "-";
            }

            function hideCoincidentDuplicates(root) {
                if (!root) {
                    return 0;
                }
                root.updateMatrixWorld(true);
                var seen = {};
                var hidden = 0;
                root.traverse(function (child) {
                    if (!child.isMesh || !child.visible) {
                        return;
                    }
                    // The visibility table already picks one copy per set, and it
                    // is the authority: it sometimes picks the _2 partner, which
                    // this pass would have hidden as the "duplicate".
                    if (child.userData.visibilityGoverned) {
                        return;
                    }
                    var key = geometryIdentity(child.geometry)
                        + "#" + materialIdentity(child.material)
                        // A skinned mesh is placed by its bones, so its own
                        // world matrix is usually identity and says nothing;
                        // the skeleton is what decides where it lands.
                        + "#" + ((child.skeleton && child.skeleton.uuid) || "-")
                        + "#" + child.matrixWorld.elements.map(function (value) {
                            return value.toFixed(5);
                        }).join(",");
                    if (seen[key]) {
                        child.visible = false;
                        child.userData.coincidentDuplicateOf = seen[key];
                        hidden += 1;
                        return;
                    }
                    seen[key] = child.name || "(unnamed)";
                });
                return hidden;
            }

            // --- per-clip node visibility ------------------------------------
            //
            // The body is authored with alternate silhouettes of the same limb:
            // leg_L_A/_B/_C, a leg_L_A_2/_B_2/_C_2 beside each, hat_L against
            // hat_R. Exactly one of each set belongs on screen, and which one
            // depends on the pose -- room_idle_L stands on leg_L_C_2 and leg_R_B,
            // battle_out on leg_L_B and leg_R_C_2. The game keeps that switch in
            // its own clip format, which glTF cannot carry, so the GLB has no
            // record of it and the viewer drew all twelve at once: six coincident
            // alpha-masked layers per leg, which is the smear at the feet.
            //
            // A track is either a constant 0/1 or a list of stepped [frame, value]
            // keys; stepped means hold the last key, never interpolate.

            // leg_L_A, leg_L_A_2 and leg_L_C all belong to the set "leg_l"; hat_L
            // and hat_R to "hat". One member of a set is on at a time.
            function variantSetOf(name) {
                var match = /^(leg_[lr]|hat)_/.exec(String(name || "").toLowerCase());
                return match ? match[1] : String(name || "").toLowerCase();
            }

            function indexVisibilityNodes() {
                // The table is read out of the player animation bundles and its
                // node names are the player rig's. An enemy that happened to name
                // a part hat_L would otherwise be switched off by a curve that was
                // never about it; enemies have their own name-based pass.
                if (!VISIBILITY_TABLE || !modelObject || modelKind === "enemy") {
                    return;
                }
                var governed = {};
                (VISIBILITY_TABLE.nodes || []).forEach(function (name) {
                    governed[name.toLowerCase()] = name;
                });
                modelObject.traverse(function (child) {
                    if (!child.isMesh) {
                        return;
                    }
                    var key = governed[String(child.name || "").toLowerCase()];
                    if (!key) {
                        return;
                    }
                    visibilityNodes[key] = visibilityNodes[key] || [];
                    visibilityNodes[key].push(child);
                    visibilitySets[variantSetOf(key)] = (visibilitySets[variantSetOf(key)] || 0) + 1;
                    // Content-dedup must never win an argument with the table:
                    // the chosen copy is sometimes the _2 one (leg_L_C_2 in
                    // room_idle_L), and dedup keeps whichever it met first.
                    child.userData.visibilityGoverned = true;
                });
            }

            function visibilityTracksFor(clipName) {
                if (!VISIBILITY_TABLE || !clipName) {
                    return null;
                }
                // Class actions share the names idle/attack/class_skill_* across
                // five classes but pose them differently, so the class table wins
                // where it has an entry.
                var byClass = VISIBILITY_TABLE.classClips || {};
                var classTable = metadata && Number.isFinite(metadata.class)
                    ? byClass[String(metadata.class)]
                    : null;
                if (classTable && classTable[clipName]) {
                    return classTable[clipName];
                }
                return VISIBILITY_TABLE.clips[clipName] || null;
            }

            function visibilityValueAt(track, frame) {
                if (!Array.isArray(track)) {
                    return track ? 1 : 0;
                }
                var value = track.length ? track[0][1] : 1;
                for (var i = 0; i < track.length; i += 1) {
                    if (track[i][0] > frame) {
                        break;
                    }
                    value = track[i][1];
                }
                return value;
            }

            function applyVisibilityTracks(frame) {
                if (!visibilityTracks) {
                    return;
                }
                Object.keys(visibilityTracks).forEach(function (name) {
                    var nodes = visibilityNodes[name];
                    if (!nodes) {
                        return;
                    }
                    // model_pl_120301 and _120302 ship hat_R and no hat_L, and
                    // the right-facing clips ask for hat_L: obeying that would
                    // take away the only hat they have. With nothing to switch
                    // to, the switch is not meaningful — leave it on.
                    if (visibilitySets[variantSetOf(name)] < 2) {
                        nodes.forEach(function (node) { node.visible = true; });
                        return;
                    }
                    var visible = visibilityValueAt(visibilityTracks[name], frame) === 1;
                    nodes.forEach(function (node) {
                        node.visible = visible;
                    });
                });
            }

            // A model is on screen before any clip is chosen, and for an enemy or
            // a procedural preview no clip is ever chosen. Standing pose first,
            // so the default is never the all-twelve-layers look.
            function applyDefaultVisibility() {
                if (!VISIBILITY_TABLE) {
                    return;
                }
                var order = ["room_idle_L", "idle", "battle_run"];
                for (var i = 0; i < order.length; i += 1) {
                    var tracks = visibilityTracksFor(order[i]);
                    if (tracks) {
                        visibilityTracks = tracks;
                        visibilityFrame = -1;
                        applyVisibilityTracks(0);
                        return;
                    }
                }
            }

            function selectVisibilityClip(clipName) {
                var tracks = visibilityTracksFor(clipName);
                // A clip with no entry (the とっておき, a retargeted skill) leaves
                // the last pose's choice standing rather than reverting to all
                // twelve layers, which would look like the bug coming back.
                if (!tracks) {
                    return;
                }
                visibilityTracks = tracks;
                visibilityFrame = -1;
                applyVisibilityTracks(0);
            }

            function updateVisibilityFromClip() {
                if (!visibilityTracks || !activeClipAction) {
                    return;
                }
                var fps = (VISIBILITY_TABLE && VISIBILITY_TABLE.fps) || 30;
                var frame = Math.floor(activeClipAction.time * fps);
                if (frame === visibilityFrame) {
                    return;
                }
                visibilityFrame = frame;
                applyVisibilityTracks(frame);
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
                var leavingUltimate = cinematic && actionGroupOf(action) !== "ultimate";
                activeAction = action;
                if (modelKind === "enemy" && !clipByName[action]) {
                    enemyMotionTime = 0;
                }
                // 挑了别的动作就退出演出：过场的相机和背景只对大招成立。
                if (leavingUltimate) {
                    exitCinematic();
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
                // The clip name, not the button label: the table is keyed by the
                // exported clip name the same way clipByName is.
                selectVisibilityClip(selectedButton.dataset.clip);
                updateTransport(true);
                // 点大招就上演出。mountCinematic 会在挂好之后回头调一次
                // selectAction("skill")，那时 cinematic 已经非空，所以不会递归。
                if (cinematicWanted && cinematicAvailable && !cinematic
                    && actionGroupOf(activeAction) === "ultimate") {
                    enterCinematic();
                }
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
                // 把窗口从一块屏幕拖到另一块缩放不同的屏幕上，devicePixelRatio 会
                // 变，而倍率只在初始化时算过一次 —— 于是缓冲会停在旧屏幕的倍率上。
                // 这里跟着重算，值没变时 three.js 自己会跳过。
                var ratio = sampleRatio();
                if (renderer.getPixelRatio() !== ratio) {
                    renderer.setPixelRatio(ratio);
                }
                renderer.setSize(width, height, false);
                if (cinematic) {
                    // 正交相机的 left/right 由播放器按 aspect 每帧重算。演出
                    // 的比例是作品自己的 3:2，跟面板大小无关 —— 面板变了只是
                    // 黑边变宽变窄，构图不动，所以这里交回去的仍是 3:2，
                    // 重设一次是为了让视锥按当前帧的 orthoSize 重建。
                    cinematic.player.setAspect(cinematicAspect());
                }
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
            // 原本方位角锁在 ±15°、俯仰锁在水平 ±10°,等于画布上拖不动:
            // 想改构图只能去右边拉「模型大小」和「上下位置」两根滑块,而那
            // 两根滑块动的是模型自身的 scale 和 position,不是镜头。想看鞋底
            // 或者背面的接缝就完全没有办法 —— 之前判断不了脚的问题就是因为
            // 根本转不过去。
            //
            // 放开限制是安全的:renderOrder 取自游戏自己的 m_HieIndex /
            // m_eRenderStage,是每个网格固定的值,不随视角变;材质留在不透明
            // 队列并照常写深度,所以遮挡由深度测试逐片元决定。游戏自己在战斗
            // 里也是一边转镜头一边用这套顺序。
            //
            // 俯仰留 6° 余量避开正下方/正上方:极点处 OrbitControls 的
            // 方位角会退化,镜头会绕着自己打转。
            controls.minAzimuthAngle = -Infinity;
            controls.maxAzimuthAngle = Infinity;
            controls.minPolarAngle = Math.PI / 30;
            controls.maxPolarAngle = Math.PI - Math.PI / 30;
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
                                            child.material.alphaToCoverage = true;
                                            child.material.depthTest = true;
                                            // Weapons carry a cartoon outline as an
                                            // inverted hull: a scaled-up shell whose
                                            // faces point inward and map to a black
                                            // texel. Rendering it double-sided draws
                                            // that shell over the weapon, so the whole
                                            // model turns black.
                                            child.material.side = THREE.FrontSide;
                                            if (fringeHelpers) {
                                                fringeHelpers.dilateMaterialTextures(child.material, THREE, FRINGE_OPTIONS);
                                            }
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
                        // Weapon bundles ship the same doubled parts the bodies
                        // do (weapon_wand_obj + weapon_wand_2_obj), and they
                        // only exist in the scene once they are socketed.
                        hideCoincidentDuplicates(modelObject);
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

            function loadEnemyBaseClips(loader) {
                return loadRetargetedClips(
                    loader,
                    enemyBaseActionSource(modelKind, preview),
                    "同族动作"
                );
            }

            // とっておき and the character's own battle skill, from the GLB
            // tools/build_skill_action_catalog.py publishes for this model id.
            // Fetched only when asked for: each is ~180 KiB, far more than the
            // shared class actions, because the clips run 15 seconds.
            function skillActionSource() {
                // ★3 has no とっておき even where a clip was published for it, so
                // refuse the source outright rather than only hiding the button:
                // nothing should be able to spend 180 KiB fetching it.
                if (modelKind === "player" && !modelHasTotteoki) {
                    return null;
                }
                // The catalog is keyed by the numeric model id, which the only
                // identifier in scope here carries: preview.file always reads
                // asset/models/model_pl_<id>/model.glb.gz.
                var match = /model_pl_(\d+)/.exec(String(preview.file || ""));
                return (match && SKILL_ACTION_PREVIEWS[match[1]]) || null;
            }

            function loadSkillActionClips(loader) {
                return loadRetargetedClips(loader, skillActionSource(), "大招动作");
            }

            // --- とっておき 演出 ------------------------------------------------
            //
            // 演出场景只对 asset/uniqueskill/ 里导出过的资源 ID 存在（177 个,
            // 全是 ★5）。没有导出的模型照旧只播动作,不假装有过场。
            function cinematicResourceId() {
                var match = /model_pl_(\d+)/.exec(String(preview.file || ""));
                return match ? match[1] : null;
            }

            function probeCinematic() {
                var id = cinematicResourceId();
                if (!id || modelKind !== "player" || !modelHasTotteoki) {
                    return;
                }
                loadCinematicModule().then(function (us) {
                    return us.loadSceneIndex();
                }).then(function (index) {
                    if (disposed) {
                        return;
                    }
                    var scenes = index.scenes || index;
                    if (!scenes[id]) {
                        return;
                    }
                    cinematicAvailable = true;
                    // 目录已经挂好了才探到,就地补上开关,不重建整条动作条。
                    if (actionStrip && actionStrip.children.length) {
                        mountActionControls(currentClipList());
                    }
                }).catch(function () { /* 没有演出就沉默降级 */ });
            }

            function currentClipList() {
                return Object.keys(clipByName).map(function (name) {
                    return clipByName[name];
                });
            }

            function setCinematicStatus(text, busy) {
                if (!cinematicStatus) {
                    return;
                }
                cinematicStatus.textContent = text || "";
                cinematicStatus.classList.toggle("is-busy", Boolean(busy));
            }

            // 演出用的是场景里那台正交相机，画布比例变了要重算。
            // 演出的画面比例由作品本身决定，不是观察台面板的比例。
            //
            // 时间轴里那台相机带着 Unity 的物理感光尺寸 apertureWidth 35.9999 /
            // apertureHeight 24.0，也就是 3:2；orthoSize/orthoDivisor =
            // 176.9844/354 刚好 0.5，即基准画面高一个世界单位。正交相机的
            // 左右是 半高 × 比例 算出来的，所以比例一变构图就跟着变：拿面板
            // 的比例（通常比 3:2 窄）去渲染，两侧会被裁掉 —— 量下来第 40 帧
            // 角色只剩 102/166 根骨骼在画面内，人从右边出画。
            //
            // 所以按 3:2 渲染，在面板里加黑边，而不是把构图拉去适配面板。
            function cinematicAspect(timeline) {
                var source = timeline || (cinematic ? cinematic.timeline : null);
                var camera = source ? source.camera : null;
                if (camera && camera.apertureWidth && camera.apertureHeight) {
                    return camera.apertureWidth / camera.apertureHeight;
                }
                return 1.5;
            }

            // 面板里那块 3:2 的画面，单位是 CSS 像素（three 自己会乘
            // pixelRatio）。窄面板上下留边，宽面板左右留边。
            function cinematicViewport() {
                var width = Math.max(1, host.clientWidth);
                var height = Math.max(1, host.clientHeight);
                var aspect = cinematicAspect();
                var w = width;
                var h = Math.round(width / aspect);
                if (h > height) {
                    h = height;
                    w = Math.round(height * aspect);
                }
                return {
                    x: Math.round((width - w) / 2),
                    y: Math.round((height - h) / 2),
                    width: w,
                    height: h
                };
            }

            function enterCinematic() {
                if (!cinematicAvailable || cinematic || disposed) {
                    return;
                }
                var id = cinematicResourceId();
                var token = ++cinematicRequest;
                setCinematicStatus("载入演出…", true);
                loadCinematicModule().then(function (us) {
                    return Promise.all([
                        us.loadTimeline(id),
                        us.loadScene(id, {
                            onProgress: function (fraction) {
                                if (token === cinematicRequest && !disposed) {
                                    setCinematicStatus(fraction === null
                                        ? "解压中…"
                                        : "载入演出 " + Math.round(fraction * 100) + "%", true);
                                }
                            }
                        }),
                        us
                    ]);
                }).then(function (parts) {
                    if (token !== cinematicRequest || disposed) {
                        // 用户已经切走了：把刚下载的场景丢掉，别挂进去。
                        disposeObjectResources(parts[1].scene);
                        return;
                    }
                    mountCinematic(parts[2], parts[0], parts[1]);
                }).catch(function (error) {
                    if (token === cinematicRequest && !disposed) {
                        console.warn("とっておき 演出载入失败", error);
                        setCinematicStatus("演出载入失败", false);
                        cinematicWanted = false;
                        syncCinematicButton();
                    }
                });
            }

            function mountCinematic(us, timeline, loaded) {
                var root = loaded.scene;
                // 时间轴驱动的那台正交相机。orthoSize/354 是引擎自己的换算，
                // createPlayer 每帧会写 left/right/top/bottom，这里只要给一台
                // 空的正交相机和当前画布比例。
                var stageCamera = new THREE.OrthographicCamera(-1, 1, 1, -1,
                    (timeline.camera && timeline.camera.near) || 0.1,
                    (timeline.camera && timeline.camera.far) || 200);
                scene.add(root);
                // 演出者挂在场景原点，不是 loc_MY_* 上。
                //
                // loc_MY_0 / loc_TGT_0 是战斗队列的站位（[±0.65, -0.16, -0.65]，
                // 左右镜像），给场上其他人和目标用；演出者由根节点上的
                // MeigeAC_owner_body@skill / MeigeAC_owner_head@skill 代表，
                // 两者的变换都是单位变换。位移在大招动作自己的 root 骨骼里
                // （100003 大约 +1.12 x），相机是按这个走位构图的。
                //
                // 挂到 loc_MY_0 上会把 0.65 叠在这 1.12 上：量下来第 0/40/90/200
                // 帧角色一个像素都不在画面里，正交相机的窗口在第 0 帧只有
                // x∈[0.459, 1.312]。挂原点则六个取样点全部在框内，重心从
                // 0.297 平移到 0.706 —— 就是过场该有的横移。
                var slot = null;
                root.traverse(function (child) {
                    if (!slot && (child.userData.name || child.name) === "loc_MY_0") {
                        slot = child;
                    }
                });
                var restore = {
                    parent: modelObject.parent,
                    position: modelObject.position.clone(),
                    quaternion: modelObject.quaternion.clone(),
                    scale: modelObject.scale.clone(),
                    shadowVisible: shadowObject ? shadowObject.visible : null
                };
                root.add(modelObject);
                modelObject.position.set(0, 0, 0);
                modelObject.quaternion.identity();
                modelObject.scale.setScalar(1);
                // 演出自带地面和背景，观察台那张影子贴片会浮在半空。
                if (shadowObject) {
                    shadowObject.visible = false;
                }
                var player = us.createPlayer({
                    THREE: THREE,
                    timeline: timeline,
                    root: root,
                    camera: stageCamera,
                    audio: us.sceneAudio(cinematicResourceId()),
                    aspect: cinematicAspect(timeline),
                    onEvent: applyCinematicEvent
                });
                cinematic = {
                    us: us,
                    root: root,
                    timeline: timeline,
                    player: player,
                    camera: stageCamera,
                    restore: restore,
                    slot: slot
                };
                // 演出的长度由时间轴说，角色动作要跟着它走而不是各跑一套时钟。
                if (clipByName.skill) {
                    selectAction("skill");
                }
                if (activeClipAction) {
                    activeClipAction.paused = true;
                }
                controls.enabled = false;
                player.seek(0);
                player.play();
                setCinematicStatus(timeline.duration.toFixed(1) + " 秒 · "
                    + (timeline.channels || []).length + " 条通道", false);
                syncCinematicButton();
                resize();
            }

            // 按 3:2 渲染演出，面板剩下的部分留黑边。
            //
            // 先在整块画布上清一次，再开裁剪：裁剪开着的时候 clear 只作用在
            // 裁剪框内，边上会留着上一帧的残像。渲染完把视口和裁剪都放回整块
            // 画布，普通观察模式和 grab() 才不会拿到一块偏移的画面。
            function renderCinematicFrame() {
                var rect = cinematicViewport();
                var width = Math.max(1, host.clientWidth);
                var height = Math.max(1, host.clientHeight);
                renderer.setScissorTest(false);
                renderer.setViewport(0, 0, width, height);
                renderer.clear();
                renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
                renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
                renderer.setScissorTest(true);
                renderer.render(scene, cinematic.camera);
                renderer.setScissorTest(false);
                renderer.setViewport(0, 0, width, height);
                renderer.setScissor(0, 0, width, height);
            }

            // 把角色骨骼拨到时间轴当前帧对应的时刻。
            //
            // 只有一条时钟：动作的时间由时间轴的帧数换算，不让 mixer 自己走 ——
            // 两套时钟一定会漂，而这段过场的相机切点是按帧卡在动作上的。
            // 单独成函数是因为按帧 seek（诊断、拖进度）也要能把骨骼带过去，
            // 否则骨架会停在实时播放最后留下的那个姿势上。
            function syncClipToCinematic() {
                if (!cinematic || !activeClipAction || !cinematic.player.fps) {
                    return;
                }
                var seconds = cinematic.player.frame / cinematic.player.fps;
                var clipLength = activeClipAction.getClip().duration;
                activeClipAction.time = clipLength > 0
                    ? Math.min(seconds, clipLength)
                    : 0;
                if (mixer) {
                    mixer.update(0);
                }
            }

            // 帧事件里只有几条会改我们这边的状态；其余是给战斗场景里的其他
            // 单位用的，观察台只有演出者一个人。
            //
            // 特别是 my*OnOff 这一组：提取器分出了 mySingleOnOff(120)、
            // myAllOnOff(121)、myOnOff(122) 三个事件，121 关的是站在
            // loc_MY_* 上的「我方全体」，不是演出者本人 —— 100003 在第 0 帧
            // 就发 myAllOnOff(0)，一直到第 360 帧（共 511 帧）才恢复，而这段
            // 时间相机恰好正对着 loc_MY_0 拍演出者的起手式。曾经把它接到
            // modelObject.visible 上，结果人在自己的大招里消失了 12 秒。
            // 观察台没有我方队列，所以这条事件在这里本就无事可做。
            function applyCinematicEvent(event) {
                if (!event || disposed) {
                    return;
                }
                var on = event.args && event.args.length ? Boolean(event.args[0]) : true;
                if (event.event === "weaponVisible") {
                    setWeaponVisible(on);
                } else if (event.event === "setFacial") {
                    applyCinematicFacial(event.args && event.args[0]);
                }
            }

            function exitCinematic() {
                cinematicRequest += 1;
                if (!cinematic) {
                    setCinematicStatus("", false);
                    syncCinematicButton();
                    return;
                }
                var previous = cinematic;
                cinematic = null;
                if (modelObject) {
                    var restore = previous.restore;
                    (restore.parent || scene).add(modelObject);
                    modelObject.position.copy(restore.position);
                    modelObject.quaternion.copy(restore.quaternion);
                    modelObject.scale.copy(restore.scale);
                    modelObject.visible = true;
                }
                if (shadowObject && previous.restore.shadowVisible !== null) {
                    shadowObject.visible = previous.restore.shadowVisible;
                }
                scene.remove(previous.root);
                disposeObjectResources(previous.root);
                if (activeClipAction) {
                    activeClipAction.paused = false;
                }
                controls.enabled = true;
                setCinematicStatus("", false);
                syncCinematicButton();
                // 过场用的正交相机和观察台的透视相机比例算法不同,回来要重算。
                resize();
                fitModelView(true);
            }

            function toggleCinematic() {
                cinematicWanted = !cinematicWanted;
                syncCinematicButton();
                if (cinematicWanted) {
                    if (actionGroupOf(activeAction) === "ultimate") {
                        enterCinematic();
                    }
                } else {
                    exitCinematic();
                }
            }

            // weaponVisible(0) 在演出开头把武器收起来，等角色摆好架势的那一帧
            // 再放出来。挂载的部件是现成的，不必重新取一次 GLB。
            function setWeaponVisible(visible) {
                mountedWeaponParts.forEach(function (part) {
                    part.visible = visible;
                });
            }

            // setFacial 带的是 facialID，和动作事件用的是同一套编号，所以直接
            // 走既有的 facialID -> 状态索引查表。没有表就跳过，不猜。
            function applyCinematicFacial(facialId) {
                if (!facialTable || !Number.isFinite(facialId)) {
                    return;
                }
                var index = facialStateForId(facialId, 0);
                if (index >= 0) {
                    applyFacialState(index, true);
                }
            }

            function syncCinematicButton() {
                if (!cinematicButton) {
                    return;
                }
                var on = cinematicWanted;
                cinematicButton.classList.toggle("is-active", on);
                cinematicButton.setAttribute("aria-pressed", String(on));
                cinematicButton.textContent = on ? "演出：开" : "演出：关";
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
                activeLoader = loader;
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
                            // 一个 alpha test 只能"保留或丢弃"，而 discard 不是
                            // MSAA 能平均的东西，所以不管开多少采样，被 alpha
                            // test 切出来的边缘一律是锯齿。头发丝、扇骨这种只有
                            // 一两个纹素宽的结构最明显。
                            //
                            // alpha-to-coverage 把贴图的 alpha 转成 MSAA 覆盖率，
                            // 让这些边交给已经在平滑几何边缘的多重采样缓冲去解算。
                            // 材质仍然是不透明并继续写深度，所以上面那套队列顺序
                            // 和接缝修复完全不受影响。
                            //
                            // 试过换成真正的 alpha 混合,交叉比对之后是退步,
                            // 见上面 mount3DModel 前的那段。
                            child.material.alphaToCoverage = !blended;
                            child.material.userData.edgeBlended = true;
                            // 五官是例外，必须按 alpha 混合画。
                            //
                            // 上面那套 cutout 会把 alpha 丢掉：过了 alphaTest 的
                            // 纹素一律按不透明画。身体上没问题，因为那些层本来就是
                            // 实心的。五官不是 —— model_en_7000 的 mouth_A 是 13x8
                            // 一小片，alpha 最高只有 100/255（39%），没有一个纹素是
                            // 实心的，alpha 和亮度的相关性是 -0.178，也就是说那份
                            // 暗色是画上去的，不是合成痕迹。作者的意思是「拿 39%
                            // 的透明度把一条灰线压在皮肤上」，皮肤 233 的话应该出
                            // 0.61*233≈142。实测按 cutout 画出来均值 70.2，自身
                            // 62.92% 的像素低于亮度 90，最暗 0 —— 一条 39% 的线被
                            // 画成了近乎全黑的一块。这就是反馈里的「嘴的黑边」。
                            //
                            // alphaToCoverage 本该把 39% alpha 变成 39% 覆盖率，
                            // 但它靠的是 MSAA 采样数，实测没救回来。
                            //
                            // 用 CustomBlending 而不是 transparent=true：后者会把
                            // 网格丢进透明队列按相机距离排序，也就是上面记的那个
                            // 帽檅接缝的退步。transparent 保持 false，队列和排序键
                            // 还是游戏自己的 renderOrder（m_HieIndex），只是混合
                            // 方程换成了正常的 SrcAlpha/OneMinusSrcAlpha。五官的
                            // renderOrder 是 29036..29045，画在脸之后，本来也没有
                            // 东西该出现在它们背后。
                            //
                            // alphaTest 留一点点：alpha 为 0 的纹素还是要 discard，
                            // 否则它们照样写深度，会挡住后面该画的东西。
                            if (FACE_PART_NAME.test(child.name || "")) {
                                var decal = faceDecalMaterials.get(child.material);
                                if (!decal) {
                                    decal = child.material.clone();
                                    decal.userData = Object.assign({},
                                        child.material.userData);
                                    decal.transparent = false;
                                    decal.blending = THREE.CustomBlending;
                                    decal.blendSrc = THREE.SrcAlphaFactor;
                                    decal.blendDst = THREE.OneMinusSrcAlphaFactor;
                                    decal.blendSrcAlpha = THREE.OneFactor;
                                    decal.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
                                    decal.alphaToCoverage = false;
                                    decal.alphaTest = 0.004;
                                    decal.userData.faceDecal = true;
                                    decal.needsUpdate = true;
                                    faceDecalMaterials.set(child.material, decal);
                                }
                                child.material = decal;
                            }
                            // 各向异性过滤：mipmap 会在斜视时整体降级，裙摆、袖子
                            // 和鞋子朝地的那一面因此发糊。
                            if (maxAnisotropy > 1 && child.material.map
                                && child.material.map.anisotropy !== maxAnisotropy) {
                                child.material.map.anisotropy = maxAnisotropy;
                                child.material.map.needsUpdate = true;
                            }
                            // 把不透明区的颜色往 alpha 斜坡里推一层，斜坡本身
                            // 照旧被 cutoff 保留，只是不再是黑的。贴图在材质
                            // 之间共享，模块内部有 WeakSet 去重，重复调用不会
                            // 重复处理。
                            if (fringeHelpers) {
                                fringeHelpers.dilateMaterialTextures(child.material, THREE, FRINGE_OPTIONS);
                            }
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
                        // 渲染质量是靠采样设置决定的，而这些设置只有 renderer
                        // 拿得到。没有这个句柄，A/B 测量只能去截图，而截图是按
                        // CSS 尺寸合成的，浏览器自己的缩放会造出一堆灰阶，把
                        // MSAA 的效果整个盖掉——先前一次对比就是这样得出"没有
                        // 变化"的假结论。仅在 debug 模式下挂出。
                        window.__rendererDebug = {
                            renderer: renderer,
                            scene: scene,
                            camera: camera,
                            THREE: THREE,
                            // 当前真正在用的那台相机。演出期间是时间轴驱动的
                            // 正交相机,不是观察台的透视相机 —— 一开始这个句柄
                            // 写死了 camera,于是演出的测量全都取到一张空画面,
                            // 看起来像"什么都没渲染出来"。
                            activeCamera: function () {
                                return cinematic ? cinematic.camera : camera;
                            },
                            // 演出挂载后的整套句柄（root/timeline/player/camera）,
                            // 没进演出时是 null。诊断脚本靠它按帧 seek 再量画面,
                            // 不然只能等实时播到那一帧。
                            cinematic: function () {
                                return cinematic;
                            },
                            syncClipToCinematic: syncClipToCinematic,
                            render: function () {
                                if (cinematic) {
                                    renderCinematicFrame();
                                } else {
                                    renderer.render(scene, camera);
                                }
                            },
                            // screenshot() 合成的是 CSS 尺寸的图,浏览器会先把
                            // 绘制缓冲降采样一遍,超采样的效果因此永远量不出来
                            // (之前就是这样得出"提高 pixelRatio 没有变化"的
                            // 假结论)。这里直接取绘制缓冲本身。
                            grab: function () {
                                if (cinematic) {
                                    renderCinematicFrame();
                                } else {
                                    renderer.render(scene, camera);
                                }
                                return {
                                    width: renderer.domElement.width,
                                    height: renderer.domElement.height,
                                    data: renderer.domElement.toDataURL("image/png")
                                };
                            },
                            setPixelRatio: function (value) {
                                sampleRatioOverride = value || null;
                                renderer.setPixelRatio(sampleRatio());
                                resize();
                                return renderer.getPixelRatio();
                            },
                            duplicatesHidden: function () { return duplicateMeshesHidden; },
                            facingVariantsHidden: function () { return facingVariantsHidden; },
                            // 用取景时算好的那份包围盒(它按骨骼采样,不是 bind
                            // pose),测量脚本才能把"模型真实顶端"投到画面上,
                            // 判断某处的着色是不是画到了几何之外。
                            bounds: function () {
                                if (!modelBounds || modelBounds.isEmpty()) { return null; }
                                return {
                                    min: modelBounds.min.toArray(),
                                    max: modelBounds.max.toArray()
                                };
                            },
                            // alpha-to-coverage 只有 4 个采样,覆盖率因此被量化
                            // 成 5 档;真正的混合有 8 bit。用它对比哪种更平滑。
                            setBlendMode: function (mode) {
                                var count = 0;
                                modelObject.traverse(function (child) {
                                    if (!child.isMesh) { return; }
                                    [].concat(child.material).forEach(function (material) {
                                        if (!material || !material.userData.edgeBlended) {
                                            return;
                                        }
                                        if (mode === "blend") {
                                            material.alphaToCoverage = false;
                                            material.transparent = true;
                                            material.blending = THREE.NormalBlending;
                                            material.depthWrite = true;
                                        } else if (mode === "custom") {
                                            // NormalBlending + transparent=false
                                            // 会被强制成 NoBlending,而
                                            // CustomBlending 照样混合,同时留在
                                            // 不透明队列里 —— 主排序键因此仍然
                                            // 是游戏自己写下的 renderOrder,而不
                                            // 是相机距离。
                                            material.alphaToCoverage = false;
                                            material.transparent = false;
                                            material.blending = THREE.CustomBlending;
                                            material.blendSrc = THREE.SrcAlphaFactor;
                                            material.blendDst = THREE.OneMinusSrcAlphaFactor;
                                            material.blendSrcAlpha = THREE.OneFactor;
                                            material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
                                            material.depthWrite = true;
                                        } else {
                                            material.alphaToCoverage = true;
                                            material.transparent = false;
                                            material.blending = THREE.NormalBlending;
                                            material.depthWrite = true;
                                        }
                                        material.needsUpdate = true;
                                        count += 1;
                                    });
                                });
                                return count;
                            },
                            edgeBlended: function () {
                                var total = 0;
                                var patched = 0;
                                modelObject.traverse(function (child) {
                                    if (!child.isMesh) { return; }
                                    [].concat(child.material).forEach(function (material) {
                                        if (!material) { return; }
                                        total += 1;
                                        if (material.userData.edgeBlended) { patched += 1; }
                                    });
                                });
                                return { total: total, patched: patched };
                            },
                            // Stop the clip so two captures differ only by what
                            // the test changed, not by where the idle loop got to.
                            freeze: function () { motionEnabled = false; },
                            showAllVariants: function () {
                                // What the viewer looked like before the table:
                                // every silhouette layer at once.
                                var shown = 0;
                                Object.keys(visibilityNodes).forEach(function (name) {
                                    visibilityNodes[name].forEach(function (node) {
                                        if (!node.visible) {
                                            node.visible = true;
                                            shown += 1;
                                        }
                                    });
                                });
                                visibilityTracks = null;
                                return shown;
                            },
                            visibility: function () {
                                return {
                                    tableLoaded: Boolean(VISIBILITY_TABLE),
                                    governed: Object.keys(visibilityNodes).length,
                                    tracks: visibilityTracks && Object.keys(visibilityTracks).length,
                                    frame: visibilityFrame
                                };
                            },
                            showDuplicates: function () {
                                // Toggle the fix back off so a before/after can be
                                // measured on one load instead of two.
                                var restored = 0;
                                modelObject.traverse(function (child) {
                                    if (child.isMesh && child.userData.coincidentDuplicateOf) {
                                        child.visible = true;
                                        restored += 1;
                                    }
                                });
                                return restored;
                            }
                        };
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
                    // After the rank pass, so a hat_R that already lost to a
                    // hat_R_2 is not re-examined, and world matrices are current.
                    if (modelKind === "enemy") {
                        modelObject.updateMatrixWorld(true);
                        facingVariantsHidden = hideEnemyFacingVariants(THREE);
                    }
                    // Before dedup, so the nodes the table owns are marked and
                    // dedup leaves them alone.
                    indexVisibilityNodes();
                    // After the name-based enemy pass, so the rank it picked is
                    // the copy that survives.
                    duplicateMeshesHidden = hideCoincidentDuplicates(modelObject);
                    applyDefaultVisibility();
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
                    // 玩家走职业动作，没自带动作的敌人走同族基础模型。两条路互斥
                    // （敌人没有 metadata.class，玩家不进 enemyBaseActionSource），
                    // 放在一起是为了后面的合并只写一遍。
                    Promise.all([
                        loadClassActionClips(loader),
                        loadEnemyBaseClips(loader)
                    ]).then(function (borrowed) {
                        var classClips = borrowed[0].concat(borrowed[1]);
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
                        // 只查一次索引（约 60 KiB，之后模块内缓存），确认这个
                        // 角色导出过演出场景才把开关放出来。不阻塞首帧。
                        probeCinematic();
                        // 影子要等 fitModelView 之后:它按 modelBounds 定位。
                        return mountGroundShadow();
                    });
                }, undefined, function (error) {
                    // GLTFLoader 把 onLoad 里抛出的异常也送到这里,所以真正的
                    // 原因可能是本文件的 bug,而不是文件损坏。不打出来就只剩
                    // 一句"解析失败",查不下去。
                    if (window.console && console.error) {
                        console.error("GLB load failed", error);
                    }
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

            // 「重置」原本只动模型变换、镜头和那两根滑块,右边控制台里其余的
            // 状态一律留在原样:速度还停在 ¼×、循环可能是关的、表情锁在手动
            // 选的那个、武器还是「不持有」、标签页也不回到第一页。看上去就是
            // 按了重置但界面没有重置。
            function resetViewerState() {
                resetModelTransform();
                viewTween = null;
                viewAzimuth = 0;
                viewPolar = Math.PI / 2;
                viewZoom = "full";
                markActive(viewPresetButtons, "viewPreset", "front");
                markActive(viewZoomButtons, "viewZoom", "full");
                // fitModelView 会重算取景距离和 min/max,之后 resetView 才有
                // 正确的 homeView 可回;顺序反了会退到上一个模型的构图。
                viewInteracted = false;
                fitModelView(true);
                resetView();
                playbackRate = 1;
                rateButtons.forEach(function (button) {
                    var isActive = Number(button.dataset.playbackRate) === 1;
                    button.classList.toggle("is-active", isActive);
                    button.setAttribute("aria-pressed", String(isActive));
                });
                if (loopButton && !loopPlayback) {
                    loopPlayback = true;
                    loopButton.classList.add("is-active");
                    loopButton.setAttribute("aria-pressed", "true");
                    loopButton.title = "循环播放（L）";
                }
                if (weaponButtons.length && activeLoader) {
                    attachWeaponMode(activeLoader, weaponInterface
                        && weaponInterface.dataset.defaultMode
                        ? weaponInterface.dataset.defaultMode
                        : "default");
                }
                var firstPanel = document.querySelector("[data-inspector-panel]");
                if (firstPanel) {
                    selectInspectorTab(firstPanel.dataset.inspectorPanel);
                }
                setMotionEnabled(true);
                if (clipByName.idle) {
                    selectAction("idle");
                } else if (clipByName.room_idle_L) {
                    selectAction("room_idle_L");
                }
                // 动作选完之后再交回自动表情:selectAction 会把 faceFollowsAction
                // 设回 true,但按钮的选中态要单独刷。
                selectAutomaticFace();
            }

            // 铺满窗口。
            //
            // 上一版是把观察台单独提成 position: fixed 的固定层。那样舞台和控制台
            // 是一起可见了，但左边的素材列表被整张盖掉 —— 要换个模型必须先退出铺满，
            // 也就是反馈里的「铺满窗口就不好选左边的条目了」。
            //
            // 现在铺满的对象是整个工作台：搜索框、素材列表、舞台、控制台一起进全屏，
            // 只是把 topbar 和浏览器界面让出来。列表始终在左边。用原生全屏 API，
            // 所以退出方式（Esc、F11）和用户预期一致，不需要再自己维护一层状态。
            var workbench = host.closest(".models-workbench");
            function focusActive() {
                return Boolean(document.fullscreenElement)
                    && document.fullscreenElement === workbench;
            }
            function syncFocusButton() {
                if (!focusButton) {
                    return;
                }
                var on = focusActive();
                focusButton.setAttribute("aria-pressed", String(on));
                focusButton.innerHTML = on
                    ? "<span aria-hidden='true'>✕</span> 退出铺满"
                    : "<span aria-hidden='true'>⛶</span> 铺满窗口";
                focusButton.title = on
                    ? "退出铺满（F 或 Esc）"
                    : "工作台铺满窗口，列表仍在左侧（F）";
            }
            function setFocusMode(next) {
                if (!workbench) {
                    return;
                }
                var want = !!next;
                if (want === focusActive()) {
                    return;
                }
                var done = want
                    ? (workbench.requestFullscreen ? workbench.requestFullscreen() : null)
                    : (document.exitFullscreen ? document.exitFullscreen() : null);
                if (done && typeof done.catch === "function") {
                    // 全屏可能被浏览器策略拒绝（非用户手势等）。拒绝了就维持原状，
                    // 不要留下一个和实际不符的按钮状态。
                    done.catch(function () { syncFocusButton(); });
                }
            }
            function onFullscreenChange() {
                syncFocusButton();
                // 容器尺寸变了，必须重算渲染缓冲，否则画面会被拉伸。
                resize();
            }
            document.addEventListener("fullscreenchange", onFullscreenChange);
            syncFocusButton();
            if (focusButton) {
                focusButton.addEventListener("click", function () {
                    setFocusMode(!focusActive());
                });
            }
            // 页签切回观察台时容器刚从 hidden 变回可见，尺寸要重算。
            viewerResizeHook = resize;

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
                    case "f":
                    case "F":
                        setFocusMode(!focusActive());
                        break;
                    // [ / ] 收起、展开左边的素材列表。收起时舞台拿到那 310px 宽，
                    // 而列表只是让位，不是消失 —— 边上留了一条竖把手。
                    case "[":
                    case "]":
                        setListCollapsed(event.key === "[");
                        break;
                    // 1-6 对应六个定点视角,顺序和面板上的按钮一致。
                    case "1":
                        selectViewPreset("front");
                        break;
                    case "2":
                        selectViewPreset("left");
                        break;
                    case "3":
                        selectViewPreset("right");
                        break;
                    case "4":
                        selectViewPreset("back");
                        break;
                    case "5":
                        selectViewPreset("top");
                        break;
                    case "6":
                        selectViewPreset("bottom");
                        break;
                    // Esc 交给浏览器：原生全屏本来就用 Esc 退出，自己再处理一遍
                    // 反而会和它抢。
                    default:
                        handled = false;
                }
                if (handled) {
                    event.preventDefault();
                }
            }
            window.addEventListener("keydown", onViewerKeydown);
            viewPresetButtons.forEach(function (button) {
                button.addEventListener("click", function () {
                    selectViewPreset(button.dataset.viewPreset);
                });
            });
            viewZoomButtons.forEach(function (button) {
                button.addEventListener("click", function () {
                    selectViewZoom(button.dataset.viewZoom);
                });
            });
            // 手动拖过之后取消定点视角的选中态,并让球坐标跟上,否则下一次点
            // 「正面」会从一个陈旧角度插值,看起来像跳帧。
            controls.addEventListener("end", syncViewFromCamera);
            // 拖拽期间不要让缓动和 OrbitControls 抢镜头。
            controls.addEventListener("start", function () {
                viewTween = null;
            });
            renderer.domElement.addEventListener("dblclick", function () {
                resetViewerState();
            });
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
                // Also when paused or scrubbed: the switch belongs to the frame,
                // not to the passage of time.
                updateVisibilityFromClip();
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
                stepViewTween(time);
                controls.update();
                if (cinematic) {
                    // 一条时钟。角色动作的时间由时间轴的帧数换算，不让 mixer
                    // 自己走 —— 两套时钟一定会漂，而这段过场的相机切点是按帧
                    // 卡在动作上的。
                    if (motionEnabled) {
                        cinematic.player.update(delta * playbackRate);
                    }
                    syncClipToCinematic();
                    renderCinematicFrame();
                } else {
                    renderer.render(scene, camera);
                }
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
                document.removeEventListener("fullscreenchange", onFullscreenChange);
                viewerResizeHook = null;
                // 全屏的对象是工作台，切模型时它一直在，所以不必退出全屏 ——
                // 上一版铺满是挂在 body 上的一个 class，不清掉会让下一个模型停在
                // 一个没有观察台的铺满布局里；现在没有这个状态了。
                controls.dispose();
                if (mixer) {
                    mixer.stopAllAction();
                }
                // 演出场景是独立下载的一整套网格和贴图（平均 24 KiB GLB，加上
                // 共享贴图），切模型时必须跟着走，否则每看一次大招就漏一份。
                if (cinematic) {
                    var stale = cinematic;
                    cinematic = null;
                    scene.remove(stale.root);
                    disposeObjectResources(stale.root);
                }
                if (shadowObject) {
                    scene.remove(shadowObject);
                    disposeObjectResources(shadowObject);
                    shadowObject = null;
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
        bindListCollapse();
        bindAboutDrawer();
    }

    // 左侧素材列表的收起 / 展开。
    // 收起只是把那 310px 让给舞台，列表位置上仍留一条竖把手，点它就回来。
    // 记在 localStorage 里：这是「摆好一次就不想再摆」的偏好。
    var LIST_COLLAPSE_KEY = "kirafan.models.listCollapsed";
    function setListCollapsed(next) {
        var browser = document.getElementById("modelsBrowser");
        var rail = document.getElementById("modelsListRail");
        var toggle = document.getElementById("modelsListCollapse");
        if (!browser) {
            return;
        }
        var on = !!next;
        browser.classList.toggle("is-list-collapsed", on);
        if (rail) {
            rail.hidden = !on;
        }
        if (toggle) {
            toggle.setAttribute("aria-expanded", String(!on));
        }
        try {
            window.localStorage.setItem(LIST_COLLAPSE_KEY, on ? "1" : "0");
        } catch (error) {
            // 隐私模式下写不进去，不影响本次会话。
        }
        // 舞台宽度变了。
        if (typeof viewerResizeHook === "function") {
            viewerResizeHook();
        }
    }
    function bindListCollapse() {
        var rail = document.getElementById("modelsListRail");
        var toggle = document.getElementById("modelsListCollapse");
        if (toggle) {
            toggle.addEventListener("click", function () {
                var browser = document.getElementById("modelsBrowser");
                setListCollapsed(!(browser && browser.classList.contains("is-list-collapsed")));
            });
        }
        if (rail) {
            rail.addEventListener("click", function () { setListCollapsed(false); });
        }
        var stored = null;
        try {
            stored = window.localStorage.getItem(LIST_COLLAPSE_KEY);
        } catch (error) {
            stored = null;
        }
        if (stored === "1") {
            setListCollapsed(true);
        }
    }

    // 「关于」抽屉。hero / about / footer 的文字原本排在观察台前后，把页面撑得
    // 必然超出视口，于是浏览器滚动条一直在。文字没删，收进这里。
    function bindAboutDrawer() {
        var toggle = document.getElementById("modelsAboutToggle");
        var drawer = document.getElementById("modelsAboutDrawer");
        var close = document.getElementById("modelsAboutClose");
        if (!toggle || !drawer) {
            return;
        }
        function setOpen(open) {
            drawer.hidden = !open;
            toggle.setAttribute("aria-expanded", String(open));
            if (open && close) {
                close.focus();
            }
        }
        toggle.addEventListener("click", function () { setOpen(drawer.hidden); });
        if (close) {
            close.addEventListener("click", function () { setOpen(false); });
        }
        // 点遮罩关闭；面板自己的点击不算。
        drawer.addEventListener("click", function (event) {
            if (event.target === drawer) {
                setOpen(false);
            }
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !drawer.hidden) {
                setOpen(false);
            }
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
            if (manifest.rarity) {
                RARITY_TABLE_URL = manifest.rarity;
            }
            if (manifest.visibility) {
                VISIBILITY_TABLE_URL = manifest.visibility;
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

    // Small (≈50 KiB) and needed before the first model mounts, so it is fetched
    // with the manifest rather than on demand. A failure must not block the
    // viewer: without the table no ultimate is offered, which is the safe side of
    // the gate -- 66 models lose a button they should not have had, and the rest
    // lose one they should. The status line says so instead of failing silently.
    function loadRarityTable() {
        if (IS_LOCAL_FILE) {
            return Promise.resolve();
        }
        return fetch(RARITY_TABLE_URL).then(function (response) {
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }
            return response.json();
        }).then(function (table) {
            if (!table || !table.models || typeof table.models !== "object") {
                throw new Error("invalid rarity table");
            }
            Object.keys(table.models).forEach(function (modelId) {
                MODEL_RARITY[modelId] = table.models[modelId];
            });
        }).catch(function () {
            manifestState.rarityError = true;
        });
    }

    // 13 KiB, and every player model needs it the moment its first clip plays.
    // A failure leaves VISIBILITY_TABLE null and the viewer falls back to drawing
    // whatever the GLB ships -- the same too-many-layers look as before the table
    // existed, which is wrong but not broken.
    function loadVisibilityTable() {
        if (IS_LOCAL_FILE) {
            return Promise.resolve();
        }
        return fetch(VISIBILITY_TABLE_URL).then(function (response) {
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }
            return response.json();
        }).then(function (table) {
            if (!table || !table.clips || typeof table.clips !== "object") {
                throw new Error("invalid visibility table");
            }
            VISIBILITY_TABLE = table;
        }).catch(function () {
            manifestState.visibilityError = true;
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
    // The rarity table's URL can be overridden by the manifest, so it is fetched
    // after the manifest resolves and before the database populates the grid.
    loadPreviewManifest().then(function () {
        // Both are small and independent; neither blocks the other.
        return Promise.all([loadRarityTable(), loadVisibilityTable()]);
    }).then(loadDatabase);
})();
