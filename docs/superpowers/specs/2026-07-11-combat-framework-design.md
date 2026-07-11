# 战斗底层框架演进设计(玩法深度地基)

> 2026-07-11。目标:把战斗底层从"能打"撑开到"加内容=填表",为 Buff/Debuff、Boss 机制、弹道/AOE 多样化、控制与位移四类内容形态奠定统一地基。操作模型定为**纯自动**(不留玩家输入接口)。

## 背景与动机

现状(`combat/BattleManager.ts` 651 行 + `SkillRuntime` + `CombatFormula`):

- `Soldier` / `Enemy` 是两套独立 interface,任何"对任意单位生效"的机制(Buff、控制、位移)都要写两遍。
- 状态变更散落:伤害走 `calcDamage`,治疗、动作切换、击杀各有各的路径;没有统一的"效果"概念,毒箭/护盾/击退这类词条**做不了**。
- 弹道只有直线单体;Boss 只是血厚的普通怪。

选定路线:**先统一地基,再填内容**(对比过"渐进叠加"路线,判负原因:每个机制双倍代码,BattleManager 会重蹈 BattleEntry 拆分前膨胀覆辙)。

## 不变量(贯穿三段,不商量)

1. 战斗逻辑**纯数据、不依赖 cc**,`pacing-sim` 继续头铁跑。战斗随机沿用裸 `Math.random`(现状无种子,pacing 以多次运行+门槛余量吸收抖动),本次不引入种子化。
2. `CombatFormula.calcDamage` 仍是唯一伤害公式,结算顺序不变。
3. 近战前压硬保险(坦克位置 ≤ 防线 + contactGap − range)、远程有限射程、防线用原始 homeX——三条既有战场不变量保持;击退等位移效果必须钳制在不破坏它们的范围内。
4. 数值进 Excel 导表;热路径零每帧分配(Buff 聚合走脏标记缓存,不每帧算)。
5. 渲染只消费 `BattleEvent`,逻辑层不感知表现。

## 第 1 段 · 统一单位模型 + 效果管线 + Buff 系统

### 1.1 CombatUnit(合并 Soldier/Enemy)

```ts
interface CombatUnit {
    id: number;
    side: 'ally' | 'enemy';
    archetype: UnitArchetype;      // 行为原型(见下)
    x: number; y: number;
    homeX: number; homeY: number;  // 原始站位(防线锚点)
    baseStats: CombatStats;        // 开战面板:装备/等级/镶嵌算完的结果(现有 EffectiveStats 链不动)
    liveStats: CombatStats;        // 战时缓存 = baseStats + Buff 修正,脏标记重算
    hp: number;
    action: UnitAction;            // idle/run/attack/death(现有动作时钟迁移)
    buffs: BuffInstance[];
    gate: BehaviorGate;            // 行为门:canMove/canAct/forcedTarget(嘲讽),由 Buff 标记聚合
    // 职业专属(技能槽)与怪物专属(赏金/经验)作为可选字段保留
}
```

- 差异走 `UnitArchetype` 配置:`melee`(前压+贴脸)/`ranged`(限射程)/`healer`(治疗循环)/后续 `boss`。移动/索敌/攻击循环按原型分支,而不是按 Soldier/Enemy 类型分支。
- `liveStats` 只在 Buff 增删/层数变化时重算(脏标记);战斗帧读缓存。

### 1.2 Effect 管线(唯一状态变更入口)

```ts
type Effect =
    | { kind: 'damage'; mult: number }                          // 内部走 calcDamage
    | { kind: 'heal'; mult: number }                            // 按施法者 atk 倍率;治疗职业现有 healPerSec 循环迁移为 healer 原型行为,不强行走技能
    | { kind: 'applyBuff'; buffId: string; stacks?: number }
    | { kind: 'dispel'; tag: string; count?: number }
    | { kind: 'knockback'; distance: number }                   // 第 2 段实装,类型先占位
    | { kind: 'summon'; unitType: string; count: number };      // 第 2/3 段实装

applyEffect(source: CombatUnit, target: CombatUnit, effect: Effect, ctx: BattleContext): EffectResult
```

- 普攻 = `[{kind:'damage', mult:1}]`;现有技能倍率伤害 = `[{kind:'damage', mult:x}]`——迁移后行为等价。
- `applyEffect` 内部产出 `BattleEvent`(伤害飘字/上 Buff/击杀),渲染层照单消费。
- 加内容 = 加一种 Effect 数据或组合既有 Effect,不改管线代码。

### 1.3 Buff 系统

- 实例:`{ id, stacks, remaining, periodAccum }`,纯数据。
- 定义进 **`buff.xlsx`**(新导表源,走 `excel-to-config` 多源清单):

| 列 | 含义 |
|----|------|
| id / name | 标识与显示名 |
| duration / maxStacks / stackRule | 时长;上限层数;叠加规则(refresh 刷新时长 / add 累计层数) |
| period / periodicEffect | 周期(秒);周期触发的 Effect(跳伤/跳疗),引用 Effect 编码 |
| statMods | 属性修正:每项 CombatStats 的加值与百分比(中毒减防、战吼加攻) |
| flags | 行为标记:stun(禁动禁攻)/ taunt(强制目标)/ silence(禁技能) |
| dispelTag | 驱散标签(增益/减益/中毒…) |

- 帧逻辑只做 `remaining -= dt`、周期累计触发 `periodicEffect`、到期移除;增删层数时置脏重算 `liveStats` 与 `gate`。
- 事件:`buffApplied` / `buffExpired`(渲染层画图标/变色用)。**实做偏差(2026-07-11)**:两事件合并为单一 `buffChanged { applied: boolean }`,信息等价、union 更短。

