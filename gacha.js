(function () {
    "use strict";

    var data = window.kirafanGachaData;
    var assetRoot = "https://asset.kirafan.cn/texture/charauiresource/";
    var recordKey = "kirafan-memorial-gacha-record-v1";
    var soundKey = "kirafan-memorial-gacha-sound-v1";
    var pageSize = 24;

    var classes = [
        { name: "战士", icon: "imgs/Class_Warrior.png" },
        { name: "魔法使", icon: "imgs/Class_Mage.png" },
        { name: "僧侣", icon: "imgs/Class_Priest.png" },
        { name: "骑士", icon: "imgs/Class_Knight.png" },
        { name: "炼金术士", icon: "imgs/Class_Alchemist.png" }
    ];
    var elements = [
        { name: "炎", icon: "imgs/Attribute_Fire.png" },
        { name: "水", icon: "imgs/Attribute_Water.png" },
        { name: "土", icon: "imgs/Attribute_Earth.png" },
        { name: "风", icon: "imgs/Attribute_Wind.png" },
        { name: "月", icon: "imgs/Attribute_Moon.png" },
        { name: "阳", icon: "imgs/Attribute_Sun.png" }
    ];

    var state = {
        catalogPage: 1,
        record: readRecord(),
        pools: { 3: [], 4: [], 5: [] },
        soundEnabled: readSoundPreference(),
        finishSummonAnimation: null,
        viewer: {
            card: null,
            evolved: false,
            mode: "card"
        }
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function clearElement(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    function readRecord() {
        try {
            var saved = JSON.parse(window.localStorage.getItem(recordKey));
            if (saved && Number.isFinite(saved.total) && Number.isFinite(saved.fiveStars) && Array.isArray(saved.owned)) {
                return {
                    total: Math.max(0, saved.total),
                    fiveStars: Math.max(0, saved.fiveStars),
                    owned: saved.owned.filter(function (id) { return Number.isFinite(id); })
                };
            }
        } catch (error) {
            // localStorage can be disabled; the summon page still works without persistence.
        }
        return { total: 0, fiveStars: 0, owned: [] };
    }

    function writeRecord() {
        try {
            window.localStorage.setItem(recordKey, JSON.stringify(state.record));
        } catch (error) {
            return;
        }
    }

    function readSoundPreference() {
        try {
            return window.localStorage.getItem(soundKey) !== "off";
        } catch (error) {
            return true;
        }
    }

    function writeSoundPreference() {
        try {
            window.localStorage.setItem(soundKey, state.soundEnabled ? "on" : "off");
        } catch (error) {
            return;
        }
    }

    function updateSoundButton() {
        var button = byId("soundToggle");
        button.classList.toggle("is-muted", !state.soundEnabled);
        button.setAttribute("aria-pressed", String(state.soundEnabled));
        button.setAttribute("aria-label", state.soundEnabled ? "关闭召唤演出音" : "开启召唤演出音");
        button.title = state.soundEnabled ? "关闭召唤演出音" : "开启召唤演出音";
        button.textContent = "♪";
    }

    function randomUnit() {
        if (window.crypto && window.crypto.getRandomValues) {
            var values = new Uint32Array(1);
            window.crypto.getRandomValues(values);
            return values[0] / 4294967296;
        }
        return Math.random();
    }

    function pickRandom(items) {
        return items[Math.floor(randomUnit() * items.length)];
    }

    function chooseRarity(guaranteedFourStar) {
        var roll = randomUnit();
        if (guaranteedFourStar) {
            return roll < 0.02 ? 5 : 4;
        }
        if (roll < 0.02) {
            return 5;
        }
        if (roll < 0.14) {
            return 4;
        }
        return 3;
    }

    function displayedCardId(card, evolved) {
        return evolved && card.evolvedId ? card.evolvedId : card.id;
    }

    function cardArtUrl(card, evolved, highResolution) {
        return assetRoot + "characard/characard_" + displayedCardId(card, evolved) + (highResolution ? ".png" : ".jpg");
    }

    function cardIconUrl(card, evolved) {
        return assetRoot + "charaicon/charaicon_" + displayedCardId(card, evolved) + ".png";
    }

    function cardIllustrationUrl(card, evolved) {
        var id = displayedCardId(card, evolved);
        var hasFull = evolved ? card.evolvedHasFullIllustration : card.hasFullIllustration;
        var directory = hasFull ? "charaillustfull/charaillust_full_" : "charaillustchara/charaillust_chara_";
        return assetRoot + directory + id + ".png";
    }

    function cardDetailUrl(card) {
        return "https://kirafan.cn/#/character/" + card.id;
    }

    function starText(rarity) {
        return new Array(rarity + 1).join("★");
    }

    function displayName(card) {
        return card.nameZh || card.name;
    }

    function displayTitle(card) {
        return card.titleZh || card.title;
    }

    function cardImageSources(card, options) {
        if (options.kind === "illustration") {
            return [
                cardIllustrationUrl(card, options.evolved),
                cardArtUrl(card, options.evolved, true),
                cardIconUrl(card, options.evolved)
            ];
        }
        if (options.highResolution) {
            return [
                cardArtUrl(card, options.evolved, true),
                cardArtUrl(card, options.evolved, false),
                cardIconUrl(card, options.evolved)
            ];
        }
        return [
            cardArtUrl(card, options.evolved, false),
            cardIconUrl(card, options.evolved)
        ];
    }

    function setCardImage(image, container, card, options) {
        image.kirafanSources = cardImageSources(card, options);
        image.kirafanSourceIndex = 0;
        image.alt = displayName(card) + (options.kind === "illustration" ? "角色图" : options.evolved ? "进化后卡面" : "初始卡面");
        image.loading = options.eager ? "eager" : "lazy";
        image.fetchPriority = options.eager ? "high" : "auto";
        container.classList.remove("is-icon", "is-image-unavailable", "is-illustration");
        container.classList.toggle("is-illustration", options.kind === "illustration");
        image.hidden = false;
        image.src = image.kirafanSources[0];
    }

    function appendCardImage(container, card, options) {
        var image = document.createElement("img");
        image.decoding = "async";
        image.addEventListener("error", function handleError() {
            image.kirafanSourceIndex += 1;
            if (image.kirafanSourceIndex < image.kirafanSources.length) {
                if (image.kirafanSourceIndex === image.kirafanSources.length - 1) {
                    container.classList.remove("is-illustration");
                    container.classList.add("is-icon");
                }
                image.src = image.kirafanSources[image.kirafanSourceIndex];
                return;
            }
            if (!container.classList.contains("is-image-unavailable")) {
                container.classList.add("is-icon");
                container.classList.add("is-image-unavailable");
            }
            image.hidden = true;
        });
        container.appendChild(image);
        setCardImage(image, container, card, options);
        return image;
    }

    function createEvolutionSwitch(card, onChange) {
        if (!card.evolvedId) {
            return null;
        }

        var group = document.createElement("div");
        group.className = "evolution-switch";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", displayName(card) + " 卡面形态");

        [
            { label: "初始", evolved: false },
            { label: "进化", evolved: true }
        ].forEach(function (option) {
            var button = document.createElement("button");
            button.type = "button";
            button.textContent = option.label;
            button.classList.toggle("is-active", !option.evolved);
            button.setAttribute("aria-pressed", String(!option.evolved));
            button.addEventListener("click", function () {
                Array.prototype.forEach.call(group.children, function (item) {
                    var active = item === button;
                    item.classList.toggle("is-active", active);
                    item.setAttribute("aria-pressed", String(active));
                });
                onChange(option.evolved);
            });
            group.appendChild(button);
        });
        return group;
    }

    function updateViewer() {
        var card = state.viewer.card;
        if (!card) {
            return;
        }

        var evolved = state.viewer.evolved && Boolean(card.evolvedId);
        state.viewer.evolved = evolved;
        byId("viewerTitle").textContent = displayName(card);
        byId("viewerSubtitle").textContent = displayTitle(card);
        byId("viewerRarity").textContent = starText(card.rarity);
        byId("viewerForm").textContent = evolved ? "进化后" : "初始";
        byId("viewerDetailLink").href = cardDetailUrl(card);

        var media = byId("viewerMedia");
        clearElement(media);
        appendCardImage(media, card, {
            evolved: evolved,
            highResolution: true,
            eager: true,
            kind: state.viewer.mode
        });

        var evolutionControls = byId("viewerEvolution");
        evolutionControls.hidden = !card.evolvedId;
        [byId("viewerBase"), byId("viewerEvolved")].forEach(function (button) {
            var active = button === byId(evolved ? "viewerEvolved" : "viewerBase");
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        [byId("viewerCardArt"), byId("viewerIllustration")].forEach(function (button) {
            var active = button === byId(state.viewer.mode === "card" ? "viewerCardArt" : "viewerIllustration");
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    function openCardViewer(card, evolved) {
        var dialog = byId("cardViewer");
        state.viewer.card = card;
        state.viewer.evolved = Boolean(evolved && card.evolvedId);
        state.viewer.mode = "card";
        updateViewer();
        if (!dialog.open) {
            dialog.showModal();
        }
        document.body.classList.add("viewer-open");
    }

    function closeCardViewer() {
        var dialog = byId("cardViewer");
        if (dialog.open) {
            dialog.close();
        }
    }

    function createDrawCard(card, index) {
        var article = document.createElement("article");
        article.className = "draw-card";
        article.dataset.rarity = String(card.rarity);
        article.style.animationDelay = (index * 55) + "ms";
        var evolved = false;

        var media = document.createElement("button");
        media.type = "button";
        media.className = "draw-card-media";
        media.setAttribute("aria-label", "放大查看 " + displayName(card) + " 初始卡面");
        var cardImage = appendCardImage(media, card, {
            evolved: false,
            highResolution: true,
            eager: true,
            kind: "card"
        });
        media.addEventListener("click", function () {
            openCardViewer(card, evolved);
        });

        var rarity = document.createElement("span");
        rarity.className = "draw-card-rarity";
        rarity.textContent = starText(card.rarity);
        media.appendChild(rarity);

        var body = document.createElement("div");
        body.className = "draw-card-body";

        var title = document.createElement("p");
        title.className = "draw-card-title";
        title.textContent = displayTitle(card);

        var name = document.createElement("p");
        name.className = "draw-card-name";
        name.textContent = displayName(card);
        if (card.nameZh && card.nameZh !== card.name) {
            var japaneseName = document.createElement("small");
            japaneseName.lang = "ja";
            japaneseName.textContent = card.name;
            name.appendChild(japaneseName);
        }

        var tags = document.createElement("div");
        tags.className = "draw-card-tags";
        var classInfo = classes[card.class];
        var elementInfo = elements[card.element];
        [classInfo, elementInfo].forEach(function (info) {
            if (!info) {
                return;
            }
            var icon = document.createElement("img");
            icon.src = info.icon;
            icon.alt = info.name;
            icon.title = info.name;
            tags.appendChild(icon);
        });
        var year = document.createElement("span");
        year.textContent = card.year ? card.year + " 年" : "";
        tags.appendChild(year);

        body.appendChild(title);
        body.appendChild(name);
        body.appendChild(tags);
        var evolutionSwitch = createEvolutionSwitch(card, function (showEvolved) {
            evolved = showEvolved;
            setCardImage(cardImage, media, card, {
                evolved: evolved,
                highResolution: true,
                eager: true,
                kind: "card"
            });
            media.setAttribute("aria-label", "放大查看 " + displayName(card) + (evolved ? " 进化后卡面" : " 初始卡面"));
        });
        if (evolutionSwitch) {
            body.appendChild(evolutionSwitch);
        }

        var link = document.createElement("a");
        link.className = "draw-card-detail";
        link.href = cardDetailUrl(card);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "卡片资料 ↗";
        link.setAttribute("aria-label", "查看 " + displayName(card) + " 的卡片资料");
        body.appendChild(link);
        article.appendChild(media);
        article.appendChild(body);
        return article;
    }

    function createCatalogCard(card) {
        var article = document.createElement("article");
        article.className = "catalog-card";
        article.dataset.rarity = String(card.rarity);

        var button = document.createElement("button");
        button.type = "button";
        button.className = "catalog-card-open";
        button.setAttribute("aria-label", "查看 " + displayName(card) + " 的高清卡面");
        button.addEventListener("click", function () {
            openCardViewer(card, false);
        });

        var imageBox = document.createElement("div");
        imageBox.className = "catalog-card-image";
        appendCardImage(imageBox, card, {
            evolved: false,
            highResolution: false,
            eager: false,
            kind: "card"
        });

        var name = document.createElement("strong");
        name.textContent = displayName(card);
        name.title = displayName(card);
        var title = document.createElement("small");
        title.textContent = displayTitle(card);
        title.title = displayTitle(card);

        var meta = document.createElement("div");
        meta.className = "catalog-card-meta";
        var rarity = document.createElement("span");
        rarity.textContent = starText(card.rarity);
        var year = document.createElement("span");
        year.textContent = card.year || "";
        meta.appendChild(rarity);
        meta.appendChild(year);

        button.appendChild(imageBox);
        button.appendChild(name);
        button.appendChild(title);
        button.appendChild(meta);
        article.appendChild(button);
        return article;
    }

    function updateRecordDisplay() {
        byId("totalDraws").textContent = state.record.total;
        byId("fiveStarDraws").textContent = state.record.fiveStars;
        byId("ownedCards").textContent = state.record.owned.length;
    }

    function renderResults(cards) {
        var grid = byId("resultsGrid");
        clearElement(grid);
        grid.classList.remove("results-grid-empty");
        cards.forEach(function (card, index) {
            grid.appendChild(createDrawCard(card, index));
        });
        var fiveStarCount = cards.filter(function (card) { return card.rarity === 5; }).length;
        byId("resultStatus").textContent = fiveStarCount > 0
            ? "召唤完成。与 " + cards.length + " 张角色卡相遇，其中 ★5 共 " + fiveStarCount + " 张。"
            : "召唤完成。与 " + cards.length + " 张角色卡相遇。";
    }

    function setSummonButtonsDisabled(disabled) {
        byId("drawOne").disabled = disabled;
        byId("drawTen").disabled = disabled;
    }

    function playSummonSound(rarity) {
        if (!state.soundEnabled) {
            return;
        }

        var AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
            return;
        }

        // The public archive has the Unity scene but no web-playable original audio.
        var context;
        try {
            context = new AudioContext();
            var start = context.currentTime + 0.03;
            var notes = rarity === 5 ? [523.25, 659.25, 783.99, 1046.5] : rarity === 4 ? [440, 554.37, 659.25] : [392, 493.88, 587.33];
            notes.forEach(function (frequency, index) {
                var oscillator = context.createOscillator();
                var gain = context.createGain();
                var noteStart = start + index * 0.17;
                oscillator.type = index === notes.length - 1 ? "sine" : "triangle";
                oscillator.frequency.setValueAtTime(frequency, noteStart);
                gain.gain.setValueAtTime(0.0001, noteStart);
                gain.gain.exponentialRampToValueAtTime(0.085, noteStart + 0.025);
                gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.72);
                oscillator.connect(gain);
                gain.connect(context.destination);
                oscillator.start(noteStart);
                oscillator.stop(noteStart + 0.75);
            });
            window.setTimeout(function () {
                Promise.resolve(context.close()).catch(function () { return; });
            }, 1800);
        } catch (error) {
            if (context && context.close) {
                Promise.resolve(context.close()).catch(function () { return; });
            }
        }
    }

    function runSummonAnimation(cards, done) {
        var stage = byId("summonStage");
        var highestRarity = Math.max.apply(null, cards.map(function (card) { return card.rarity; }));
        var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        var finished = false;
        var timer;

        stage.hidden = false;
        stage.className = "summon-stage rarity-" + highestRarity;
        stage.setAttribute("aria-hidden", "false");
        byId("summonStageText").textContent = highestRarity === 5
            ? "虹色的星光正在汇聚"
            : highestRarity === 4
                ? "金色的星光正在汇聚"
                : "星光正在回应呼唤";
        document.body.classList.add("summon-playing");
        window.requestAnimationFrame(function () {
            stage.classList.add("is-active");
        });
        playSummonSound(highestRarity);

        function finish() {
            if (finished) {
                return;
            }
            finished = true;
            window.clearTimeout(timer);
            stage.classList.add("is-ending");
            window.setTimeout(function () {
                stage.hidden = true;
                stage.setAttribute("aria-hidden", "true");
                document.body.classList.remove("summon-playing");
                state.finishSummonAnimation = null;
                done();
            }, reducedMotion ? 0 : 220);
        }

        state.finishSummonAnimation = finish;
        timer = window.setTimeout(finish, reducedMotion ? 60 : 1900);
    }

    function performSummon(count) {
        setSummonButtonsDisabled(true);
        byId("resultStatus").textContent = "正在翻开圣典……";

        var results = [];
        for (var index = 0; index < count; index++) {
            var guaranteed = count === 10 && index === count - 1;
            var rarity = chooseRarity(guaranteed);
            results.push(pickRandom(state.pools[rarity]));
        }

        runSummonAnimation(results, function () {
            var ownedSet = new Set(state.record.owned);
            results.forEach(function (card) {
                ownedSet.add(card.id);
                if (card.rarity === 5) {
                    state.record.fiveStars += 1;
                }
            });
            state.record.total += results.length;
            state.record.owned = Array.from(ownedSet);
            writeRecord();
            updateRecordDisplay();
            renderResults(results);
            setSummonButtonsDisabled(false);
            byId("resultsTitle").focus({ preventScroll: true });
            byId("resultsTitle").scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }

    function normalizeSearch(value) {
        return String(value || "").toLocaleLowerCase().replace(/\s+/g, "");
    }

    function filteredCards() {
        var query = normalizeSearch(byId("searchInput").value);
        var titleId = byId("titleFilter").value;
        var rarity = byId("rarityFilter").value;
        return data.cards.filter(function (card) {
            if (titleId && String(card.titleId) !== titleId) {
                return false;
            }
            if (rarity && String(card.rarity) !== rarity) {
                return false;
            }
            if (!query) {
                return true;
            }
            var haystack = normalizeSearch([
                card.name,
                card.nameZh,
                card.character,
                card.characterZh,
                card.title,
                card.titleZh
            ].join(" "));
            return haystack.indexOf(query) !== -1;
        });
    }

    function paginationPages(current, total) {
        var pages = [];
        for (var page = 1; page <= total; page++) {
            if (page === 1 || page === total || Math.abs(page - current) <= 2) {
                pages.push(page);
            }
        }
        return pages;
    }

    function renderPagination(totalPages) {
        var navigation = byId("catalogPagination");
        clearElement(navigation);
        if (totalPages <= 1) {
            return;
        }

        function addButton(label, page, disabled, current) {
            var button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.disabled = disabled;
            if (current) {
                button.classList.add("is-current");
                button.setAttribute("aria-current", "page");
            }
            button.setAttribute("aria-label", label === "上一页" || label === "下一页" ? label : "第 " + page + " 页");
            button.addEventListener("click", function () {
                state.catalogPage = page;
                renderCatalog();
                byId("catalogTitle").scrollIntoView({ behavior: "smooth", block: "start" });
            });
            navigation.appendChild(button);
        }

        addButton("上一页", state.catalogPage - 1, state.catalogPage === 1, false);
        var pages = paginationPages(state.catalogPage, totalPages);
        pages.forEach(function (page, index) {
            if (index > 0 && page - pages[index - 1] > 1) {
                var ellipsis = document.createElement("span");
                ellipsis.textContent = "…";
                navigation.appendChild(ellipsis);
            }
            addButton(String(page), page, false, page === state.catalogPage);
        });
        addButton("下一页", state.catalogPage + 1, state.catalogPage === totalPages, false);
    }

    function renderCatalog() {
        var cards = filteredCards();
        var totalPages = Math.max(1, Math.ceil(cards.length / pageSize));
        state.catalogPage = Math.min(state.catalogPage, totalPages);
        var start = (state.catalogPage - 1) * pageSize;
        var visibleCards = cards.slice(start, start + pageSize);
        var grid = byId("catalogGrid");
        clearElement(grid);

        if (visibleCards.length === 0) {
            var empty = document.createElement("p");
            empty.className = "catalog-empty";
            empty.textContent = "没有找到符合条件的角色卡。";
            grid.appendChild(empty);
        } else {
            visibleCards.forEach(function (card) {
                grid.appendChild(createCatalogCard(card));
            });
        }

        byId("poolCount").textContent = "找到 " + cards.length + " 张卡片 · 第 " + state.catalogPage + " / " + totalPages + " 页";
        renderPagination(totalPages);
    }

    function populateTitleFilter() {
        var select = byId("titleFilter");
        data.titles.forEach(function (title) {
            var option = document.createElement("option");
            option.value = title.id;
            option.textContent = title.nameZh || title.name;
            select.appendChild(option);
        });
    }

    function init() {
        if (!data || !Array.isArray(data.cards) || data.cards.length === 0) {
            byId("resultStatus").textContent = "卡池数据加载失败，请刷新页面重试。";
            setSummonButtonsDisabled(true);
            return;
        }

        data.cards.forEach(function (card) {
            if (state.pools[card.rarity]) {
                state.pools[card.rarity].push(card);
            }
        });

        byId("cardCount").textContent = data.meta.cardCount;
        byId("characterCount").textContent = data.meta.characterCount;
        byId("titleCount").textContent = data.meta.titleCount;
        updateRecordDisplay();
        updateSoundButton();
        populateTitleFilter();
        renderCatalog();

        byId("drawOne").addEventListener("click", function () { performSummon(1); });
        byId("drawTen").addEventListener("click", function () { performSummon(10); });
        byId("soundToggle").addEventListener("click", function () {
            state.soundEnabled = !state.soundEnabled;
            writeSoundPreference();
            updateSoundButton();
        });
        byId("skipSummon").addEventListener("click", function () {
            if (state.finishSummonAnimation) {
                state.finishSummonAnimation();
            }
        });
        byId("viewerClose").addEventListener("click", closeCardViewer);
        byId("cardViewer").addEventListener("click", function (event) {
            if (event.target === byId("cardViewer")) {
                closeCardViewer();
            }
        });
        byId("cardViewer").addEventListener("close", function () {
            document.body.classList.remove("viewer-open");
        });
        byId("viewerBase").addEventListener("click", function () {
            state.viewer.evolved = false;
            updateViewer();
        });
        byId("viewerEvolved").addEventListener("click", function () {
            state.viewer.evolved = true;
            updateViewer();
        });
        byId("viewerCardArt").addEventListener("click", function () {
            state.viewer.mode = "card";
            updateViewer();
        });
        byId("viewerIllustration").addEventListener("click", function () {
            state.viewer.mode = "illustration";
            updateViewer();
        });
        byId("catalogFilters").addEventListener("submit", function (event) { event.preventDefault(); });
        ["searchInput", "titleFilter", "rarityFilter"].forEach(function (id) {
            var eventName = id === "searchInput" ? "input" : "change";
            byId(id).addEventListener(eventName, function () {
                state.catalogPage = 1;
                renderCatalog();
            });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
