// Who can appear on an ADV stage, and how each one is rendered.
//
// Names are separated from scripts on purpose: a line says `speaker: "lamp"`,
// and this table decides whether that renders as ランプ, 兰普, or both. Change
// the display mode and every script follows without being touched.
//
// `model` is a resourceId from asset/models/manifest.json (via core/cards.js),
// so a character on stage is the same 3D model the battle screen uses -- the
// approved 決策 4 ①「3D 模型当立绘」. Characters with no player model (マッチ is
// an NPC in the original too, ADV standpic only) carry `standpic` instead and
// the stage falls back to a flat slot.
//
// `card` records which card the model came from, because a resourceId alone
// does not say which head or class the actions have to match.

// Expression names for the principals, picked by hand.
//
// The keys are the game's own expression vocabulary -- default / angry / happy /
// joy / shy / sorrow / surprise / unique1-3 -- because that is what the original
// names its ADV face tiles, and a script written in those names renders both on a
// 3D model and on a flat standpic without a translation table in between. Names
// the game does not have (`talk`, `cry`, `serious`, `smile-tired`) are ours, kept
// because a 15-state 3D table can express things a 10-tile sheet cannot.
//
// core/actor.js can infer most of these from a state's layer composition, and
// that is what the other 235 characters use. But the inference ties `sorrow`
// against `serious` on every table -- the evidence genuinely does not separate
// them -- and `angry` and the `unique` slots have no compositional signature at
// all. These four carry the prologue, so their names are chosen rather than
// scored. Indices come from tools/check_face_names.py, which prints each state's
// composition; the reading of each is noted so a wrong guess can be corrected
// without re-deriving it.
//
// Provisional until seen: run game/faces.html to look at all of them at once.

const FACES_ARCIVE = {          // kirara_archives, 15 states
    "default": 0,               // eye_A brow_A mouth_A
    talk: 1,                    // + mouth open
    happy: 13,                  // eye_G(閉じ) brow_E mouth_F -- 目を閉じた微笑、彼女らしい
    "happy-faint": 10,          // eye_E(伏し目) brow_F mouth_F cheek
    shy: 10,                    // 同じ一枚: 頬が乗る唯一の笑み
    joy: 13,
    serious: 2,                 // brow_B, mouth shut -- 郑重
    sorrow: 6,                  // eye_E brow_D mouth_A -- 伏し目で沈んだ
    surprise: 5,                // eye_D brow_C mouth_E
    angry: 2,                   // 彼女は怒鳴らない。強い郑重が彼女の怒り
    blank: 6,
    cry: 8
};

const FACES_LAMP = {            // kirara_lump, 16 states
    "default": 0,
    talk: 1,
    surprise: 5,                // eye_D brow_A mouth_E -- 「……あら？」
    shout: 6,                   // mouth_F 全開 -- 大声を出す用
    blank: 13,                  // eye_F だけ変化、口は閉じ -- 呆滞
    joy: 4,                     // cheek + eye_C + mouth_B -- 「読み手！！」
    happy: 10,                  // cheek + brow_C -- 照れ笑い
    shy: 10,                    // 同じ一枚。ランプの笑顔は基本照れている
    sorrow: 7,                  // brow_B mouth_C -- 不安
    serious: 2,                 // brow_E mouth_C -- 深呼吸してからの郑重
    angry: 6,                   // 大声のほう。怒るというより慌てて叫ぶ
    cry: 8
};

const FACES_KIRARA = {          // kirara_kirara, 15 states
    "default": 0,
    talk: 1,
    happy: 4,                   // cheek + eye_H + mouth_E -- 満面
    joy: 4,
    // 「微笑，但眼神疲惫」: 伏し目 + 頬 + 口は閉じたまま。笑ってはいるが
    // 目が笑っていない、という状態がこの一枚で出る。
    "happy-tired": 10,          // eye_F brow_E mouth_A cheek
    shy: 10,
    // 「笑容不变，但更淡」: 目を閉じてしまう。同じ笑顔なのに、見ていない。
    "happy-faint": 12,          // eye_G brow_C mouth_H cheek
    serious: 7,                 // brow_C mouth_F、頬なし -- 「読んでいてくれる？」
    sorrow: 2,                  // brow_B mouth_C
    surprise: 5,
    angry: 7,                   // きららが怒った顔は用意されていない
    cry: 8
};

export const CAST = {
    // 主线三人 + アルシーヴ。全部沿用原作性格与关系。
    kirara: {
        ja: "きらら", zh: "琪拉拉",
        model: 320005, head: 2, card: 32002020,   // きらら【第2部】: 序章在第一部之后
        faces: FACES_KIRARA,
        cv: "楠木ともり"
    },
    lamp: {
        ja: "ランプ", zh: "兰普",
        model: 320111, head: 3, card: 32012040,   // ランプ【第2部】
        faces: FACES_LAMP,
        cv: "高野麻里佳"
    },
    match: {
        ja: "マッチ", zh: "玛琪",
        // No player model exists: マッチ is an NPC in the original as well, and
        // only ever appears as an ADV standpic. Not a gap in the conversion.
        // asset/original-characters.js gives no official Chinese name for her,
        // so 玛琪 is ours -- flagged rather than passed off as canon.
        // Key into asset/story/standpic-index.json, written by
        // tools/convert_standpic.py: asset/story/standpic/match/<expr>.webp,
        // one file per expression with the face already composited on.
        standpic: "match",
        cv: "三森すずこ"
    },
    arcive: {
        ja: "アルシーヴ", zh: "阿尔希芙",
        model: 320801, head: 1, card: 32082000,   // 基础 ★5，第一部封印女神的那个她
        faces: FACES_ARCIVE,
        cv: "沢城みゆき"
    },

    // 旁白没有立绘也没有名牌 —— speaker: null 走这条路，这里只留一个占位，
    // 让 validate() 不把 narration 报成未知角色。
    narrator: { ja: "", zh: "" }
};

// Stage slots the prologue uses. Kept here rather than in the script so the
// same three-person composition can be reused by later chapters.
export const SLOTS = {
    left: { x: -1.35, y: 0, z: 0, turn: 18 },
    center: { x: 0, y: 0, z: 0, turn: 0 },
    right: { x: 1.35, y: 0, z: 0, turn: -18 },
    // 読み手 stands where the camera is, so anyone addressing the player turns
    // to face it. There is deliberately no slot for the player.
    farLeft: { x: -2.1, y: 0, z: -0.6, turn: 22 },
    farRight: { x: 2.1, y: 0, z: -0.6, turn: -22 }
};

export function castEntry(id) {
    return CAST[id] || null;
}
