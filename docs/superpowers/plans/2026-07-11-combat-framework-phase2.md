# 战斗框架第 2 段(弹道/AOE 泛化 + 控制位移)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bullet 泛化为 Projectile(直线/穿透/抛物/场地四形态,命中走效果列表),实装 knockback/taunt/silence 三种控制,技能获得可配置投递方式;现有战斗行为等价、`verify` 与 `pacing-sim` 全绿。

**Architecture:** 沿用第 1 段格局:编码解析进 `config/EffectTypes.ts`(新增 `parseDelivery`),行为门扩展在 `combat/BuffSystem.ts`,位移经 `Effects.applyEffect` 的 knockback case 回调 BattleManager 钳制落地。`Projectile`/`ZoneEffect` 由 BattleManager 持有数组(渲染层直接遍历),命中/周期一律复用 `applyEffect` 效果列表。

**Tech Stack:** TypeScript 5.8.2(双 tsconfig),tsx 单测,xlsx 导表,Cocos 3.8.8(渲染仅改名+加一个半透明圆)。

## Global Constraints

- 战斗逻辑纯数据、不依赖 cc;`calcDamage` 唯一伤害公式不动;改单位状态必须走 `applyEffect`。
- 三条战场不变量:近战前压硬保险、远程有限射程、防线用 homeX;击退钳制不得破坏它们。
- 热路径零每帧分配:弹道/场地数组原地压缩(swap 写法),回调用实例字段绑定,不建帧闭包。
- 护栏:`MAX_PROJECTILES = 64`、`MAX_ZONES = 8`,达到上限静默跳过生成(占位阶段可接受,注释标明)。
- 现有 3 个技能 delivery 留空 = instant,行为等价;**不加会动 pacing 的内容**。战斗随机沿用 `Math.random`。
- 中文 commit + `Co-Authored-By: Claude <noreply@anthropic.com>`;每 Task 一个 commit,不 push;每 Task 结束 `npm run typecheck`,Task 1 起每 Task 结束 `npm test`,收尾跑 `npm run verify` + `sim:pacing`。

**语义决策(spec 未细化处,本计划定稿):**
- **taunt**:标记在**我方单位**上的"吸引火力"光环——敌人贴身攻击优先选最近的活着的 `gate.taunting` 士兵;没有则按原逻辑选最近。
- **silence**:只禁技能释放,不停技能进度、不禁普攻(`collectCasts` 跳过,就绪保留待放语义自然成立)。
- **knockback**:敌人向 +x(推离防线)、我方向 −x;敌人钳 `[当前x, halfW]`、我方钳 `[-halfW+20, 当前x]`(只许往后推);远程/治疗士兵钉站位,击退下一帧被 `x=homeX` 复位,语义上等于免疫(可接受,注释标明)。
- **DoT 周期伤害经 zone**:zone 周期对域内每个活敌执行完整效果列表(damage 走 calcDamage,与直击同口径;区别于 Buff 的 srcAtk 快照 DoT)。
- **投递技能的 skillCast 事件**:`hits: []` 空数组即时发出(表现层闪光用),伤害在命中/周期时后置结算;仅 instant 投递保留"全落空不发事件"规则。

---

### Task 1: Projectile 泛化(直线/穿透/抛物)

**Files:**
- Modify: `assets/scripts/combat/BattleManager.ts`(Bullet→Projectile、`_fireBullet`→`_spawnProjectile`、`_updateBullets`→`_updateProjectiles`)
- Modify: `assets/scripts/ui/BattleStageView.ts`(`manager.bullets` 遍历改 `manager.projectiles`,一处)
- Create: `tools/projectile-test.ts`
- Modify: `package.json`(`test:projectile` + test 链)

