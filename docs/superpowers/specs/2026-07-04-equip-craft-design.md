# 装备等级 + 材料合成系统 · 设计文档

> 日期：2026-07-04 · 阶段：色块占位 · 范围：**装备新增等级维度 + 用材料合成装备**

## 背景与目标

宝箱系统已产出三种材料（打造石/宝石碎片/铭文粉尘，`PlayerData.materials`），但目前没有任何消耗出口。本版给材料加一个消耗方向：**用材料合成装备**。

明确边界（用户已确认）：
- **装备不做强化**：不存在"消耗材料给已穿装备加成"的玩法，已生成的装备属性终身不变。
- **所有装备都要有"等级"**，不只是合成出来的——掉落/宝箱开出的装备也要带等级。等级与品质是两个独立叠乘维度。
- 合成时**玩家选部位**，**选等级档位**（决定材料消耗），**品质随机**（按档位权重表）。
- 掉落装备的等级**暂不接关卡**，先独立随机区间；关卡系统扩展时再把区间挂到 `levelIndex`。

## 架构总览

```
config/EquipConfig.ts        新增等级系数计算，calcEquipItemStats 签名加 level 参数
config/equip.config.generated.ts   新增 LevelScaling 字段（growthPerLevel/maxLevel）
config/DropConfig.ts         rollDropItems 按 dropGroup 的 levelMin/levelMax 随机等级
config/drop.config.generated.ts    DropGroups 新增 levelMin/levelMax
config/CraftConfig.ts        新增：档位类型定义 + 品质权重查表（纯计算，引用生成产物）
config/craft.config.generated.ts   新增导表产物：Tiers + QualityWeights
craft/CraftService.ts        新增：纯逻辑 craftEquipment(materials, tierId, slot, rng)
inventory/EquipDefs.ts       EquipItem 加 level 字段；ensureEquipItemStats 顺带补 level 兜底
inventory/InventoryView.ts   列表卡片/详情/差值对比展示格式加 Lv.{level}
BattleEntry.ts               新增 CraftView 覆盖层 + NavSectHot 热区接入
tools/config-xlsx/craft.xlsx       新建：Tiers、QualityWeights 两表
tools/config-xlsx/drop.xlsx        DropGroups 表加两列
tools/config-xlsx/equip.xlsx       新增 LevelScaling 表
tools/excel-to-config.ts     SOURCES 新增 craft 一条
tools/seed-craft-xlsx.ts     新建：craft.xlsx 种子脚本
tools/craft-test.ts          新建：CraftService 纯逻辑单测
```

逻辑/渲染分离沿用项目纪律：`CraftService`/`CraftConfig` 不碰渲染，`BattleEntry` 只负责调用、持久化、渲染面板。

## ① 装备等级 + 属性缩放

`EquipItem`（`inventory/EquipDefs.ts`）新增字段：

```ts
export interface EquipItem {
    id: string;
    slot: EquipSlot;
    name: string;
    quality: Quality;
    level: number;      // 新增：装备等级，1..maxLevel
    stats?: EquipStats;
    locked?: boolean;
}
```

属性计算公式扩展为 **部位基础 × 品质倍率 × 等级系数 × roll**，等级系数用线性公式：

```
levelCoefficient(level) = 1 + (level - 1) * growthPerLevel
```

`growthPerLevel`、`maxLevel` 进 `equip.xlsx` 新增的 `LevelScaling` 表（单行常量表，风格同 `battle.xlsx` 的 `Misc`）。默认值：`growthPerLevel = 0.03`（每级 +3% 基础属性），`maxLevel = 30`。

`calcEquipItemStats` 签名从 `(slot, quality, rng)` 扩展为 `(slot, quality, level, rng)`；`EquipConfig.ts` 内部把 `levelCoefficient(level)` 乘进 `addStat` 的系数链路（基础词条和附加词条都吃等级系数，与品质倍率并列相乘，不是叠加）。

`createEquipItem`/`randomItem`（`EquipDefs.ts` 里目前给调试用的随机生成）也要接受/生成 `level`，避免调用方漏传导致运行时报错——默认给 `level=1` 或传入范围随机，具体看调用点（调试用途，允许简单处理）。

