# 角色天赋系统（chartalent）设计

日期：2026-07-12
状态：已与用户对齐待实施
关联：`talent/` 心法（账号级全局天赋树，本系统与其并存不互改）、`growth/` 角色成长、`combat/PassiveSystem`

## 1. 背景与目标

角色（职业 1:1，现 tank/dps/healer 三职业）已有独立等级/经验（1~100 级）。本系统为**每个角色**提供一棵职业专属天赋树：

- 技能点来源：角色每升 1 级得 1 点（Lv.1 为 0 点，满级 99 点）。
- 节点两类：**属性节点**（加战斗属性）与**被动节点**（学习被动技能）；全部可多级，每级花 1 点。
- 学习要求：**仅角色等级门槛**（节点按等级分层解锁），无节点连线依赖、无金币/材料消耗。
- 支持**免费洗点**（一键重置本角色全部投点）。
- 树总容量 > 点数供给（约 128 点容量 vs 99 点），满级也点不满，**强制流派取舍**；配合免费洗点随时换流派。

与心法的边界：心法是账号级、双币种（金币+残页）、prereq 连线、加成作用全队；角色天赋是角色级、纯技能点、等级门槛分层、加成只作用本角色。两套系统代码互不依赖。

## 2. 用户决策记录

| 议题 | 决定 |
|------|------|
| 树的归属 | 职业专属树（每职业内容不同） |
| 前置条件 | 只有角色等级门槛（无节点连线、无消耗品） |
| 节点形态 | 全部可多级（被动也分级，每级递进数字参数） |
| 洗点 | 支持，免费 |
| 容量 vs 点数 | 容量 > 点数，强制取舍 |
| UI 入口 | SquadPanel 每角色天赋入口 + 主界面加天赋按钮（首版挂左上角角色头像热区，独立按钮图后置给 Codex） |

## 3. 系统规则

### 3.1 技能点

- 点数**不单独存档**，派生计算：`可用点数 = (角色等级 − 1) − 已投总点数`。
- 天然兼容老存档：已练级角色自动有点可用；等级来自 `CharacterGrowthModel`。
- 洗点 = 清空该角色投点记录，点数余额自动回满，无消耗无冷却（点击需二次确认防误触）。

### 3.2 树结构（每职业一棵）

- 节点按**等级门槛分层**（tier），占位分层：Lv.1 / 5 / 10 / 20 / 35 / 50 / 70 共 7 层。
- 每层 1~2 个节点；节点无连线依赖，达到等级即可投点。
- 每职业 13 节点 = 9 属性节点（各 12 级）+ 4 被动节点（各 5 级），总容量 9×12+4×5 = **128 点**。
- 投点校验（fail-before-mutate）：节点存在 → 未满级 → 角色等级 ≥ 门槛 → 余点 ≥ 1。

### 3.3 节点效果

**属性节点**：每级加固定数值或百分比，键使用 `EquipStats` 已有键（含 `hpPct/atkPct/defPct/moveSpeedPct` 双层公式百分比键），走 `EffectiveStats` 现有叠算路径（平铺加算/百分比进双层公式），效果 = 每级值 × 已投级数。

**被动节点**：每级对应一条完整 `PassiveDef`（复用现有五触发器 always/onHit/onHurt/onKill/onCast + chance + targetMode + Effect 列表）。只取**当前级数那一条**注入战斗（非逐级叠加），级间只递进数字参数（触发率/倍率/Buff 强度）。需要的新 Buff 追加进 `buff.xlsx`（永久或短时 Buff 均复用 BuffSystem）。

### 3.4 占位内容（数值全占位，待并入 balance 框架反解）

各职业主题：tank 偏生存反制、dps 偏爆发斩杀、healer 偏团队增益。

**tank**（示例节点，实施时以 xlsx 为准）：
- 属性：hp%、def%、格挡率、格挡强度、免伤、hp 固定、def 固定、移速%、atk%
- 被动：「反震」onHurt 概率反伤攻击者；「坚韧」always 自身免伤光环；「守护」onHurt 概率给全队短时 def Buff；「战意」onHit 概率自身攻击 Buff

**dps**：
- 属性：atk%、暴击率、暴击伤害、攻速、单体伤、群体伤、普攻伤、技能伤、atk 固定
- 被动：「嗜血」onKill 自疗；「连击」onHit 概率追加一段伤害；「破军」onCast 自身技能伤 Buff；「残影」always 自身闪避光环

**healer**：
- 属性：hp%、atk%、技能急速、移速%、闪避、def%、hp 固定、免伤、atk 固定
- 被动：「回春」onCast 全队小额治疗；「庇护」onHurt 概率自身石肤；「鼓舞」always 全队 atk 光环（与心法/战旗同池加算）；「妙手」onCast 概率全队短时受疗/防御 Buff

## 4. 数据与模块（复刻心法管线）

新模块 `assets/scripts/chartalent/`，全部纯逻辑不依赖 cc：

