# 自动技能系统（第一版：伤害类） 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 我方职业固定技能组自动释放（按时间 / 按普攻次数两种触发器），第一版只做伤害类，3 个技能按钮变冷却状态展示，数值经 sim:pacing 重校准。

**Architecture:** 纯逻辑技能状态机 `combat/SkillRuntime.ts`（不依赖 cc，可注入技能定义单测），`BattleManager` 只在两个钩子点（每帧 tick、普攻挥出）调用并负责伤害结算（仍走 `CombatFormula.calcDamage` 唯一入口）+ 吐 `skillCast` 事件；数值走导表管线新增 `skill.xlsx`；渲染只在 `BattleEntry`。

**Tech Stack:** TypeScript + tsx 单测、xlsx（SheetJS）种子/导表、Cocos 3.8.8（仅 BattleEntry 渲染层）。

**设计依据:** `docs/superpowers/specs/2026-07-04-auto-skill-system-design.md`。

## Global Constraints

- 数值只进 xlsx：改 `tools/seed-skill-xlsx.ts` 种子 → 重建 → `npm run config`；`.generated.ts` 产物入库、勿手改。
- 伤害结算只经 `CombatFormula.calcDamage`；`SkillRuntime`/`SkillConfig` 不 import cc。
- 中文 commit，结尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`；只 `git add` 指定文件。
- **当前在 master**：Task 1 第一步先切功能分支 `feat/skill-system`。
- 技能会抬高我方战力：Task 5 的 `sim:pacing` 重校准是**必做项**，13 门槛复绿才算完成。

---

### Task 1: 配置管线（skill.xlsx 种子 + 解析器 + 类型）

**Files:**
- Create: `tools/seed-skill-xlsx.ts`
- Create: `assets/scripts/config/SkillConfig.ts`
- Modify: `tools/excel-to-config.ts`（加 `buildSkillConfig` + `SOURCES` 一行）
- Modify: `package.json`（scripts 加 `seed:skill`）
- Regenerate: `tools/config-xlsx/skill.xlsx`、`assets/scripts/config/skill.config.generated.ts`

**Interfaces:**
- Produces: `SkillConfig.ts` 导出 `SkillDef`（`{ id, name, cls, trigger: 'timer'|'attackCount', triggerValue, target: 'aoe'|'nearest'|'single', radius, maxTargets, dmgMult }`）、`skillsForClass(cls: string): SkillDef[]`（保持配置行顺序）。Task 2/3/4 都依赖这两个导出。

- [ ] **Step 1: 切功能分支**

```powershell
git checkout -b feat/skill-system
```

- [ ] **Step 2: 写种子脚本**

Create `tools/seed-skill-xlsx.ts`（照 `tools/seed-chest-xlsx.ts` 的模板）：

```typescript
// skill.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/skill.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/skill.xlsx');

// 行顺序即 UI 按钮顺序（左→右）。数值为占位，经 `npm run sim:pacing` 校准后回填。
const SKILLS_HEADER = ['id', 'name', 'cls', 'trigger', 'triggerValue', 'target', 'radius', 'maxTargets', 'dmgMult'];
const SKILLS_ROWS: (string | number)[][] = [
    ['whirlwind',     '旋风斩',   'dps', 'attackCount', 8,  'aoe',     220, 0, 1.2],
    ['ground_smash',  '裂地击',   'dps', 'timer',       7,  'nearest', 0,   3, 1.8],
    ['lethal_strike', '致命一击', 'dps', 'attackCount', 15, 'single',  0,   0, 4.0],
];

const wb = XLSX.utils.book_new();

function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}

