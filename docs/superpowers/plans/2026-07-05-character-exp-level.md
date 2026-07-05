# 经验 → 角色升级系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 击杀怪物产经验 → 每个上阵角色各得全额 → 等级抬角色 hp/atk 战斗属性；只做机制，不重调平衡。

**Architecture:** 新增 `CharGrowthConfig`（等级系数/经验曲线纯计算，镜像装备 `levelCoefficient`）+ `CharacterGrowthModel`（纯逻辑，每角色 level/exp）+ 持久化；`EnemyType` 加 `exp` 字段；`EffectiveStats.buildEffectiveStatsMap` 新增可选 `growth` 参数（不传=纯装备档位，`pacing-sim` 不受影响）；`BattleEntry` 消费 `enemyKilled` 累计本场经验、胜/负都提交给上阵角色、离线收益同样喂上阵角色；`SquadView` 面板行显示 `Lv.N`。

**Tech Stack:** TypeScript（Cocos Creator 3.8.8 运行时子集，纯逻辑不依赖 cc）、tsx（跑纯逻辑单测）、xlsx（数值真源，`npm run config` 生成产物）。

## Global Constraints

- **数值真源在 Excel**：改战斗数值只改 `tools/seed-battle-xlsx.ts` → `npx tsx tools/seed-battle-xlsx.ts`（即 `npm run seed:battle`）重生 `tools/config-xlsx/battle.xlsx` → `npm run config` 生成 `assets/scripts/config/battle.config.generated.ts`。**产物入库**（Cocos 不跑 npm）。
- **逻辑与渲染分离**：纯逻辑（`CharGrowthConfig`/`CharacterGrowthModel`）不 import `cc`，可跑 tsx 单测；渲染/持久化只在 `BattleEntry`/`*Persistence.ts`。
- **class = character 1:1**：角色 id 类型是 `SoldierClass`（= `CharacterId`，tank/dps/healer），与上阵系统（`squad/SquadModel.ts`）共用同一枚举。
- **色块占位期**：UI 只加文字标签，不接真实美术。
- **本次不重调平衡**：`pacing-sim` 的 `winRate` 调用不传 `growth` 参数，必须继续保持「纯装备档位」等价——每个 Task 完成后跑 `npm run sim:pacing` 确认仍「全部达标」。
- **提交规范**：中文 commit，结尾带 `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`。只在本计划步骤要求时提交。
- **占位初值**（数值平衡留待办，不在本计划验收范围内）：`charGrowth.expBase=50`、`expGrowthPerLevel=1.15`、`statGrowthPerLevel=0.05`、`maxLevel=30`；`EnemyTypes.exp`：zombie=5、runner=4、brute=10、boss_butcher=200。

---

### Task 1: charGrowth 配置 + EnemyTypes.exp 接线

把成长曲线四个标量、怪物经验值接入 Excel→配置产物链路。

**Files:**
- Modify: `tools/seed-battle-xlsx.ts:24-32`（ENEMY_HEADER/ENEMY_ROWS 加 `exp` 列）
- Modify: `tools/seed-battle-xlsx.ts` MISC_ROWS（加 `charGrowth.*` 四行）
- Modify: `tools/excel-to-config.ts:147-165`（EnemyTypes 解析加 `exp`）
- Modify: `tools/excel-to-config.ts:297-311`（config 组装加 `charGrowth`）
- Modify: `assets/scripts/config/BattleConfig.ts`（类型加 `EnemyType.exp` + `charGrowth`）
- Regenerate: `tools/config-xlsx/battle.xlsx`、`assets/scripts/config/battle.config.generated.ts`

**Interfaces:**
- Produces: `BattleConfig.enemyTypes[type].exp: number`；`BattleConfig.charGrowth: { expBase: number; expGrowthPerLevel: number; statGrowthPerLevel: number; maxLevel: number }`。供 Task 2（`CharGrowthConfig`）、Task 5（`BattleEntry` 查表累计经验）使用。

- [ ] **Step 1: seed 脚本 ENEMY_HEADER/ENEMY_ROWS 加 exp 列**

`tools/seed-battle-xlsx.ts` 当前 24-32 行：

```typescript
// —— EnemyTypes sheet：怪物图鉴（type 作行 key；color 用 "r,g,b" 字符串；stats 拍平到同表）——
const ENEMY_HEADER = ['type', 'name', 'speed', 'radius', 'attackInterval', 'color',
    'hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce', 'exp'];
const ENEMY_ROWS: (string | number)[][] = [
    ['zombie', '丧尸',   90,  28, 0.8, '230,70,70',  120, 18, 4,  0, 1.0, 0.05, 0.5, 0.05, 0.0, 0.0, 0.0, 0.0, 5],
    ['runner', '疾行者', 175, 22, 0.6, '240,150,60', 70,  14, 2,  0, 1.4, 0.05, 0.5, 0.15, 0.0, 0.0, 0.0, 0.0, 4],
    ['brute',  '重装',   55,  40, 1.2, '170,80,200', 360, 30, 12, 0, 0.8, 0.05, 0.5, 0.0,  0.0, 0.0, 0.0, 0.15, 10],
    // 第一章 Boss：纯数值型大体型（高血高攻高减免），无技能机制；血量经 sim:pacing 校准（t2 卡关 / t3 可过）
    ['boss_butcher', '屠夫领主', 40, 60, 1.5, '150,40,40', 15100, 55, 20, 0, 0.8, 0.05, 0.5, 0.0, 0.0, 0.0, 0.0, 0.30, 200],
];
```

（每行末尾追加一个数字：`exp` 列。）

- [ ] **Step 2: seed 脚本 MISC_ROWS 加 charGrowth 四行**

`tools/seed-battle-xlsx.ts` 的 `MISC_ROWS`（现含 `squadCap`/`roster` 等），在 `roster` 行后加：

