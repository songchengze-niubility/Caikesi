# 心法（全局天赋树）系统 · 设计文档

> 日期：2026-07-12 · 阶段：色块占位 · 范围：**账号级天赋树"心法"——金币点小节点、首通材料点大节点，加成作用于所有上阵角色与全局产出；只做机制与占位数值，份额反解后置**

## 背景与目标

现有养成线：角色等级、装备（等级+合成）、镶嵌（宝石+装备铭文）。本次新增第四条**账号级**养成线：一棵天赋树，玩家消耗金币与专属材料点节点，加成覆盖战斗属性、经济产出、掉落概率、功能解锁四类，作用于**所有上阵角色 / 全局**。

**命名红线**：项目已有「铭文」指装备铭文位（inlay 线，卷轴打词条，2026-07-05 落地，数值框架份额 kInsc）。本系统对玩家展示名为**「心法」**，代码内部统一用 **`talent`** 命名，与 inlay 线互不相干、互不迁移。

用户已确认的边界（brainstorm 逐条敲定）：

| 决策点 | 结论 |
|--------|------|
| 与装备铭文关系 | **两条独立线**：装备铭文不动，新系统另起名「心法」 |
| 加成类别 | **四类全要**：战斗属性 / 经济产出（金币、经验、离线）/ 掉落概率（稀有装备）/ 功能解锁 |
| 分叉语义 | **不互斥，只是先后**：分叉只影响点树路径顺序，所有节点最终都能点满 → **无需重置功能** |
| 节点形态 | **混合**：小节点多级（3~5 级），大节点一次性解锁 |
| 成本 | 小节点**纯金币**；大节点金币 + 专属材料**秘笈残页**（`talent_page`） |
| 材料产出 | **关卡首通胜利掉落**（一次性供给对应一次性大节点） |
| 树规模 | 单树约 24 节点：主干 + 战斗/经济/掉落三主题分支 |
| 前置规则 | **前置节点点满才解锁后继**（导表校验引用存在、无环） |
| 功能大节点 | 第 3 上阵位（树最深处）/ 离线收益提升 / 宝箱扩容 / 自动卖白绿装（解锁开关，默认关） |
| 第 3 上阵位定位 | 树最深处，**第一章难度不重校**；第二章标定时再把 3 人队纳入数值模型 |
| 生效时机 | 与穿脱装备一致：下一场战斗重建 `EffectiveStats` 时吃到 |

## 架构总览（镜像 inlay 线模式）

```
tools/config-xlsx/talent.xlsx      新真源：Nodes 单表
tools/seed-talent-xlsx.ts          从零重建 talent.xlsx 种子脚本（npm run seed:talent）
tools/excel-to-config.ts           SOURCES 加一行 talent parser → talent.config.generated.ts
config/talent.config.generated.ts  导表产物（勿手改）
talent/TalentConfig.ts             纯计算：节点查询/每级成本/效果聚合/前置判定
talent/TalentModel.ts              纯逻辑 OpResult：learnNode（校验+扣费，失败不改）
talent/TalentStats.ts              纯函数查询面：statBonus / econBonus / dropBonus / isUnlocked
ui/panels/TalentPanel.ts           cc 占位面板（分支分列、tier 分行、灰显锁定）
tools/talent-test.ts               TalentConfig/TalentModel 纯逻辑单测
services/RewardTypes.ts            MaterialId 加 'talent_page'（秘笈残页）
progression/ProgressModel.ts       ProgressSave 加 maxClearedLevel（首通判定）
```

逻辑/渲染分离沿用项目纪律：`TalentConfig`/`TalentModel`/`TalentStats` 纯逻辑可 tsx 单测；`TalentPanel` 是唯一 import cc 的心法文件。消费方保持纯函数，心法值由组合根（`BattleEntry`/服务装配处）注入参数，不做全局单例。

## ① 配置（新真源 talent.xlsx，单张 Nodes 表）

