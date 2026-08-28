# 四作并行开发大纲

> 配套文档：[fangame-plan.md](fangame-plan.md)（设定考据 / 剧情 / 玩法提案）
> 本文只讲怎么造。**待批准，尚未动手。**

---

## 一、素材侦察结论

远程索引 `https://database.kirafan.cn/assetBundle.json` 共 **39,669** 条。
你说的没错，城镇模型确实有 —— D 的硬伤解除了。

| 类别 | 条数 | 状态 | 用于 |
| --- | --- | --- | --- |
| `model/player` | 1255 | ✅ 已转换 | A B C D |
| `model/enemy` | 604 | ✅ 已转换 | A C |
| `model/weapon` | 267 | ✅ 已转换 | A |
| `audio/bgm` | 70 | ✅ 已在库 | 全部 |
| `prefab/town/building` | 129 | ⬜ 待转 | **D（解锁项）** |
| `prefab/room` | 1402 | ⬜ 待转 | D（家具/摆件） |
| `prefab/room/anime` | 5 | ⬜ 待转 | **D（角色走动动画）** |
| `adv/background` | 617 | ⬜ 待转 | B C D |
| `adv/standpic` | 7528 | ⬜ 待转（需抽子集） | B |
| `battle/battlebg` | 36 | ⬜ 待转 | A |
| `effect` | 475 | ⚠️ 部分可用 | A |
| `uniqueskill` | 1190 | ⬜ 待转 | A（とっておき 演出） |
| `adv/script` | 7692 | ⚠️ 需定策 | 见第五节决策 3 |
| `texture` | 17192 | ⬜ 按需 | 全部 |

`prefab/room/anime` 里的 `roombody0_common` / `roomhead0..3_common` 和现有转换器
已经在处理的 `common_menu_body` 是同一套结构 —— 也就是说**城镇里角色能站能动，不用新写管线**。

---

## 二、架构：怎么让四个能真的并行

并行的前提是**先把公共层抽出来**。否则四个人同时改 `models.js` 必然打架。

```
core/                     ← 阶段 0 产出，之后冻结接口
  loader.js       模型加载：gz 解压 / meshopt / 材质 alpha / 表情层（从 models.js 抽）
  actor.js        角色实例：换装 / 表情 / 播动作 / 挂武器
  cards.js        685 张卡的查询与筛选（职业/属性/作品/稀有度）
  audio.js        BGM 交叉淡入 + 语音播放（从 gacha.js 抽）
  i18n.js         ja/zh/both 三档切换
  save.js         localStorage 存档，四作共用一个命名空间
  adv.js          对话引擎：文本框/立绘位/表情/选项  ← A B C D 都要用
  ui.js           公共控件：按钮/面板/加载条

game/
  rpg/     提案 A  时间轴战术 RPG
  adv/     提案 B  章节制 ADV
  tower/   提案 C  図書館 解谜 Roguelite
  town/    提案 D  エトワリア 城镇重建

game.html                 ← 新增：四作入口 hub
```

**现有 `index.html` / `gacha.html` / `models.html` 完全不动。**
`core/loader.js` 是从 `models.js` **复制**出来再整理，不是原地重构 ——
这样 `models.html` 保持可用，也不会成为并行开发的争用点。

### 冻结的接口（阶段 0 一旦定稿就不改）

```js
await Core.loader.load(assetKey)        // → { scene, animations, expressions }
Core.actor.create(cardId)              // → actor.play('attack') / actor.face('smile')
Core.cards.query({ class:0, element:3 })
Core.audio.bgm('bgm_battle_12_0', { fade:1200 })
Core.i18n.mode = 'both'                // 'zh' | 'ja' | 'both'
Core.adv.run(scriptArray)              // → Promise，播完一段剧本
Core.save.get('rpg') / .set('rpg', obj)
```

---

## 三、阶段划分

### 阶段 0 — 地基（串行，唯一的瓶颈）

必须先做完，因为四作都依赖它。两条线可同时进行：

- **0a 素材管线**：扩展 `tools/convert_kirafan_model.py`，新增
  `--kind town|room|roomanim|advbg|standpic|battlebg`。
  静态网格（building / 家具）走现有 weapon 那条路，基本是加个前缀。
  背景与立绘是纯贴图 → 转 WebP。