```typescript
    ['squadCap', 2],
    ['roster', 'tank,dps'],
    ['charGrowth.expBase', 50],
    ['charGrowth.expGrowthPerLevel', 1.15],
    ['charGrowth.statGrowthPerLevel', 0.05],
    ['charGrowth.maxLevel', 30],
```

- [ ] **Step 3: 导表器 EnemyTypes 解析加 exp**

`tools/excel-to-config.ts` 当前第 158-165 行，`enemyTypes[type] = {...}` 对象字面量：

```typescript
        enemyTypes[type] = {
            name: reqStr(r['name'], `EnemyTypes[${type}].name`),
            speed: reqNum(r['speed'], `EnemyTypes[${type}].speed`),
            radius: reqNum(r['radius'], `EnemyTypes[${type}].radius`),
            attackInterval: reqNum(r['attackInterval'], `EnemyTypes[${type}].attackInterval`),
            color: parseColor(r['color'], `EnemyTypes[${type}].color`),
            stats: eStats,
        };
```

改为（`color` 行后、`stats: eStats,` 前插入 `exp` 一行）：

```typescript
        enemyTypes[type] = {
            name: reqStr(r['name'], `EnemyTypes[${type}].name`),
            speed: reqNum(r['speed'], `EnemyTypes[${type}].speed`),
            radius: reqNum(r['radius'], `EnemyTypes[${type}].radius`),
            attackInterval: reqNum(r['attackInterval'], `EnemyTypes[${type}].attackInterval`),
            color: parseColor(r['color'], `EnemyTypes[${type}].color`),
            exp: reqNum(r['exp'], `EnemyTypes[${type}].exp`),
            stats: eStats,
        };
```

- [ ] **Step 4: 导表器 config 组装加 charGrowth**

`tools/excel-to-config.ts` 当前 297-311 行 config 组装块，在 `squadCap` 行后加：

```typescript
    const config = {
        stats,
        enemyTypes,
        levels,
        startLevel: misc['startLevel'] ?? 0,
        squadCap: misc['squadCap'] ?? 2,
        charGrowth: misc['charGrowth'] ?? {},
        combat: misc['combat'] ?? {},
        classes,
        roster,
        layout: misc['layout'] ?? {},
        bullet: misc['bullet'] ?? {},
        formation: misc['formation'] ?? {},
        scene,
    };
```

- [ ] **Step 5: BattleConfig 类型加 exp + charGrowth**

`assets/scripts/config/BattleConfig.ts` 的 `EnemyType` 接口（当前 33-40 行区域）加 `exp` 字段：

```typescript
export interface EnemyType {
    name: string;          // 名字（飘字/调试用）
    stats: CombatStats;    // 战斗属性
    speed: number;         // 向左推进速度（像素/秒）
    radius: number;        // 体型 + 命中半径
    attackInterval: number;// 基础贴身攻击间隔（秒）
    color: [number, number, number]; // 占位色块颜色 RGB
    exp: number;           // 击杀经验：喂给全部上阵角色
}
```

`BattleConfig` 断言类型（当前含 `squadCap: number;` 那段）加 `charGrowth`：

```typescript
    startLevel: number;
    squadCap: number;
    charGrowth: {
        expBase: number;
        expGrowthPerLevel: number;
        statGrowthPerLevel: number;
        maxLevel: number;
    };
    combat: { minDamageRate: number };
```

- [ ] **Step 6: 重生 xlsx + 产物**

Run:
```bash
npm run seed:battle && npm run config
```
Expected: `✓ 已生成 .../battle.xlsx`；config 输出各模块 `ok`，无报错（若报 `EnemyTypes[...].exp` 缺失或 `charGrowth` 相关错误，检查 Step 1-2 是否所有行都补了新列/新键）。

- [ ] **Step 7: 校验产物含新字段**

Run:
```bash
grep '"exp": 200' assets/scripts/config/battle.config.generated.ts
grep '"expBase": 50' assets/scripts/config/battle.config.generated.ts
```
Expected: 两条都命中（boss_butcher 的 exp=200；charGrowth.expBase=50）。

- [ ] **Step 8: 回归现有链路仍全绿**

Run:
```bash
npm run test:combat && npm run sim:pacing
```
Expected: combat 测试全过；`sim:pacing` 输出「全部达标」（新增字段不影响既有数值路径）。

- [ ] **Step 9: Commit**

```bash
git add tools/seed-battle-xlsx.ts tools/excel-to-config.ts assets/scripts/config/BattleConfig.ts assets/scripts/config/battle.config.generated.ts tools/config-xlsx/battle.xlsx
git commit -m "feat(growth): charGrowth 配置 + EnemyTypes.exp 接入 battle 配置链路

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: CharGrowthConfig 纯计算（TDD）

等级系数、经验曲线、等级钳制——镜像 `EquipConfig.levelCoefficient`/`clampEquipLevel`。

**Files:**
- Create: `assets/scripts/growth/CharGrowthConfig.ts`
- Create: `tools/char-growth-config-test.ts`
- Modify: `package.json`（加 `test:growth-config`）

**Interfaces:**
- Consumes: `BattleConfig.charGrowth`（Task 1）。
- Produces: `charLevelCoef(level: number): number`、`expToNext(level: number): number`、`clampCharLevel(level: number): number`——供 Task 3（`CharacterGrowthModel`）、Task 4（`EffectiveStats`）使用。

- [ ] **Step 1: 写失败测试**

Create `tools/char-growth-config-test.ts`：

```typescript
// CharGrowthConfig 纯计算单测（tsx 运行）。
import * as assert from 'node:assert/strict';
import { charLevelCoef, expToNext, clampCharLevel } from '../assets/scripts/growth/CharGrowthConfig';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('charLevelCoef：1级=1.0（无加成）', () => {
    assert.equal(charLevelCoef(1), 1.0);
});