| 列 | 说明 |
|---|---|
| `id` | 节点 id（如 `trunk_1` / `combat_atk` / `func_squad3`） |
| `label` | 中文名（如「吐纳」「剑意」「三才阵」） |
| `branch` | `trunk` 主干 / `combat` 战斗 / `economy` 经济 / `drop` 掉落 |
| `tier` | 层级（UI 排布用，同支内从 1 递增） |
| `prereq` | 前置节点 id，逗号分隔；**全部前置点满**才可点本节点 |
| `maxLevel` | 小节点 3~5，大节点 1 |
| `effectKind` | `stat` / `econ` / `drop` / `unlock` |
| `effectKey` | 见下表 |
| `valuePerLevel` | 每级效果值（百分比按 0~1 小数填，沿用 PERCENT_STATS 语义红线） |
| `goldBase` / `goldGrowth` | 第 n 级金币成本 = `round(goldBase × goldGrowth^(n-1))` |
| `pageCost` | 秘笈残页消耗（一次性，仅大节点 >0；多级节点必须为 0，导表校验） |

**effectKind × effectKey 合法组合**（导表校验）：

| kind | key | 语义 | 消费方 |
|------|-----|------|--------|
| `stat` | 任意 `EquipStatKey`（atkPct/hpPct/defPct/critRate/dmgBonus…） | 叠给每个上阵角色，走现有双层叠算 `(白板+固定)×(1+百分比)` 对应池 | `combat/EffectiveStats` |
| `econ` | `gold` | 战斗/结算金币 ×(1+Σ值) | 结算奖励装配（`LootService`/`BattleEntry`） |
| `econ` | `exp` | 战斗经验 ×(1+Σ值) | 同上 |
| `econ` | `offlineRate` | 离线收益 ×(1+Σ值) | `offline/OfflineCombatService` 装配处 |
| `drop` | `equipQuality` | 装备掉落/开箱时**蓝及以上**品质权重 ×(1+Σ值) 后重新归一 | `config/DropConfig.rollDropItems`（关卡掉落与 `ChestService` 开箱同路径吃到；合成 `CraftConfig.pickCraftQuality` **不受影响**） |
| `unlock` | `squadSlot3` | 上阵上限 +1（2→3） | `SquadModel` 装配处（`squadCap = BattleConfig.squadCap + 1`） |
| `unlock` | `chestCapacity` | 宝箱库存容量 +`valuePerLevel`（如 +20） | `ChestModel` 容量装配处 |
| `unlock` | `autoSell` | 解锁背包「自动卖白/绿装」开关（默认关） | `InventoryModel` 入包钩子 + 背包 UI |
| `unlock` | `offlineCap` | 离线时长上限 +`valuePerLevel` 秒（可选，首版可不配） | `OfflineConfig` 装配处 |

`TalentConfig.ts` 纯计算辅助：

```ts
talentNodes(): TalentNodeDef[]                       // 全节点（导表产物）
nodeById(id): TalentNodeDef | undefined
levelCost(node, nextLevel): { gold: number; pages: number }
canLearn(node, save): boolean                        // 前置全点满 && 未到 maxLevel
aggregate(save): TalentAggregate                     // 一次遍历聚合四类效果（见 ③）
```

**占位数值方向**（平衡后置，本计划不做调优）：小节点属性每级 1%~2%、金币/经验每级 3%~5%、品质概率每级 3%；金币成本对齐现有经济账（金币产出口径见 balance 快照），首版给能在第一章毕业前点掉主干+一条支的量级。

## ② 材料与产出（秘笈残页，关卡首通）

- `services/RewardTypes.ts`：`MaterialId` 加 `'talent_page'`，`MATERIAL_LABEL` 加「秘笈残页」。复用 materials 全套存储/显示/掉落机制，**不新增持久化结构**。
- `levels.xlsx` 加列 `firstClearPages`（普通关 1、Boss 关 2、章节关 3，占位）：**首次通关**该关时随胜利结算发放（进 `RewardBundle.materials`）。
- **首通判定**：现有 `ProgressSave` 只有 `currentLevel`/`maxUnlockedLevel`，最后一关无法推导是否已通（`completeLevel` 对末关不推进 maxUnlocked）。故 `ProgressSave` 加 **`maxClearedLevel: number`**（已实际通关的最高关卡 index，未通关任何关为 -1）：
  - 首通判定：`completedLevel > maxClearedLevel` ⇒ 首通，发残页并更新。
  - 单调性成立（只能打已解锁关卡，通关顺序不回退语义）。
  - **老档兼容**：缺失时默认 `maxUnlockedLevel - 1`（解锁之下视为已通）；若老档已通末关会被视为未通、多领一次末关残页——占位期无真实存量玩家，接受。