**Interfaces:**
- Consumes: `applyEffect`/`EffectHooks`(第 1 段)、`CombatUnit.id`。
- Produces(后续 Task 依赖):
```ts
export interface Projectile {
    x: number; y: number; vx: number; vy: number;
    stats: CombatStats;      // 开火者攻击属性快照引用(EffectSource)
    effects: Effect[];       // 命中效果列表
    pierce: number;          // 剩余穿透数(0=命中即灭)
    gravity: number;         // >0 抛物下坠;0=直线
    hitIds: number[];        // 已命中单位 id(穿透去重),spawn 时 length=0 复用
    alive: boolean;
}
projectiles: Projectile[];   // 原 bullets 数组改名,渲染层遍历
private _spawnProjectile(fromX: number, fromY: number, target: CombatUnit, speed: number, gravity: number, pierce: number, effects: Effect[], stats: CombatStats): void;
```
- 抛物瞄准(y 轴向上、g 向下拉):`t = dist/speed; vx = dx/t; vy = dy/t + 0.5*g*t`,每帧 `vy -= gravity*dt`,落点即目标(`y(t) = vy0*t − 0.5*g*t² = dy`)。
- `_updateProjectiles` 命中:半径判定同现状(`bullet.radius + e.radius`);命中后对该敌逐效果 `applyEffect(p, e, eff, hooks)`(p 满足 EffectSource);记 `hitIds`;`pierce-- < 0` 才灭,否则继续飞、跳过已命中 id。
- 普攻远程:`_updateFiring` 调 `_spawnProjectile(s.x, s.y, target, BattleConfig.bullet.speed, 0, 0, BASIC_ATTACK_EFFECTS, s.stats)`,其中 `const BASIC_ATTACK_EFFECTS: Effect[] = [DMG1]` 模块级常量——行为与旧 Bullet 逐帧等价。
- 护栏:`projectiles.length >= MAX_PROJECTILES(64)` 时跳过生成。

- [ ] **Step 1: 写失败测试** `tools/projectile-test.ts`(骨架同 `tools/effect-test.ts`;用 `mkQuietManager`(range=0 dps,同 effect-test 的隔离手法)+ 手动往 `mgr.projectiles` push 构造弹道):

```ts
// 直线命中:朝首个敌人发直线弹,tick 至命中,断言扣血一次
// 穿透:pierce=2 的横穿弹打三只叠位敌人,断言前 3 只各扣血一次、弹体存活到穿透耗尽
// 抛物:gravity>0 瞄准远处敌人,断言飞行中 y 先升后降、最终命中扣血
// hitIds 去重:穿透弹不会对同一敌人二次结算
// 越界清理:飞出 halfW+40 后 alive=false 且数组被压缩
// 上限护栏:塞满 64 发后 _spawnProjectile 不再增长(经远程士兵普攻观察 projectiles.length 封顶)
```
(每条都写成完整可运行断言;敌人用 `firstEnemy(mgr)` 等它自然刷出后钉住 `e.moveSpeed=0` 消除移动干扰。)

- [ ] **Step 2: 跑测试确认失败** — Run: `npx tsx tools/projectile-test.ts`,Expected: FAIL(projectiles 属性不存在)
- [ ] **Step 3: 实现**(改名 + 泛化 + 抛物运动 + 穿透 + 护栏 + 渲染层一处改名;`export type { Projectile }` 保持渲染层 import 路径)
- [ ] **Step 4: 验证** — Run: `npx tsx tools/projectile-test.ts && npm run typecheck && npm test && npm run sim:pacing`,Expected: 全绿(普攻等价迁移,pacing 不动)
- [ ] **Step 5: Commit** — `feat(战斗框架): Bullet 泛化 Projectile——直线/穿透/抛物,命中走效果列表`

---

### Task 2: Zone 场地效果

**Files:**
- Modify: `assets/scripts/combat/BattleManager.ts`(zones 数组、`_spawnZone`、`_updateZones`、事件)
- Modify: `assets/scripts/ui/BattleStageView.ts`(renderUnits 开头画半透明圆)
- Create: `tools/zone-test.ts`
- Modify: `package.json`(`test:zone` + test 链)

**Interfaces:**
- Produces:
```ts
export interface ZoneEffect {
    x: number; y: number; radius: number;
    remaining: number;       // 剩余时长
    period: number; accum: number;
    effects: Effect[];
    stats: CombatStats;      // 施放者属性快照引用
    alive: boolean;
}
zones: ZoneEffect[];
export interface ZoneSpawnedEvent { type: 'zoneSpawned'; x: number; y: number; radius: number; }
export interface ZoneExpiredEvent { type: 'zoneExpired'; x: number; y: number; }
private _spawnZone(x: number, y: number, cfg: { radius: number; duration: number; period: number }, effects: Effect[], stats: CombatStats): void;
```
- `_updateZones(dt)`:`remaining -= dt`;`accum += dt`,while 满 period → 对**半径内活敌**(平方距离)逐效果 `applyEffect({stats: z.stats}, e, eff, hooks)`;到期 swap-remove + `zoneExpired` 事件。tick 顺序插在 `_updateProjectiles` 之后。
- `BattleEvent` union += 两个 zone 事件;护栏 `MAX_ZONES = 8`;渲染:`g.fillColor = zoneColor(120,200,120,50)` 画圆,画在敌人之前(垫底)。
- 注意 `applyEffect` 第一参是 `EffectSource`,`{stats: z.stats}` 字面量只在周期触发时构造(低频,可接受)——或 zone 对象本身就满足 EffectSource(有 stats 字段),直接传 `z`,零分配。**用后者。**

