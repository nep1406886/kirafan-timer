import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATABASE_ROOT = "https://database.kirafan.cn/database";
const TRANSLATION_ROOT = "https://trans.kirafan.cn";
const ORIGINAL_TITLE_TYPE = 22;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "asset", "gacha", "cards.js");

async function fetchJson(name) {
    const response = await fetch(`${DATABASE_ROOT}/${name}.json`);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${name}: HTTP ${response.status}`);
    }
    return response.json();
}

const [characters, namedCharacters, titles, translations, englishTranslations, assetBundles, version, translationVersion] = await Promise.all([
    fetchJson("CharacterList"),
    fetchJson("NamedList"),
    fetchJson("TitleList"),
    fetch(`${TRANSLATION_ROOT}/zh.json`).then((response) => response.json()),
    fetch(`${TRANSLATION_ROOT}/en.json`).then((response) => response.json()),
    fetch(`${DATABASE_ROOT}/../assetBundle.json`).then((response) => response.json()),
    fetch(`${DATABASE_ROOT}/../version`).then((response) => response.text()),
    fetch(`${TRANSLATION_ROOT}/version`).then((response) => response.text())
]);

const namedById = new Map(namedCharacters.map((item) => [item.m_NamedType, item]));
const titleById = new Map(titles.map((item) => [item.m_TitleType, item]));
const characterById = new Map(characters.map((item) => [item.m_CharaID, item]));
const assetNames = new Set(assetBundles.map((item) => item.name));

function fullIllustrationName(id) {
    return `texture/charauiresource/charaillustfull/charaillust_full_${id}.muast`;
}

const nameSuffixes = {
    zh: {
        "水着": "泳装",
        "温泉": "温泉",
        "七夕": "七夕",
        "第2部": "第2部",
        "ブライダル": "婚礼",
        "成長版": "成长版",
        "大人版": "成人版"
    },
    en: {
        "水着": "Swimsuit",
        "温泉": "Onsen",
        "七夕": "Tanabata",
        "第2部": "Part 2",
        "ブライダル": "Bridal",
        "成長版": "Grown-up",
        "大人版": "Adult"
    }
};

const titleOverrides = {
    zh: {
        "RPG不動産": "RPG不动产",
        "スローループ": "Slow Loop",
        "ぱわーおぶすまいる。": "Power of Smile",
        "ぼっち・ざ・ろっく！": "孤独摇滚！",
        "まんがタイム": "Manga Time"
    },
    en: {
        "RPG不動産": "RPG Real Estate",
        "スローループ": "Slow Loop",
        "ぱわーおぶすまいる。": "Power of Smile",
        "ぼっち・ざ・ろっく！": "Bocchi the Rock!",
        "まんがタイム": "Manga Time"
    }
};

function translateName(source, translations, language) {
    if (translations[source]) {
        return translations[source];
    }
    const variant = /^(.*?)【([^】]+)】$/.exec(source);
    if (!variant) {
        return source;
    }
    const base = translations[variant[1]] || variant[1];
    const suffix = nameSuffixes[language][variant[2]] || variant[2];
    return `${base}【${suffix}】`;
}

function translateTitle(source, translations, language) {
    return titleOverrides[language][source] || translations[source] || source;
}

const cards = characters
    .filter((card) => card.m_CharaID % 10 === 0)
    .filter((card) => {
        const named = namedById.get(card.m_NamedType);
        return Boolean(named);
    })
    .map((card) => {
        const named = namedById.get(card.m_NamedType);
        const title = titleById.get(named.m_TitleType);
        const evolved = characterById.get(card.m_CharaID + 1);
        const hasEvolution = Boolean(
            evolved &&
            evolved.m_NamedType === card.m_NamedType &&
            evolved.m_Rare === card.m_Rare &&
            evolved.m_Class === card.m_Class &&
            evolved.m_Element === card.m_Element
        );
        if (!title) {
            throw new Error(`Missing title ${named.m_TitleType} for card ${card.m_CharaID}`);
        }
        return {
            id: card.m_CharaID,
            name: card.m_Name,
            nameZh: translateName(card.m_Name, translations, "zh"),
            nameEn: translateName(card.m_Name, englishTranslations, "en"),
            character: named.fullName || named.m_FullName || named.m_NickName,
            characterZh: translations[named.fullName || named.m_FullName || named.m_NickName] || named.fullName || named.m_FullName || named.m_NickName,
            characterEn: englishTranslations[named.fullName || named.m_FullName || named.m_NickName] || named.fullName || named.m_FullName || named.m_NickName,
            title: title.m_DisplayName,
            titleZh: translateTitle(title.m_DisplayName, translations, "zh"),
            titleEn: translateTitle(title.m_DisplayName, englishTranslations, "en"),
            titleId: named.m_TitleType,
            namedType: card.m_NamedType,
            resourceId: card.m_ResourceID,
            rarity: card.m_Rare + 1,
            evolvedId: hasEvolution ? evolved.m_CharaID : null,
            evolvedResourceId: hasEvolution ? evolved.m_ResourceID : null,
            hasFullIllustration: assetNames.has(fullIllustrationName(card.m_CharaID)),
            evolvedHasFullIllustration: hasEvolution && assetNames.has(fullIllustrationName(evolved.m_CharaID)),
            class: card.m_Class,
            element: card.m_Element,
            limited: Boolean(card.isPeriodLimited),
            distributed: Boolean(card.isDistributed),
            year: card.year || null
        };
    })
    .sort((left, right) => left.id - right.id);

const cardIds = new Set(cards.map((card) => card.id));
const characterIds = new Set(cards.map((card) => card.namedType));
const includedTitleIds = new Set(cards.map((card) => card.titleId));
const evolutionCount = cards.filter((card) => card.evolvedId !== null).length;
const originalCards = cards.filter((card) => card.titleId === ORIGINAL_TITLE_TYPE);
const originalCharacterIds = new Set(originalCards.map((card) => card.namedType));

if (cardIds.size !== cards.length) {
    throw new Error("Duplicate card IDs found in generated gacha data");
}
if (
    cards.length < 680 ||
    characterIds.size < 240 ||
    !includedTitleIds.has(ORIGINAL_TITLE_TYPE) ||
    originalCards.length !== 51 ||
    originalCharacterIds.size !== 21
) {
    throw new Error("Generated data failed completeness or original-character checks");
}

const includedTitles = titles
    .filter((title) => includedTitleIds.has(title.m_TitleType))
    .map((title) => ({
        id: title.m_TitleType,
        name: title.m_DisplayName,
        nameZh: translateTitle(title.m_DisplayName, translations, "zh"),
        nameEn: translateTitle(title.m_DisplayName, englishTranslations, "en")
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "ja"));

const payload = {
    meta: {
        databaseVersion: version.trim(),
        translationVersion: translationVersion.trim(),
        cardCount: cards.length,
        characterCount: characterIds.size,
        titleCount: includedTitles.length,
        evolutionCount,
        originalTitleType: ORIGINAL_TITLE_TYPE,
        originalCardCount: originalCards.length,
        originalCharacterCount: originalCharacterIds.size,
        sources: [
            "https://database.kirafan.cn/database/CharacterList.json",
            "https://database.kirafan.cn/database/NamedList.json",
            "https://database.kirafan.cn/database/TitleList.json",
            "https://database.kirafan.cn/assetBundle.json",
            "https://trans.kirafan.cn/zh.json",
            "https://trans.kirafan.cn/en.json"
        ]
    },
    titles: includedTitles,
    cards
};

const output = [
    "// Generated by scripts/generate-gacha-data.mjs. Do not edit by hand.",
    `window.kirafanGachaData = ${JSON.stringify(payload)};`,
    ""
].join("\n");

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, "utf8");

console.log(`Generated ${cards.length} cards / ${characterIds.size} characters / ${includedTitles.length} titles.`);
