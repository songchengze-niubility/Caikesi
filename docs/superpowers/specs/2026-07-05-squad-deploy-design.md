# 多人小队上阵系统 · 设计文档

> 日期：2026-07-05 · 阶段：色块占位 · 范围：**roster 从配置常量变玩家选择（选人 + 排站位 + 持久化 + 接战斗）+ 多人组合平衡重调**

## 背景与目标

项目此前切到「单人近战 dps 验收」（`battle.xlsx/Misc.roster=['dps']`），`sim:pacing` 的 10 关数值专为单人 dps 烤过种子。现在恢复多人小队，但不是纯自动分配——**玩家从固定职业角色里选谁参战（上阵）、并调整他们的前后站位顺序**。

用户已确认的边界：
- **角色池 = 现有固定职业角色**（tank/dps/healer，沿用 class=character 1:1，不做英雄收集、同职业不做多英雄）。
- **队伍上限 < 角色数**：现在 3 个角色、上限 2，**每场必须做取舍**（上阵 2 个、下阵 1 个）。上限做成配置值，以后加职业时改配置即可。
- **站位 = 一字阵前后顺序**（沿用设计日志「单排一字阵、分前后不分行」的既定约定，不做自由走位）。
- **改 roster 仅战前**（和装备「穿脱后重开战斗刷新属性」一致），战斗中不动。
- **本次连平衡一起重调**：以默认组合为基线重跑 `sim:pacing`，让默认组合三台阶（4/7/10 关）重新成立，替代组合可玩（不追求所有组合完美平衡）。

替代默认值（本设计替用户定，均配置/存档可改）：**`squadCap = 2`，默认出战 `tank+dps`**（前排肉 + 输出）。

## 架构总览

```
config/BattleConfig.ts              类型加 squadCap: number（roster 语义变为“默认出战组合”）
config/battle.config.generated.ts   Misc 导出新增 squadCap
squad/SquadModel.ts                 新建：纯逻辑——出战有序列表/板凳、上限约束、上阵/下阵/重排、序列化
core/data/DataService.ts            PlayerData 加 squad?: SquadSave（老存档兜底默认组合）
combat/BattleManager.ts             构造函数新增 roster 入参（有序 SoldierClass[]），_setupSquad 遍历它
BattleEntry.ts                      加载 SquadModel；_startBattle 传出战列表；渲染遍历出战列表；上阵面板 + NavSectHot 热区
tools/config-xlsx/battle.xlsx       Misc 表加 squadCap 一行
tools/pacing-sim.ts                 参数化：按出战组合构造多角色 effectiveStats；重调门槛
tools/squad-test.ts                 新建：SquadModel 纯逻辑单测
```

逻辑/渲染分离沿用项目纪律：`SquadModel` 纯逻辑不碰 cc、可 tsx 单测；`BattleManager` 只多收一个 roster 入参、不认识 UI；`BattleEntry` 负责加载/持久化/渲染上阵面板。

## ① 数据模型：`SquadModel`（纯逻辑）

新建 `assets/scripts/squad/SquadModel.ts`，纯逻辑不依赖 cc（照 `InventoryModel`/`ChestModel` 惯例）。

**状态**：`deployed: CharacterId[]`（有序，`deployed[0]` = 一字阵最前）。板凳 = `CHARACTERS` 里不在 `deployed` 的部分（派生，不单独存）。

**不变量**：`1 ≤ deployed.length ≤ squadCap`；元素唯一；每个元素 ∈ `CHARACTERS`。

**方法**（均返回操作是否成功，不抛异常，方便 UI 灰化按钮）：
- `deploy(id)`：把板凳角色加入出战末尾；已满（达 `squadCap`）返回 false。
- `undeploy(id)`：下阵；若下阵后出战为空返回 false（保底至少 1 人）。
- `move(id, toIndex)`：重排出战顺序（前后站位）。
- `isDeployed(id)` / `deployedList()` / `canDeploy()` 等查询。
- `serialize(): SquadSave` / 静态 `deserialize(save, squadCap): SquadModel`。

**兜底**：`deserialize` 对非法存档（空、超上限、含未知/重复 id、超过当前 `squadCap`）做修正——去重、过滤未知 id、截断到 `squadCap`、空则回落默认组合。因为 `squadCap` 可能被调小、角色池可能变化，反序列化必须自愈而非信任存档。

`SquadSave = { deployed: CharacterId[] }`。默认组合来源：读 `BattleConfig.roster`（配置里的「默认出战组合」）与 `squadCap` 取合法前缀；配置缺省再回落 `['tank','dps']`。

