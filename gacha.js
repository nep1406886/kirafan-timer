(function () {
    "use strict";

    var data = window.kirafanGachaData;
    var assetRoot = "https://asset.kirafan.cn/texture/charauiresource/";
    var recordKey = "kirafan-memorial-gacha-record-v1";
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
        pools: { 3: [], 4: [], 5: [] }
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

    function cardArtUrl(card) {
        return assetRoot + "characard/characard_" + card.id + ".jpg";
    }

    function cardIconUrl(card) {
        return assetRoot + "charaicon/charaicon_" + card.id + ".jpg";
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

    function appendCardImage(container, card, useFullArt) {
        var image = document.createElement("img");
        image.src = useFullArt ? cardArtUrl(card) : cardIconUrl(card);
        image.alt = displayName(card) + "角色卡";
        image.loading = useFullArt ? "eager" : "lazy";
        image.decoding = "async";
        image.addEventListener("error", function handleError() {
            if (useFullArt && image.dataset.fallback !== "icon") {
                image.dataset.fallback = "icon";
                container.classList.add("is-icon");
                image.src = cardIconUrl(card);
                return;
            }
            image.removeEventListener("error", handleError);
            image.remove();
            container.classList.add("is-image-unavailable");
        });
        container.appendChild(image);
    }

    function createDrawCard(card, index) {
        var article = document.createElement("article");
        article.className = "draw-card";
        article.dataset.rarity = String(card.rarity);
        article.style.animationDelay = (index * 55) + "ms";

        var media = document.createElement("div");
        media.className = "draw-card-media";
        appendCardImage(media, card, true);

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
        article.appendChild(media);
        article.appendChild(body);

        var link = document.createElement("a");
        link.className = "draw-card-link";
        link.href = cardDetailUrl(card);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", "查看 " + displayName(card) + " 的卡片资料");
        article.appendChild(link);
        return article;
    }

    function createCatalogCard(card) {
        var article = document.createElement("article");
        article.className = "catalog-card";
        article.dataset.rarity = String(card.rarity);

        var link = document.createElement("a");
        link.href = cardDetailUrl(card);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", "查看 " + displayName(card) + " 的卡片资料");

        var imageBox = document.createElement("div");
        imageBox.className = "catalog-card-image";
        appendCardImage(imageBox, card, false);

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

        link.appendChild(imageBox);
        link.appendChild(name);
        link.appendChild(title);
        link.appendChild(meta);
        article.appendChild(link);
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

    function performSummon(count) {
        setSummonButtonsDisabled(true);
        byId("resultStatus").textContent = "正在翻开圣典……";

        window.setTimeout(function () {
            var results = [];
            for (var index = 0; index < count; index++) {
                var guaranteed = count === 10 && index === count - 1;
                var rarity = chooseRarity(guaranteed);
                results.push(pickRandom(state.pools[rarity]));
            }

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
        }, 360);
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
        populateTitleFilter();
        renderCatalog();

        byId("drawOne").addEventListener("click", function () { performSummon(1); });
        byId("drawTen").addEventListener("click", function () { performSummon(10); });
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
