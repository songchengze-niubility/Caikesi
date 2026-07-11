# 战斗流程 2.0 Plan A(技能槽 + 被动系统)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每角色 2 技能槽(主动/被动混装,按职业固定填表),被动三形态落地(常驻/条件触发/光环),四个触发钩子接入战斗;dps 3 主动砍 2 槽并重校 pacing 13 门槛,`verify` 全绿。

**Architecture:** 被动复用 Buff 系统——`duration: -1` 永久 Buff 承载常驻/光环;条件触发经新纯逻辑模块 `combat/PassiveSystem.ts`(chance 掷骰 + targetMode 解析),proc 效果走 `applyEffect`,一层防递归 guard。`skill.xlsx` 加 `kind/passiveTrigger/chance/targetMode` 四列,解析期拆成 `skills`(主动,SkillRuntime 零改动)与 `passives` 两组并做槽位/互斥/引用校验。

**Tech Stack:** TypeScript 5.8.2 双 tsconfig、tsx 单测、xlsx 导表、Cocos 3.8.8(HUD 已天然支持 ≤3 按钮,近零改动)。

## Global Constraints

- 改单位状态必须走 `applyEffect`;被动 proc 出的效果**不再触发被动钩子**(一层截断,防"反击触发反击"死循环)。
- 普攻命中 = 近战直击 + 普攻弹道命中,技能伤害不算;受击 = applyEffect 直击伤害命中未闪避(DoT 不算);击杀凶手不可溯源时(DoT 击杀)不触发 onKill。
- 每职业技能行 ≤ 2(导表校验);`onKill + targetMode=trigger` 禁配(被杀者已死无意义);`always` 的 chance 必须为 1。
- 概率掷骰用裸 `Math.random`(与战斗随机同口径);纯逻辑模块注入 rng 供测试。
- **pacing 13 门槛重校是显式任务**:dps 移除 `ground_smash` 后按"各关手感接近现状"最小改动补偿(优先调保留技能的倍率),复跑全绿才算完。
- 中文 commit + `Co-Authored-By: Claude <noreply@anthropic.com>`;每 Task 一 commit 不 push;每 Task 结束 typecheck+test+pacing,收尾完整 `verify`。

---

### Task A1: 永久 Buff(duration = -1)

**Files:**
- Modify: `assets/scripts/combat/BuffSystem.ts`(tickBuffs 跳过永久 Buff 的时长递减与到期)
- Modify: `tools/excel-to-config.ts`(buff 解析:duration 允许 -1,拒绝 0 与其他负数)
- Modify: `tools/seed-buff-xlsx.ts`(加 `['war_banner','战旗',-1,1,'refresh',0,'','atk%:0.05','','']` 永久光环占位)
- Modify: `tools/buff-test.ts`(新用例)
- 产物:`buff.xlsx`/`buff.config.generated.ts` 重生成提交

**Interfaces:** `BuffDef.duration === -1` 表示永久:实例 `remaining` 存 -1,`tickBuffs` 对其不递减、永不到期;周期效果照跳;可被驱散(若带 dispelTag)。

- [ ] **Step 1: buff-test 加两个失败用例**——永久 Buff tick 100 秒仍在且属性聚合有效;`duration:-1, period:1` 的永久周期 Buff 2.5 秒跳 2 次。Run 确认 FAIL(现实现 remaining=-1 首帧就过期)。
- [ ] **Step 2: 实现**——`tickBuffs` 循环内:`const permanent = def.duration === -1; if (!permanent) inst.remaining -= dt; ...到期分支加 !permanent 前置`;导表校验 `if (duration <= 0 && duration !== -1) err(...)`;seed 加行。
- [ ] **Step 3: 验证** — `npm run seed:buff && npm run config && npx tsx tools/buff-test.ts && npm run typecheck && npm test`,全绿
- [ ] **Step 4: Commit** — `feat(战斗框架): 永久 Buff(duration=-1)——常驻/光环被动的承载体`

---

### Task A2: skill.xlsx 槽位重构 + dps 迁移 + pacing 重校

**Files:**
- Modify: `assets/scripts/config/SkillConfig.ts`、`tools/seed-skill-xlsx.ts`、`tools/excel-to-config.ts`(skill 解析器)
- Modify: `tools/skill-test.ts`(dps count 3→2 + passivesForClass 断言)
- 可能修改: `tools/config-xlsx/skill.xlsx` 数值(pacing 补偿)与 `tools/pacing-sim.ts` 无需动(门槛不变)
- 产物:`skill.xlsx`/`skill.config.generated.ts` 重生成提交

