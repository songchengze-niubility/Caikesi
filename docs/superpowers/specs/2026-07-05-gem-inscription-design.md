# 镶嵌（宝石）+ 铭文系统 · 设计文档

> 日期：2026-07-05 · 阶段：色块占位 · 范围：**装备加宝石孔 + 铭文位，宝石按类型/等级镶入（可插拔），铭文靠卷轴随机打入（可覆盖）；只做机制，平衡后置**

## 背景与目标

装备成长的第二条线（第一条是等级+合成，已落地）。现有 `craft.xlsx`/`RewardTypes.ts` 的材料命名是 `gem_shard`（宝石碎片）/`rune_dust`（铭文粉尘），属于"碎片攒够换合成"的中间材料——与本次确定的方向冲突：

- **宝石**：可直接镶嵌的道具，**按类型分属性、按等级分强弱**（越高级加成越大），不再是碎片。
- **铭文**：消耗**卷轴**道具，随机打一条效果到装备的铭文位上。

本次落地这两个系统的机制，替换掉 `gem_shard`/`rune_dust` 两种材料定义。

用户已确认的边界（brainstorm 逐条敲定）：

| 决策点 | 结论 |
|--------|------|
| 槽位模型 | **两组独立槽位**：宝石孔 + 铭文位互不占用对方位置 |
| 槽位数量 | **按品质浮动**（白/绿/蓝/紫/橙 各有各的孔数） |
| 宝石形态 | **分类型**：每类型固定映射一个战斗属性，同类型分 1~N 级，加成随等级增大 |
| 宝石可逆 | **可取出重用**：拔出退回背包，可换到别的装备上 |
| 铭文效果 | **使用时随机**：卷轴不写死效果，消耗后从池里随机抽一条 roll 出数值 |
| 铭文覆盖 | **可覆盖重抽**：再用一卷就重抽该位（旧效果丢弃） |
| 获取来源 | **复用宝箱掉落**：没入新掉落入口，和现有材料一样从宝箱开出 |
| 数据落点 | **方案 A**：宝石/铭文数据挂在 `EquipItem` 上，跟着装备实例走 |
| 宝石存储 | **A1**：宝石按"类型_等级"拆成一批新 `MaterialId`，复用 materials 全套机制 |
| UI 入口 | **从装备详情进**：背包选中装备详情加「镶嵌」按钮 → 开独立 `InlayView` 聚焦该装备 |

## 架构总览

```
inventory/EquipDefs.ts        EquipItem 加 gemSockets? / inscriptions?；GemSocket/InscriptionEffect 类型
services/RewardTypes.ts       MaterialId 删 gem_shard/rune_dust，加 gem_<type>_<level> 一批 + rune_scroll
inlay/InlayConfig.ts          新建：socketCounts(quality) / gemStatValue(type,level) / rollInscription(rng)
inlay/InlayModel.ts           新建：socketGem / unsocketGem / applyInscription（OpResult）+ ensureInlaySlots(item)
inlay/InlayStats.ts           新建：itemInlayStats(item): EquipStats（宝石+铭文加成汇总，纯函数）
inlay/InlayView.ts            新建：cc 占位面板（从装备详情「镶嵌」按钮打开，聚焦一件装备）
combat/EffectiveStats.ts      calcEffectiveStats 每件装备贡献 = item.stats + itemInlayStats(item)
inventory/InventoryModel.ts   掉落入包/读档时调 ensureInlaySlots 补空孔；出售前退回已镶宝石
inventory/InventoryView.ts    选中装备详情加「镶嵌」按钮 → 回调开 InlayView
chest/ChestService.ts         CHEST_REWARD_PROFILE 扩产宝石/卷轴（替换 gem_shard/rune_dust 产出）
config/CraftConfig.ts + craft.xlsx  合成成本里的 gem_shard/rune_dust 引用一并替换（见"迁移"）
tools/config-xlsx/inlay.xlsx  新真源：Gems/SocketCounts/Inscriptions 三表
tools/seed-inlay-xlsx.ts      从零重建 inlay.xlsx 种子脚本
tools/excel-to-config.ts      SOURCES 加一行 inlay parser → inlay.config.generated.ts
tools/inlay-test.ts           InlayModel/InlayConfig 纯逻辑单测
```

