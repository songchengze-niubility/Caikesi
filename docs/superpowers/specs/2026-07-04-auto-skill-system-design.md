# 自动技能系统（第一版：伤害类） 设计

> 日期：2026-07-04 ｜ 状态：已与用户对齐
> 范围：我方职业固定技能组、两种自动触发器（按时间 / 按普攻次数）、伤害类效果、技能按钮状态展示、数值校准回归。
> 不在范围：Buff/Debuff 容器、怪物/Boss 技能、手动释放、技能升级/解锁、技能图标真实美术。

## 决策记录

1. 战斗保持全自动，技能**自动释放**：`timer`（冷却循环）与 `attackCount`（攒普攻次数）两种触发器都做。
2. 技能按职业固定配置在 `skill.xlsx`，第一版只给 dps 配 3 个。
3. 第一版只做**伤害类**效果；Buff/Debuff 留到下个专项。
4. 只接我方；技能运行态挂在**单位实例**上（而非职业抽象），给后续 Boss 技能留口子。
5. 战斗主界面已有的 3 个技能按钮切片变成**状态展示**：进度遮罩 + 就绪满亮 + 释放闪光，不可点击。

## 1. 配置层：`skill.xlsx` → `skill.config.generated.ts`

按导表管线"一个模块一张表"：新增 `tools/config-xlsx/skill.xlsx`（种子脚本 `tools/seed-skill-xlsx.ts`），`tools/excel-to-config.ts` 的 `SOURCES` 加一行，产物 `assets/scripts/config/skill.config.generated.ts`，类型与辅助在 `assets/scripts/config/SkillConfig.ts`。

Skills sheet 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 技能唯一标识（如 `whirlwind`） |
| `name` | string | 显示名（飘字/按钮用） |
| `cls` | string | 归属职业，须存在于 battle 的 Stats（导表校验） |
| `trigger` | `timer` \| `attackCount` | 触发器类型（导表校验枚举） |
| `triggerValue` | number | 秒数或普攻次数（>0，导表校验） |
| `target` | `aoe` \| `nearest` \| `single` | 目标选择：自身半径内全体 / 最近 N 个 / 当前攻击目标 |
| `radius` | number | `aoe` 用，像素半径 |
| `maxTargets` | number | `nearest` 用 |
| `dmgMult` | number | 伤害倍率（>0） |

第一版 3 个技能（占位值，sim 校准后回填）：

| id | name | trigger | triggerValue | target | 参数 | dmgMult |
|----|------|---------|--------------|--------|------|---------|
| `whirlwind` | 旋风斩 | attackCount | 8 | aoe | radius 220 | 1.2 |
| `ground_smash` | 裂地击 | timer | 7 | nearest | maxTargets 3 | 1.8 |
| `lethal_strike` | 致命一击 | attackCount | 15 | single | — | 4.0 |

## 2. 逻辑层：`combat/SkillRuntime.ts`（纯逻辑，不依赖 cc）

- 每个士兵一份运行态：`{ skill, timer, attackCounter, pendingCast }`，开战按 `cls` 从 `SkillConfig` 装载（一个单位可持多个技能运行态）。
- **两个钩子**由 `BattleManager` 调用：
  - `tickSkills(dt)`：推进 `timer` 型计时；
  - `onBasicAttack(soldier)`：普攻**挥出**时计数（不管命中/闪避，节奏直观稳定）。
- 触发条件满足但目标选择结果为空（范围内没活敌）→ `pendingCast=true` **保留待放**，之后每帧检查，有目标的第一帧释放。
- 释放：逐个目标 `calcDamage(施法者stats, 目标stats) × dmgMult` —— 走唯一伤害入口，可暴击/可闪避，与普攻行为一致，不开新公式路径；然后重置该技能的计时/计数。
- 释放同时向 `BattleManager` 事件队列吐 `skillCast` 事件：`{ skillId, casterCls, hits: [{targetIndex, damage, crit, dodged}] }`，渲染层消费。
- 目标选择实现放 `SkillRuntime`（输入敌人列表快照，纯函数可测）。

## 3. 渲染层：`BattleEntry`

- 3 个技能按钮切片按 `SkillConfig` 中该职业技能的配置顺序一一对应。
- 每帧从 `SkillRuntime` 读进度（`timer/triggerValue` 或 `attackCounter/triggerValue`，钳到 [0,1]），按钮上画半透明黑遮罩（高度 = 1−进度）；就绪（pendingCast 或进度=1）满亮。
- 消费 `skillCast` 事件：按钮闪光约 0.3s；命中敌人头上飘技能伤害字（复用现有飘字，用区别于普攻的颜色）。
- 不可点击（现有热区若有 noop 绑定则保持 noop）。

## 4. 数值联动：sim:pacing 校准回归（必做）

技能抬高我方 DPS → 13 个台阶门槛整体偏移。接完技能后：

1. `tools/pacing-sim.ts` 无需改动（技能在 `BattleManager` 内自动生效，头铁模拟天然包含）。
2. 重跑 `npm run sim:pacing`；不达标项按既有方法调整——优先调**技能占位数值**（dmgMult/triggerValue），其次调关卡 hp 覆盖，直到 13 门槛复绿。
3. 校准结论回填 `skill.xlsx` 种子与 `battle.xlsx` 种子。

## 5. 测试

- 新增 `tools/skill-test.ts`（`npm run test:skill`），覆盖：timer 到点触发并重置；attackCount 攒满触发并重置；无目标时保留、出现目标后释放一次且只一次；伤害经 `calcDamage×dmgMult`；`skillCast` 事件字段完整、一次释放只吐一个事件；aoe/nearest/single 三种目标选择边界。
- 导表校验：`cls` 引用存在、`trigger`/`target` 枚举合法、`triggerValue`/`dmgMult` > 0。
- 既有 `test:combat`（普攻/击杀事件）不应受影响；全套测试 + `sim:pacing` 全绿为完成标准。

## 关键不变量（沿袭战斗框架）

- 伤害结算只经 `CombatFormula.calcDamage`。
- `SkillRuntime`/`SkillConfig` 不 import cc；渲染只在 `BattleEntry`。
- 数值只进 xlsx（改种子→重建→`npm run config`），不散进代码。