### 1.4 技能升级为"触发 + 目标 + 效果列表"

- `SkillRuntime` 的触发器(计时/普攻计数)与目标选择(aoe/nearest/single)**保留**;`skill.xlsx` 的伤害倍率列扩展为**效果列表**列(Effect 编码,如 `damage:1.5|applyBuff:poison:1`)。
- 毒箭 = 伤害 + 上中毒 Buff;战吼 = 群体上护盾 Buff。纯自动,无输入接口。

### 1.5 第 1 段交付物

`combat/CombatUnit.ts`(类型+原型行为)、`combat/Effects.ts`(Effect 类型+applyEffect)、`combat/BuffSystem.ts`(纯逻辑,可 tsx 单测)、`buff.xlsx` + seed 脚本 + 导表接入、`BattleManager` 迁移到统一模型、`skill.xlsx` 效果列表迁移;新增 `tools/buff-test.ts`、`tools/effect-test.ts`,现有 combat/skill 测试迁移;`verify` + `pacing-sim` 全绿。

## 第 2 段 · 弹道泛化 + 控制位移

### 2.1 Projectile(Bullet 泛化)

```ts
type ProjectileMotion =
    | { kind: 'instant' }                          // 瞬发命中(现治疗束/雷击类)
    | { kind: 'line'; speed: number; pierce?: number }   // 直线,可穿透 N 个目标
    | { kind: 'arc'; speed: number; gravity: number }    // 抛物线(投石/箭雨单发)
    | { kind: 'zone'; radius: number; duration: number; period: number }; // 场地:毒池/火海
```

- 命中(或 zone 周期)对目标执行**效果列表**(复用 Effect 管线)。
- zone = 带时长的区域,周期对域内单位 `applyEffect`;毒池火海不是新系统,是 Projectile 的一种形态。
- 护栏:最大存活弹道数、最大同时 zone 数、zone 域内单位数按半径平方距离筛(无碰撞群殴现状保持,不开物理)。

### 2.2 控制与位移

- 眩晕/嘲讽/沉默 = Buff flags 聚合进 `BehaviorGate`,移动/攻击/技能循环在入口处查门,不散落判断。
- 击退 = `knockback` Effect 实装:直接改 x,**钳制**——敌人不越过防线锚点语义、我方不被推出屏幕/阵型合法区;与近战前压硬保险共存(击退后按现有移动逻辑自然回位)。
- 事件:`knockback`、`zoneSpawned`/`zoneExpired`。
- **实做语义定稿(2026-07-11 第 2 段落地)**:嘲讽为光环式(敌人优先打最近的带 taunt 我方单位,不追施法者);沉默只禁释放不停技能进度;远程/治疗钉站位单位天然免疫击退;技能投递经 `skill.xlsx` 的 `delivery` 列(`DeliveryDef` 编码 `line:速度[:穿透]`/`arc:速度:重力`/`zone:半径:时长:周期`,空=instant),投递技能的 skillCast 事件 hits 为空;护栏 `MAX_PROJECTILES=64`/`MAX_ZONES=8`。

## 第 3 段 · Boss 机制脚本化

- `combat/BossBrain.ts`:挂在 `archetype: 'boss'` 单位上的决策器。
- **`boss.xlsx`**:阶段表(血量百分比阈值→阶段)+ 招式轮转表(每阶段:技能序列、间隔、读条时长、狂暴计时器)。
- 读条:`castStart` 事件先发(表现层画预警条),读条完成执行技能效果列表;被打断机制暂不做(纯自动打不出打断,YAGNI)。
- Boss 招式全部引用第 1、2 段的技能/Effect/Projectile——**加 Boss = 填 boss.xlsx + skill.xlsx,零新代码**。
- 验收样板:第 10 关屠夫领主改造成两阶段 Boss(一阶段普攻+召唤,二阶段狂暴+火海),`pacing-sim` 第 10 关门槛按改造后重校。

## 配置与导表汇总

| 新表 | 内容 | 生成产物 |
|------|------|----------|
| `buff.xlsx` | Buff 定义(1.3 列结构) | `buff.config.generated.ts` |
| `boss.xlsx` | 阶段 + 招式轮转 | `boss.config.generated.ts` |
| `skill.xlsx`(改) | 伤害倍率列 → 效果列表列 | `skill.config.generated.ts` |

均走 `tools/excel-to-config.ts` 多源清单 + seed 脚本;Effect 编码格式在导表器里校验(未知 kind/引用不存在的 buffId 报错)。

## 测试与回归口径

- 新增:`buff-test`(叠层/到期/周期跳伤/驱散/属性修正缓存)、`effect-test`(各 Effect 类型+事件产出)、第 2 段 `projectile-test`、第 3 段 `boss-test`(阶段切换/轮转/狂暴)。
- 迁移:`combat-test` / `skill-test` 适配统一单位模型。
- `pacing-sim`:统一模型可能改变 RNG 调用顺序,数值轻微抖动可接受,口径为"13 门槛留余量 + 复跑确认",不追字节级等价;第 10 关门槛在第 3 段 Boss 改造后重校。
- 每段独立提交,`npm run verify` 全绿为交付线。

## 风险与取舍

- **第 1 段是核心手术**:动 BattleManager 核心类型,一次性成本约其 1/3 重写;用"迁移后普攻/技能行为等价 + pacing 门槛"托底。
- 打断读条、弹道碰撞物理、玩家手动技能:明确不做(YAGNI / 纯自动已定)。
- 渲染表现(Buff 图标、预警条、zone 贴图)在色块占位阶段用最简表现,真美术后置——逻辑事件接口本次定稿。
