// 序章《最後の読み手》 -- docs/fangame-plan.md §8 turned into data.
//
// Every line is ours. The original game's adv/script files were read for how
// these characters speak and how a scene is staged, never copied: quoting them
// would make this transcription rather than 二创.
//
// Staging directives from the plan are commands here, in the same order, so the
// document and the running scene cannot drift apart.

export const PROLOGUE = [
    // ---- 白紙より ------------------------------------------------------
    { bgm: "bgm_Prologue_0", fade: 2600 },
    { bg: "white", ms: 0 },
    { wait: 900 },

    { speaker: null,
      ja: "この世界は、誰かに読まれることで出来ている。",
      zh: "这个世界，是由「被谁阅读」构成的。" },
    { speaker: null,
      ja: "女神ソラの記す聖典を人々が読み、そこからクリエを得て生きる。",
      // 索拉 and 克利耶 are the Chinese server's own terms, not ours: 索拉 from
      // the character list, 克利耶 from 克利耶梅特 (クリエメイト). Taken from
      // https://trans.kirafan.cn/zh.json so the Chinese track reads the way a
      // Chinese player already knows these words.
      zh: "女神索拉书写圣典，人们阅读它，从中获得克利耶而活。" },
    { speaker: null,
      ja: "——だから、読まれなくなった世界がどうなるかは、誰も考えたことがなかった。",
      zh: "——所以，没有人想过：不再被阅读的世界，会变成什么样。" },

    // 白色缓慢褪成图书馆的轮廓。逆光
    { bg: "library", transition: "fade", ms: 3200, light: "backlit" },
    { bgm: "bgm_adv_19_0", fade: 2000 },

    { speaker: null,
      ja: "言の葉の樹の、いちばん奥。",
      // zh.json has no entry for 言の葉の樹; 言叶之树 is the form the Chinese
      // community settled on, and it keeps 言葉 poetic rather than flattening it
      // to 语言. 神樹 -> 神树 in the official data shows the same plain approach.
      zh: "言叶之树的最深处。" },
    { speaker: null,
      ja: "図書館には、まだ灯がひとつだけ残っていた。",
      zh: "图书馆里，还剩着一盏灯。" },

    // ---- アルシーヴ ----------------------------------------------------
    { enter: "arcive", at: "center", face: "default", ms: 1400 },

    { speaker: "arcive", face: "default",
      ja: "いらっしゃい。……ずいぶん久しぶりのお客様ね。",
      zh: "欢迎。……真是久违的客人了。" },
    { speaker: "arcive",
      ja: "名乗らなくていいわ。あなたが何者かは、もう分かっているから。",
      zh: "不必自我介绍。你是什么人，我已经知道了。" },
    { speaker: "arcive",
      ja: "あなたは——読み手。",
      // 「読み手」is the term the plan coined for the player. It stays as-is in
      // Japanese; the Chinese track says 读者, because kana dropped mid-sentence
      // reads as broken text to a Chinese reader rather than as a coined name.
      zh: "你是——读者。" },

    { title: { ja: "白紙のエトワリア", zh: "白纸的埃托瓦利亚" }, kind: "title", ms: 3000 },

    { speaker: "arcive",
      ja: "この本を見てちょうだい。",
      zh: "你看看这本书。" },

    // 道具特写：一本摊开的聖典，右半页是空白的
    { focus: "seiten-blank", ms: 1600 },

    { speaker: "arcive",
      ja: "破られたわけじゃない。燃やされたわけでもない。",
      zh: "不是被撕掉的，也不是被烧掉的。" },
    { speaker: "arcive",
      ja: "ただ——誰も読まなくなった。それだけ。",
      zh: "只是——没有人再读了。仅此而已。" },
    { speaker: "arcive",
      ja: "聖典は、読まれることで文字を保つの。",
      zh: "圣典是靠「被阅读」来维持文字的。" },
    { speaker: "arcive",
      ja: "読まれない頁は、白紙に還る。そこに書かれていた子も、一緒に。",
      zh: "没被阅读的页，会回归白纸。写在那上面的孩子，也一起。" },

    // ---- ランプ と マッチ ----------------------------------------------
    { focus: null },
    { se: "footstep_run" },
    { bgm: "bgm_town_1_0", fade: 900 },
    { enter: "lamp", at: "left", face: "default", ms: 500 },
    { enter: "match", at: "farLeft", face: "default", ms: 500 },

    { speaker: "lamp",
      ja: "アルシーヴさん！　大変です、また一頁——",
      zh: "阿尔希芙女士！不好了，又有一页——" },

    // ランプ 注意到読み手
    { face: "lamp", to: "surprise" },
    { turn: "lamp", to: "camera" },

    { speaker: "lamp", face: "surprise",
      ja: "……あら？　あの、そちらの方は……",
      zh: "……咦？那个，这位是……" },
    { speaker: "arcive", face: "default",
      ja: "読み手よ。",
      zh: "是读者。" },

    // 表情：呆滞 → 激动
    { face: "lamp", to: "blank" },
    { wait: 700 },
    { face: "lamp", to: "joy" },

    { speaker: "lamp",
      ja: "読み手。読み手ですか。読み手！！",
      zh: "读者。是读者吗。读者——！！" },
    { speaker: "match",
      ja: "出たよ。ランプのこれ、聖典のキャラ見たときと同じ顔だぞ。",
      zh: "又来了。兰普这表情，跟她看见圣典角色时一模一样。" },
    { speaker: "lamp", face: "joy",
      ja: "だ、だって……！　聖典を読む人が、まだいたなんて……！",
      zh: "因、因为……！居然还有人在读圣典……！" },

    // 表情：转为郑重。深呼吸
    { face: "lamp", to: "default" },
    { wait: 800 },

    { speaker: "lamp",
      ja: "……失礼しました。わたし、ランプと申します。",
      zh: "……失礼了。我叫兰普。" },
    { speaker: "lamp",
      ja: "こっちはマッチ。自称・わたしの守護者です。",
      zh: "这位是玛琪。自称是我的守护者。" },
    { speaker: "match",
      ja: "自称じゃない。守護者だ。",
      zh: "不是自称。就是守护者。" },

    // 静默一拍。ランプ 表情转为不安
    { wait: 1200 },
    { face: "lamp", to: "sorrow" },

    { speaker: "lamp", face: "sorrow",
      ja: "……あの、聞いてもいいですか。",
      zh: "……那个，我可以问一句吗。" },
    { speaker: "lamp",
      ja: "読み手さんは——どこまで、覚えていますか。",
      // さん has no gender-neutral Chinese equivalent, and the player's is
      // unknown. Lamp's politeness is already carried by the previous line, so
      // the honorific is dropped rather than guessed at.
      zh: "读者——你还记得多少？" },

    // BGM 淡出。静默
    { bgm: null, fade: 1800 },
    { wait: 1600 },

    { speaker: "arcive",
      ja: "ランプ。",
      zh: "兰普。" },
    { speaker: "lamp",
      ja: "……すみません。でも、大事なことなんです。",
      zh: "……对不起。可是，这很重要。" },
    { speaker: "lamp",
      ja: "だって、覚えている人がいる頁は——まだ、白くならないから。",
      zh: "因为，还有人记得的页——就还不会变白。" },

    // ---- 図書館 外 -----------------------------------------------------
    { exit: "*", ms: 900 },
    { bg: "library-outside", transition: "fade", ms: 1600, light: "blownout" },
    { bgm: "bgm_adv_12_0", fade: 1400 },

    { enter: "kirara", at: "center", face: "default", turn: "away", ms: 1600 },
    { enter: "match", at: "right", face: "default", ms: 0 },
    { enter: "lamp", at: "farRight", face: "sorrow", ms: 0 },

    { speaker: "match",
      ja: "……きらら。またそこにいたのか。",
      zh: "……琪拉拉。你又在那儿啊。" },

    // きらら 转身。表情：微笑，但眼神疲惫
    { turn: "kirara", to: "camera" },
    { face: "kirara", to: "happy-tired" },

    { speaker: "kirara", face: "happy-tired",
      ja: "うん。ここ、いちばん絆がよく見える場所だから。",
      // 絆 does not carry over as 绊, which means "to trip" in Chinese. 羁绊 is
      // the term Chinese players use for this game's bonds, so it is used here
      // and everywhere else 絆 appears.
      zh: "嗯。这里是最能看清羁绊的地方。" },
    { speaker: "kirara",
      ja: "……前は、そうだったんだけどね。",
      zh: "……以前是这样的。" },
    { speaker: "lamp", face: "sorrow",
      ja: "きららさん、今日は……いくつ、見えますか。",
      zh: "琪拉拉，今天……能看见几条？" },

    { wait: 1500 },

    { speaker: "kirara",
      ja: "昨日より、みっつ少ない。",
      zh: "比昨天少了三条。" },

    // 笑容不变，但更淡
    { face: "kirara", to: "happy-faint" },

    { speaker: "kirara",
      ja: "わたしの力、絆を感じるものでしょう。",
      zh: "我的力量，就是感知羁绊的吧。" },
    { speaker: "kirara",
      ja: "だから——減っていくのも、いちばん先に分かっちゃうんだ。",
      zh: "所以——减少的时候，也是我最先知道。" },

    // きらら 看向読み手。表情：认真
    { turn: "kirara", to: "camera" },
    { face: "kirara", to: "serious" },

    { speaker: "kirara", face: "serious",
      ja: "ねえ、読み手さん。ひとつだけお願いしてもいい？",
      zh: "那个，读者。我可以拜托你一件事吗？" },
    { speaker: "kirara",
      ja: "わたしが白くなっても、いいの。順番だから。",
      zh: "我变白也没关系。这是顺序的事。" },
    { speaker: "kirara",
      ja: "でも——最後まで、読んでいてくれる？",
      zh: "但是——你能读到最后吗？" },

    // 玩家的第一个选择。两个答案都不改变序章走向 —— 它记录的是玩家的立场，
    // 后面章节会引用这个 flag，而不是在这里分叉。
    { choice: [
        { ja: "——読む。最後まで。", zh: "——我读。读到最后。",
          set: { promised: true }, goto: "promise" },
        { ja: "……約束は、しない。", zh: "……我不做承诺。",
          set: { promised: false }, goto: "noPromise" }
    ] },

    { label: "promise" },
    { speaker: "kirara", face: "happy-tired",
      ja: "……うん。ありがとう。じゃあ、ちゃんと最後まで書くね。",
      zh: "……嗯。谢谢你。那我会好好写到最后的。" },
    { goto: "ending" },

    { label: "noPromise" },
    { speaker: "kirara", face: "default",
      ja: "そっか。……そのほうが、きららは好きかも。",
      // きららは — she refers to herself in the third person, which Chinese does
      // not do naturally in this register, so it becomes plain 我 rather than a
      // literal 琪拉拉说不定. The character read is the same; the phrasing is not
      // borrowed.
      zh: "这样啊。……不过，我说不定更喜欢这个答案。" },
    { speaker: "kirara", face: "happy-tired",
      ja: "できない約束をする人、いっぱい見てきたから。",
      zh: "因为我见过太多，许下做不到的承诺的人了。" },

    { label: "ending" },

    // 镜头拉远。三人立于过曝的白色天空下
    { focus: "wide", ms: 2400 },
    { bgm: "bgm_adv_20_0", fade: 2200 },

    { speaker: null,
      ja: "——こうして、終わってから始まる物語が、始まった。",
      zh: "——于是，结束之后才开始的故事，开始了。" },

    { title: { ja: "序章「最後の読み手」", zh: "序章「最后的读者」" },
      kind: "chapter", ms: 3600 },
    { exit: "*", ms: 1200 },
    { bgm: null, fade: 2600 }
];

export const META = {
    id: "prologue",
    title: { ja: "最後の読み手", zh: "最后的读者" },
    cast: ["arcive", "lamp", "match", "kirara"],
    // Every background this chapter asks for, so a preloader can fetch them
    // before the first line rather than popping in mid-scene.
    backgrounds: ["white", "library", "library-outside"],
    bgm: ["bgm_Prologue_0", "bgm_adv_19_0", "bgm_town_1_0", "bgm_adv_12_0", "bgm_adv_20_0"]
};

export default PROLOGUE;