- [ ] **Step 1: 写失败测试** `tools/zone-test.ts`:毒池(damage:0.2 效果)覆盖两只钉住的敌人,tick 2.05s 断言各扣 2 跳、跳伤走 calcDamage 口径;半径外敌人无伤;到期后 zones 压缩为空且吐 `zoneSpawned`/`zoneExpired` 事件;第 9 个 zone 被护栏拒绝。
- [ ] **Step 2: 确认失败** — `npx tsx tools/zone-test.ts` FAIL
- [ ] **Step 3: 实现**(含渲染圆)
- [ ] **Step 4: 验证** — `npx tsx tools/zone-test.ts && npm run typecheck && npm test && npm run sim:pacing` 全绿
- [ ] **Step 5: Commit** — `feat(战斗框架): Zone 场地效果——周期对域内敌人施加效果列表,毒池火海形态解锁`

---

### Task 3: 控制三件套(knockback / taunt / silence)

**Files:**
- Modify: `assets/scripts/combat/BuffSystem.ts`(BehaviorGate 扩展)
- Modify: `assets/scripts/combat/CombatUnit.ts`(gate 初始化/recomputeDerived 同步新字段)
- Modify: `assets/scripts/combat/Effects.ts`(knockback case 实装,EffectHooks 加 applyKnockback)
- Modify: `assets/scripts/combat/BattleManager.ts`(applyKnockback 实现+事件、taunt 选目标、silence 门)
- Modify: `tools/seed-buff-xlsx.ts` + 重跑 `seed:buff`/`config`(加 挑衅/沉默 两行)
- Modify: `tools/effect-test.ts`(既有手工 hooks 对象补 applyKnockback 成员)
- Create: `tools/control-test.ts`
- Modify: `package.json`(`test:control` + test 链)

**Interfaces:**
- `BehaviorGate` 扩展为 `{ canMove: boolean; canAct: boolean; canCast: boolean; taunting: boolean }`;`buffGate` 聚合:stun → 三 can 全 false;silence → 仅 canCast=false;taunt → taunting=true。
- `EffectHooks` += `applyKnockback(target: CombatUnit, distance: number): void`;`applyEffect` 的 knockback case 调它并返回 NONE。
- BattleManager 实现:敌人 `x = min(halfW, x + distance)`、我方 `x = max(-halfW + 20, x - distance)`;push `KnockbackEvent { type:'knockback'; targetSide; targetKey; distance }` 进事件流(union 扩展)。
- taunt:`_enemyAttack` 先扫 `gate.taunting && alive` 的士兵取最近,无则回落原"最近士兵"。
- silence:`_updateSkills` 里 `s.skills.tick(dt)` 照跑,`collectCasts` 仅在 `s.gate.canCast` 时调用。**注意第 1 段的 stun 判断要同步改**:循环开头从 `!s.gate.canAct` 收窄为不跳过 tick(眩晕原语义"技能进度暂停"保留:canAct=false 时连 tick 都跳,canCast=false 单独只跳 collectCasts——即 `if (!s.gate.canAct) continue; s.skills.tick(dt); if (!s.gate.canCast) continue;`)。
- buff.xlsx 新行:`['taunt_shout','挑衅',3,1,'refresh',0,'','','taunt','buff']`、`['silence_seal','沉默',3,1,'refresh',0,'','','silence','debuff']`。

- [ ] **Step 1: 写失败测试** `tools/control-test.ts`:buffGate 三标记聚合;knockback 敌人 +x 且钳 halfW、我方 −x、事件吐出;taunt 集成(两士兵,给后排挂 taunt_shout,断言敌人贴身攻击打的是 taunting 者——观察其 hp 减少而前排不减);silence 集成(就绪技能被沉默不放、保留待放,解除后首帧释放)。
- [ ] **Step 2: 确认失败** — `npx tsx tools/control-test.ts` FAIL
- [ ] **Step 3: 实现**(五个文件 + seed 重跑 `npm run seed:buff && npm run config`)
- [ ] **Step 4: 验证** — `npx tsx tools/control-test.ts && npm run typecheck && npm test && npm run sim:pacing` 全绿(无人施控,快路径等价)
- [ ] **Step 5: Commit** — `feat(战斗框架): 控制三件套——击退钳制落地/嘲讽拉仇恨/沉默禁技,行为门四字段`

