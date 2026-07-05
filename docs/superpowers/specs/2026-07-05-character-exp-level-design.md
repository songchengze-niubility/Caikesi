# 经验 → 角色升级系统 · 设计文档

> 日期：2026-07-05 · 阶段：色块占位 · 范围：**击杀产经验 → 喂上阵角色升级 → 等级抬角色战斗属性（只做机制，平衡后置）**

## 背景与目标

击杀怪物的掉落里除宝箱外还有**经验**，经验用于给**上阵角色**升级——这就是玩家的成长线（**明确不做玩家账号等级**）。现状：`PlayerData.exp` 是放置 demo 遗留的**全局死计数**，只有离线 `expPerWin` 往里空转累加，没有任何东西消费它；在线击杀/通关目前不产经验（`generateStageReward` 只出装备）。

用户已确认的边界：
- **经验分配**：一次击杀的经验，**每个上阵角色各得全额**（并行升级）；下阵角色不得经验。
- **等级只抬 hp + atk**（与装备/pacing 的战力模型同轴，其它维度暂不随等级动）。
- **经验战斗结束提交**（胜/负都保留击杀所得）。
- **本次只做机制，不重调平衡**：角色等级会额外抬战力、让现有 10 关随练度变简单，标为待办；`pacing-sim` 保持纯装备档位（不传角色成长）故本次交付后仍全绿。
- 无玩家账号等级；镶嵌/铭文是另一条线，不在此。

## 架构总览

```
config/BattleConfig.ts              类型加 charGrowth: CharGrowthConfig；EnemyType 加 exp
config/battle.config.generated.ts   Misc 导出新增 charGrowth；EnemyTypes 各加 exp
growth/CharGrowthConfig.ts          新建：等级系数/经验曲线纯计算（引用生成产物，镜像 EquipConfig.levelCoefficient）
growth/CharacterGrowthModel.ts      新建：纯逻辑——每角色 level/exp、gainExp 连续升级、封顶、存档自愈
growth/CharacterGrowthPersistence.ts 新建：接 PlayerData.charGrowth
core/data/DataService.ts            PlayerData 加 charGrowth?（旧全局 exp 保留不删、不再用）
combat/EffectiveStats.ts            buildEffectiveStatsMap 新增可选 growth 参数：先按等级缩放 base 再加装备
BattleEntry.ts                      消费 enemyKilled 累计本场经验、结束提交给上阵角色；传 growth 进 effectiveStats；SquadView 行显示 Lv.N
offline/OfflineClaimService.ts      离线 exp 改喂上阵角色（按 data.squad），不再写全局 exp
tools/config-xlsx/battle.xlsx       Misc 加 charGrowth.* 四个标量；EnemyTypes 加 exp 列
tools/seed-battle-xlsx.ts           MISC_ROWS/ENEMY_ROWS 同步
tools/excel-to-config.ts            battle parser 读 charGrowth + EnemyTypes.exp
tools/char-growth-test.ts           新建：CharacterGrowthModel 纯逻辑单测
```

逻辑/渲染分离沿用项目纪律：`CharacterGrowthModel`/`CharGrowthConfig` 纯逻辑可 tsx 单测；`EffectiveStats` 只多收一个可选参数、保持向后兼容；`BattleEntry` 负责事件消费/持久化/面板显示。

## ① 经验来源

- **`EnemyType` 加 `exp` 字段**（EnemyTypes 表加一列）：每种怪死亡给的经验，Boss 配更高。
- **在线**：`BattleEntry` 已在 `drainEvents()` 循环里逐个消费 `enemyKilled`（现有掉宝箱处，约 `BattleEntry.ts:2250`）。在同处按 `event.enemyType` 查 `BattleConfig.enemyTypes[...].exp` 累计到本场经验计数 `_battleExpGained`。
- **提交时机**：战斗结束（`won` 或 `lost` 都算）把 `_battleExpGained` 给**每个上阵角色各一份全额**，经 `CharacterGrowthModel.gainExp` 落库并存档。打到一半失败也保留。
- **离线**：`OfflineClaimService` 现有 `data.exp += reward.exp` 改为——按 `data.squad` 取出战列表，给每个上阵角色 `gainExp(reward.exp)`，写回 `data.charGrowth`；不再写全局 `exp`。

## ② 数据模型：`CharacterGrowthModel`（纯逻辑）

新建 `growth/CharacterGrowthModel.ts`，纯逻辑不依赖 cc。