> ⚠️ 本次要把 `battle.xlsx/Misc.roster` 从当前的 `['dps']`（单人验收遗留）改回多人默认 `['tank','dps']`，否则「读 roster 前缀」得到的默认组合仍是单人，与 squadCap=2 及重调基线不符。

## ② 持久化

`PlayerData`（`core/data/DataService.ts`）加 `squad?: SquadSave`。老存档缺字段 → `defaultData` 合并模式天然兜底为 undefined → `SquadModel.deserialize(undefined)` 回落默认组合。存取复用 `PlayerDataStore` 缓存（和装备/进度共享，避免快照互相覆盖）。

## ③ 配置：`squadCap`

`battle.xlsx/Misc` 表加 `squadCap`（默认 2），`excel-to-config.ts` 的 battle parser 读入，`battle.config.generated.ts` 顶层导出。`BattleConfig` 类型加 `squadCap: number`。`roster` 字段保留但语义改为「默认出战组合」（长度可 > squadCap，`SquadModel` 取合法前缀）；同时把 `Misc.roster` 值从 `['dps']` 改回 `['tank','dps']`（见 §① 提示）。

## ④ 战斗接线

- **`BattleManager` 构造函数新增 roster 入参**（有序 `SoldierClass[]`），签名末位追加、缺省回退 `BattleConfig.roster`（保持现有调用/测试不破）。`_setupSquad()` 改遍历该入参而非 `BattleConfig.roster`。这是让 sim 与实战都能跑任意组合的关键接缝。因 class=character 1:1，roster 即 `SoldierClass[]`。
- **`BattleEntry`**：启动时 `SquadModel.deserialize(data.squad, squadCap)`；`_startBattle()` 把 `deployedList()` 传入 `new BattleManager(...)`；渲染侧 `BattleEntry.ts:446` 的 `for (const cls of BattleConfig.roster)` 改遍历出战列表，只建出战角色序列帧节点（`effectiveStats` 仍按 class key，天然对得上）。
- **时机**：改 roster 仅战前生效；上阵面板保存后，若不在结算页则 `_startBattle()` 重开刷新（复用穿脱装备的既有路径）。

## ⑤ 上阵 UI（色块占位期）

新面板 `SquadView`（Cocos 占位）：
- 列出全部角色，标记出战/板凳状态，显示上限（如「出战 2/2」）。
- 点板凳角色 → 上阵（满员时该操作灰化，需先下阵）；点出战角色 → 下阵（最后 1 人不可下阵）。
- 出战角色可调前后顺序（沿用装备 UI 已有的点选/拖拽风格，前=贴敌）。
- 保存写 `PlayerData.squad` → 触发战斗重开。

入口复用底部导航栏空闲热区（和合成当初复用 `NavSectHot` 同套路，具体热区到实现时确认）。布局细节留到实现阶段，若需迭代可用可视化伴侣出草图。

## ⑥ 平衡重调（和机制一起交付）

- `tools/pacing-sim.ts` 现在硬编码 `{ dps: {...} }`，改成**按出战组合参数化**：对每个出战角色套「期望套装平铺加成」（沿用现有 LOADOUTS 建模），构造多角色 `effectiveStats` 传进 `BattleManager`。
- 以**默认组合 tank+dps** 为主基线重跑，逐关调 `battle.xlsx` 怪物 hp 覆盖值，让三台阶（4/7/10 关）对默认组合重新成立；抽查一两个替代组合（如 dps+healer、tank+healer）不至于卡死或过易。
- 更新 sim 门槛（GATES/LOADOUTS 随组合调整），改完烤进种子，回归 `npm run sim:pacing`。
- **明确取舍**：不追求所有组合完美平衡，只保证默认组合过关顺畅、替代组合可玩。多角色叠加导致「战力≈能力平方」的悬崖会更陡（设计日志已记），逐关校准照旧。

## 验收

- `SquadModel` tsx 单测：上限约束、上阵/下阵保底、重排、非法存档自愈全绿。
- 现有 9 套 test（含 battle）+ `npm run config`（新增 squadCap）+ `npm run sim:pacing`（多角色参数化后默认组合 13 门槛复绿）全通过。
- 人工（Cocos 预览，列入待办）：上阵面板选人/排序/保存后战斗生效、老存档进入回落默认组合、下阵到 1 人保底。

## 不在本次范围

- 走位操作（位置仍是一字阵前后序，不做自由拖到战场任意点）。
- 角色升级 / 上阵名额随成长解锁（属「角色成长」方向，另开）。
- 英雄收集 / 同职业多英雄。
- 所有组合的精细平衡（只保证默认组合 + 抽查替代组合）。