---

### Task 4: 技能投递方式(delivery)

**Files:**
- Modify: `assets/scripts/config/EffectTypes.ts`(`DeliveryDef` + `parseDelivery`)
- Modify: `assets/scripts/config/SkillConfig.ts`(`SkillDef.delivery: DeliveryDef | null`)
- Modify: `tools/seed-skill-xlsx.ts`(加 `delivery` 列,现有 3 技能留空)+ 重跑 seed/config
- Modify: `tools/excel-to-config.ts`(skill 解析器读 delivery 列)
- Modify: `assets/scripts/combat/BattleManager.ts`(`_updateSkills` 按 delivery 分支)
- Modify: `tools/effect-types-test.ts`(parseDelivery 用例)、`tools/skill-test.ts`(mkDef 补 `delivery: null` + zone 投递集成测试)

**Interfaces:**
```ts
// EffectTypes.ts
export type DeliveryDef =
    | { kind: 'line'; speed: number; pierce: number }
    | { kind: 'arc'; speed: number; gravity: number }
    | { kind: 'zone'; radius: number; duration: number; period: number };
export function parseDelivery(src: string, onError: (msg: string) => void): DeliveryDef | null;
// 编码:'' → null(instant,现状);'line:900'/'line:900:2'(穿透默认0);'arc:700:1400';'zone:150:4:1'
```
- `_updateSkills` 分支:`delivery === null` 走现有 instant 路径(hits 聚合、全落空不发事件,行为等价);`zone` → `_spawnZone(首目标.x, 首目标.y, d, cast.def.effects, s.stats)`;`line`/`arc` → 对每个目标 `_spawnProjectile(s.x, s.y, t, d.speed, arc?d.gravity:0, line?d.pierce:0, cast.def.effects, s.stats)`;投递分支即时发 `skillCast` 事件且 `hits: []`。
- 导表校验:delivery 编码非法报错;`zone` 的 radius/duration/period 必须 > 0;delivery 非空时技能 `target` 仍照常选目标(投递需要落点)。

- [ ] **Step 1: 测试先红**——effect-types-test 加 parseDelivery 四种编码+非法用例;skill-test 加"zone 投递毒池技能:释放后 mgr.zones 长度 1、敌人周期扣血、skillCast 事件 hits 为空"集成测试;mkDef 补 `delivery: null`。Run 确认 FAIL。
- [ ] **Step 2: 实现**(类型/解析/导表/seed/BattleManager 分支)+ `npm run seed:skill && npm run config`
- [ ] **Step 3: 验证** — `npx tsx tools/effect-types-test.ts && npx tsx tools/skill-test.ts && npm run typecheck && npm test && npm run sim:pacing` 全绿(3 技能 delivery 空=等价)
- [ ] **Step 4: Commit** — `feat(战斗框架): 技能投递方式——instant/line/arc/zone 可配置,毒池穿透箭全链路打通`

---

### Task 5: 收尾——文档同步 + verify 终验

**Files:**
- Modify: `ai/memory/代码地图.md`(BattleManager 行补 Projectile/Zone/控制;EffectTypes 行补 DeliveryDef;测试三行)
- Modify: `ai/skills/战斗框架.md`(文件分工、"加投递形态"流程、击退/嘲讽/沉默语义、护栏两常量)
- Modify: `ai/memory/项目状态.md`(最近进展 + 待办 6 更新为"仅剩第 3 段 Boss")
- Modify: `docs/superpowers/specs/2026-07-11-combat-framework-design.md`(第 2 段回写实做语义:taunt 光环式、silence 不停进度、远程钉桩免疫击退、DeliveryDef 编码)

- [ ] **Step 1: 同步四文档**
- [ ] **Step 2: 终验** — `npm run verify && npm run sim:pacing`(pacing 复跑一次防抖动),Expected: 全绿
- [ ] **Step 3: Commit** — `docs(战斗框架): 第 2 段收尾——文档同步与语义定稿回写`