addSheet('Skills', SKILLS_HEADER, SKILLS_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Skills(${SKILLS_ROWS.length})`);
```

- [ ] **Step 3: 导表器加 skill 解析器**

`tools/excel-to-config.ts`：在 `buildCraftConfig` 函数结束后（`// ============ 源清单` 注释之前）插入：

```typescript
// ============ skill 模块解析器 ============
// 读 skill.xlsx 的 1 sheet → 技能配置（保持行顺序，UI 按顺序对应按钮）。
// Skills: id, name, cls, trigger, triggerValue, target, radius, maxTargets, dmgMult
function buildSkillConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_CLASSES = new Set(['tank', 'dps', 'healer']);   // 与 BattleConfig.SoldierClass 手写 union 对齐
    const VALID_TRIGGERS = new Set(['timer', 'attackCount']);
    const VALID_TARGETS = new Set(['aoe', 'nearest', 'single']);

    const { rows } = sheetToRows(wb, 'Skills');
    const skills: unknown[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
        const id = reqStr(r['id'], 'Skills.id');
        if (seen.has(id)) err(`Skills: id "${id}" 重复定义`);
        seen.add(id);
        const cls = reqStr(r['cls'], `Skills[${id}].cls`);
        if (!VALID_CLASSES.has(cls)) err(`Skills[${id}]: cls "${cls}" 非法（须为 tank/dps/healer）`);
        const trigger = reqStr(r['trigger'], `Skills[${id}].trigger`);
        if (!VALID_TRIGGERS.has(trigger)) err(`Skills[${id}]: trigger "${trigger}" 非法（timer/attackCount）`);
        const target = reqStr(r['target'], `Skills[${id}].target`);
        if (!VALID_TARGETS.has(target)) err(`Skills[${id}]: target "${target}" 非法（aoe/nearest/single）`);
        const triggerValue = reqNum(r['triggerValue'], `Skills[${id}].triggerValue`);
        if (triggerValue <= 0) err(`Skills[${id}].triggerValue 必须 > 0`);
        const radius = reqNum(r['radius'], `Skills[${id}].radius`);
        const maxTargets = reqNum(r['maxTargets'], `Skills[${id}].maxTargets`);
        if (target === 'aoe' && radius <= 0) err(`Skills[${id}]: target=aoe 时 radius 必须 > 0`);
        if (target === 'nearest' && maxTargets <= 0) err(`Skills[${id}]: target=nearest 时 maxTargets 必须 > 0`);
        const dmgMult = reqNum(r['dmgMult'], `Skills[${id}].dmgMult`);
        if (dmgMult <= 0) err(`Skills[${id}].dmgMult 必须 > 0`);
        skills.push({ id, name: reqStr(r['name'], `Skills[${id}].name`), cls, trigger, triggerValue, target, radius, maxTargets, dmgMult });
    }
    if (skills.length === 0) err('Skills: 至少需要 1 个技能');
    const config = { skills };
    const summary = `skills=${skills.length}`;
    return { config, summary };
}
```

`SOURCES` 数组末尾（craft 条目后）加：

```typescript
    {
        name: 'skill',
        xlsxRel: 'config-xlsx/skill.xlsx',
        outRel: '../assets/scripts/config/skill.config.generated.ts',
        exportVar: 'generatedSkillConfig',
        build: buildSkillConfig,
    },
```

- [ ] **Step 4: 写类型与访问层**

Create `assets/scripts/config/SkillConfig.ts`：

```typescript
// 技能配置。
// ★★★ 数值由 Excel 管理 ★★★
//    源文件：tools/config-xlsx/skill.xlsx
//    改数值流程：编辑 Excel → 跑 `npm run config` → 生成 skill.config.generated.ts
//    本文件只保留 TypeScript 类型定义与查询辅助。

import { generatedSkillConfig } from './skill.config.generated';

export type SkillTrigger = 'timer' | 'attackCount';
export type SkillTarget = 'aoe' | 'nearest' | 'single';

export interface SkillDef {
    id: string;
    name: string;
    cls: string;              // 归属职业（tank/dps/healer）
    trigger: SkillTrigger;
    triggerValue: number;     // 秒数（timer）或普攻次数（attackCount）
    target: SkillTarget;
    radius: number;           // aoe 用
    maxTargets: number;       // nearest 用
    dmgMult: number;          // 伤害倍率（乘在 calcDamage 结果上）
}

export interface SkillConfigShape {
    skills: SkillDef[];
}

export const SkillConfig = generatedSkillConfig as SkillConfigShape;

// 某职业的技能列表（保持配置行顺序 = UI 按钮顺序）
export function skillsForClass(cls: string): SkillDef[] {
    return SkillConfig.skills.filter(s => s.cls === cls);
}
```

- [ ] **Step 5: 加 npm script 并生成**

`package.json` scripts 的 `"seed:craft"` 之后加：

```json
    "seed:skill": "tsx tools/seed-skill-xlsx.ts",
```

Run: `npm run seed:skill; npm run config`
Expected: `✓ 已生成 ...skill.xlsx`；config 输出多一行 `✓ [skill] 已生成 ... skills=3`，其余源不变全 `✓`。

- [ ] **Step 6: 提交**

```powershell
git add tools/seed-skill-xlsx.ts tools/excel-to-config.ts assets/scripts/config/SkillConfig.ts package.json tools/config-xlsx/skill.xlsx assets/scripts/config/skill.config.generated.ts
git commit -m @'
feat(skill): skill.xlsx 导表管线 + SkillConfig 类型层

3 个 dps 占位技能（旋风斩/裂地击/致命一击），两种触发器、三种目标选择。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@ -- tools/seed-skill-xlsx.ts tools/excel-to-config.ts assets/scripts/config/SkillConfig.ts package.json tools/config-xlsx/skill.xlsx assets/scripts/config/skill.config.generated.ts
```

（`npm run config` 会顺带刷新其它 `.generated.ts` 的时间戳行，不属于本任务，提交前 `git checkout -- assets/scripts/config/battle.config.generated.ts assets/scripts/config/equip.config.generated.ts assets/scripts/config/drop.config.generated.ts assets/scripts/config/chest.config.generated.ts assets/scripts/config/offline.config.generated.ts assets/scripts/config/craft.config.generated.ts` 还原。）

---

### Task 2: SkillRuntime 纯逻辑（TDD）

**Files:**
- Create: `assets/scripts/combat/SkillRuntime.ts`
- Test: `tools/skill-test.ts`
- Modify: `package.json`（scripts 加 `test:skill`）

**Interfaces:**
- Consumes: Task 1 的 `SkillDef` / `skillsForClass`。
- Produces（Task 3/4 依赖）:
  - `interface SkillTargetable { x: number; y: number; alive: boolean }`
  - `class UnitSkills`：`constructor(defs: SkillDef[])`、`tick(dt: number)`、`onBasicAttack()`、`collectCasts<T extends SkillTargetable>(cx, cy, enemies: readonly T[], currentTarget: T | null): { def: SkillDef; targets: T[] }[]`、`progress(i: number): number`（0~1，就绪钳 1）、`get count(): number`、`defAt(i): SkillDef | undefined`
  - `function unitSkillsForClass(cls: string): UnitSkills`
  - `function selectTargets<T extends SkillTargetable>(def, cx, cy, enemies, currentTarget): T[]`

- [ ] **Step 1: 写失败测试**

Create `tools/skill-test.ts`：

```typescript
// 技能系统测试（纯逻辑，tsx 运行）。
import assert from 'node:assert/strict';
import { UnitSkills, selectTargets, unitSkillsForClass, type SkillTargetable } from '../assets/scripts/combat/SkillRuntime';
import type { SkillDef } from '../assets/scripts/config/SkillConfig';
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

function mkDef(partial: Partial<SkillDef>): SkillDef {
    return {
        id: 'test', name: '测试', cls: 'dps',
        trigger: 'timer', triggerValue: 5,
        target: 'single', radius: 0, maxTargets: 0, dmgMult: 1,
        ...partial,
    };
}

function mkEnemy(x: number, y: number, alive = true): SkillTargetable { return { x, y, alive }; }

test('timer 技能：计时到点且有目标才释放，释放后重置', () => {
    const sk = new UnitSkills([mkDef({ trigger: 'timer', triggerValue: 5, target: 'single' })]);
    const target = mkEnemy(10, 0);
    sk.tick(4.9);
    assert.equal(sk.collectCasts(0, 0, [target], target).length, 0);
    sk.tick(0.2);
    const casts = sk.collectCasts(0, 0, [target], target);
    assert.equal(casts.length, 1);
    assert.deepEqual(casts[0].targets, [target]);
    assert.equal(sk.collectCasts(0, 0, [target], target).length, 0);
    assert.ok(sk.progress(0) < 1);
});

test('attackCount 技能：攒满普攻次数触发并重置', () => {
    const sk = new UnitSkills([mkDef({ trigger: 'attackCount', triggerValue: 3 })]);
    const t = mkEnemy(0, 0);
    sk.onBasicAttack(); sk.onBasicAttack();
    assert.equal(sk.collectCasts(0, 0, [t], t).length, 0);
    sk.onBasicAttack();
    assert.equal(sk.collectCasts(0, 0, [t], t).length, 1);
    assert.equal(sk.progress(0), 0);
});

test('无目标时保留待放，出现目标后释放一次且只一次', () => {
    const sk = new UnitSkills([mkDef({ trigger: 'timer', triggerValue: 1 })]);
    sk.tick(3);
    assert.equal(sk.collectCasts(0, 0, [], null).length, 0);
    assert.equal(sk.progress(0), 1);
    const t = mkEnemy(0, 0);
    assert.equal(sk.collectCasts(0, 0, [t], t).length, 1);
    assert.equal(sk.collectCasts(0, 0, [t], t).length, 0);
});

test('selectTargets：aoe 只命中半径内活敌', () => {
    const def = mkDef({ target: 'aoe', radius: 100 });
    const near = mkEnemy(50, 0), far = mkEnemy(500, 0), dead = mkEnemy(10, 0, false);
    assert.deepEqual(selectTargets(def, 0, 0, [near, far, dead], null), [near]);
});

test('selectTargets：nearest 按距离升序取前 N 个', () => {
    const def = mkDef({ target: 'nearest', maxTargets: 2 });
    const a = mkEnemy(10, 0), b = mkEnemy(20, 0), c = mkEnemy(30, 0);
    assert.deepEqual(selectTargets(def, 0, 0, [c, a, b], null), [a, b]);
});

test('selectTargets：single 只打当前目标，目标死亡/为空则不选', () => {
    const def = mkDef({ target: 'single' });
    const t = mkEnemy(10, 0);
    assert.deepEqual(selectTargets(def, 0, 0, [t], t), [t]);
    assert.deepEqual(selectTargets(def, 0, 0, [t], mkEnemy(0, 0, false)), []);
    assert.deepEqual(selectTargets(def, 0, 0, [t], null), []);
});

test('unitSkillsForClass(dps) 装载配置中的 3 个技能', () => {
    const sk = unitSkillsForClass('dps');
    assert.equal(sk.count, 3);
    assert.ok(sk.defAt(0));
});

let failed = 0;
for (const t of tests) {
    try {
        t.run();
        console.log(`  ✓ ${t.name}`);
    } catch (e) {
        failed++;
        console.error(`  ✗ ${t.name}`);
        console.error(e);
    }
}

console.log(`\n技能测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
```

`package.json` scripts 的 `"test:craft"` 之后加：

```json
    "test:skill": "tsx tools/skill-test.ts",
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:skill`
Expected: 报错 `Cannot find module '.../combat/SkillRuntime'`（模块不存在）。

- [ ] **Step 3: 实现 SkillRuntime**

Create `assets/scripts/combat/SkillRuntime.ts`：

```typescript
// 技能运行态（SkillRuntime）—— 纯逻辑，不依赖 cc。
// 每个单位持一份 UnitSkills（挂在单位实例上，后续 Boss 技能可复用）：
// 装载技能定义，维护计时/计数；触发条件满足但选不到目标时保留待放，
// 有目标的第一帧释放并重置。伤害结算不在这里——BattleManager 拿到
// collectCasts 结果后走 CombatFormula.calcDamage。

import { SkillDef, skillsForClass } from '../config/SkillConfig';

export interface SkillTargetable {
    x: number;
    y: number;
    alive: boolean;
}

interface SkillState {
    def: SkillDef;
    timer: number;          // timer 型已积累秒数（就绪后继续积累无副作用，释放时清零）
    attackCounter: number;  // attackCount 型已积累普攻次数
}

export interface SkillCast<T extends SkillTargetable> {
    def: SkillDef;
    targets: T[];
}

export function selectTargets<T extends SkillTargetable>(
    def: SkillDef, cx: number, cy: number, enemies: readonly T[], currentTarget: T | null,
): T[] {
    if (def.target === 'single') {
        return currentTarget && currentTarget.alive ? [currentTarget] : [];
    }
    const alive = enemies.filter(e => e.alive);
    if (def.target === 'aoe') {
        const r2 = def.radius * def.radius;
        return alive.filter(e => {
            const dx = e.x - cx, dy = e.y - cy;
            return dx * dx + dy * dy <= r2;
        });
    }
    // nearest：按距离升序取前 maxTargets 个
    return alive
        .map(e => ({ e, d: (e.x - cx) * (e.x - cx) + (e.y - cy) * (e.y - cy) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, Math.max(1, Math.floor(def.maxTargets)))
        .map(x => x.e);
}

export class UnitSkills {
    private states: SkillState[];

    constructor(defs: SkillDef[]) {
        this.states = defs.map(def => ({ def, timer: 0, attackCounter: 0 }));
    }

    get count(): number { return this.states.length; }
    defAt(i: number): SkillDef | undefined { return this.states[i]?.def; }

    tick(dt: number) {
        for (const st of this.states) {
            if (st.def.trigger === 'timer') st.timer += dt;
        }
    }

    onBasicAttack() {
        for (const st of this.states) {
            if (st.def.trigger === 'attackCount') st.attackCounter += 1;
        }
    }

    // 触发进度 0~1（就绪后钳在 1），渲染层画遮罩直接用
    progress(i: number): number {
        const st = this.states[i];
        if (!st) return 0;
        const v = st.def.trigger === 'timer' ? st.timer : st.attackCounter;
        return Math.max(0, Math.min(1, v / st.def.triggerValue));
    }

    private _ready(st: SkillState): boolean {
        const v = st.def.trigger === 'timer' ? st.timer : st.attackCounter;
        return v >= st.def.triggerValue;
    }

    // 收集本帧可释放的技能：就绪且选得到目标才出手并重置；选不到目标保留待放
    collectCasts<T extends SkillTargetable>(
        cx: number, cy: number, enemies: readonly T[], currentTarget: T | null,
    ): SkillCast<T>[] {
        const casts: SkillCast<T>[] = [];
        for (const st of this.states) {
            if (!this._ready(st)) continue;
            const targets = selectTargets(st.def, cx, cy, enemies, currentTarget);
            if (targets.length === 0) continue;   // 保留待放
            if (st.def.trigger === 'timer') st.timer = 0;
            else st.attackCounter = 0;
            casts.push({ def: st.def, targets });
        }
        return casts;
    }
}

export function unitSkillsForClass(cls: string): UnitSkills {
    return new UnitSkills(skillsForClass(cls));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:skill`
Expected: 7 项全 ✓（`技能测试：7 通过，0 失败`）。

- [ ] **Step 5: 提交**

```powershell
git add assets/scripts/combat/SkillRuntime.ts tools/skill-test.ts package.json
git commit -m @'
feat(skill): SkillRuntime 纯逻辑状态机（TDD）

计时/计数触发、无目标保留待放、aoe/nearest/single 三种目标选择。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@ -- assets/scripts/combat/SkillRuntime.ts tools/skill-test.ts package.json
```

---

### Task 3: BattleManager 接入 + skillCast 事件

**Files:**
- Modify: `assets/scripts/combat/BattleManager.ts`（Soldier 加 skills、事件 union、两个钩子、`_updateSkills`、`_applySkillDamage`、`_spawnFloat` 加 kind 覆盖、FloatText kind 加 `'skill'`）
- Modify: `tools/combat-test.ts`（事件按 type 过滤）
- Test: `tools/skill-test.ts`（追加集成测试）

**Interfaces:**
- Consumes: Task 2 的 `UnitSkills` / `unitSkillsForClass`。
- Produces（Task 4 依赖）:
  - `Soldier.skills: UnitSkills`
  - `BattleEvent = EnemyKilledEvent | SkillCastEvent`；`SkillCastEvent = { type: 'skillCast'; skillId: string; skillName: string; casterCls: SoldierClass; hits: { damage: number; crit: boolean; dodged: boolean }[] }`
  - `FloatText.kind` 增加 `'skill'`

- [ ] **Step 1: 在 `tools/skill-test.ts` 追加失败的集成测试**

在 `let failed = 0;` 之前插入：

```typescript
test('BattleManager 集成：战斗产生 skillCast 事件，enemyKilled 计数不受影响', () => {
    const mgr = new BattleManager(470, 836, 0, {
        dps: { ...BattleConfig.stats.dps, hp: 99999, atk: 99999, range: 2000, attackSpeed: 20, critRate: 0, dodgeRate: 0 },
    });
    const events: import('../assets/scripts/combat/BattleManager').BattleEvent[] = [];
    for (let i = 0; i < 4000 && mgr.phase !== 'won'; i++) {
        mgr.tick(0.05);
        events.push(...mgr.drainEvents());
    }
    events.push(...mgr.drainEvents());
    assert.equal(mgr.phase, 'won');

    const casts = events.filter(e => e.type === 'skillCast');
    assert.ok(casts.length > 0, '应至少释放一次技能');
    for (const c of casts) {
        assert.ok(c.type === 'skillCast' && c.hits.length > 0, '每次释放至少命中一个目标');
        if (c.type === 'skillCast') for (const h of c.hits) assert.ok(h.dodged || h.damage > 0);
    }

    let total = 0;
    for (const w of BattleConfig.levels[0].waves) for (const s of w.spawns) total += s.count;
    assert.equal(events.filter(e => e.type === 'enemyKilled').length, total);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:skill`
Expected: 集成测试 ✗（`应至少释放一次技能` —— BattleManager 还没接技能）。

- [ ] **Step 3: 改 BattleManager**

`assets/scripts/combat/BattleManager.ts` 五处改动：

① import 区加：

```typescript
import { UnitSkills, unitSkillsForClass } from './SkillRuntime';
```

② `Soldier` 接口（`actionLock: number;` 之后）加一行；`FloatText` 的 kind union 加 `'skill'`；`BattleEvent` 改为 union（原 `BattleEvent` 接口改名 `EnemyKilledEvent`，新增 `SkillCastEvent`）：

```typescript
    skills: UnitSkills;   // 该单位的自动技能运行态（挂实例上，Boss 技能后续可复用）
```

```typescript
    kind: 'normal' | 'crit' | 'block' | 'dodge' | 'skill';
```

```typescript
export interface EnemyKilledEvent {
    type: 'enemyKilled';
    levelIndex: number;
    waveIndex: number;
    enemyType: string;
    killIndex: number;
    isStageFinalKill: boolean;
}

export interface SkillCastEvent {
    type: 'skillCast';
    skillId: string;
    skillName: string;
    casterCls: SoldierClass;
    hits: { damage: number; crit: boolean; dodged: boolean }[];
}

export type BattleEvent = EnemyKilledEvent | SkillCastEvent;
```

③ `_setupSquad` 里 `this.soldiers.push({...})` 对象加一行：

```typescript
                skills: unitSkillsForClass(cls),
```

④ `_updateFiring` 里 `s.cd = s.fireInterval / Math.max(0.01, s.stats.attackSpeed);` 之后（melee/ranged 分支之前）加：

```typescript
            s.skills.onBasicAttack();   // 普攻挥出计数（不管命中与否）
```

`tick(dt)` 里 `this._updateFiring(dt);` 之后加一行 `this._updateSkills(dt);`。

⑤ 类内（`_updateFiring` 之后）加两个方法，并给 `_spawnFloat` 加可选 kind 覆盖参数：

```typescript
    // —— 自动技能：计时/计数就绪且有目标即释放；伤害走唯一公式 × 技能倍率 ——
    private _updateSkills(dt: number) {
        for (const s of this.soldiers) {
            if (!s.alive) continue;
            s.skills.tick(dt);
            const currentTarget = s.attackType === 'melee'
                ? this._frontmostEnemy()
                : this._nearestEnemy(s.x, s.y);
            const casts = s.skills.collectCasts(s.x, s.y, this.enemies, currentTarget);
            for (const cast of casts) {
                const hits: SkillCastEvent['hits'] = [];
                for (const target of cast.targets) {
                    if (!target.alive) continue;
                    hits.push(this._applySkillDamage(s.stats, target, cast.def.dmgMult));
                }
                this._setAction(s, 'attack', ATTACK_ACTION_HOLD);
                this.events.push({
                    type: 'skillCast',
                    skillId: cast.def.id,
                    skillName: cast.def.name,
                    casterCls: s.cls,
                    hits,
                });
            }
        }
    }

    private _applySkillDamage(att: CombatStats, defender: Enemy, mult: number): { damage: number; crit: boolean; dodged: boolean } {
        const r = calcDamage(att, defender.stats);
        const damage = r.dodged ? 0 : Math.max(1, Math.round(r.damage * mult));
        defender.hp -= damage;
        this._spawnFloat(defender.x, defender.y, { ...r, damage }, 'skill');
        if (defender.hp <= 0) this._markDead(defender);
        return { damage, crit: r.crit, dodged: r.dodged };
    }
```

`_spawnFloat` 签名与 kind 推导改为：

```typescript
    private _spawnFloat(x: number, y: number, r: DamageResult, kindOverride?: FloatText['kind']) {
        let text: string;
        let kind: FloatText['kind'];
        if (r.dodged) { text = '闪避'; kind = 'dodge'; }
        else {
            text = String(r.damage);
            kind = kindOverride ?? (r.crit ? 'crit' : (r.blocked ? 'block' : 'normal'));
        }
```

（函数其余部分不动。）

- [ ] **Step 4: 修 combat-test 的事件过滤**

`tools/combat-test.ts` 两个测试都在 `events.push(...mgr.drainEvents());`（循环外那句）之后加一行过滤，并把后续断言里的 `events` 换成 `kills`：

第一个测试：

```typescript
    const kills = events.filter(event => event.type === 'enemyKilled');
    assert.equal(mgr.phase, 'won');
    assert.equal(kills.length, monsterCount(0));
    assert.equal(new Set(kills.map(event => event.killIndex)).size, kills.length);
```

第二个测试：

```typescript
    const kills = events.filter(event => event.type === 'enemyKilled');
    const finals = kills.filter(event => event.isStageFinalKill);
    assert.equal(finals.length, 1);
    assert.equal(finals[0], kills[kills.length - 1]);
    assert.equal(finals[0].waveIndex, BattleConfig.levels[0].waves.length - 1);
```

（TypeScript 窄化：`kills` 过滤后元素是 union，用 `event.type === 'enemyKilled'` 过滤后若类型不窄化，改为 `events.filter((event): event is import('../assets/scripts/combat/BattleManager').EnemyKilledEvent => event.type === 'enemyKilled')`。）

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run test:skill; npm run test:combat`
Expected: 技能测试 8 项全 ✓；战斗事件测试 2 项全 ✓。

- [ ] **Step 6: 提交**

```powershell
git add assets/scripts/combat/BattleManager.ts tools/skill-test.ts tools/combat-test.ts
git commit -m @'
feat(skill): BattleManager 接入自动技能与 skillCast 事件

普攻挥出计数 + 每帧计时，就绪有目标即放；伤害 calcDamage×倍率，飘字 kind=skill。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@ -- assets/scripts/combat/BattleManager.ts tools/skill-test.ts tools/combat-test.ts
```

---

### Task 4: BattleEntry 技能按钮状态展示

**Files:**
- Modify: `assets/scripts/BattleEntry.ts`（事件消费过滤 + 技能状态 Graphics 层 + 闪光计时 + 飘字颜色）

**Interfaces:**
- Consumes: Task 3 的 `BattleEvent` union、`Soldier.skills`（`count`/`progress(i)`/`defAt(i)`）。
- Produces: 无（渲染终点）。人工网页预览验收。

- [ ] **Step 1: 事件消费按 type 过滤**

用 Grep 定位 `const events = this._mgr.drainEvents();`（在宝箱掉落消费函数里，约 2046 行）。把后面的 `for (const event of events) {` 循环体开头改为：

```typescript
        for (const event of events) {
            if (event.type === 'skillCast') {
                this._onSkillCast(event);
                continue;
            }
            const level = BattleConfig.levels[event.levelIndex];
```

（其余原逻辑不动——`enemyKilled` 分支照旧。）import 区把 `BattleManager` 的类型导入补上 `SkillCastEvent`（该文件顶部已有从 `./combat/BattleManager` 的 import，追加即可）。

- [ ] **Step 2: 加技能状态层与闪光**

类字段区加：

```typescript
    private _skillGfx: Graphics | null = null;
    private _skillFlash: number[] = [0, 0, 0];   // 每个按钮的释放闪光剩余秒数
```

`_onSkillCast`（放在事件消费函数附近）：

```typescript
    private _onSkillCast(event: SkillCastEvent) {
        const sk = this._skillSource();
        if (!sk) return;
        for (let i = 0; i < Math.min(3, sk.count); i++) {
            if (sk.defAt(i)?.id === event.skillId) { this._skillFlash[i] = 0.3; break; }
        }
    }

    // 技能 UI 的数据源：第一个有技能的存活士兵（当前=单人 dps）
    private _skillSource() {
        if (!this._mgr) return null;
        const s = this._mgr.soldiers.find(u => u.alive && u.skills.count > 0);
        return s ? s.skills : null;
    }
```

在 `onLoad` 里创建 `StyledUi`（`this._uiRoot`）之后追加一个 Graphics 节点（盖在切片上方）：

```typescript
        const skillGfxNode = new Node('SkillStatusGfx');
        skillGfxNode.layer = this.node.layer;
        skillGfxNode.addComponent(UITransform);
        this._skillGfx = skillGfxNode.addComponent(Graphics);
        this._battleRoot.addChild(skillGfxNode);
        skillGfxNode.setPosition(0, 0, 0);
```

- [ ] **Step 3: 每帧绘制进度遮罩与闪光**

在 `update(dt)` 里（`this._mgr.tick(...)` 之后、渲染调用附近）加 `this._renderSkillStatus(dt);`，实现：

```typescript
    // 技能按钮状态：未就绪部分盖半透明遮罩（进度从下往上点亮），释放瞬间白光一闪
    private _renderSkillStatus(dt: number) {
        const g = this._skillGfx;
        if (!g) return;
        g.clear();
        const sk = this._skillSource();
        if (!sk) return;
        const rects = [UI_RECTS.skill1, UI_RECTS.skill2, UI_RECTS.skill3];
        for (let i = 0; i < Math.min(3, sk.count); i++) {
            const box = this._sourceRect(rects[i]);
            const p = sk.progress(i);
            if (p < 1) {
                g.fillColor = this._tmpColor.set(0, 0, 0, 140);
                g.rect(box.x - box.w / 2, box.y - box.h / 2 + box.h * p, box.w, box.h * (1 - p));
                g.fill();
            }
            if (this._skillFlash[i] > 0) {
                this._skillFlash[i] = Math.max(0, this._skillFlash[i] - dt);
                g.fillColor = this._tmpColor.set(255, 255, 255, Math.round(160 * (this._skillFlash[i] / 0.3)));
                g.rect(box.x - box.w / 2, box.y - box.h / 2, box.w, box.h);
                g.fill();
            }
        }
    }
```

（`this._sourceRect(rect)` 是现有方法——`_makeUiHotZone` 用它把 1080×1920 设计稿 rect 映射为本地中心坐标 `{x,y,w,h}`；`this._tmpColor` 是现有临时色对象。若 `_tmpColor` 在 Graphics 用法上与 Label 冲突，就地 `new Color(...)` 一次性创建三个常量色缓存在字段里，避免每帧 new。）

- [ ] **Step 4: 技能飘字颜色**

定位 `_renderFloats` 的 `switch (ft.kind)`（约 1880 行），`case 'block'` 之后加：

```typescript
                case 'skill': lb.fontSize = 36; lb.color = this._tmpColor.set(120, 235, 255, a); break;
```

- [ ] **Step 5: 全套测试 + 人工预览验收**

Run: `npm run test:skill; npm run test:combat; npm run test:services; npm run test:drop; npm run test:inventory; npm run test:effective; npm run test:progression; npm run test:craft`
Expected: 全绿。

人工（Cocos 编辑器网页预览，执行者若无法运行则在提交信息和汇报里注明"UI 部分待人工预览"）：开战后 3 个技能按钮出现进度遮罩自下而上消退；旋风斩（普攻 8 次）最先亮起并闪光；敌人头上出现青蓝色技能伤害飘字。

- [ ] **Step 6: 提交**

```powershell
git add assets/scripts/BattleEntry.ts
git commit -m @'
feat(skill): 技能按钮变冷却状态展示 + 技能飘字

进度遮罩自下而上点亮、就绪满亮、释放白光一闪；skillCast 事件与宝箱击杀消费分流。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@ -- assets/scripts/BattleEntry.ts
```

---

### Task 5: sim:pacing 重校准 + 收尾

**Files:**
- Modify（按校准结果）: `tools/seed-skill-xlsx.ts`、`tools/seed-battle-xlsx.ts`、`tools/config-xlsx/skill.xlsx`、`tools/config-xlsx/battle.xlsx`、对应 `.generated.ts`
- Modify: `ai/memory/项目状态.md`、`ai/memory/设计日志.md`、`ai/memory/代码地图.md`

**Interfaces:**
- Consumes: Task 3 接入后的 BattleManager（`pacing-sim.ts` 无需改动，技能在模拟中自动生效）。
- Produces: 13 门槛复绿的最终数值；同步后的项目记忆。

- [ ] **Step 1: 跑节奏回归**

Run: `npm run sim:pacing`
Expected: 大概率有"应卡关却能过"的门槛（技能抬高了我方战力）。

- [ ] **Step 2: 调参循环（收敛为止）**

优先级：① 先调技能占位数值——`tools/seed-skill-xlsx.ts` 里降 `dmgMult` 或升 `triggerValue`（技能定位是"节奏点缀"不是主要输出，参考：技能总 DPS 占比 ≤ 普攻的 30%）；② 仍不达标再升台阶关怪 hp（`tools/seed-battle-xlsx.ts` 的 L4/L7/L10 行，方法见该文件头注释）。每轮：

```powershell
npm run seed:skill; npx tsx tools/seed-battle-xlsx.ts; npm run config; npm run sim:pacing
```

直到 `节奏自检：全部达标`。然后 `npm run test:combat; npm run test:skill` 确认没调坏。

- [ ] **Step 3: 更新项目记忆**

- `ai/memory/项目状态.md`：「最近进展」刷新（自动技能系统落地：两种触发器/三种目标选择/按钮状态展示/sim 重校准结论；**待人工验证**：网页预览看按钮遮罩与技能飘字）；「已完成」加技能系统一条；「待办」删"技能/Buff/Debuff"改为"Buff/Debuff 容器、怪物/Boss 技能、技能升级"。
- `ai/memory/设计日志.md`：「战斗框架决策」节追加 (2026-07-04)：技能自动释放两种触发器、挂单位实例留 Boss 口子、只做伤害类的取舍、技能伤害走 calcDamage×倍率不开新公式路径。
- `ai/memory/代码地图.md`：战斗核心表加 `combat/SkillRuntime.ts` 行；配置表加 `config/SkillConfig.ts`/`skill.config.generated.ts`/`tools/config-xlsx/skill.xlsx`/`tools/seed-skill-xlsx.ts` 行；`BattleManager` 与 `BattleEntry` 职责句同步（技能钩子/按钮状态展示）。

- [ ] **Step 4: 提交**

```powershell
git add tools/seed-skill-xlsx.ts tools/seed-battle-xlsx.ts tools/config-xlsx/skill.xlsx tools/config-xlsx/battle.xlsx assets/scripts/config/skill.config.generated.ts assets/scripts/config/battle.config.generated.ts ai/memory/项目状态.md ai/memory/设计日志.md ai/memory/代码地图.md
git commit -m @'
feat(skill): 技能数值经 sim:pacing 重校准 + 记忆同步

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@ -- tools/seed-skill-xlsx.ts tools/seed-battle-xlsx.ts tools/config-xlsx assets/scripts/config ai/memory
```

（若 Step 2 没动某文件，从 `git add` 列表里去掉。）

---

## 计划外（明确不做）

- Buff/Debuff 容器、怪物/Boss 技能、手动释放、技能升级/解锁（见设计文档"不在范围"）。
- 技能图标/特效真实美术（按钮沿用现有切片，特效只有飘字+闪光）。
- 敌方闪避对 aoe 的逐目标判定优化（沿用 calcDamage 单体路径，行为与普攻一致）。