逻辑/渲染分离沿用项目纪律：`InlayConfig`/`InlayModel`/`InlayStats` 纯逻辑可 tsx 单测；`InlayView` 是唯一 import cc 的镶嵌文件。宝石/铭文是**平铺加成**，走和装备词条同一条 `EffectiveStats` 路径，不新开战斗公式，也不与角色/装备等级缩放叠乘（那两者只动 base 与生成期属性）。

## ① 数据模型（挂在 EquipItem 上）

```ts
// EquipDefs.ts
export type GemType = 'atk' | 'hp' | 'def' | 'crit' | 'dmg';   // 起手 5 类（占位，Excel 可增删）
export interface GemSocket { type: GemType; level: number }     // 只记类型+等级，加成值由 InlayConfig 现算
export interface InscriptionEffect { stat: EquipStatKey; value: number }  // 卷轴抽定后固定存这（同装备词条形状）

export interface EquipItem {
    // ...现有 id/slot/name/quality/level?/stats?/locked? 不变...
    gemSockets?: (GemSocket | null)[];         // 长度 = 该品质宝石孔数；null=空孔
    inscriptions?: (InscriptionEffect | null)[]; // 长度 = 该品质铭文位数；null=空位
}
```

- **宝石按类型+等级等价**：两颗 Lv.2 攻击宝石完全一致 → 用 `MaterialId` 计数堆叠即可，不需要每颗独立 id。
- **孔位长度 = 品质派生**：孔数只由品质决定（品质不可变），所以数组长度天然稳定，无迁移问题。空孔存 `null` 占位。

## ② 宝石存储（A1：拆细 MaterialId）

`services/RewardTypes.ts`：

```ts
export type GemType = 'atk' | 'hp' | 'def' | 'crit' | 'dmg';   // 复用/re-export EquipDefs 的定义
export type MaterialId =
    | 'forge_stone'                          // 打造石（保留）
    | 'rune_scroll'                          // 铭文卷轴（替换 rune_dust）
    | `gem_${GemType}_${1 | 2 | 3 | 4}`;     // gem_atk_1..gem_dmg_4（替换 gem_shard）
```

- 删掉 `gem_shard` / `rune_dust`。
- 宝石背包/宝箱掉落/材料显示全部复用现有 `MaterialItem`/`MaterialSave`/`MATERIAL_LABEL` 机制——**A1 的核心收益**：不新建任何材料存储代码。
- **`MaterialId` 必须是有限联合**（因为 `MATERIAL_LABEL` 是 `Record<MaterialId, string>`，无限模板类型无法作 Record 键），故等级范围写死 `${1|2|3|4}`。**这带来一处耦合红线**：`MaterialId` 的等级范围与 `Gems.maxLevel` 必须一致——起手统一 `maxLevel=4`；将来调宝石等级上限时，要同步拓宽这个联合类型的 `${1|2|3|4}`，否则超范围等级会产出未登记 `MaterialId`。运行时构造 `gem_${type}_${level}` 与该类型字符串一致（模板类型里的数字字面量即其字符串形式）。
- `MATERIAL_LABEL` 的 gem 条目**由代码按 `GemType × 等级` 循环生成**（不手写 20 行）后 `as Record<MaterialId,string>` 断言，仍是有限穷尽；`gem_atk_2` → "攻击宝石·Lv.2"，`rune_scroll` → "铭文卷轴"。
- **宝石只存类型+等级，不存 stat**：`GemSocket` 记 `{type, level}`，具体加成属性由 `InlayConfig.gemStatKey(type)` 从配置现查——改配置里某类型的 stat 映射，已镶宝石的效果随之变（config-driven，与项目既有"存 key、值由配置现算"一致）。
- 枚举总量 = 宝石类型数 × 等级数 + 2（起手 5×4+2 = 22 项，个位数类型/等级下可接受；真长到几十种再评估拆独立存储）。

## ③ 配置（新真源 inlay.xlsx，走现有导表管线）

三张 sheet：

| sheet | 列 | 说明 |
|------|------|------|
| `Gems` | `type / label / stat / baseValue / maxLevel` | 每个宝石类型映射到哪个战斗属性；宝石加成 = `baseValue × level` |
| `SocketCounts` | `quality / gemSockets / inscriptionSlots` | 每品质两组独立孔数 |
| `Inscriptions` | `stat / valueMin / valueMax` | 铭文效果池；打铭文时随机抽一行、在区间内 roll 出 value |