**Interfaces(A3 依赖):**
```ts
export type PassiveTrigger = 'always' | 'onHit' | 'onHurt' | 'onKill' | 'onCast';
export type PassiveTargetMode = 'trigger' | 'self' | 'team';
export interface PassiveDef {
    id: string; name: string; cls: string;
    trigger: PassiveTrigger;
    chance: number;              // 0~1;always 必为 1
    targetMode: PassiveTargetMode;
    effects: Effect[];
}
export interface SkillConfigShape { skills: SkillDef[]; passives: PassiveDef[]; }
export function passivesForClass(cls: string): PassiveDef[];
```
**表结构:** header = `id,name,cls,kind,trigger,triggerValue,target,radius,maxTargets,effects,delivery,passiveTrigger,chance,targetMode`。种子行:
```
whirlwind      旋风斩   dps    active  attackCount 10 aoe    220 0 damage:0.5   (被动列空)
lethal_strike  致命一击 dps    active  attackCount 15 single 0   0 damage:2.5   (被动列空)
tank_stoneskin 坚壁     tank   passive (主动列全空)              applyBuff:stone_skin  onHurt 0.15 self
healer_banner  战旗光环 healer passive (主动列全空)              applyBuff:war_banner  always 1    team
```
(`ground_smash` 移除;三形态示范:坚壁=条件触发、战旗=光环、war_banner 本身=常驻属性加成。)

**解析校验:** 按 kind 分流——active 走现有校验;passive 要求主动列(trigger/triggerValue/target/radius/maxTargets/delivery)全空否则 err、effects 非空+applyBuff 跨表校验、passiveTrigger/targetMode 枚举、chance∈[0,1] 且 always→必为 1、`onKill+targetMode=trigger` err;**每 cls 总行数 >2 err**。

- [ ] **Step 1: skill-test 先红**——`unitSkillsForClass('dps').count === 2`、`passivesForClass('tank')` 长度 1 且 trigger==='onHurt'、`passivesForClass('healer')[0].targetMode==='team'`。
- [ ] **Step 2: 类型/种子/解析器实现** + `npm run seed:skill && npm run config`
- [ ] **Step 3: 全量回归 + pacing 重校**——`npm run typecheck && npm test` 绿后跑 `npm run sim:pacing`;若门槛不达标(dps 少一个技能输出下降),按最小改动补偿:优先 `whirlwind` 0.5→0.6/0.7、其次 `lethal_strike` 2.5→3.0,每调一档重跑,直至 13 门槛全绿并复跑一次确认;最终数值和理由写进 seed 注释(被动此时未接运行时,不影响 pacing)。
- [ ] **Step 4: Commit** — `feat(战斗流程): 技能槽 2 槽落地——skill.xlsx 主/被动分流,dps 迁移与 pacing 重校`

---

### Task A3: PassiveSystem + 四钩子接线 + 防递归

**Files:**
- Create: `assets/scripts/combat/PassiveSystem.ts`
- Modify: `assets/scripts/combat/CombatUnit.ts`(加 `passives: PassiveDef[]`,士兵工厂装载 `passivesForClass`,敌人空数组)
- Modify: `assets/scripts/combat/Effects.ts`(EffectHooks 加可选 `onDamaged`/`onKilled`;damage case 结算后调用)
- Modify: `assets/scripts/combat/BattleManager.ts`(Projectile/ZoneEffect 加 `owner`、Projectile 加 `isBasicAttack`;`_firePassives` guard;五个接线位点)
- Create: `tools/passive-test.ts`;Modify: `package.json`(`test:passive` + test 链)