test('charLevelCoef：等级越高系数越大（statGrowthPerLevel=0.05 时 10级=1.45）', () => {
    const c10 = charLevelCoef(10);
    assert.ok(Math.abs(c10 - 1.45) < 1e-9, `期望约 1.45，得到 ${c10}`);
});

test('charLevelCoef：非整数/小于1按1处理', () => {
    assert.equal(charLevelCoef(0), 1.0);
    assert.equal(charLevelCoef(-5), 1.0);
});

test('expToNext：随等级几何增长（后一级门槛更高）', () => {
    const e1 = expToNext(1);
    const e5 = expToNext(5);
    assert.ok(e5 > e1, `expToNext(5)=${e5} 应大于 expToNext(1)=${e1}`);
});

test('clampCharLevel：钳制在 1~maxLevel', () => {
    assert.equal(clampCharLevel(0), 1);
    assert.equal(clampCharLevel(-3), 1);
    assert.equal(clampCharLevel(9999), 30);
    assert.equal(clampCharLevel(15), 15);
});

console.log(`\nCharGrowthConfig：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 加测试脚本 + 运行确认失败**

`package.json` 的 `scripts`，在 `"test:squad"` 行后加：

```json
    "test:squad": "tsx tools/squad-test.ts",
    "test:growth-config": "tsx tools/char-growth-config-test.ts",
```

Run: `npm run test:growth-config`
Expected: FAIL — `Cannot find module '.../growth/CharGrowthConfig'`。

- [ ] **Step 3: 写最小实现**

Create `assets/scripts/growth/CharGrowthConfig.ts`：

```typescript
// 角色成长纯计算：等级系数（镜像 EquipConfig.levelCoefficient）+ 经验曲线 + 等级钳制。
// 不依赖 cc，可 tsx 单测。数值来自 battle.xlsx/Misc 的 charGrowth.* 四个标量。

import { BattleConfig } from '../config/BattleConfig';

export function charLevelCoef(level: number): number {
    const growth = BattleConfig.charGrowth?.statGrowthPerLevel ?? 0;
    const clamped = Math.max(1, Math.floor(level));
    return 1 + (clamped - 1) * growth;
}

export function expToNext(level: number): number {
    const cfg = BattleConfig.charGrowth;
    const base = cfg?.expBase ?? 50;
    const growth = cfg?.expGrowthPerLevel ?? 1.15;
    const clamped = Math.max(1, Math.floor(level));
    return Math.round(base * Math.pow(growth, clamped - 1));
}

export function clampCharLevel(level: number): number {
    const max = BattleConfig.charGrowth?.maxLevel ?? 30;
    return Math.max(1, Math.min(max, Math.floor(level)));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:growth-config`
Expected: PASS — `CharGrowthConfig：5 通过，0 失败`。

- [ ] **Step 5: Commit**

```bash
git add assets/scripts/growth/CharGrowthConfig.ts tools/char-growth-config-test.ts package.json
git commit -m "feat(growth): CharGrowthConfig 纯计算（等级系数/经验曲线/钳制，TDD）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: CharacterGrowthModel 纯逻辑（TDD）

每角色 level/exp 状态机：加经验、连续升级、封顶、序列化、存档自愈。

**Files:**
- Create: `assets/scripts/growth/CharacterGrowthModel.ts`
- Create: `tools/char-growth-test.ts`
- Modify: `package.json`（加 `test:growth`）

**Interfaces:**
- Consumes: `charLevelCoef`/`expToNext`/`clampCharLevel`（Task 2）；`CHARACTERS`/`CharacterId`（`assets/scripts/inventory/EquipDefs.ts`）。
- Produces:
  - `interface CharGrowthSave { [id: string]: { level: number; exp: number } }`（键为 `CharacterId`）
  - `class CharacterGrowthModel`，方法：`levelOf(id): number`、`expOf(id): number`、`gainExp(id, amount): boolean`（返回是否升级）、`serialize(): CharGrowthSave`、静态 `deserialize(save: CharGrowthSave | undefined): CharacterGrowthModel`。供 Task 4（`EffectiveStats`）、Task 5（`BattleEntry`/`CharacterGrowthPersistence`）、Task 6（`SquadView`）使用。

- [ ] **Step 1: 写失败测试**

Create `tools/char-growth-test.ts`：

```typescript
// CharacterGrowthModel 单测（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { CharacterGrowthModel } from '../assets/scripts/growth/CharacterGrowthModel';
import { expToNext } from '../assets/scripts/growth/CharGrowthConfig';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('新建：全角色默认 Lv.1/exp.0', () => {
    const m = new CharacterGrowthModel();
    assert.equal(m.levelOf('tank'), 1);
    assert.equal(m.expOf('tank'), 0);
});

test('gainExp：不够升级时只累加经验', () => {
    const m = new CharacterGrowthModel();
    const need = expToNext(1);
    const leveledUp = m.gainExp('dps', Math.floor(need / 2));
    assert.equal(leveledUp, false);
    assert.equal(m.levelOf('dps'), 1);
    assert.equal(m.expOf('dps'), Math.floor(need / 2));
});

test('gainExp：刚好/超过门槛时升级并保留余量', () => {
    const m = new CharacterGrowthModel();
    const need = expToNext(1);
    const leveledUp = m.gainExp('dps', need + 10);
    assert.equal(leveledUp, true);
    assert.equal(m.levelOf('dps'), 2);
    assert.equal(m.expOf('dps'), 10);
});

test('gainExp：一次性经验可连续跨多级', () => {
    const m = new CharacterGrowthModel();
    const big = expToNext(1) + expToNext(2) + expToNext(3) + 5;
    m.gainExp('tank', big);
    assert.equal(m.levelOf('tank'), 4);
    assert.equal(m.expOf('tank'), 5);
});

test('gainExp：不同角色互不影响', () => {
    const m = new CharacterGrowthModel();
    m.gainExp('tank', expToNext(1) + 1);
    assert.equal(m.levelOf('tank'), 2);
    assert.equal(m.levelOf('dps'), 1);
});

test('gainExp：满级后经验不再累加溢出', () => {
    const m = new CharacterGrowthModel();
    m.gainExp('healer', 10_000_000);
    const lv = m.levelOf('healer');
    assert.ok(lv >= 1, '应达到某个封顶等级');
    const exp1 = m.expOf('healer');
    m.gainExp('healer', 999);
    assert.equal(m.levelOf('healer'), lv, '满级后等级不再变化');
    assert.equal(m.expOf('healer'), exp1, '满级后经验不再累加');
});

test('serialize/deserialize 往返一致', () => {
    const m = new CharacterGrowthModel();
    m.gainExp('dps', expToNext(1) + 3);
    const back = CharacterGrowthModel.deserialize(m.serialize());
    assert.equal(back.levelOf('dps'), m.levelOf('dps'));
    assert.equal(back.expOf('dps'), m.expOf('dps'));
});

test('deserialize：缺失/未知 id 自愈为 Lv.1，负值归零', () => {
    const m = CharacterGrowthModel.deserialize({
        tank: { level: -5, exp: -10 },
        bogus: { level: 99, exp: 50 },
    } as any);
    assert.equal(m.levelOf('tank'), 1);
    assert.equal(m.expOf('tank'), 0);
    assert.equal(m.levelOf('dps'), 1);   // 缺失 id 补默认
});

console.log(`\nCharacterGrowthModel：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 加测试脚本 + 运行确认失败**

`package.json` 的 `scripts`，在 `"test:growth-config"` 行后加：

```json
    "test:growth-config": "tsx tools/char-growth-config-test.ts",
    "test:growth": "tsx tools/char-growth-test.ts",
```

Run: `npm run test:growth`
Expected: FAIL — `Cannot find module '.../growth/CharacterGrowthModel'`。

- [ ] **Step 3: 写最小实现**

Create `assets/scripts/growth/CharacterGrowthModel.ts`：

```typescript
// 每角色成长状态（纯逻辑，不依赖 cc）：level/exp、gainExp 连续升级、封顶、存档自愈。
// exp 语义：当前等级内已累积、未满下一级的经验（不是终身累计经验）。

import { CHARACTERS, CharacterId } from '../inventory/EquipDefs';
import { expToNext, clampCharLevel } from './CharGrowthConfig';

export type CharGrowthSave = Partial<Record<CharacterId, { level: number; exp: number }>>;

function isCharacterId(x: unknown): x is CharacterId {
    return typeof x === 'string' && (CHARACTERS as string[]).indexOf(x) >= 0;
}

interface GrowthEntry { level: number; exp: number }

export class CharacterGrowthModel {
    private _entries: Record<string, GrowthEntry> = {};

    constructor() {
        for (const c of CHARACTERS) this._entries[c] = { level: 1, exp: 0 };
    }

    private _entry(id: CharacterId): GrowthEntry {
        if (!this._entries[id]) this._entries[id] = { level: 1, exp: 0 };
        return this._entries[id];
    }

    levelOf(id: CharacterId): number { return this._entry(id).level; }
    expOf(id: CharacterId): number { return this._entry(id).exp; }

    // 返回本次调用是否至少升了一级（供 UI 飘字判断）。
    gainExp(id: CharacterId, amount: number): boolean {
        if (amount <= 0) return false;
        const e = this._entry(id);
        const maxLevel = clampCharLevel(Number.POSITIVE_INFINITY);
        if (e.level >= maxLevel) return false;   // 已满级，经验不再累加
        e.exp += amount;
        let leveledUp = false;
        while (e.level < maxLevel) {
            const need = expToNext(e.level);
            if (e.exp < need) break;
            e.exp -= need;
            e.level++;
            leveledUp = true;
        }
        if (e.level >= maxLevel) { e.level = maxLevel; e.exp = 0; }   // 封顶后不留溢出经验
        return leveledUp;
    }

    serialize(): CharGrowthSave {
        const out: CharGrowthSave = {};
        for (const c of CHARACTERS) out[c] = { ...this._entries[c] };
        return out;
    }

    static deserialize(save: CharGrowthSave | undefined): CharacterGrowthModel {
        const m = new CharacterGrowthModel();
        if (!save) return m;
        for (const key of Object.keys(save)) {
            if (!isCharacterId(key)) continue;
            const raw = save[key];
            if (!raw) continue;
            const level = clampCharLevel(Number.isFinite(raw.level) ? raw.level : 1);
            const exp = Number.isFinite(raw.exp) && raw.exp > 0 ? raw.exp : 0;
            m._entries[key] = { level, exp };
        }
        return m;
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:growth`
Expected: PASS — `CharacterGrowthModel：8 通过，0 失败`。

- [ ] **Step 5: Commit**

```bash
git add assets/scripts/growth/CharacterGrowthModel.ts tools/char-growth-test.ts package.json
git commit -m "feat(growth): CharacterGrowthModel 纯逻辑（TDD，连续升级/封顶/存档自愈）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: EffectiveStats 接入 growth 参数（TDD）

`buildEffectiveStatsMap` 新增可选 `growth`：先按等级缩放 base 的 hp/atk，再叠加装备。不传则行为与现在完全一致（`pacing-sim` 不受影响）。

**Files:**
- Modify: `assets/scripts/combat/EffectiveStats.ts`
- Modify: `tools/effective-stats-test.ts`（追加测试）

**Interfaces:**
- Consumes: `CharacterGrowthModel`（Task 3，仅用其 `levelOf` 返回值——这里为解耦不直接依赖 model 类型，改为接收一个 `Partial<Record<SoldierClass, number>>` 的等级表，由调用方从 model 转换）；`charLevelCoef`（Task 2）。
- Produces: `buildEffectiveStatsMap(equipped: CharEquipped | undefined, levels?: Partial<Record<SoldierClass, number>>): EffectiveStatsMap`——供 Task 5（`BattleEntry._startBattle`）传角色等级。

- [ ] **Step 1: 写失败测试**

`tools/effective-stats-test.ts` 末尾（在现有 `test(...)` 调用之后、汇总输出之前）追加：

```typescript
test('buildEffectiveStatsMap：传 levels 时按等级系数放大 hp/atk 再叠加装备', () => {
    const base = BattleConfig.stats.dps;
    const map = buildEffectiveStatsMap(undefined, { dps: 10 });
    // statGrowthPerLevel 从配置读取，此处只验证「有放大」而非精确系数（系数值由 charLevelCoef 单测覆盖）
    assert.ok(map.dps!.hp > base.hp, `10级 hp(${map.dps!.hp}) 应大于1级基础(${base.hp})`);
    assert.ok(map.dps!.atk > base.atk, `10级 atk(${map.dps!.atk}) 应大于1级基础(${base.atk})`);
});

test('buildEffectiveStatsMap：不传 levels 时与不传该参数时行为一致（向后兼容）', () => {
    const withUndefined = buildEffectiveStatsMap(undefined);
    const withEmptyLevels = buildEffectiveStatsMap(undefined, {});
    assert.deepEqual(withUndefined, withEmptyLevels);
});
```

（若文件头部尚未导入 `BattleConfig`，需确认现有 import 是否已含；`assets/scripts/combat/EffectiveStats.ts` 本身已 `import { BattleConfig, ... } from '../config/BattleConfig'`，测试文件按需补 import。）

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:effective`
Expected: FAIL — `buildEffectiveStatsMap` 目前只接收 1 个参数，调用带第 2 参不会报类型错误（tsx 运行时不做严格类型检查）但 `map.dps.hp` 不会因等级放大，断言 `map.dps!.hp > base.hp` 失败。

- [ ] **Step 3: 改 EffectiveStats 实现**

`assets/scripts/combat/EffectiveStats.ts` 当前 32-56 行整体替换为：

```typescript
import { BattleConfig, CombatStats, SoldierClass } from '../config/BattleConfig';
import { CHARACTERS, EquipItem, SLOTS } from '../inventory/EquipDefs';
import type { CharEquipped } from '../inventory/InventoryModel';
import { charLevelCoef } from '../growth/CharGrowthConfig';

export type EffectiveStatsMap = Partial<Record<SoldierClass, CombatStats>>;

const STAT_KEYS: (keyof CombatStats)[] = [
    'hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg',
    'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce',
];
const PROB_STATS: (keyof CombatStats)[] = ['critRate', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgReduce'];

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

function normalizeStats(st: CombatStats): CombatStats {
    st.hp = Math.max(1, st.hp);
    st.atk = Math.max(0, st.atk);
    st.def = Math.max(0, st.def);
    st.range = Math.max(0, st.range);
    st.attackSpeed = Math.max(0.01, st.attackSpeed);
    st.critDmg = Math.max(0, st.critDmg);
    st.dmgBonus = Math.max(0, st.dmgBonus);
    for (const k of PROB_STATS) st[k] = clamp(st[k], 0, 1);
    return st;
}

export function calcEffectiveStats(base: CombatStats, items: (EquipItem | null | undefined)[]): CombatStats {
    const out: CombatStats = { ...base };
    for (const item of items) {
        if (!item?.stats) continue;
        for (const k of STAT_KEYS) {
            const bonus = item.stats[k];
            if (!bonus) continue;
            out[k] += bonus;
        }
    }
    return normalizeStats(out);
}

// levels 缺省/角色缺项 = 不做等级缩放（向后兼容，pacing-sim 不传即纯装备档位）。
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
        const scaledBase: CombatStats = level
            ? { ...base, hp: base.hp * charLevelCoef(level), atk: base.atk * charLevelCoef(level) }
            : base;
        const slots = equipped?.[c];
        map[cls] = calcEffectiveStats(scaledBase, slots ? SLOTS.map(s => slots[s]) : []);
    }
    return map;
}
```

（两处行为变化，均已核实不会破坏现有测试：① 原 `if (!equipped) return map;` 在整体未传装备时直接返回空 map，新实现移除此提前返回，改为每个角色按 `equipped?.[c]` 取槽位；② 原 `if (!base || !slots) continue;` 在某角色没有槽位对象时跳过该角色，新实现改为「没槽位就传空数组」、只要 `base` 存在就产出。核实依据：`tools/effective-stats-test.ts:95-101` 现有测试传入的是 `InventoryModel.equipped`——该结构给每个角色都初始化了槽位对象（未装备也是 `{}` 而非 `undefined`），且测试第 100 行 `map.dps!.atk` 已经断言「未装备的 dps 也出现在 map 里」，与新实现一致；仓库里没有测试断言「equipped 整体为 undefined 时返回空 map」。这是让「有等级无装备」角色也能拿到等级加成的必要修正。）

- [ ] **Step 4: 运行测试确认通过 + 全套回归**

Run:
```bash
npm run test:effective
```
Expected: PASS，全部通过（含新增 2 条）。

Run:
```bash
npm run test:combat && npm run test:inventory && npm run test:services && npm run sim:pacing
```
Expected: 全部通过；`sim:pacing`「全部达标」（`pacing-sim` 内部手工构造 `effectiveStats`、不调用 `buildEffectiveStatsMap`，完全不受本 Task 影响）。

- [ ] **Step 5: Commit**

```bash
git add assets/scripts/combat/EffectiveStats.ts tools/effective-stats-test.ts
git commit -m "feat(growth): EffectiveStats 加可选 levels 参数（等级缩放 hp/atk，TDD）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: 持久化 + BattleEntry 接线（击杀累计 → 战斗结束提交 → 离线喂养）

**Files:**
- Modify: `assets/scripts/core/data/DataService.ts`（`PlayerData` 加 `charGrowth?`）
- Create: `assets/scripts/growth/CharacterGrowthPersistence.ts`
- Modify: `assets/scripts/BattleEntry.ts`（字段、加载链、`_startBattle` 传 levels、击杀累计、胜/负提交）
- Modify: `assets/scripts/offline/OfflineClaimService.ts`（离线经验喂上阵角色）

**Interfaces:**
- Consumes: `CharacterGrowthModel`（Task 3）；`buildEffectiveStatsMap(equipped, levels?)`（Task 4）；`this._squad`/`SquadModel.deployedList()`（既有，上阵系统）；`BattleConfig.enemyTypes[type].exp`（Task 1）。
- Produces: `loadGrowth(): Promise<CharacterGrowthModel>`、`saveGrowth(model): Promise<void>`（`CharacterGrowthPersistence`）；`BattleEntry` 私有 `this._growth: CharacterGrowthModel`，供 Task 6（`SquadView` 显示 Lv）读取。

- [ ] **Step 1: PlayerData 加 charGrowth 字段**

`assets/scripts/core/data/DataService.ts` 顶部 import 区加：

```typescript
import type { CharGrowthSave } from '../../growth/CharacterGrowthModel';
```

`PlayerData` 接口在 `squad?: SquadSave;` 行后加：

```typescript
    squad?: SquadSave;          // 出战小队（有序出战角色）；老存档缺它，由默认组合兜底
    charGrowth?: CharGrowthSave; // 每角色成长（等级/经验）；老存档缺它，全角色按 Lv.1 兜底
}
```

- [ ] **Step 2: 建 CharacterGrowthPersistence**

Create `assets/scripts/growth/CharacterGrowthPersistence.ts`：

```typescript
// 角色成长持久化：把 CharacterGrowthModel 接到共享 PlayerData 存档。

import { loadPlayerData, savePlayerData } from '../core/data/PlayerDataStore';
import { CharacterGrowthModel } from './CharacterGrowthModel';

export async function loadGrowth(): Promise<CharacterGrowthModel> {
    const data = await loadPlayerData();
    return CharacterGrowthModel.deserialize(data.charGrowth);
}

export async function saveGrowth(model: CharacterGrowthModel): Promise<void> {
    const data = await loadPlayerData();
    data.charGrowth = model.serialize();
    await savePlayerData();
}
```

- [ ] **Step 3: BattleEntry 加字段与 import**

`assets/scripts/BattleEntry.ts` import 区，`SquadPersistence` 导入行后加：

```typescript
import { loadSquad, saveSquad } from './squad/SquadPersistence';
import { CharacterGrowthModel } from './growth/CharacterGrowthModel';
import { loadGrowth, saveGrowth } from './growth/CharacterGrowthPersistence';
```

字段区，`private _squad: SquadModel = null!;` 行后加：

```typescript
    private _squad: SquadModel = null!;
    private _growth: CharacterGrowthModel = null!;
```

`_battleChestDropCount = 0;` 字段声明附近加一个新计数字段：

```typescript
    private _battleChestDropCount = 0;
    private _battleExpGained = 0;
```

- [ ] **Step 4: 加载链里载入成长数据**

`assets/scripts/BattleEntry.ts` 数据就绪链（当前含 `.then(() => loadSquad()).then((squad) => { this._squad = squad; })`），在其后追加载入成长：

```typescript
        const dataReady = loadInventory(this._inv)
            .then(() => loadProgress(this._progress))
            .then(() => this._claimOfflineRewards())
            .then(() => loadChests(this._chests))
            .then(() => this._refreshMaterialsCache())
            .then(() => loadSquad())
            .then((squad) => { this._squad = squad; })
            .then(() => loadGrowth())
            .then((growth) => { this._growth = growth; })
            .then(() => {
```

（保留原链末尾 `.then(() => { this._invView.refresh(); }).catch(...)` 不变，只在 `loadSquad` 赋值之后、原有 `.then(() => { ... })` 之前插入两步。）

- [ ] **Step 5: `_startBattle` 传角色等级 + 重置本场经验计数**

`assets/scripts/BattleEntry.ts` 当前 `_startBattle()`（410-425 行区域）：

```typescript
    private _startBattle() {
        if (!this._gameStarted) return;
        this._hideSettlement();
        this._hideChestPanel();
        this._hideCraftPanel();
        const levels = this._growth
            ? Object.fromEntries(CHARACTERS.map(c => [c, this._growth.levelOf(c)])) as Partial<Record<SoldierClass, number>>
            : {};
        const effective = this._inv ? buildEffectiveStatsMap(this._inv.equipped, levels) : buildEffectiveStatsMap(undefined, levels);
        const levelIndex = this._progress ? this._progress.currentLevel : BattleConfig.startLevel;
        const roster = this._squad ? (this._squad.deployedList() as SoldierClass[]) : BattleConfig.roster;
        this._battleSeed = `${Date.now()}|${Math.random()}|${levelIndex}`;
        this._battleChestDropCount = 0;
        this._battleExpGained = 0;
        this._shownWaveKey = -1;   // 强制下一帧刷新波次文本
        this._syncSoldierVisualsToRoster(roster);
        this._mgr = new BattleManager(this._halfW, this._halfH, levelIndex, effective, roster);
        this._winRewardText = '';
        this._lastComplete = null;
        this._statusLabel.string = '';
```

（`CHARACTERS` 已在 Task 5 之前的上阵系统里导入；若当前导入行是 `import { CHARACTERS, CHARACTER_LABEL } from './inventory/EquipDefs';` 保持不变，无需再加。原 `const effective = this._inv ? buildEffectiveStatsMap(this._inv.equipped) : {};` 整行替换为上面两行 `levels`/`effective`。）

- [ ] **Step 6: 击杀事件累计经验**

`assets/scripts/BattleEntry.ts` 的 `_processBattleEvents()`（当前 2247-2289 行区域），在遍历 `events` 的 for 循环里、`skillCast` 分支的 `continue` 之后，加经验累计：

```typescript
        for (const event of events) {
            if (event.type === 'skillCast') {
                this._onSkillCast(event);
                continue;
            }
            const enemyDef = BattleConfig.enemyTypes[event.enemyType];
            if (enemyDef) this._battleExpGained += enemyDef.exp;
            const level = BattleConfig.levels[event.levelIndex];
            if (!level) continue;
```

（原 `const level = BattleConfig.levels[event.levelIndex]; if (!level) continue;` 两行保留在原位置，只在其前插入经验累计两行。）

- [ ] **Step 7: 战斗结束（胜/负）提交经验给上阵角色**

新增一个提交方法，`_awardVictoryDrop`（约 2191 行）之前插入：

```typescript
    // 战斗结束（胜或负）都提交本场累计经验：每个上阵角色各得全额。
    private _commitBattleExp() {
        if (!this._growth || !this._squad || this._battleExpGained <= 0) return;
        for (const cls of this._squad.deployedList()) {
            this._growth.gainExp(cls, this._battleExpGained);
        }
        void saveGrowth(this._growth);
        this._battleExpGained = 0;
    }

    private _awardVictoryDrop() {
        this._commitBattleExp();
        const result = this._grantDropItems(this._mgr.levelIndex);
```

（`_awardVictoryDrop` 原有函数体从 `const result = this._grantDropItems(...)` 开始的部分保持不变，只在函数顶部插入 `this._commitBattleExp();` 一行。）

`update()` 方法（当前 1987-2004 行区域）加 `lost` 分支的一次性提交（镜像 `won` 的 `phaseBefore` 防重入写法）：

```typescript
    update(dt: number) {
        this._actionPreviewAnim?.update(Math.min(dt, 0.05));
        if (!this._mgr) return;
        this._bg.update(dt);   // 背景（云飘动）
        if (this._offlineNoticeTtl > 0) this._offlineNoticeTtl = Math.max(0, this._offlineNoticeTtl - dt);
        // dt 兜底，防止切后台回来一帧巨大导致瞬移
        const phaseBefore = this._mgr.phase;
        this._mgr.tick(Math.min(dt, 0.05));
        this._processBattleEvents();
        if (phaseBefore !== 'won' && this._mgr.phase === 'won') this._awardVictoryDrop();
        if (phaseBefore !== 'lost' && this._mgr.phase === 'lost') this._commitBattleExp();
        this._updateSoldierVisualActions();
```

（`won` 分支已调用 `_commitBattleExp`（经由 `_awardVictoryDrop` 顶部），`lost` 分支单独触发一次；两分支互斥，`_battleExpGained` 提交后清零，不会重复计入下一场。）

- [ ] **Step 8: 离线经验喂上阵角色**

`assets/scripts/offline/OfflineClaimService.ts` 全文替换为：

```typescript
import { BattleConfig } from '../config/BattleConfig';
import { ChestInventoryModel } from '../chest/ChestModel';
import { loadPlayerData, savePlayerData } from '../core/data/PlayerDataStore';
import { calculateOfflineReward, type OfflineClaimResult, type OfflineRewardInput } from './OfflineCombatService';
import { CharacterGrowthModel } from '../growth/CharacterGrowthModel';
import { SquadModel } from '../squad/SquadModel';

export async function claimOfflineReward(input: Partial<OfflineRewardInput> = {}): Promise<OfflineClaimResult> {
    const data = await loadPlayerData();
    const now = input.now ?? Date.now();
    const levelIndex = input.levelIndex ?? data.progress?.currentLevel ?? BattleConfig.startLevel;
    const lastOnlineAt = input.lastOnlineAt ?? data.lastSaveTime ?? now;
    const seed = input.seed ?? `${lastOnlineAt}|${now}|${levelIndex}`;
    const reward = calculateOfflineReward({ lastOnlineAt, now, levelIndex, seed });

    data.gold = (data.gold ?? 0) + reward.gold;
    if (reward.exp > 0) {
        const squad = SquadModel.deserialize(data.squad, BattleConfig.squadCap);
        const growth = CharacterGrowthModel.deserialize(data.charGrowth);
        for (const cls of squad.deployedList()) growth.gainExp(cls, reward.exp);
        data.charGrowth = growth.serialize();
    }
    const chests = new ChestInventoryModel();
    chests.deserializeChests(data.chests);
    const stored = chests.addChests(reward.chests);
    data.chests = chests.serializeChests();
    data.lastSaveTime = now;
    await savePlayerData(false);
    return { ...reward, chests: stored.added, chestOverflow: stored.failed, claimed: true };
}
```

（旧的 `data.exp = (data.exp ?? 0) + reward.exp;` 一行被移除——`PlayerData.exp` 字段本身保留在类型里不删，只是不再被写入；这是 spec 明确要求的兼容策略。）

- [ ] **Step 9: 类型检查 + 回归测试**

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS" | grep -viE "TS5107" | grep -iE "growth|BattleEntry|DataService|OfflineClaimService"
```
Expected: 空输出（无相关类型错误）。

Run:
```bash
npm run test:combat && npm run test:growth && npm run test:growth-config && npm run test:services && npm run sim:pacing
```
Expected: 全部通过；`sim:pacing`「全部达标」（`_startBattle` 传的 `levels` 来自 `this._growth`，`pacing-sim` 完全不经过 `BattleEntry`，不受影响）。

- [ ] **Step 10: Commit**

```bash
git add assets/scripts/core/data/DataService.ts assets/scripts/growth/CharacterGrowthPersistence.ts assets/scripts/BattleEntry.ts assets/scripts/offline/OfflineClaimService.ts
git commit -m "feat(growth): 出战角色经验持久化 + 击杀累计/胜负提交/离线喂养接线

BattleEntry 消费 enemyKilled 按 EnemyTypes.exp 累计本场经验，胜(_awardVictoryDrop)/负
(phaseBefore 防重入)都提交给上阵角色；_startBattle 把角色等级传入 buildEffectiveStatsMap；
离线收益经验改喂上阵角色（squad+growth 临时反序列化），不再写全局 PlayerData.exp。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: SquadView 面板显示角色等级

上阵面板每行追加 `Lv.N`（沿用已有 `_squadLabel`/`_drawSquadPanel` 结构，不新增交互）。

**Files:**
- Modify: `assets/scripts/BattleEntry.ts`（`_drawSquadPanel` 的 `pushRow` 调用处）

**Interfaces:**
- Consumes: `this._growth.levelOf(cls)`（Task 5）；`CharGrowthConfig.clampCharLevel`（仅用于满级判断，直接比较 `BattleConfig.charGrowth.maxLevel` 即可，不需额外引入）。

- [ ] **Step 1: 面板行文案加等级**

`assets/scripts/BattleEntry.ts` 的 `_drawSquadPanel()` 方法里，出战行与板凳行的 `pushRow` 调用（当前形如 `pushRow(CHARACTER_LABEL[cls], y, ...)`）改为附加等级文案。找到：

```typescript
        let y = top;
        deployed.forEach((cls, i) => {
            pushRow(CHARACTER_LABEL[cls], y, `出战${i + 1}`,
                () => this._squadUndeploy(cls),
                i > 0 ? () => this._squadMove(cls, i - 1) : undefined);
            y -= rowH;
        });
        y -= 24;
        for (const cls of this._squad.benchList()) {
            pushRow(CHARACTER_LABEL[cls], y, '板凳', () => this._squadDeploy(cls));
            y -= rowH;
        }
```

替换为：

```typescript
        const nameWithLevel = (cls: SoldierClass): string => {
            const lv = this._growth ? this._growth.levelOf(cls) : 1;
            const maxLv = BattleConfig.charGrowth?.maxLevel ?? 30;
            return `${CHARACTER_LABEL[cls]}  Lv.${lv}${lv >= maxLv ? '·满' : ''}`;
        };

        let y = top;
        deployed.forEach((cls, i) => {
            pushRow(nameWithLevel(cls), y, `出战${i + 1}`,
                () => this._squadUndeploy(cls),
                i > 0 ? () => this._squadMove(cls, i - 1) : undefined);
            y -= rowH;
        });
        y -= 24;
        for (const cls of this._squad.benchList()) {
            pushRow(nameWithLevel(cls), y, '板凳', () => this._squadDeploy(cls));
            y -= rowH;
        }
```

- [ ] **Step 2: 类型检查**

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS" | grep -viE "TS5107" | grep -iE "BattleEntry"
```
Expected: 空输出。

- [ ] **Step 3: 人工验证（Cocos 预览，列入待办）**

自动测试不覆盖 Graphics/Label 渲染。人工在 Cocos 预览确认：打开「英雄」上阵面板，出战/板凳行都显示 `Lv.N`；击杀几只怪后战斗结束（胜或负），重新打开面板等级/经验有变化（配合占位初值 `expBase=50`，一两场低级怪应该能看到至少一次升级）；满级角色显示 `·满`。记入 `ai/memory/项目状态.md` 待办的「Cocos 预览手测」。

- [ ] **Step 4: Commit**

```bash
git add assets/scripts/BattleEntry.ts
git commit -m "feat(growth): 上阵面板显示角色等级（Lv.N/满级标记）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## 收尾（实现全部 Task 后，按开发收尾.md）

- [ ] 全套回归：`npm run test:inventory && npm run test:effective && npm run test:drop && npm run test:combat && npm run test:progression && npm run test:services && npm run test:art && npm run test:craft && npm run test:skill && npm run test:squad && npm run test:growth-config && npm run test:growth && npm run config && npm run sim:pacing` 全绿。
- [ ] 刷新 `ai/memory/项目状态.md`「最近进展」+「已完成」+「待办」（经验升级已落地、Cocos 手测项、角色等级平衡重调待办）。
- [ ] `ai/memory/设计日志.md`：把「角色成长」方向条从"规划中"更新为已实现，补最终数值占位与「平衡后置」的取舍说明。
- [ ] `ai/memory/代码地图.md`：新增 `growth/` 模块（CharGrowthConfig/CharacterGrowthModel/CharacterGrowthPersistence 职责）+ EffectiveStats/BattleEntry/OfflineClaimService 改动点。
- [ ] 提交收尾。

## 自检对照（spec → task 覆盖）

- spec ① 经验来源（EnemyTypes.exp、在线累计、战斗结束提交、离线喂养）→ Task 1（exp 字段）+ Task 5（累计/提交/离线）✓
- spec ② 数据模型 CharacterGrowthModel + 持久化 → Task 3 + Task 5 Step 1-2 ✓
- spec ③ 等级→属性（镜像装备 levelCoefficient，EffectiveStats 接 growth）→ Task 2 + Task 4 ✓
- spec ④ 成长配置（Misc.charGrowth.*）→ Task 1 ✓
- spec ⑤ UI（SquadView 显示 Lv.N）→ Task 6 ✓
- spec ⑥ 平衡（本次不做，pacing-sim 不传 growth 仍全绿）→ 每个 Task 的回归步骤都验证 sim 达标 ✓
- spec 验收（tsx 单测 + 全套回归 + 人工验证待办）→ Task 2/3 单测 + Task 5 Step 9 回归 + Task 6 Step 3 人工验证 ✓