**占位数值**（平衡后置，本计划不做数值调优）：

- `Gems`：`atk→atk baseValue=30`、`hp→hp baseValue=120`、`def→def baseValue=8`、`crit→critRate baseValue=0.02`、`dmg→dmgBonus baseValue=0.03`，各 `maxLevel=4`。
- `SocketCounts`（gemSockets / inscriptionSlots）：白 `1/0`、绿 `1/1`、蓝 `2/1`、紫 `2/1`、橙 `3/2`。
- `Inscriptions`：从 `atk/hp/def/critRate/critDmg/dmgBonus/dmgReduce` 各配一条 min/max 区间。

> **数值语义红线**：百分比类属性（`PERCENT_STATS`：attackSpeed/critRate/critDmg/dodgeRate/blockRate/blockRatio/dmgBonus/dmgReduce）在代码里是 0~1 小数，配 `baseValue`/`valueMin` 时按小数填（暴击 2% 填 `0.02` 而非 `2`）。

`InlayConfig.ts` 纯计算辅助：

```ts
socketCounts(quality): { gemSockets: number; inscriptionSlots: number }
gemStatValue(type, level): number        // baseValue[type] × clamp(level,1,maxLevel)
gemStatKey(type): EquipStatKey           // 该宝石类型映射的属性
rollInscription(rng): InscriptionEffect  // 从 Inscriptions 池抽一条并 roll value
```

## ④ 操作逻辑（inlay/InlayModel.ts，纯逻辑 OpResult 风格）

三个操作，成功即改、失败不留半成品（镜像 `InventoryModel`）：

- `socketGem(item, socketIndex, gemType, gemLevel, materials): OpResult`
  - 校验孔位合法、材料背包有 ≥1 颗 `gem_<type>_<level>`。
  - 若该孔已有宝石 → 先把旧宝石 +1 退回 materials，再扣 1 新宝石、写入孔位。
  - 材料不足 / 非法孔位 → 失败不改。
- `unsocketGem(item, socketIndex, materials): OpResult`
  - 该孔宝石 +1 退回 materials，孔位置 `null`；空孔 → 失败。
- `applyInscription(item, slotIndex, materials, rng): OpResult`
  - 校验有 ≥1 `rune_scroll`；扣 1 卷轴，`rollInscription(rng)` 抽一条**覆盖**写入该位（旧效果丢弃）；无卷轴 → 失败。

`ensureInlaySlots(item): EquipItem` —— 把 `gemSockets`/`inscriptions` 补齐到该品质应有的长度（幂等、保留已有格、多余截断）。由 `InventoryModel` 在**掉落入包**和**读档**两处调用，和现有 `ensureEquipItemStats` 完全并列 → 任何进包装备都有正确长度的空孔，UI/逻辑不用再对账。

## ⑤ 战斗接入（EffectiveStats）

`inlay/InlayStats.ts` 新增纯函数：

```ts
itemInlayStats(item: EquipItem): EquipStats  // 汇总：Σ 宝石(gemStatKey→gemStatValue) + Σ 铭文({stat,value})
```

`combat/EffectiveStats.ts` 的 `calcEffectiveStats`：每件装备的贡献从 `item.stats` 改为 `item.stats + itemInlayStats(item)`，仍在 `normalizeStats` 钳制之前累加。宝石/铭文与装备词条同池、同路径；与角色等级缩放（只放大 base 的 hp/atk）、装备生成期等级系数互不干扰，无叠乘顺序问题。

## ⑥ 出售 / 持久化 / 兼容

- **出售**：卖装备（`sellItem`/`sellBatch`）前把已镶宝石逐颗退回 materials（materials 无上限，退回永远安全），再执行出售；**铭文随装备消失**（卷轴烧出的效果、非可回收道具，与"卷轴消耗品"定位一致）。批量卖白绿同理。
- **持久化**：`gemSockets`/`inscriptions` 跟着 `EquipItem` 走现有 InventoryModel 序列化/深拷贝；gem `MaterialId` 与 `rune_scroll` 走现有 `PlayerData.materials`——**不新增持久化文件**。
- **老存档兼容**：
  - 缺 `gemSockets`/`inscriptions` 的装备 → 读档 `ensureInlaySlots` 补空孔。
  - 老存档里的 `gem_shard`/`rune_dust` 计数 → 枚举移除后 UI 只遍历现有 `MaterialId`，旧键静默忽略、不崩（materials 是普通对象，读不会报错）。不做主动数据迁移（占位期无真实存量玩家）。