**Interfaces:**
```ts
// PassiveSystem.ts(纯逻辑,注入 rng 可测)
export type PassiveHook = 'onHit' | 'onHurt' | 'onKill' | 'onCast';
export function firePassives(
    passives: readonly PassiveDef[], hook: PassiveHook,
    owner: CombatUnit, other: CombatUnit | null, allies: readonly CombatUnit[],
    apply: (target: CombatUnit, eff: Effect) => void,
    rng: () => number = Math.random,
): void;   // 过滤 trigger===hook → chance 掷骰 → targetMode 解析(trigger→other,self→owner,team→活着的 allies)逐效果 apply
export function applyAlwaysPassives(passives, owner, allies, apply): void;   // trigger==='always' 无掷骰

// Effects.ts
export interface EffectHooks {
    ...现有四个...
    onDamaged?(target: CombatUnit, attacker: CombatUnit | null, damage: number): void;  // 直击未闪避且 damage>0
    onKilled?(attacker: CombatUnit | null, victim: CombatUnit): void;                    // 直击致死
}
// damage case 内攻击者溯源(结构探测,不引入类型依赖):
// const attacker = (source as {side?: unknown}).side !== undefined ? source as CombatUnit : ((source as {owner?: CombatUnit|null}).owner ?? null);
```
**BattleManager 接线五点:**
1. `private _procGuard = false;` + `_firePassives(owner, hook, other)`:guard 中/owner 死亡/无被动 → 直接返回;置 guard 后 `firePassives(..., (t, eff) => applyEffect(owner, t, eff, this._effectHooks))`,finally 复位。hooks 的 `onDamaged`/`onKilled` 实现分别转发 `_firePassives(target,'onHurt',attacker)` / `_firePassives(attacker,'onKill',victim)`(attacker 为 null 跳过)。
2. 开战:`_setupSquad` 末尾对每个士兵 `applyAlwaysPassives`(经同一 guard 包裹的 apply,光环/常驻上永久 Buff)。
3. onHit:近战直击后 `_firePassives(s, 'onHit', target)`;`_updateProjectiles` 命中后 `if (p.isBasicAttack && p.owner) _firePassives(p.owner, 'onHit', e)`。普攻发射处 `isBasicAttack: true, owner: s`;技能投递弹道 `false, owner: s`;zone 的 `owner: s`(onKill 溯源用)。
4. onCast:`_updateSkills` 两个分支(instant/投递)推完 skillCast 事件后 `_firePassives(s, 'onCast', null)`。
5. `allies` 取 `owner.side === 'ally' ? this.soldiers : this.enemies`(team 解析用;敌人被动第 3 段 Boss 用,本段自然支持)。

- [ ] **Step 1: 写失败测试 `tools/passive-test.ts`**——单元:chance=0 永不/chance=1 必触发(注入 rng=()=>0.99/0)、targetMode 三种解析、always 无掷骰;集成(BattleManager):①手挂 `onHurt+self+applyBuff:stone_skin, chance:1` 到 tank,敌人打一下后 tank.buffs 含 stone_skin;②防递归:互相 onHurt+trigger+damage 的两单位对打一轮,断言伤害只多一层不无限;③healer 上阵开战即全队带 war_banner 永久 Buff 且 atk 提升;④onHit:近战 dps 手挂 `onHit+trigger+applyBuff:poison, chance:1`,命中后怪带毒;⑤onCast:放技能后触发 self buff。
- [ ] **Step 2: 确认 FAIL** → **Step 3: 实现**(上面全部接线)→ **Step 4: 验证** `npx tsx tools/passive-test.ts && npm run typecheck && npm test && npm run sim:pacing`(注意:tank 坚壁被动此时生效,tank 略变硬——pacing 若有单门槛漂移按 A2 同口径微调复绿)
- [ ] **Step 5: Commit** — `feat(战斗流程): PassiveSystem 被动三形态——四钩子接线/一层防递归/光环开战生效`

---

### Task A4: HUD 确认 + 收尾

**Files:**
- Modify: `assets/scripts/ui/BattleStageView.ts`(仅确认:`renderSkillStatus` 的 `min(3, count)` 对 count=2 无越界——第 3 按钮保持静态贴图,真 UI 阶段再动态化;如有越界才修)
- Modify: `ai/memory/代码地图.md`(PassiveSystem 行、SkillConfig/skill.xlsx 行、buff duration -1、测试行)
- Modify: `ai/skills/战斗框架.md`("加被动"标准流程、防递归/普攻语义红线)
- Modify: `ai/skills/配置与关卡.md`(skill 表新列)
- Modify: `ai/memory/项目状态.md`(最近进展 + 待办:战斗流程 2.0 完结,剩 Boss 第 3 段)
- Modify: `docs/superpowers/specs/2026-07-11-combat-flow2-design.md`(实做偏差回写)

- [ ] **Step 1: HUD 检查(必要才改)** → **Step 2: 文档同步** → **Step 3: 终验** `npm run verify && npm run sim:pacing`(复跑)
- [ ] **Step 4: 用户 Cocos 预览人工点验**——一局看:技能按钮只有 2 个在转、战斗/行军/结算正常、tank 挨打偶尔冒"石肤"字样(buffChanged 无渲染,看飘字即可不强求)
- [ ] **Step 5: Commit** — `docs(战斗流程): Plan A 收尾——文档同步/终验`,之后走分支合并流程
