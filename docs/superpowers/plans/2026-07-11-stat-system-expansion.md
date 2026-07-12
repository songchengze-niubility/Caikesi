# 属性系统扩展实施计划（养成数值框架 · 子计划 A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `docs/superpowers/specs/2026-07-11-progression-framework-design.md` 第 3/5/7 节，把战斗属性从 13 维扩到 18 维（技能急速 + 伤害四拆），落地伤害标签、双层叠算（固定+百分比）、穿戴等级、等级上限 100、宝石 1~6 级——**全部结构就位、数值保持等价或占位**，绝对数值由后续子计划 B（生成式框架）反解。

**Architecture:** 纯逻辑层逐文件扩展：类型（BattleConfig/EquipDefs）→ 公式（CombatFormula 伤害标签）→ 管线（Effects/BattleManager 打标、SkillRuntime 急速）→ 叠算（EffectiveStats 双层）→ 数据（seed 脚本 → xlsx → `npm run config` 再生成）。每步默认值设计成行为等价（新增维度 0 / 系数 1），现有 13 项 pacing 门槛全程全绿。

**Tech Stack:** TypeScript 5.8.2（tsconfig.game + tsconfig.tools 双编译）、tsx 单测、xlsx 导表管线（seed-*.ts → config-xlsx/*.xlsx → excel-to-config.ts → *.config.generated.ts）。

## Global Constraints

- 数值真源是 xlsx：改数值 = 改 `tools/seed-*.ts` → `npm run seed:*` → `npm run config`；**严禁手改 `*.config.generated.ts`**。产物 `.generated.ts` 与 xlsx 都入库。
- `MaterialId` 有限联合红线：`gem_${GemType}_${level}` 联合与 `Gems.maxLevel` 耦合，改上限必须同步拓宽联合类型（本计划 Task 6）。
- 逻辑与渲染分离：本计划全部改动在纯逻辑层（`combat/`/`config/`/`inventory/`/`inlay/`/`growth/`/`tools/`），不触 Cocos 渲染。
- 每任务收尾跑 `npm run typecheck && npm test`；整计划收尾跑 `npm run verify`（含 13 项 pacing 门槛，必须全绿——本计划所有默认值都设计为行为等价）。
- 提交规范：中文 commit，结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`；**是否允许逐任务提交需用户在执行前明确授权**，未授权则每任务只 `git add` 暂存，最后由用户决定。
- 热路径（BattleManager 每帧循环）不新增每帧对象分配：伤害标签用模块级常量复用。
- 工作区现有未提交改动全部属于 Codex 美术线，**不得混入**本计划的提交/暂存。

---

### Task 1: CombatStats 13→18 维全链贯通（默认 0，行为等价）

**Files:**
- Modify: `assets/scripts/config/BattleConfig.ts:17-31`（CombatStats 接口）
- Modify: `tools/excel-to-config.ts:51`、`:60`（nonNeg 校验清单 + STAT_KEYS）
- Modify: `tools/seed-battle-xlsx.ts:14-35`（Stats/EnemyTypes 表头与行）
- Modify: `assets/scripts/combat/EffectiveStats.ts:12-15`（STAT_KEYS）、`:22-33`（normalizeStats）
- Modify: `assets/scripts/debug/ConfigPanel.ts:23-37`（STAT_META）
- Test: `tools/combat-test.ts`（新增默认值断言）

**Interfaces:**
- Produces: `CombatStats` 新增 5 字段 `skillHaste/basicDmgBonus/skillDmgBonus/singleDmgBonus/aoeDmgBonus: number`（后续任务全部依赖）；`dmgBonus` 注释语义收窄为「全伤害加成」。

- [ ] **Step 1: 扩展 CombatStats 类型**

`BattleConfig.ts` 接口末尾（`moveSpeed` 之后）追加：

```ts
    skillHaste: number;     // 技能急速：计时型技能计时 ×(1+急速)；计数型所需普攻次数 ÷(1+急速)（向上取整，保底 1）
    basicDmgBonus: number;  // 普攻伤害加成（只吃普攻及普攻弹道）
    skillDmgBonus: number;  // 技能伤害加成（技能效果/技能弹道/场地/DoT）
    singleDmgBonus: number; // 单体伤害加成（本次结算目标数=1）
    aoeDmgBonus: number;    // 群体伤害加成（本次结算为 aoe/多目标）
```

并把 `dmgBonus` 行注释改为 `// 全伤害加成（无条件生效，攻击方，最终伤害 ×(1+合计加成)）`。

- [ ] **Step 2: 导表器认识新列**

`tools/excel-to-config.ts`：
- 第 51 行 `nonNeg` 数组追加 `'skillHaste', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus', 'aoeDmgBonus'`；
- 第 60 行 `STAT_KEYS` 数组末尾追加同样 5 个键。

- [ ] **Step 3: seed 加列（全 0）并核对 seed 与 xlsx 无漂移**

先跑防漂移检查：`npm run seed:battle && npm run config`，然后 `git diff --stat assets/scripts/config/battle.config.generated.ts tools/config-xlsx/battle.xlsx`。**预期改动为空或仅时间戳**；若出现数值 diff，说明 seed 落后于 xlsx 的近期手调——STOP，先把 diff 中的新值回写进 `seed-battle-xlsx.ts` 对应行再继续。

然后 `tools/seed-battle-xlsx.ts`：
- `STATS_HEADER`（14 列）末尾追加 `'skillHaste', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus', 'aoeDmgBonus'`；`STATS_ROWS` 三行各追加 `0, 0, 0, 0, 0`。
- `ENEMY_HEADER` 在 `'moveSpeed'` 与 `'exp'` **之间**插入同 5 列；`ENEMY_ROWS` 四行在 moveSpeed 值与 exp 值之间各插入 `0, 0, 0, 0, 0`（exp 必须仍是最后一列）。

- [ ] **Step 4: 聚合层与调参面板认识新维度**

`EffectiveStats.ts`：
- `STAT_KEYS` 数组末尾追加 5 个新键；
- `normalizeStats` 追加：

```ts
    st.skillHaste = Math.max(0, st.skillHaste);
    st.basicDmgBonus = Math.max(0, st.basicDmgBonus);
    st.skillDmgBonus = Math.max(0, st.skillDmgBonus);
    st.singleDmgBonus = Math.max(0, st.singleDmgBonus);
    st.aoeDmgBonus = Math.max(0, st.aoeDmgBonus);
```

`ConfigPanel.ts` `STAT_META` 末尾追加：

```ts
    { key: 'skillHaste',     label: '技能急速', min: 0, max: 2, step: 0.05 },
    { key: 'basicDmgBonus',  label: '普攻伤加成', min: 0, max: 2, step: 0.05 },
    { key: 'skillDmgBonus',  label: '技能伤加成', min: 0, max: 2, step: 0.05 },
    { key: 'singleDmgBonus', label: '单体伤加成', min: 0, max: 2, step: 0.05 },
    { key: 'aoeDmgBonus',    label: '群体伤加成', min: 0, max: 2, step: 0.05 },
```

- [ ] **Step 5: 重导 + 写失败中的断言测试**

跑 `npm run seed:battle && npm run config`。`tools/combat-test.ts` 追加用例（沿用该文件现有断言风格）：

```ts
// 18 维贯通：新增维度从 Excel 导出默认 0
{
    const st = BattleConfig.stats.tank;
    assert(st.skillHaste === 0 && st.basicDmgBonus === 0 && st.skillDmgBonus === 0
        && st.singleDmgBonus === 0 && st.aoeDmgBonus === 0, '新增 5 维默认应为 0');
}
```

- [ ] **Step 6: 验证等价**

Run: `npm run typecheck && npm test && npm run sim:pacing`
Expected: 全绿；pacing 13 门槛不动（新维度全 0 → 数值行为逐位等价）。

- [ ] **Step 7: 暂存/提交（按授权）**

```bash
git add assets/scripts/config/BattleConfig.ts tools/excel-to-config.ts tools/seed-battle-xlsx.ts assets/scripts/combat/EffectiveStats.ts assets/scripts/debug/ConfigPanel.ts tools/config-xlsx/battle.xlsx assets/scripts/config/battle.config.generated.ts tools/combat-test.ts
git commit -m "feat(属性): CombatStats 扩到 18 维——技能急速+伤害四拆全链贯通（默认 0 行为等价）"
```

---

### Task 2: 伤害标签（普攻/技能 × 单体/群体）

**Files:**
- Modify: `assets/scripts/combat/CombatFormula.ts`
- Modify: `assets/scripts/combat/Effects.ts:40`
- Modify: `assets/scripts/combat/BuffSystem.ts:11-38`（BuffInstance.srcMult）
- Modify: `assets/scripts/combat/BattleManager.ts`（打标点：`:497` 近战普攻、`:502` 普攻弹道、`:550` 瞬发技能、`:641` 场地、`:675` 弹道命中、`:734` 敌方普攻、`:181` DoT 结算、`:66` applyBuff 快照）
- Test: `tools/combat-test.ts`、`tools/effect-test.ts`、`tools/buff-test.ts`

**Interfaces:**
- Consumes: Task 1 的 5 个新 stats 字段。
- Produces: `DamageTags { source: 'basic'|'skill'; scope: 'single'|'aoe' }`；`calcDamage(att, def, tags?)`；`applyEffect(source, target, effect, hooks, floatKind?, tags?)`；`applyBuffStack(buffs, def, srcAtk, stacks?, srcMult?)`、`BuffInstance.srcMult: number`。

- [ ] **Step 1: 写失败测试（公式层）**

`tools/combat-test.ts` 追加（构造零随机面板：critRate/dodgeRate/blockRate 全 0）：

```ts
// 伤害标签：全伤害+来源+范围同乘区加算，三类不互乘
{
    const att = { ...BattleConfig.stats.dps, atk: 100, critRate: 0, dmgBonus: 0.1, basicDmgBonus: 0.2, skillDmgBonus: 0.3, singleDmgBonus: 0.05, aoeDmgBonus: 0.15 };
    const def = { ...BattleConfig.stats.tank, def: 0, dodgeRate: 0, blockRate: 0, dmgReduce: 0 };
    const basicSingle = calcDamage(att, def, { source: 'basic', scope: 'single' });
    assert(basicSingle.damage === Math.round(100 * (1 + 0.1 + 0.2 + 0.05)), `普攻单体应 ×1.35，实际 ${basicSingle.damage}`);
    const skillAoe = calcDamage(att, def, { source: 'skill', scope: 'aoe' });
    assert(skillAoe.damage === Math.round(100 * (1 + 0.1 + 0.3 + 0.15)), `技能群体应 ×1.55，实际 ${skillAoe.damage}`);
    const untagged = calcDamage(att, def);
    assert(untagged.damage === Math.round(100 * 1.1), `无标签只吃全伤害，实际 ${untagged.damage}`);
}
```

- [ ] **Step 2: 跑测确认失败**

Run: `npm run test:combat`（若无独立脚本则 `npx tsx tools/combat-test.ts`）
Expected: FAIL——`calcDamage` 不接受第三参（编译错）或数值断言失败。

- [ ] **Step 3: 公式层实现**

`CombatFormula.ts`：

```ts
// 伤害标签：来源（普攻/技能）× 范围（单体/群体），由攻击管线打标。
// 同乘区加算：最终加成 = 全伤害 + (普攻|技能) + (单体|群体)，整体 ×(1+合计)，三类不互乘。
export interface DamageTags { source: 'basic' | 'skill'; scope: 'single' | 'aoe' }

export function calcDamage(att: CombatStats, def: CombatStats, tags?: DamageTags): DamageResult {
```

第 43 行 `dmg *= (1 + att.dmgBonus);` 替换为：

```ts
    const srcBonus = tags ? (tags.source === 'basic' ? att.basicDmgBonus : att.skillDmgBonus) : 0;
    const scopeBonus = tags ? (tags.scope === 'single' ? att.singleDmgBonus : att.aoeDmgBonus) : 0;
    dmg *= (1 + att.dmgBonus + srcBonus + scopeBonus);
```

`Effects.ts` 第 40 行签名加尾参 `tags?: DamageTags`（import type 自 CombatFormula），`case 'damage'` 内 `calcDamage(source.stats, target.stats)` → `calcDamage(source.stats, target.stats, tags)`。

- [ ] **Step 4: 管线打标（BattleManager）**

模块顶部加常量（热路径零分配）：

```ts
const TAG_BASIC: DamageTags = { source: 'basic', scope: 'single' };
const TAG_SKILL_SINGLE: DamageTags = { source: 'skill', scope: 'single' };
const TAG_SKILL_AOE: DamageTags = { source: 'skill', scope: 'aoe' };
```

- `:497` 近战普攻与 `:734` 敌方普攻：`applyEffect(..., this._effectHooks)` → `applyEffect(..., this._effectHooks, undefined, TAG_BASIC)`。
- Projectile 增加字段 `tags: DamageTags`：`_spawnProjectile` 现有 `isBasicAttack` 参数处同步定标——普攻弹道 `TAG_BASIC`；技能弹道按投递形态：`pierce > 0` 或抛物(arc) → `TAG_SKILL_AOE`，否则 `TAG_SKILL_SINGLE`。`:675` 命中循环 `applyEffect(p, e, eff, this._effectHooks)` → 尾参 `p.tags`。
- `:550` 瞬发技能：cast 循环开头 `const tags = cast.targets.length > 1 ? TAG_SKILL_AOE : TAG_SKILL_SINGLE;`，`applyEffect(s, target, eff, this._effectHooks, 'skill')` → 尾参 `tags`。
- `:641` 场地：尾参 `TAG_SKILL_AOE`。

- [ ] **Step 5: DoT 吃技能伤害（快照乘数）**

`BuffSystem.ts`：`BuffInstance` 加 `srcMult: number`（注释：施加时快照 1+全伤害+技能伤害，DoT 结算乘它；HoT 不用）。`applyBuffStack` 签名加尾参 `srcMult = 1`，已有实例刷新处 `inst.srcMult = srcMult;`，新建实例字面量加 `srcMult`。

`Effects.ts` `case 'applyBuff'`：

```ts
            const srcMult = 1 + source.stats.dmgBonus + source.stats.skillDmgBonus;
            if (applyBuffStack(target.buffs, def, source.stats.atk, effect.stacks, srcMult)) recomputeDerived(target);
```

`BattleManager.ts:181` DoT 结算：`inst.srcAtk * eff.mult * inst.stacks` → `inst.srcAtk * eff.mult * inst.stacks * inst.srcMult`（治疗分支 `:187` 不乘）。裁定记录：DoT 属技能伤害、不吃单体/群体（周期伤害无目标数概念）。

- [ ] **Step 6: 补管线/DoT 测试**

`tools/effect-test.ts` 追加：带 `basicDmgBonus` 的攻击者走 `TAG_BASIC` 伤害变高、走 `TAG_SKILL_*` 不变；`tools/buff-test.ts` 追加：`applyBuffStack(..., srcMult=1.4)` 后按 `_onBuffPeriodic` 同式手算 `srcAtk×mult×stacks×srcMult` 断言（沿用两文件现有构造器写法）。

- [ ] **Step 7: 全量验证**

Run: `npm run typecheck && npm test && npm run sim:pacing`
Expected: 全绿。pacing 不动——现有单位新维度全 0，`(1+dmgBonus+0+0)` 与旧式逐位等价。

- [ ] **Step 8: 暂存/提交（按授权）**

```bash
git add assets/scripts/combat/CombatFormula.ts assets/scripts/combat/Effects.ts assets/scripts/combat/BuffSystem.ts assets/scripts/combat/BattleManager.ts tools/combat-test.ts tools/effect-test.ts tools/buff-test.ts
git commit -m "feat(战斗): 伤害标签落地——普攻/技能×单体/群体同乘区加算，DoT 快照吃技能伤害"
```

---

### Task 3: 技能急速（skillHaste）

**Files:**
- Modify: `assets/scripts/combat/SkillRuntime.ts:48-98`
- Modify: `assets/scripts/combat/BattleManager.ts:508-516`（_updateSkills）
- Test: `tools/skill-test.ts`

**Interfaces:**
- Consumes: `CombatStats.skillHaste`（Task 1）。
- Produces: `UnitSkills.haste: number`（每帧由 BattleManager 用当前面板刷新；Buff 增减急速自然生效）。

- [ ] **Step 1: 写失败测试**

`tools/skill-test.ts` 追加（沿用该文件现有 SkillDef 构造写法）：

```ts
// 技能急速：timer 型计时 ×(1+haste)；attackCount 型所需次数 ÷(1+haste) 向上取整、保底 1
{
    const us = new UnitSkills([timerSkillDef(10)]);   // triggerValue=10s 的 timer 技能
    us.haste = 1.0;
    us.tick(5);   // 5 秒 × (1+1.0) = 10 → 就绪
    assert(us.progress(0) >= 1, 'haste=1 时 5 秒应就绪');
}
{
    const us = new UnitSkills([countSkillDef(4)]);    // triggerValue=4 次的 attackCount 技能
    us.haste = 0.5;
    us.onBasicAttack(); us.onBasicAttack(); us.onBasicAttack();   // ceil(4/1.5)=3 次
    assert(us.progress(0) >= 1, 'haste=0.5 时 3 次普攻应就绪');
}
{
    const us = new UnitSkills([countSkillDef(2)]);
    us.haste = 9;                                     // ceil(2/10)=1 → 保底 1 次
    us.onBasicAttack();
    assert(us.progress(0) >= 1, '极高急速下保底 1 次普攻');
}
```

- [ ] **Step 2: 跑测确认失败**

Run: `npm run test:skill`（或 `npx tsx tools/skill-test.ts`）
Expected: FAIL——`haste` 属性不存在。

- [ ] **Step 3: 实现**

`SkillRuntime.ts` `UnitSkills`：

```ts
    // 技能急速（来自面板 skillHaste，BattleManager 每帧刷新；0 = 无加速）
    haste = 0;

    private _required(st: SkillState): number {
        if (st.def.trigger === 'timer') return st.def.triggerValue;
        return Math.max(1, Math.ceil(st.def.triggerValue / (1 + this.haste)));
    }
```

- `tick`：`st.timer += dt;` → `st.timer += dt * (1 + this.haste);`
- `progress`：`v / st.def.triggerValue` → `v / this._required(st)`
- `_ready`：`v >= st.def.triggerValue` → `v >= this._required(st)`

`BattleManager.ts` `_updateSkills` 内 `s.skills.tick(dt);` 前加一行：`s.skills.haste = s.stats.skillHaste;`

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm test && npm run sim:pacing`
Expected: 全绿（现有单位 haste 恒 0，行为等价）。

- [ ] **Step 5: 暂存/提交（按授权）**

```bash
git add assets/scripts/combat/SkillRuntime.ts assets/scripts/combat/BattleManager.ts tools/skill-test.ts
git commit -m "feat(技能): 技能急速——计时加速/计数需求折减（向上取整保底1），面板每帧刷新"
```

---

### Task 4: 装备/铭文双层叠算（固定值 + 百分比）

**Files:**
- Modify: `assets/scripts/inventory/EquipDefs.ts:8`、`:57-72`（EquipStatKey/标签/百分比/排序）
- Modify: `assets/scripts/combat/EffectiveStats.ts:35-66`（双层公式 + 等级乘全池）
- Modify: `tools/seed-equip-xlsx.ts`（Affixes 占位行）、`tools/seed-inlay-xlsx.ts`（Inscriptions 占位行）
- Modify: `tools/excel-to-config.ts`（equip/inlay 合法属性键白名单）
- Test: `tools/effective-stats-test.ts`

**Interfaces:**
- Consumes: Task 1 的新 CombatStats 键。
- Produces: `EquipStatKey` 新增 `'moveSpeed'|'hpPct'|'atkPct'|'defPct'|'moveSpeedPct'|'skillHaste'|'basicDmgBonus'|'skillDmgBonus'|'singleDmgBonus'|'aoeDmgBonus'`；`calcEffectiveStats(base, items, levelPct = 0)` 双层公式；`buildEffectiveStatsMap` 等级改为百分比乘全池（含 def）。

- [ ] **Step 1: 写失败测试**

`tools/effective-stats-test.ts` 追加：

```ts
// 双层公式：面板 = (白板+固定) × (1+百分比)；等级百分比乘全池且覆盖 def
{
    const base = { ...BattleConfig.stats.tank, hp: 1000, atk: 100, def: 50 };
    const item = { id: 't', slot: 'weapon', name: 'x', quality: 'common', level: 1,
                   stats: { atk: 40, atkPct: 0.10 } } as EquipItem;
    const out = calcEffectiveStats(base, [item], 0.20);   // levelPct=20%
    assert(out.atk === Math.round((100 + 40) * (1 + 0.10 + 0.20)), `atk 双层应 182，实际 ${out.atk}`);
    assert(out.hp === Math.round(1000 * 1.20), `hp 吃等级百分比，实际 ${out.hp}`);
    assert(out.def === Math.round(50 * 1.20), `def 也吃等级百分比（新行为），实际 ${out.def}`);
}
// moveSpeed 双形态 + 新二级属性走平铺
{
    const base = { ...BattleConfig.stats.dps };
    const item = { id: 't2', slot: 'shoes', name: 'x', quality: 'common', level: 1,
                   stats: { moveSpeed: 30, moveSpeedPct: 0.10, skillHaste: 0.15 } } as EquipItem;
    const out = calcEffectiveStats(base, [item]);
    assert(out.moveSpeed === Math.round((base.moveSpeed + 30) * 1.10), `移速双层，实际 ${out.moveSpeed}`);
    assert(Math.abs(out.skillHaste - 0.15) < 1e-9, `技能急速平铺，实际 ${out.skillHaste}`);
}
```

- [ ] **Step 2: 跑测确认失败**

Run: `npx tsx tools/effective-stats-test.ts`
Expected: FAIL——`atkPct` 不是合法 EquipStatKey（编译错）。

- [ ] **Step 3: EquipDefs 扩键**

`EquipDefs.ts:8` 替换为：

```ts
export type EquipStatKey = 'hp' | 'atk' | 'def' | 'range' | 'attackSpeed' | 'critRate' | 'critDmg'
    | 'dodgeRate' | 'blockRate' | 'blockRatio' | 'dmgBonus' | 'dmgReduce' | 'moveSpeed'
    | 'hpPct' | 'atkPct' | 'defPct' | 'moveSpeedPct'
    | 'skillHaste' | 'basicDmgBonus' | 'skillDmgBonus' | 'singleDmgBonus' | 'aoeDmgBonus';
```

`STAT_LABEL` 追加：`moveSpeed: '移速', hpPct: '生命%', atkPct: '攻击%', defPct: '防御%', moveSpeedPct: '移速%', skillHaste: '技能急速', basicDmgBonus: '普攻伤害', skillDmgBonus: '技能伤害', singleDmgBonus: '单体伤害', aoeDmgBonus: '群体伤害'`。
`PERCENT_STATS` 追加：`'hpPct', 'atkPct', 'defPct', 'moveSpeedPct', 'skillHaste', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus', 'aoeDmgBonus'`。
`STAT_ORDER` 末尾追加全部 10 个新键（moveSpeed 排 dmgReduce 后）。

- [ ] **Step 4: EffectiveStats 双层公式**

`EffectiveStats.ts` 替换 `calcEffectiveStats` 与 `buildEffectiveStatsMap`：

```ts
// 百分比键 → 作用的面板键（双层公式：面板 = (白板+固定) × (1+百分比合计)）
const PCT_MAP = { hpPct: 'hp', atkPct: 'atk', defPct: 'def', moveSpeedPct: 'moveSpeed' } as const;
type PctKey = keyof typeof PCT_MAP;
const PCT_KEYS = Object.keys(PCT_MAP) as PctKey[];

// levelPct：角色等级的三围百分比（乘全池，白板+装备+宝石一起放大；不作用 moveSpeed）
export function calcEffectiveStats(base: CombatStats, items: (EquipItem | null | undefined)[], levelPct = 0): CombatStats {
    const out: CombatStats = { ...base };
    const pct: Record<keyof typeof PCT_MAP extends never ? never : (typeof PCT_MAP)[PctKey], number> =
        { hp: levelPct, atk: levelPct, def: levelPct, moveSpeed: 0 };
    for (const item of items) {
        if (!item) continue;
        const inlay = itemInlayStats(item);
        for (const k of STAT_KEYS) {
            const bonus = (item.stats?.[k] ?? 0) + (inlay[k] ?? 0);
            if (bonus) out[k] += bonus;
        }
        for (const pk of PCT_KEYS) {
            const bonus = (item.stats?.[pk] ?? 0) + (inlay[pk] ?? 0);
            if (bonus) pct[PCT_MAP[pk]] += bonus;
        }
    }
    out.hp = Math.round(out.hp * (1 + pct.hp));
    out.atk = Math.round(out.atk * (1 + pct.atk));
    out.def = Math.round(out.def * (1 + pct.def));
    out.moveSpeed = Math.round(out.moveSpeed * (1 + pct.moveSpeed));
    return normalizeStats(out);
}

export function buildEffectiveStatsMap(
    equipped: CharEquipped | undefined,
    levels: Partial<Record<SoldierClass, number>> = {},
): EffectiveStatsMap {
    const map: EffectiveStatsMap = {};
    for (const c of CHARACTERS) {
        const cls = c as SoldierClass;
        const base = BattleConfig.stats[cls];
        if (!base) continue;
        const level = levels[cls];
        const slots = equipped?.[c];
        // 等级改为百分比乘全池（旧行为：只放大白板 hp/atk）；三围同幅，含 def
        map[cls] = calcEffectiveStats(base, slots ? SLOTS.map(s => slots[s]) : [], level ? charLevelCoef(level) - 1 : 0);
    }
    return map;
}
```

注意 `STAT_KEYS`（CombatStats 键集）与新 EquipStatKey 的交集自动覆盖 `moveSpeed/skillHaste/伤害四拆` 的平铺（Task 1 已加入）；百分比键单独走 `PCT_KEYS`。

- [ ] **Step 5: 词条/铭文池占位行 + 导表白名单**

`tools/seed-equip-xlsx.ts` `AFFIXES_ROWS` 追加占位行（数值占位，子计划 B 反解重写）：

```ts
    ['hpPct', 0.03], ['atkPct', 0.03], ['defPct', 0.03], ['moveSpeedPct', 0.03],
    ['skillHaste', 0.05], ['basicDmgBonus', 0.04], ['skillDmgBonus', 0.04],
```

`tools/seed-inlay-xlsx.ts` `INSCRIPTIONS_ROWS` 追加：

```ts
    ['atkPct', 0.02, 0.06], ['hpPct', 0.02, 0.06], ['defPct', 0.02, 0.06],
    ['singleDmgBonus', 0.02, 0.06], ['aoeDmgBonus', 0.02, 0.06], ['skillHaste', 0.03, 0.08],
```

（列序以两文件现有 HEADER 为准。）跑 `npm run seed:equip && npm run seed:inlay && npm run config`——若导表校验红字报"非法属性键"，把上述新键加进 `tools/excel-to-config.ts` 中 equip/inlay 解析器的合法键集合（红字会给出校验行号），再重跑至绿。

- [ ] **Step 6: 全量验证**

Run: `npm run typecheck && npm test && npm run sim:pacing`
Expected: 全绿。注意：`pacing-sim` 不传 levels，13 门槛不受"等级乘全池"影响；带等级的实际对局会略变强，属过渡态，子计划 B 统一重校（已在 spec 记录）。若 `effective-stats-test` 原有等级用例按旧公式断言（只放大白板 hp/atk），按新公式更新期望值并在断言消息里注明"2026-07-11 双层公式"。

- [ ] **Step 7: 暂存/提交（按授权）**

```bash
git add assets/scripts/inventory/EquipDefs.ts assets/scripts/combat/EffectiveStats.ts tools/seed-equip-xlsx.ts tools/seed-inlay-xlsx.ts tools/excel-to-config.ts tools/config-xlsx/equip.xlsx tools/config-xlsx/inlay.xlsx assets/scripts/config/equip.config.generated.ts assets/scripts/config/inlay.config.generated.ts tools/effective-stats-test.ts
git commit -m "feat(养成): 双层叠算落地——(白板+固定)×(1+百分比)，等级乘全池，词条/铭文池扩新维度"
```

---

### Task 5: 装备穿戴等级（需求 = 装备等级）

**Files:**
- Modify: `assets/scripts/inventory/InventoryModel.ts:212-233`（equip/equipFromWarehouse）
- Modify: `assets/scripts/BattleEntry.ts`（穿戴回调注入角色等级；grep `equip(` 定位）
- Test: `tools/inventory-test.ts`

**Interfaces:**
- Consumes: `EquipItem.level`（已有字段）、`CharacterGrowthModel.levelOf(cls)`（已有，BattleEntry 持有 `_growth`）。
- Produces: `equip(id, character, charLevel = Infinity)`、`equipFromWarehouse(id, character, charLevel = Infinity)`——不传 = 不校验（向后兼容全部旧调用与测试）。

- [ ] **Step 1: 写失败测试**

`tools/inventory-test.ts` 追加：

```ts
// 穿戴等级：需求=装备等级，只在穿戴时校验；不传 charLevel 不校验（兼容）
{
    const m = newModel();   // 沿用本文件现有构造辅助
    const item = { ...makeItem('weapon', 'common'), level: 12 };
    m.backpack.push(item);
    const r = m.equip(item.id, 'tank', 5);
    assert(!r.ok && /等级不足/.test(r.reason ?? ''), '角色 Lv5 穿 Lv12 装备应被拒');
    assert(m.backpack.some(it => it.id === item.id), '失败不得改动背包');
    assert(m.equip(item.id, 'tank', 12).ok, '等级刚好达标应可穿');
}
```

- [ ] **Step 2: 跑测确认失败**

Run: `npx tsx tools/inventory-test.ts`
Expected: FAIL——equip 第三参不存在/未校验。

- [ ] **Step 3: 实现（fail-before-mutate）**

`InventoryModel.equip`（`equipFromWarehouse` 同式）在 `findIndex` 判定后、`splice` 之前插入：

```ts
        const reqLevel = this.backpack[i].level ?? 1;   // 穿戴需求 = 装备等级（spec 5.2）
        if (reqLevel > charLevel) return fail(`角色等级不足（需 Lv.${reqLevel}）`);
```

签名：`equip(id: string, character: CharacterId, charLevel = Infinity): OpResult`。**不加任何读档校验**——老存档已穿戴的不强制脱（spec 裁定）。

- [ ] **Step 4: 接线**

`BattleEntry.ts` 中注入给背包/装备面板的穿戴回调处（grep `\.equip(` 与 `equipFromWarehouse(`），补第三参 `this._growth.levelOf(character)`。UI 侧失败提示走现有 `OpResult.reason` 通路，本任务不改面板渲染（灰化留给 UI 打磨）。

- [ ] **Step 5: 验证**

Run: `npm run typecheck && npm test`
Expected: 全绿（旧用例不传第三参 → Infinity → 行为不变）。

- [ ] **Step 6: 暂存/提交（按授权）**

```bash
git add assets/scripts/inventory/InventoryModel.ts assets/scripts/BattleEntry.ts tools/inventory-test.ts
git commit -m "feat(装备): 穿戴等级需求=装备等级——穿戴时校验，老存档不强制脱"
```

---

### Task 6: 角色等级上限 100 + 宝石 1~6 级（等比价值）

**Files:**
- Modify: `tools/seed-battle-xlsx.ts`（Misc 表 `charGrowth.maxLevel` 30→100）
- Modify: `assets/scripts/services/RewardTypes.ts:8`、`:30`（联合 1~6 + 标签循环）
- Modify: `tools/seed-inlay-xlsx.ts:12-17`（Gems 加 `levelRatio` 列、maxLevel 4→6）
- Modify: `assets/scripts/inlay/InlayConfig.ts:7`、`:36-41`（InlayGemDef.levelRatio + 等比 gemStatValue）
- Modify: `tools/excel-to-config.ts`（inlay 解析器读 levelRatio 列）
- Test: `tools/inlay-config-test.ts`、`tools/reward-types-test.ts`、`tools/char-growth-config-test.ts`

**Interfaces:**
- Produces: `GemMaterialId` = `gem_${GemType}_${1|2|3|4|5|6}`；`gemStatValue(type, level) = baseValue × levelRatio^(level-1)`（levelRatio 缺省 1 = 旧表兼容）。

- [ ] **Step 1: 写失败测试**

`tools/inlay-config-test.ts` 追加：

```ts
// 宝石 1~6 级等比价值：value = baseValue × ratio^(lv-1)
{
    const v1 = gemStatValue('atk', 1), v2 = gemStatValue('atk', 2), v6 = gemStatValue('atk', 6);
    const ratio = InlayConfig.gems.atk.levelRatio ?? 1;
    assert(ratio > 1, 'Gems 表应有 levelRatio 列（占位 1.6）');
    assert(Math.abs(v2 - v1 * ratio) < 1e-6, `2 级应为 1 级 ×${ratio}`);
    assert(Math.abs(v6 - v1 * Math.pow(ratio, 5)) < 1e-4, '6 级应为 1 级 ×ratio^5');
    assert(gemStatValue('atk', 99) === v6, '超上限钳到 maxLevel=6');
}
```

`tools/reward-types-test.ts` 追加：

```ts
assert(MATERIAL_LABEL['gem_atk_6'] === '攻击宝石·Lv.6', '标签应覆盖 1~6 级');
```

`tools/char-growth-config-test.ts` 追加：

```ts
assert(clampCharLevel(100) === 100 && clampCharLevel(101) === 100, '等级上限应为 100');
```

- [ ] **Step 2: 跑测确认失败**

Run: `npx tsx tools/inlay-config-test.ts`
Expected: FAIL——`levelRatio` 字段不存在。

- [ ] **Step 3: 实现**

- `RewardTypes.ts:8`：`` type GemMaterialId = `gem_${GemType}_${1 | 2 | 3 | 4 | 5 | 6}`; ``；`:30` 循环 `lv <= 4` → `lv <= 6`；第 7 行红线注释同步"1~6 与 Gems.maxLevel 耦合"。
- `InlayConfig.ts`：`InlayGemDef` 加 `levelRatio?: number`；`gemStatValue`：

```ts
export function gemStatValue(type: GemType, level: number): number {
    const def = InlayConfig.gems[type];
    if (!def) return 0;
    const clamped = Math.max(1, Math.min(gemMaxLevel(type), Math.floor(level)));
    // 等比价值（spec 5.3）：baseValue × ratio^(lv-1)；levelRatio 缺省 1 = 兼容旧线性表的 1 级值
    return def.baseValue * Math.pow(def.levelRatio ?? 1, clamped - 1);
}
```

- `seed-inlay-xlsx.ts`：`GEMS_HEADER` 加 `'levelRatio'`；五行 maxLevel 4→6、追加 `1.6`。首行注释更新为"宝石加成 = baseValue × levelRatio^(lv-1)，maxLevel 6 与 MaterialId 联合耦合"。
- `seed-battle-xlsx.ts` Misc 表：`charGrowth.maxLevel` 值 30→100。
- `excel-to-config.ts` inlay 解析器：Gems 行读 `levelRatio`（数值可选，缺省不写字段）。
- 跑 `npm run seed:inlay && npm run seed:battle && npm run config`。

**已知数值影响（占位期可接受，子计划 B 统一重解）**：旧线性 `base×lv` → 等比 `base×1.6^(lv-1)`，2~4 级宝石值有小幅漂移（如 atk 宝石 L4：120→122.88）；涉及旧断言按新公式更新。

- [ ] **Step 4: 全量验证**

Run: `npm run typecheck && npm test && npm run sim:pacing`
Expected: 全绿（pacing 不含宝石，无影响；`ChestService` 取 `gemMaxLevel` 自动适配 1~6，其奖励档位仍最高掉 3 级石，符合"第一章产出集中低级段"）。

- [ ] **Step 5: 暂存/提交（按授权）**

```bash
git add tools/seed-battle-xlsx.ts tools/seed-inlay-xlsx.ts tools/excel-to-config.ts assets/scripts/services/RewardTypes.ts assets/scripts/inlay/InlayConfig.ts tools/config-xlsx/battle.xlsx tools/config-xlsx/inlay.xlsx assets/scripts/config/battle.config.generated.ts assets/scripts/config/inlay.config.generated.ts tools/inlay-config-test.ts tools/reward-types-test.ts tools/char-growth-config-test.ts
git commit -m "feat(养成): 角色上限 100 级 + 宝石 1~6 级等比价值（MaterialId 联合同步拓宽）"
```

---

### Task 7: 终验与开发收尾

**Files:**
- Modify: `ai/memory/项目状态.md`、`ai/memory/代码地图.md`

- [ ] **Step 1: 全门禁**

Run: `npm run verify`
Expected: 双编译、全部单测、13 项 pacing 门槛、art、UI alpha 全绿。任何红项：修复后复跑，不带病收尾。

- [ ] **Step 2: 按 `ai/skills/开发收尾.md` 走收尾**

- `项目状态.md`「最近进展」加一条：属性系统扩展落地（18 维/伤害标签/技能急速/双层叠算/穿戴等级/Lv100/宝石 6 级），数值占位待子计划 B 反解；待办更新"数值平衡"进度。
- `代码地图.md`：CombatFormula（伤害标签）、SkillRuntime（haste）、EffectiveStats（双层公式）、InlayConfig（levelRatio）、RewardTypes（联合 1~6）各行职责描述同步；MaterialId 红线段落更新为 1~6。
- 方向性决策已在 spec，无需另记设计日志；如实施中出现偏离 spec 的裁定，回写 spec「偏差记录」节。

- [ ] **Step 3: 暂存/提交（按授权）**

```bash
git add ai/memory/项目状态.md ai/memory/代码地图.md
git commit -m "docs(memory): 属性系统扩展收尾——项目状态/代码地图同步 18 维与新机制"
```

---

## Self-Review 记录

- **Spec 覆盖**：spec §7.1→Task 1；§7.2→Task 2；§7.3→Task 3；§7.4→Task 4；§7.5→Task 5；§7.6→Task 6；§7.7/§7.8（balance-model、框架/校验）→**子计划 B**（spec §6 亦然）；§8 后置项未偷跑。§7.8 的"全量单测补铺"分散在各任务测试步。
- **类型一致性**：`DamageTags`/`applyEffect` 尾参/`applyBuffStack` 尾参/`calcEffectiveStats(…, levelPct)`/`equip(…, charLevel)` 在各任务 Interfaces 块口径一致。
- **行为等价链**：T1 新列全 0；T2 无标签=旧式、现有单位加成 0；T3 haste=0 等价；T4 pacing 不传 levels；T6 宝石小幅漂移已显式声明。pacing 全绿是每任务出口条件。