## ⑦ 宝箱产出（复用现有掉落，扩 ChestService）

`chest/ChestService.ts` 的 `CHEST_REWARD_PROFILE`（现为硬编码占位，代码地图已注"后续可配置化"）：

- `forge_stone` 产出保留。
- 移除 `gem_shard` / `rune_dust` 产出，替换为：
  - **宝石**：按宝箱档位随机产一颗宝石——类型从配置的宝石集合里随机挑、等级按宝箱档位缩放（普通→低级、Boss→中级、章节→高级），构造 `gem_<type>_<level>` 加入 materials。
  - **卷轴**：Boss/章节宝箱产 1~N 个 `rune_scroll`。
- 产出**保持与现在同样的硬编码占位性质**（和既有 forge_stone 档位一样，真实掉率随平衡后置一并配置化）。
- seed 复现语义不变（沿用现有 `createSeededRng` 分道）。

## ⑧ UI（占位期，InlayView 从装备详情进）

- `inventory/InventoryView.ts`：选中装备的详情面板加一个「镶嵌」按钮，回调把选中装备 id 传出。
- `inlay/InlayView.ts`：cc 占位面板（色块+文字，镜像 `CraftView`/`SquadView`），聚焦一件装备，展示其宝石孔/铭文位现状，提供：
  - 每个宝石孔：空孔 → 选类型+等级镶入（列出背包持有的 gem 材料）；已镶 → 取出。
  - 每个铭文位：显示当前效果；「打铭文」按钮消耗 1 卷轴覆盖重抽。
- 操作走 `InlayModel` → 写回 materials + inventory → 关闭面板时通知刷新 InventoryView 详情（属性变了）。战斗数值在下一场 `_startBattle` 重建 `EffectiveStats` 时吃到（与穿脱装备一致，不做局内无缝更新）。

## 迁移（gem_shard / rune_dust 退场）

移除这两个 `MaterialId` 会波及现有引用，一并处理：

- `services/RewardTypes.ts`：删两键、删对应 `MATERIAL_LABEL`。
- `chest/ChestService.ts`：`CHEST_REWARD_PROFILE` 改为产 gem/scroll（见 ⑦）。
- `config/CraftConfig.ts` + `craft.xlsx`：现有合成档位成本若引用 `gem_shard`/`rune_dust`，改为引用 `forge_stone`（合成只保留打造石成本）或新宝石键——**合成与镶嵌是两条独立线，合成成本不应依赖宝石**，故改为只用 `forge_stone`；对应重跑 `seed:craft` + `npm run config`。
- 任何 tsx 测试/种子脚本里的旧材料引用一并替换。

> 具体每个引用点由实现计划（writing-plans）逐一列出并验证编译通过。

## 验收

- `InlayConfig`/`InlayModel`/`InlayStats` tsx 单测：镶入/占用孔覆盖退回/取出/铭文覆盖重抽/材料不足失败不改/宝石+铭文加成汇总/ensureInlaySlots 补齐幂等/出售退回宝石。
- 现有全套 test + `npm run config`（新增 inlay 模块）+ `npm run sim:pacing`（宝石/铭文默认不进 sim loadout，13 门槛不受影响）通过。
- 类型检查：移除 `gem_shard`/`rune_dust` 后全仓库无残留引用编译错误。
- 人工（Cocos 预览，列入待办）：装备详情开镶嵌面板、镶入宝石属性涨、取出退回背包、打铭文随机出效果、覆盖重抽、卖掉镶了宝石的装备后宝石回背包。

## 不在本次范围

- 宝石/铭文/掉率的**数值平衡重调**（占位值先跑通机制，折进 `pacing-sim` 逐关重调留待办）。
- 宝石合成/升级（低级宝石合成高级）——宝石只从宝箱按各等级掉，不做融合。
- 多种卷轴类型（先只做一种通用 `rune_scroll`）。
- 清空铭文位而不覆盖（覆盖即唯一变更手段，无"卸铭文"操作）。
- 套装效果、宝石同色套装加成等高级机制。
- 玩家账号等级、其他成长线（另属独立方向）。