**迁移**：`ensureEquipItemStats` 现在只补 `stats`，改成同时兜底 `level`：老存档没有 `level` 字段时按 `level: 1` 处理。函数签名/调用点不变，只加一行兜底逻辑。

## ② 掉落/宝箱装备的等级区间

`drop.xlsx` 的 `DropGroups` 表新增两列 `levelMin`/`levelMax`。产物 `drop.config.generated.ts` 每个分组多两个字段。

`DropConfig.rollDropItems(dropGroup, rng)` 在为每件装备生成属性前，先在 `[levelMin, levelMax]` 区间内均匀取整生成 `level`，再传入 `calcEquipItemStats(slot, quality, level, rng)`。

因为 `ChestService.openChest` 也是靠 `chest.sourceDropGroup` 调用 `rollDropItems`（见 `chest/ChestService.ts:81`），所以**这一处改动同时覆盖"通关掉落"和"宝箱开箱"两条产出路径**，不需要给宝箱单独加逻辑。

初始区间（先给两个现有分组一个合理默认值，后续接关卡再精调，不阻塞本功能验收）：
- `level_1`：`levelMin=1, levelMax=10`
- `level_2`：`levelMin=6, levelMax=15`

## ③ 合成配置 `craft.xlsx` → `CraftConfig.ts`

新建 `tools/config-xlsx/craft.xlsx`，走现有多源导表约定（`tools/excel-to-config.ts` 的 `SOURCES` 清单加一行）。两张表：

**Tiers**（档位表）：

| 字段 | 说明 |
|------|------|
| `tierId` | 档位 id，如 `tier_1`/`tier_2`/`tier_3` |
| `label` | 展示名，如"初阶"/"中阶"/"高阶" |
| `levelMin`/`levelMax` | 该档合成出的装备等级区间 |
| `costForgeStone` | 消耗打造石数量 |
| `costGemShard` | 消耗宝石碎片数量（低档为 0） |
| `costRuneDust` | 消耗铭文粉尘数量（低档/中档为 0） |

初始 3 档，材料需求对齐现有材料稀有度（打造石所有宝箱都产，宝石碎片需 boss 箱，铭文粉尘需章节箱）：
- `tier_1`（1-10 级）：只消耗打造石。
- `tier_2`（11-20 级）：打造石 + 宝石碎片。
- `tier_3`（21-30 级）：打造石 + 宝石碎片 + 铭文粉尘。

具体数值先给占位（如 tier_1 消耗 10 打造石，tier_2 消耗 20 打造石+3 宝石碎片，tier_3 消耗 30 打造石+6 宝石碎片+2 铭文粉尘），策划后续在 Excel 里调。

**QualityWeights**（品质权重表）：`tierId` × `quality` → `weight`，结构与 `drop.xlsx` 现有的 `QualityWeights` 表一致。档位越高权重越往史诗/传说偏，初始给一个偏低品质的默认分布，具体数值同样后续调。

`config/CraftConfig.ts` 只保留类型定义 + 纯计算：

```ts
export interface CraftTierConfig {
    tierId: string;
    label: string;
    levelMin: number;
    levelMax: number;
    cost: Partial<Record<MaterialId, number>>;
}

export function pickCraftQuality(tierId: string, rng: () => number): Quality;
export function rollCraftLevel(tierId: string, rng: () => number): number;
```

## ④ 合成服务 `craft/CraftService.ts`

纯逻辑，不依赖 `cc`，可单测：

```ts
export interface CraftResult {
    ok: boolean;
    reason?: string;        // 材料不足 / 档位非法 / 部位非法
    item?: EquipItem;
    remainingMaterials?: MaterialSave;
}

export function craftEquipment(
    materials: MaterialSave,
    tierId: string,
    slot: EquipSlot,
    rng: () => number = Math.random,
): CraftResult;
```