- 离线快速战斗**不发**首通残页（离线只结算重复收益，与首通语义一致）。

## ③ 存档与操作逻辑

**存档**：`PlayerData.talents?: Record<string, number>`（nodeId → 已点级数）。老档缺省 `{}`；读档时对未知 nodeId（配置删除后残留）静默忽略不崩。背包自动出售开关存 `PlayerData.autoSellLowQuality?: boolean`（默认 false）。

**`talent/TalentModel.ts`**（纯逻辑 OpResult 风格，fail-before-mutate，镜像 `InlayModel`）：

```ts
learnNode(save: TalentSave, nodeId, wallet: { gold }, materials): OpResult
```

- 校验：节点存在、未到 `maxLevel`、全部前置点满、金币 ≥ 本级成本、残页 ≥ `pageCost`（仅 0→1 级时收）。
- 成功：扣金币/残页、`save[nodeId] += 1`；任一校验失败不改任何状态。

**`talent/TalentStats.ts`** 纯函数聚合（供消费方注入）：

```ts
interface TalentAggregate {
    stats: EquipStats;                      // stat 类聚合（同装备词条形状）
    econ: { gold: number; exp: number; offlineRate: number };
    drop: { equipQuality: number };
    unlocks: { squadSlot3: boolean; chestCapacity: number; autoSell: boolean; offlineCap: number };
}
talentAggregate(save: TalentSave): TalentAggregate
```

## ④ 消费方接线（值由组合根注入，消费方保持纯函数）

| 消费方 | 改动 |
|--------|------|
| `combat/EffectiveStats.calcEffectiveStats` | 加可选参数（心法 stats）：每个上阵角色在装备词条外再叠这一份，走既有固定/百分比双层池，`normalizeStats` 钳制前累加 |
| 结算奖励装配（`BattleEntry` 胜利结算 & `LootService` 调用处） | gold/exp 乘 `(1+econ.gold)` / `(1+econ.exp)`，四舍五入 |
| `offline/OfflineCombatService` 装配处 | 离线金币/经验乘 `(1+econ.offlineRate)`；`offlineCap` 加到时长上限 |
| `config/DropConfig.rollDropItems` | 加可选参数 `qualityBonus`：蓝/紫/橙权重 ×(1+值) 后 `pickWeighted`（天然归一）。关卡掉落与开箱两条调用链都由装配处传入；**seed 复现语义**：同 seed + 同心法状态可复现（心法状态变化影响 roll 结果属预期，同现有"配置变了结果变"一致） |
| `squad/SquadPersistence` 装配处 | `squadCap = BattleConfig.squadCap + (unlocks.squadSlot3 ? 1 : 0)`；`SquadModel` 本身不感知心法。解锁后战斗生成/站位沿用现有 squadCap 驱动逻辑（前后排机制不变） |
| `chest/ChestModel` 装配处 | 容量 = 30 + `unlocks.chestCapacity` |
| `inventory/InventoryModel` 掉落入包链 | `unlocks.autoSell && PlayerData.autoSellLowQuality` 时，白/绿装入包即走现有 `sellItem` 链（含返石），奖励通知合并展示"已自动出售 N 件" |

**心法状态变更后**：与穿脱装备一致，不做局内无缝更新；点完节点回到战斗入口时由组合根重建各注入值。

## ⑤ UI（占位期，TalentPanel）

- 入口：战斗主界面 HUD 按钮行加「心法」（与背包/上阵/合成/宝箱并列），打开 `ui/panels/TalentPanel.ts`。
- 面板（色块+文字，镜像既有 panels 模式）：
  - 按 `branch` 分列（主干/战斗/经济/掉落）、`tier` 分行；节点显示 label、当前级/最大级、效果描述、下一级成本。
  - 前置未满 → 灰显不可点；可点 → 点击调 `TalentModel.learnNode`，成功后刷新 + 持久化（回调注入，同其他 panels）。
  - 顶部显示持有金币 / 秘笈残页数。