| 文件 | 职责 |
|------|------|
| `chartalent/CharTalentConfig.ts` | 纯查询：`charTalentNodes(cls)`、`nodeById`、每级属性值/被动 def 查询；数值来自 `config/chartalent.config.generated.ts` |
| `chartalent/CharTalentModel.ts` | 纯逻辑：存档结构（角色 id → {节点 id → 已投级数}）、`learnNode(cls, nodeId, charLevel)` 四步校验、`resetChar(cls)` 洗点、`availablePoints(cls, charLevel)`、序列化/反序列化 + 存档自愈（未知节点丢弃、级数超上限截断、投点总数超 (等级−1) 按节点顺序回退） |
| `chartalent/CharTalentStats.ts` | 纯函数：`charTalentAggregate(save, cls) → { stats: EquipStats, passives: PassiveDef[] }`——属性聚合 + 按已投级数解析被动 def 列表 |
| `config/chartalent.config.generated.ts` | 导表产物（勿手改） |
| `tools/config-xlsx/chartalent.xlsx` | **真源**：`Nodes` 表（cls/nodeId/名称/类型 stat 或 passive/等级门槛 tier/最大级/statKey/每级值）+ `Passives` 表（nodeId+level → PassiveDef 全字段，effects JSON 编码同 skill.xlsx）|
| `tools/seed-chartalent-xlsx.ts` | 从零重建 xlsx；`npm run seed:chartalent` |
| `tools/chartalent-test.ts` | Config/Model/Stats 单测；`npm run test:chartalent` |

导表校验：cls ∈ 三职业、类型×字段匹配（stat 节点必有 statKey/每级值，passive 节点每级都有 Passives 行）、statKey ∈ EquipStats 合法键、被动 buffId 跨表存在于 buff.xlsx、maxLevel ≥ 1、等级门槛 ∈ 1~100。

存档：`PlayerData.charTalents`，跟随现有 `save_<accountId>` 账号隔离与读档链。

## 5. 接线

值由 `BattleEntry` 组合根缓存注入（对齐心法 `_refreshTalentCache` 模式）：

1. **属性**：`buildEffectiveStatsMap` 增加可选第 4 参 `perClassStats?: Partial<Record<SoldierClass, EquipStats>>`；内部与现有全局 `extraStats`（心法）**合并求和**后走原 `calcEffectiveStats` 路径。缺省 = 现行为。
2. **被动**：`BattleEntry._startBattle` 组队建单位处，把 `charTalentAggregate(...).passives` 追加到该单位的 `passives` 数组（`passivesForClass(cls)` 之后 concat）。战斗层（PassiveSystem/BattleManager）**零改动**。
3. **零影响保证**：天赋全未点 = 空 stats + 空 passives = 现行为；`pacing-sim`/`sim:progress` 不传天赋，13 项节奏门槛与推进基线不动。
4. 离线收益、经验结算、掉落等一律不碰（角色天赋不含经济类效果）。

## 6. UI

新 `ui/panels/CharTalentPanel.ts` 覆盖层（对齐 TalentPanel 的实现风格）：

- 顶部：角色切换页签（3 职业）+ 当前角色等级 + 剩余点数；右上「洗点」按钮（弹确认）。
- 主体：按等级层分组的节点网格；每节点显示名称、当前级/最大级、下一级效果摘要。状态三态：等级未达（灰显+显示「Lv.X 解锁」）/ 可投点（亮起，点击 +1 级）/ 已点满（金色）。
- 点击已可投节点直接投 1 点，无需二次确认（有免费洗点兜底）。
- 入口①：主界面左上角角色头像热区（`HudAvatar` 区域新增 `AvatarHot`）→ 打开面板默认选中当前展示角色；独立「天赋」按钮图作为美术欠账移交 Codex，出图后可换。
- 入口②：`SquadPanel` 每个角色行加「天赋」按钮 → 打开面板并选中该角色。

## 7. 测试与验收

- 单测（tsx，挂 `npm run verify`）：点数派生/投点四步校验/跨门槛拒绝/点满拒绝/洗点回满/序列化往返/存档自愈（未知节点、级数溢出、总点数超发回退）/聚合正确性（属性求和、被动取当前级）。
- 导表校验用例随 `npm run config` 生效。
- 回归：`npm run verify` 全绿；`sim:pacing`、`sim:progress` 基线不动。
- 人工验收（用户 Cocos 预览）：开面板 → 升级拿点 → 投属性节点面板变化 → 投被动节点开战触发 → 洗点 → 切角色/切账号隔离。

## 8. 不做的事（YAGNI）

- 不做节点连线/依赖图渲染（无 prereq，分层网格足够）。
- 不做付费洗点、洗点道具。
- 不做天赋对离线收益/经济的加成（那是心法的地盘）。
- 不做主动技能学习/技能升级（另属「技能升级」待办线）。
- 首版不做独立按钮美术，不等 Codex 排期。