**状态**：`Record<CharacterId, { level: number; exp: number }>`（`exp` = 当前等级内已积累、未满下一级的经验）。

**方法**（不抛异常，便于 UI）：
- `gainExp(id, amount)`：累加经验，`while (exp ≥ expToNext(level) && level < maxLevel) { exp -= expToNext(level); level++ }`；封顶后经验不再累加（截断）。返回是否升级（供飘字）。
- `levelOf(id)` / `expOf(id)` / `expToNext(level)`。
- `serialize(): CharGrowthSave` / 静态 `deserialize(save, config): CharacterGrowthModel`——对非法存档自愈（未知/缺失 id 补 Lv.1、负值归零、超 maxLevel 截断）。

`CharGrowthSave = Record<CharacterId, { level: number; exp: number }>`。`PlayerData.charGrowth?` 缺省 → 全角色 Lv.1/0。`growth/CharacterGrowthPersistence.ts` 提供 `loadGrowth()`（注入 `BattleConfig.charGrowth`）/`saveGrowth(model)`，复用 `PlayerDataStore`。

## ③ 等级 → 属性（镜像装备等级先例）

新建 `growth/CharGrowthConfig.ts`，镜像 `EquipConfig.levelCoefficient`：
- `charLevelCoef(level) = 1 + (max(1, floor(level)) - 1) × charGrowth.statGrowthPerLevel`
- `expToNext(level) = round(charGrowth.expBase × charGrowth.expGrowthPerLevel^(level-1))`（几何增长）
- `clampCharLevel(level)`：`1 ≤ level ≤ charGrowth.maxLevel`

`EffectiveStats.buildEffectiveStatsMap(equipped, growth?)` 新增可选 `growth`：对每个角色，`base' = { ...base, hp: base.hp × coef, atk: base.atk × coef }`（其余维度不变），再叠加装备（现有逻辑不变）。
- **关键接缝**：`pacing-sim` 不传 `growth` → 纯装备档位、既有平衡烤值不受影响、sim 仍全绿；`BattleEntry` 传 `growth`（当前存档）→ 实战吃到等级加成。向后兼容（旧调用少一个参数照常工作）。

## ④ 成长配置

`battle.xlsx/Misc` 加四个点分 key（镜像 `squadCap` 的 Misc 机制）：`charGrowth.expBase`、`charGrowth.expGrowthPerLevel`、`charGrowth.statGrowthPerLevel`、`charGrowth.maxLevel`。`excel-to-config.ts` 组装进 `charGrowth`，`BattleConfig` 类型加 `charGrowth: { expBase; expGrowthPerLevel; statGrowthPerLevel; maxLevel }`。`EnemyType` 类型加 `exp: number`，EnemyTypes 解析读该列。初值先给保守占位（`expBase≈50`、`expGrowthPerLevel≈1.15`、`statGrowthPerLevel≈0.05`、`maxLevel≈30`），数值平衡列入待办。

## ⑤ UI

英雄/上阵面板 `SquadView`（已存在）每个角色行追加 `Lv.N`（满级显示 `Lv.N·满`；未满可附 `exp/expToNext` 小字）。升级/存档后 `_drawSquadPanel` 重画即刷新。可选轻量"升级"飘字后置（YAGNI，先不做）。

## ⑥ 平衡（本次不做）

只交付机制。角色等级抬战力会让现有 10 关随练度变简单——**待办**：后续把"每关预期角色等级"折进 `pacing-sim` 的 LOADOUT（像装备档位那样把角色等级贡献的 hp/atk 加进去）再逐关重调。本次因 sim 不传 growth，交付后 `sim:pacing` 仍全绿。

## 验收

- `CharacterGrowthModel` tsx 单测：单次跨多级连升、封顶不溢出、存档自愈、序列化往返。
- 现有全套 test + `npm run config`（新增 charGrowth/EnemyTypes.exp）+ `npm run sim:pacing`（不传 growth 仍全绿）通过。
- 人工（Cocos 预览，列入待办）：击杀后上阵角色经验涨、够了升级、面板 Lv 刷新、战斗属性随等级变强；离线收益把经验给上阵角色；老存档进入全角色 Lv.1。

## 不在本次范围

- 角色等级的平衡重调（折进 pacing-sim + 逐关调，待办）。
- 玩家账号等级（明确不做）。
- 升级飘字/特效、角色技能随等级解锁/升级。
- 镶嵌 / 铭文（另一条线）。
- 等级抬 hp/atk 以外的维度。