- 背包面板：`autoSell` 解锁后出现「自动出售白/绿装」开关。
- 占位期不画连线，靠列/行 + 前置灰显表达树结构；真实美术后置。

## ⑥ 首版树骨架（约 24 节点，占位）

```
主干 trunk（4 小节点，纯属性，逐段解锁三条分支的入口）
├─ 战斗支 combat（7 小节点：atk%/hp%/def%/critRate/dmgBonus… + 1 大节点「心法大成」一次性属性大额）
├─ 经济支 economy（4 小节点：gold%/exp% + 2 大节点：离线收益提升、自动卖白绿装）
└─ 掉落支 drop（4 小节点：equipQuality% + 1 大节点：宝箱扩容）
汇合 func_squad3「三才阵」：第 3 上阵位，前置 = 三支末端节点各点满（树最深处）
```

大节点残页定价对齐第一章首通总供给（10 关约 13 页，占位）：心法大成 2 / 离线 2 / 自动卖 2 / 宝箱扩容 2 / 三才阵 4，留 1 页余量给第二章开局。

## ⑦ 数值与门禁

- 首版全占位数值；**默认一点未点** → `sim:pacing`/`sim:progress` 不受影响（sim 不配置心法 loadout），13 项节奏门槛保持全绿。
- 属性类份额后续进 `balance.xlsx` 新增 talent 维度（与 kLevel/kEquip/kGem/kInsc 并列）反解，**本期不做**；届时 `tools/balance-model/templates.ts` 加心法形状模板。
- 第 3 上阵位不进第一章数值模型；第二章难度标定时纳入。

## 验收

- `talent-test.ts` tsx 单测：点节点成功扣费/前置未满失败不改/金币不足/残页不足/多级递增成本/点满拒绝/聚合四类效果/未知 nodeId 容忍/序列化兼容。
- 导表校验：prereq 引用存在且无环、effectKind×effectKey 组合合法、多级节点 pageCost=0、PERCENT 语义抽查。
- `ProgressModel` 单测补 `maxClearedLevel`：首通判定/末关首通/老档兜底。
- 现有全套 test + `npm run config` + `npm run verify` 全绿。
- 人工（Cocos 预览）：开心法面板→点小节点下一场战斗属性涨→首通关卡拿残页→点大节点（宝箱容量/自动卖/离线/第 3 位逐项生效）→切账号心法隔离。

## 实施偏差（2026-07-12 收尾回写）

- **自动卖开关放在心法面板内**而非背包面板：解锁节点「拂尘」后 TalentPanel 底部出现开关（发现路径就在解锁处，实现也不动 InventoryView）。存档字段 `PlayerData.autoSellLowQuality` 不变。
- **心法入口用主界面导航栏「主页」按钮**（`MainScreenView` 的 `NavMainHot`，原为 noop 占位）：实现期间 Codex 线已把 HUD 热区从 BattleStageView 迁入新的 `MainScreenView`，spec 里的「HUD 按钮行加入口」落到该处。
- **econ.gold 现阶段只作用于离线金币**：在线战斗胜利目前不产金币（金币来源=卖装+离线），心法金币加成挂在 `RewardBundle.gold` 统一链路上，未来在线金币产出加入后自动吃到。生财/聚宝节点短期体感偏弱，属已知占位。
- **首通判定实现**：`ProgressSave.maxClearedLevel` 老档兜底为 `maxUnlockedLevel-1`，已通关末关的老档会多领一次末关残页（占位期无真实玩家，接受）。
- **BattleEntry/BattleStageView/MainScreenView 与 Codex 美术线混编**：这三个文件同时含 Codex 未提交的主界面 UI 改动与本次心法接线，提交分组时需一并处理或由用户裁量。

## 不在本次范围

- 心法**数值平衡反解**（份额进 balance 框架另起计划）。
- 重置/洗点（分叉不互斥，无需求）。
- 树的真实美术与连线绘制（色块占位）。
- 第二章节点扩层、第 3 上阵位的难度重标定。
- 多棵树/多页签。