行为：
1. 查 `CraftConfig` 拿到档位的材料成本；成本任一项超过 `materials` 持有量 → 返回 `{ ok: false, reason: '材料不足' }`，**不扣任何材料**（失败不留半成品，沿用项目一贯纪律）。
2. 材料足够 → 从 `materials` 深拷贝一份并扣除对应数量，作为 `remainingMaterials` 返回（调用方负责写回 `PlayerData.materials`，不在这里碰持久化）。
3. 用 `rollCraftLevel(tierId, rng)` 随机等级、`pickCraftQuality(tierId, rng)` 随机品质、传入的 `slot` 固定部位，调 `calcEquipItemStats(slot, quality, level, rng)` 生成属性，`id` 用 `EquipDefs.makeId()`（现有生成器，时间戳+自增序列保证唯一）。
4. 合成永不"失败出空"——材料够就一定产出一件装备，只有等级/品质是随机的。

`rng` 默认 `Math.random`，不用宝箱那套 `createSeededRng`：宝箱要支持离线批量模拟和可复现，合成是玩家实时点击触发的一次性行为，不需要跨会话可重放，沿用 `EquipDefs.randomItem()` 现有的 `Math.random` 默认值风格即可。

`BattleEntry` 侧调用后，装备走现有"背包满进仓库、都满则整体失败"逻辑放入库存（复用 `InventoryModel`/`InventoryService` 现成方法，不新写放置逻辑），材料的 `remainingMaterials` 直接覆盖写回 `PlayerData.materials` 并保存。

## ⑤ UI：入口与展示

**入口**：复用底部导航栏当前仍是 `noop` 的 `NavSectHot` 热区（`BattleEntry.ts:359`），改成打开合成面板，不新增美术资源（符合项目色块占位阶段约定）。

**`CraftView`**（新覆盖层，结构参考现有 `ChestView`/`_renderChestPanel` 模式）：
- 顶部展示三种材料当前持有量。
- 3 个档位按钮（初阶/中阶/高阶），选中后显示该档消耗的材料明细，材料不足的项高亮标红。
- 5 个部位按钮（武器/头盔/胸甲/裤子/鞋子），选中要合成的部位。
- "合成"按钮：材料不足时置灰不可点；点击后调用 `craftEquipment`，成功则更新材料显示、展示结果卡片（部位/品质/等级/属性），装备已放入背包（或仓库）。
- 面板打开/关闭、层级管理复用 `_battleRoot` 容器 + `setSiblingIndex` 置顶的现有模式（设计日志 2026-06-28 条已定的规则）。

**装备等级展示**：所有展示装备的地方统一格式 `Lv.{level} {品质} {名字}`（如 `Lv.18 优秀 长剑`），涉及：
- `InventoryView` 背包/仓库列表卡片。
- 选中装备详情面板。
- 同部位已穿装备的差值对比面板。
- 宝箱开箱结果卡片、合成结果卡片。

## ⑥ 测试计划

- 新建 `tools/craft-test.ts`：
  - 材料充足 → 正确扣除、产出装备等级落在档位区间内。
  - 材料不足 → 返回失败、`materials` 原样不变（不能被部分扣除）。
  - 品质权重抽样：跑多次统计各品质出现比例大致符合权重表方向（非精确断言，允许容差）。
  - 非法 `tierId`/`slot` → 返回失败而非抛异常。
- 扩展 `tools/drop-config-test.ts`：验证 `rollDropItems` 产出的装备 `level` 落在对应 `dropGroup` 的 `[levelMin, levelMax]` 区间内。
- `tools/effective-stats-test.ts`/`tools/inventory-test.ts`：补充老存档缺 `level` 字段时按 1 兜底的断言（沿用现有"补 stats"测试用例的写法加一条）。
- `npm run config` 跑通新增的 `craft.xlsx` 导表 + `drop.xlsx`/`equip.xlsx` 新增字段的校验（缺字段/引用不存在要报错阻断，沿用现有导表器校验风格）。

## 不在本版做（边界）

- 装备强化/精炼（消耗材料给已穿装备加成）——本版明确排除。
- 掉落等级挂钩关卡 `levelIndex`——先独立随机区间，接关卡时再改 `drop.xlsx` 的区间生成方式（不改这里定的数据结构）。
- 宝石镶嵌、铭文技能系统——本版材料的其余潜在用途，留到后续单独设计。
- 合成消耗动画/特效——先用现成弹层交互，视觉后置。
