# kirafan-timer

《闪耀幻想曲》（きららファンタジア / Kirara Fantasia）服务终止后的纪念站点：倒计时器、角色模型素材库、必杀演出还原等，全部从游戏资产离线重建。

- 站点首页：<https://nep1406886.github.io/kirafan-timer/>
- 倒计时器：<https://nep1406886.github.io/kirafan-timer/index.html>
- 模型素材库：<https://nep1406886.github.io/kirafan-timer/models.html>（1255 个角色模型 + 604 个敌人，5 个游戏动作/表情可调）
- 角色检查（战斗演出）：<https://nep1406886.github.io/kirafan-timer/game/actor.html>
- 必杀演出还原：<https://nep1406886.github.io/kirafan-timer/game/uniqueskill.html>
- 纪念召唤：<https://nep1406886.github.io/kirafan-timer/gacha.html>

非官方同人作品，与芳文社、EXNOA 无关。游戏资产版权归原权利方所有。

> 本项目最初基于上游 [icekirby/kirafan-timer](https://github.com/icekirby/kirafan-timer) 的活动倒计时器改造而来（灵感来源与起步代码），现已发展为独立的纪念站点，与上游功能基本不再重叠。

## 部署

推到 `master` 就由 [.github/workflows/static.yml](.github/workflows/static.yml) 上传到 GitHub Pages。

## 目录结构

```
index.html          倒计时器（data.js 维护活动数据）
models.html         模型素材库（asset/models/，tools/build_model_catalog.py 重建）
gacha.html          纪念召唤
game/               战斗演出：角色检查、必杀演出
asset/              游戏资产：模型、战斗、卡池、城镇、停服纪念图等
core/               加载器、音频、贴图修复等共享模块
tools/              资产转换与校验脚本（Unity bundle → glTF）
```

倒计时器的数据格式（`data.js` 中 `timersData` 各事件类型与查询参数）沿用上游的约定，编辑方式与上游文档一致。
