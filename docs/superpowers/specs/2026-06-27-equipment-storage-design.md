# 装备存储系统 · 设计文档

> 日期：2026-06-27 · 阶段：色块占位 · 范围：**纯存储层，不影响战斗数值**

## 目标与范围

给项目加一套装备的**存储与管理**子系统：装备掉落进背包、玩家在背包/仓库间转移、角色 5 个装备栏可穿脱。装备数据持久化到本地存储。

**本版明确不做**（边界）：
- 装备**不影响战斗数值**（穿上只是占位，不接 BattleManager/CombatFormula）。
- 装备**不带数值属性**（只有 部位 / 名字 / 品质）。
- 不建 `equip.xlsx`（内容用代码里的小占位池）。
- 掉落不接战斗（用调试按钮触发）。

> 下一版再做：装备影响战斗（effective-stats 计算层）、属性词条、equip.xlsx 定义、真实掉落触发、真实美术 UI。

## 架构总览

采用「独立数据模型 + Cocos 占位 UI 覆盖层」，保持项目单场景：

```
inventory/
  InventoryModel.ts    纯逻辑：背包/仓库/装备栏 + 掉落/转移/穿脱 + 序列化（可单测，不依赖 cc）
  EquipDefs.ts         部位/品质枚举 + 颜色 + 名字占位池 + 随机生成
  InventoryConfig.ts   小常量：格子上限等（方便调）
  InventoryView.ts     Cocos 节点占位 UI（色块格子 + Label + 按钮），驱动 Model、触发存盘
core/data/DataService.ts   PlayerData 扩展 inventory 字段（复用现有存档接缝）
BattleEntry.ts             加「背包」「掉落」两个按钮，挂 InventoryView 覆盖层
```

逻辑/渲染分离沿用项目纪律：`InventoryModel` 不碰渲染，`InventoryView` 只消费/驱动 Model。

## ① 数据模型 `inventory/InventoryModel.ts`

纯逻辑，无 `cc` 依赖，可单测。

```ts
type EquipSlot = 'weapon' | 'helmet' | 'chest' | 'pants' | 'shoes';   // 武器/头盔/胸甲/裤子/鞋子
type Quality   = 'common' | 'fine' | 'rare' | 'epic' | 'legend';       // 白/绿/蓝/紫/橙

interface EquipItem {
    id: string;        // 实例唯一 id
    slot: EquipSlot;   // 部位（决定能装到哪个装备栏）
    name: string;      // 占位名字
    quality: Quality;  // 品质（决定颜色）
}

interface InventoryModel {
    backpack: EquipItem[];                          // 背包，上限 backpackCap
    warehouse: EquipItem[];                         // 仓库，上限 warehouseCap
    equipped: Record<EquipSlot, EquipItem | null>;  // 5 个装备栏，一部位一格
}
```

操作（均返回 `{ ok: boolean; reason?: string }`，**满了/非法就失败，绝不静默丢装备**）：

| 操作 | 行为 | 失败条件 |
|------|------|----------|
| `dropRandom()` | 用 `EquipDefs.randomItem()` 造一件 → 进背包 | 背包满 |
| `toWarehouse(id)` | 背包 → 仓库 | 仓库满 / id 不在背包 |
| `toBackpack(id)` | 仓库 → 背包 | 背包满 / id 不在仓库 |
| `equip(id)` | 背包某件 → 对应部位装备栏；该部位原有装备**退回背包** | id 不在背包 / 退回时背包满 |
| `unequip(slot)` | 装备栏 → 背包 | 背包满 / 该栏为空 |

- `equip` 只能装到 `item.slot` 对应的栏；穿一件同时若原栏有装备则换下回背包——若背包此时已满，**整个操作失败回滚**（不产生半成品状态）。
- `serialize()` → 纯对象；`deserialize(obj)` 从存档恢复（缺字段用默认空兜底）。

## ② 装备生成 `inventory/EquipDefs.ts`

- `SLOTS`：5 部位 + 中文显示名。
- `QUALITIES`：5 档品质 + 颜色（白绿蓝紫橙的占位 RGB）。
- `NAME_POOL`：每部位一小撮占位名（如 武器：短剑/长剑/巨斧；头盔：皮帽/铁盔…），代码硬编码。
- `randomItem(): EquipItem`：随机部位 + 随机品质 + 从该部位池随机取名 + 生成唯一 id。

> 全部是占位内容，后续接 `equip.xlsx` 时整体替换，不影响 Model/UI 接口。

## ③ 持久化（复用 `DataService`）

- `PlayerData` 增加可选字段 `inventory?: InventorySave`（= `InventoryModel.serialize()` 的结构）。
- 启动：`DataService.load()` → 若有 `inventory` 则 `model.deserialize(...)`，否则空模型。
- 变更：任何成功的操作后调用 `save`（把 `model.serialize()` 合并进 `PlayerData` 存回）。
- 老存档缺 `inventory` → DataService 现有的「默认值兜底」机制自动补空，不报错。

## ④ UI `inventory/InventoryView.ts`（Cocos 节点占位）

覆盖层（默认隐藏，点 BattleEntry「背包」按钮开关）：

- **顶部装备栏区**：5 格，每格显示部位名 + 当前装备（色块按品质上色 + Label 名字，空栏显灰框）。
- **左：背包区**：网格色块格子，显示 `已用/上限`；每格 = 品质色块 + 名字 Label。
- **右：仓库区**：同上。
- **交互**：点格子选中（高亮）→ 下方按钮按上下文可用：`转移`（背包↔仓库，按选中所在区决定方向）/`穿`（背包选中 → 装备栏）/`脱`（装备栏选中 → 背包）。顶部有 `掉落`（调试）、`关闭`。
- 操作失败（如满了）→ 飘字/Label 提示原因。
- 纯色块占位风格，接美术时换 Sprite，不动 Model。

## ⑤ 接入 `BattleEntry.ts`

- 加两个按钮：「背包」（切换 InventoryView 显隐）、「掉落」（调 `model.dropRandom()`，调试用）。
- InventoryView 作为 BattleEntry 的子节点覆盖层创建。
- **战斗逻辑（BattleManager/CombatFormula）零改动。**

## 默认值（可调）

放 `inventory/InventoryConfig.ts`：

| 项 | 默认 | 说明 |
|----|------|------|
| `backpackCap` | 20 | 背包格子上限 |
| `warehouseCap` | 50 | 仓库格子上限 |
| 品质档 | 5（白绿蓝紫橙） | 颜色在 EquipDefs |
| 部位 | 5（武器/头盔/胸甲/裤子/鞋子） | 装备栏一部位一格 |
| 背包满掉落 | 失败 + 提示，不丢 | — |

## 测试

- `InventoryModel` 纯逻辑可单测：掉落进背包、背包满失败、转移双向、仓库满失败、穿戴换下回退、背包满时穿戴回滚、序列化/反序列化往返一致。
- 手动验证：网页预览里点掉落/转移/穿脱，刷新页面后数据仍在（持久化）。

## 不变量

- Model 不依赖 cc、不碰渲染；UI 不直接改数据结构，只调 Model 操作。
- 任何操作要么完整成功、要么完整失败回滚，不留半成品状态。
- 装备只能进对应部位的装备栏。
- 持久化只走 DataService 这一个接缝。