- **0b core 抽取**：从 `models.js` / `gacha.js` 抽出上面八个模块，接口定稿。

### 阶段 1 — 四作并行（各自独立目录，互不接触）

每作先做到**最小可玩闭环**，不做内容填充：

| | 最小闭环定义 |
| --- | --- |
| A | 1 场 5v3 战斗能打完：时间轴转、四指令、属性克制、とっておき、胜负判定 |
| B | 序章能从头播到尾：立绘/表情/BGM/双语切换/自动播放 |
| C | 図書館 3 层能爬完：出题→答对入队/答错永久失去→结算入档 |
| D | 城镇能走能建：3 栋建筑、克莉耶 收集、修复动画、1 个角色住进去 |

### 阶段 2 — 内容填充（仍并行）

A 填角色技能与关卡；B 填 1〜最終章剧本；C 填题库；D 填建筑与居民。

### 阶段 3 — 收束（串行）

`game.html` hub、四作互通（**図書館 是枢纽**：B 解锁的章节喂给 C 的题库，
C 找回的角色喂给 A 的可用队伍，A 通关的章节点亮 D 的建筑）、统一存档、性能与移动端。

---

## 四、体积预算（要紧）

现在仓库 3.4G，其中 `asset` 817M + `audio` 60M。全量转换会失控，必须限额：

| 项 | 策略 | 预估 |
| --- | --- | --- |
| 已有模型 | 不动 | 817M |
| `adv/background` | 617 张 → WebP q80，按章节懒加载 | ~120M |
| `adv/standpic` | **不全转**。只取主线＋六部对应作品，约 800 张 | ~60M |
| `prefab/town` | 129 栋全转 | ~40M |
| `prefab/room` | 只取城镇需要的约 200 件 | ~25M |
| `battle/battlebg` | 36 张全转 | ~15M |
| `uniqueskill` | 只取实装角色的 | ~30M |
| **合计** | | **~1.2G** |

GitHub Pages 软上限 1G、单文件 100M。**1.2G 会超。**
所以第五节决策 1 必须先定，否则阶段 0a 白做。

---

## 五、开工前要你定的四件事

### 决策 1：体积超限怎么办（**阻塞阶段 0a**）

- **① 只转子集**（推荐）—— 六部作品＋主线，控制在 ~700M 以内，Pages 直接能部署。
- ② 素材走远程 —— 从 `asset.kirafan.cn` 直连，仓库只放代码。体积零负担，
  但依赖对方服务器存活，且离线不可用。
- ③ 分仓库 —— 主仓放代码，素材仓放资源，Pages 跨仓引用。
- ④ 无视上限先做，之后再削。

### 决策 2：`effect` 那 475 个特效

Unity 粒子系统没法直接搬进 three.js。两条路：
- **① 抽贴图，用 three.js 重写简版特效**（推荐）—— 能还原七八成观感，工作量可控。
- ② 跳过特效，靠模型动作＋镜头震动＋闪白撑演出。A 的手感会弱一些，但能快很多。

### 决策 3：`adv/script` 那 7,692 份原作剧本怎么用（**影响 B 和 C**）

- **① 只做解析器，用来查角色语气和演出手法参考，成品台词全部自己写**（推荐）——
  这样是干净的二创。
- ② 直接引用原作台词做 C 的题库（「谁说过这句话」）—— 还原度最高，
  但等于搬运原文，性质从二创偏向转载。
- ③ 完全不碰。

### 决策 4：B 的角色用 2D 还是 3D

- **① 3D 模型当立绘**（推荐）—— 表情系统已经能用，且和 A/C/D 共用一套资源。
- ② 用 `adv/standpic` 官方立绘 —— 最还原，但多 60M，且与其他三作资源不通。
- ③ 混合：日常用 3D，关键剧情用官方立绘。

---

## 六、并行方式

阶段 1 的四个模块目录互不重叠，可以开四条线同时做。如果你要我用子 agent 并行推，
说一声我就开四个；默认我按 A→B→C→D 的顺序自己连续做完（总时长更长，但过程你能逐个 review）。

阶段 0 无论如何是串行的，且必须先完成。

---

## 七、我需要的回复

最少只要回决策 1，我就能开工阶段 0。其余三个可以边做边定。
如果四个决策都按推荐项走，直接说「按推荐来」即可。
