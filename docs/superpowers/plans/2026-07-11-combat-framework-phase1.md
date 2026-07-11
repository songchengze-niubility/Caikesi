# 战斗框架第 1 段(CombatUnit + Effect 管线 + Buff 系统)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把战斗底层迁移到统一单位模型 CombatUnit,建立唯一状态变更入口 applyEffect 和数据驱动的 Buff 系统,迁移后现有战斗行为等价、`verify` 与 `pacing-sim` 全绿。

**Architecture:** 纯逻辑三件套:`config/EffectTypes.ts`(Effect 类型+编码解析,导表器与运行时共用)→ `combat/BuffSystem.ts`(Buff 实例生命周期+属性聚合,纯函数)→ `combat/Effects.ts`(applyEffect 唯一入口)。`BattleManager` 的 `Soldier`/`Enemy` 合并为 `CombatUnit`(保留 `soldiers[]`/`enemies[]` 两个数组不变,渲染层近零改动),所有伤害/治疗路径重构走 applyEffect。数值经 `buff.xlsx` 走既有 excel-to-config 多源导表。

**Tech Stack:** TypeScript 5.8.2(双 tsconfig),tsx 单测,xlsx 导表,Cocos 3.8.8(本段不碰渲染,仅编译级引用修正)。

## Global Constraints

- 战斗逻辑纯数据、不依赖 cc;新文件必须被 `tsconfig.game.json`(assets/scripts 下自动包含)覆盖;工具/测试归 `tsconfig.tools.json`。
- `CombatFormula.calcDamage` 是唯一伤害公式,签名与结算顺序不得改。
- 三条战场不变量:近战前压硬保险(坦克位置 ≤ 防线 + contactGap − range)、远程有限射程、防线用原始 homeX。
- 热路径零每帧分配:Buff 属性聚合走脏标记,只在增删/层数变化时重算;数组原地压缩(参考现有 `_cleanupDeadEnemies` 的 swap 写法)。
- 战斗随机沿用裸 `Math.random`,不引入种子;`pacing-sim` 13 门槛以"留余量+复跑"为口径。
- Buff 的 statMods **禁止修改 hp**(maxHp 记账不做,导表期报错拒绝)。
- 中文 commit,结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`;每个 Task 一个 commit,不 push。
- 每个 Task 结束跑 `npm run typecheck`;Task 3 起每个 Task 结束跑 `npm test`;最后收尾跑完整 `npm run verify` + `npm run sim:pacing`。

---

### Task 1: Effect 类型与编码解析 + buff.xlsx 导表链

**Files:**
- Create: `assets/scripts/config/EffectTypes.ts`
- Create: `assets/scripts/config/BuffConfig.ts`
- Create: `tools/seed-buff-xlsx.ts`
- Create: `tools/effect-types-test.ts`
- Modify: `tools/excel-to-config.ts`(加 buff 解析器 + SOURCES 条目,**插在 skill 源之前**)
- Modify: `package.json`(scripts 加 `seed:buff`、`test:effect-types`,并把 `test:effect-types` 追加进 `test` 链)
- 产物: `tools/config-xlsx/buff.xlsx`、`assets/scripts/config/buff.config.generated.ts`(跑脚本生成后一并提交)

**Interfaces:**
- Produces(后续 Task 依赖的签名,严格照此):
```ts
// EffectTypes.ts
export type Effect =
    | { kind: 'damage'; mult: number }
    | { kind: 'heal'; mult: number }
    | { kind: 'applyBuff'; buffId: string; stacks: number }
    | { kind: 'dispel'; tag: string; count: number }
    | { kind: 'knockback'; distance: number }      // 第 2 段实装,本段仅类型占位
    | { kind: 'summon'; unitType: string; count: number }; // 第 2/3 段实装,同上
export interface StatMod { key: keyof CombatStats; flat: number; pct: number; }
export function parseEffectList(src: string, onError: (msg: string) => void): Effect[];
export function parseStatMods(src: string, onError: (msg: string) => void): StatMod[];

// BuffConfig.ts
export type BuffStackRule = 'refresh' | 'add';
export type BuffFlag = 'stun' | 'taunt' | 'silence';
export interface BuffDef {
    id: string; name: string;
    duration: number; maxStacks: number; stackRule: BuffStackRule;
    period: number;                  // 0 = 无周期效果
    periodicEffect: Effect | null;   // period>0 时必填
    statMods: StatMod[];             // 每层生效,层数线性叠加
    flags: BuffFlag[];
    dispelTag: string;               // '' = 不可驱散
}
export function getBuffDef(id: string): BuffDef | undefined;
```

**编码格式(写死在解析器注释里):**
- 效果列表:`damage:1.5|applyBuff:poison:1|heal:0.8`,竖线分隔,冒号分参。`damage:<倍率>`、`heal:<倍率,按施法者atk>`、`applyBuff:<buffId>[:层数=1]`、`dispel:<标签>[:个数=1]`、`knockback:<距离>`、`summon:<单位类型>:<数量>`。空串 → `[]`。
- 属性修正:`atk:+5|atk%:0.25|def:-3`,`键%` 表示百分比;键必须是 CombatStats 合法键;**hp 直接 onError**。

- [ ] **Step 1: 写失败测试** `tools/effect-types-test.ts`(套用 `tools/combat-test.ts` 的 test/run 骨架):

```ts
import assert from 'node:assert/strict';
import { parseEffectList, parseStatMods } from '../assets/scripts/config/EffectTypes';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }
const noErr = (msg: string) => { throw new Error('不应报错: ' + msg); };

test('parseEffectList:混合列表', () => {
    const list = parseEffectList('damage:1.5|applyBuff:poison:2|heal:0.8', noErr);
    assert.deepEqual(list, [
        { kind: 'damage', mult: 1.5 },
        { kind: 'applyBuff', buffId: 'poison', stacks: 2 },
        { kind: 'heal', mult: 0.8 },
    ]);
});
test('parseEffectList:applyBuff 默认层数 1;空串给空数组', () => {
    assert.deepEqual(parseEffectList('applyBuff:poison', noErr), [{ kind: 'applyBuff', buffId: 'poison', stacks: 1 }]);
    assert.deepEqual(parseEffectList('', noErr), []);
});
test('parseEffectList:未知 kind / 非法数字要报错', () => {
    let errs: string[] = [];
    parseEffectList('explode:3', m => errs.push(m));
    assert.equal(errs.length, 1);
    errs = [];
    parseEffectList('damage:abc', m => errs.push(m));
    assert.equal(errs.length, 1);
});
test('parseStatMods:平铺与百分比', () => {
    assert.deepEqual(parseStatMods('atk:+5|atk%:0.25|def:-3', noErr), [
        { key: 'atk', flat: 5, pct: 0 },
        { key: 'atk', flat: 0, pct: 0.25 },
        { key: 'def', flat: -3, pct: 0 },
    ]);
});
test('parseStatMods:hp 与未知键报错', () => {
    let errs: string[] = [];
    parseStatMods('hp:+100', m => errs.push(m));
    assert.equal(errs.length, 1);
    errs = [];
    parseStatMods('mana:+5', m => errs.push(m));
    assert.equal(errs.length, 1);
});

let failed = 0;
for (const t of tests) {
    try { t.run(); console.log(`  ✓ ${t.name}`); }
    catch (e) { failed++; console.error(`  ✗ ${t.name}`); console.error(e); }
}
console.log(`\nEffect 编码测试:${tests.length - failed} 通过,${failed} 失败`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx tools/effect-types-test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现 `assets/scripts/config/EffectTypes.ts`**

```ts
// Effect 类型与编码解析 —— 导表器(tools/excel-to-config)与运行时共用,不依赖 cc。
// 编码格式见下方各解析器注释;新增 Effect 种类:改 union + parseEffectList 两处。
import type { CombatStats } from './BattleConfig';

export type Effect =
    | { kind: 'damage'; mult: number }
    | { kind: 'heal'; mult: number }
    | { kind: 'applyBuff'; buffId: string; stacks: number }
    | { kind: 'dispel'; tag: string; count: number }
    | { kind: 'knockback'; distance: number }
    | { kind: 'summon'; unitType: string; count: number };

export interface StatMod { key: keyof CombatStats; flat: number; pct: number; }

const STAT_KEYS: (keyof CombatStats)[] = [
    'hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg',
    'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce',
];

function num(raw: string | undefined, where: string, onError: (msg: string) => void): number {
    const n = Number(raw);
    if (raw === undefined || raw === '' || !Number.isFinite(n)) {
        onError(`${where}: 不是合法数字(得到 ${JSON.stringify(raw)})`);
        return 0;
    }
    return n;
}

// 'damage:1.5|applyBuff:poison:1' → Effect[];空串 → []
export function parseEffectList(src: string, onError: (msg: string) => void): Effect[] {
    const out: Effect[] = [];
    if (!src || !src.trim()) return out;
    for (const token of src.split('|')) {
        const parts = token.trim().split(':');
        const kind = parts[0];
        switch (kind) {
            case 'damage': out.push({ kind, mult: num(parts[1], `effect[${token}].mult`, onError) }); break;
            case 'heal': out.push({ kind, mult: num(parts[1], `effect[${token}].mult`, onError) }); break;
            case 'applyBuff': {
                if (!parts[1]) { onError(`effect[${token}]: 缺 buffId`); break; }
                out.push({ kind, buffId: parts[1], stacks: parts[2] === undefined ? 1 : num(parts[2], `effect[${token}].stacks`, onError) });
                break;
            }
            case 'dispel': {
                if (!parts[1]) { onError(`effect[${token}]: 缺驱散标签`); break; }
                out.push({ kind, tag: parts[1], count: parts[2] === undefined ? 1 : num(parts[2], `effect[${token}].count`, onError) });
                break;
            }
            case 'knockback': out.push({ kind, distance: num(parts[1], `effect[${token}].distance`, onError) }); break;
            case 'summon': {
                if (!parts[1]) { onError(`effect[${token}]: 缺单位类型`); break; }
                out.push({ kind, unitType: parts[1], count: num(parts[2], `effect[${token}].count`, onError) });
                break;
            }
            default: onError(`effect[${token}]: 未知种类 ${JSON.stringify(kind)}`);
        }
    }
    return out;
}

// 'atk:+5|atk%:0.25|def:-3' → StatMod[];hp 禁改(maxHp 记账不做)
export function parseStatMods(src: string, onError: (msg: string) => void): StatMod[] {
    const out: StatMod[] = [];
    if (!src || !src.trim()) return out;
    for (const token of src.split('|')) {
        const [rawKey, rawVal] = token.trim().split(':');
        const isPct = rawKey.endsWith('%');
        const key = (isPct ? rawKey.slice(0, -1) : rawKey) as keyof CombatStats;
        if (key === 'hp') { onError(`statMod[${token}]: 禁止修改 hp(maxHp 记账不支持)`); continue; }
        if (!STAT_KEYS.includes(key)) { onError(`statMod[${token}]: 未知属性键 ${JSON.stringify(rawKey)}`); continue; }
        const v = num(rawVal, `statMod[${token}]`, onError);
        out.push(isPct ? { key, flat: 0, pct: v } : { key, flat: v, pct: 0 });
    }
    return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx tsx tools/effect-types-test.ts`
Expected: 5 通过,0 失败

- [ ] **Step 5: 写种子脚本 `tools/seed-buff-xlsx.ts`**(照抄 `tools/seed-skill-xlsx.ts` 的骨架):

```ts
// buff.xlsx 种子脚本(一次性/重建用)。生成后策划直接编辑 xlsx。
import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/buff.xlsx');

// 数值全部占位,后续数值平衡阶段折进 sim:pacing 校准。
const BUFFS_HEADER = ['id', 'name', 'duration', 'maxStacks', 'stackRule', 'period', 'periodicEffect', 'statMods', 'flags', 'dispelTag'];
const BUFFS_ROWS: (string | number)[][] = [
    ['poison',     '中毒', 6,   3, 'add',     1, 'damage:0.15', 'def:-2',                '',     'debuff'],
    ['battle_cry', '战吼', 5,   1, 'refresh', 0, '',            'atk%:0.25',             '',     'buff'],
    ['stone_skin', '石肤', 8,   1, 'refresh', 0, '',            'def:+6|dmgReduce:+0.1', '',     'buff'],
    ['stun',       '眩晕', 1.5, 1, 'refresh', 0, '',            '',                      'stun', 'debuff'],
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([BUFFS_HEADER, ...BUFFS_ROWS]);
XLSX.utils.book_append_sheet(wb, ws, 'Buffs');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Buffs(${BUFFS_ROWS.length})`);
```

- [ ] **Step 6: 在 `tools/excel-to-config.ts` 加 buff 解析器与源条目**

在 skill 模块解析器(约 703 行)前加:

```ts
// ============ buff 模块解析器 ============
// 读 buff.xlsx 的 Buffs sheet → Buff 定义;effects/statMods 用 EffectTypes 编码解析。
// 导出 id 集合供 skill 源跨表校验 applyBuff 引用(SOURCES 里 buff 必须排在 skill 前)。
import { parseEffectList, parseStatMods } from '../assets/scripts/config/EffectTypes';

export const knownBuffIds = new Set<string>();

function buildBuffConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const rows = sheetRows(wb, 'Buffs');   // 用文件里既有的 sheet 读取工具(其余解析器同款)
    const buffs: unknown[] = [];
    knownBuffIds.clear();
    for (const r of rows) {
        const id = reqStr(r['id'], 'Buffs.id');
        if (knownBuffIds.has(id)) err(`Buffs[${id}]: id 重复`);
        knownBuffIds.add(id);
        const duration = reqNum(r['duration'], `Buffs[${id}].duration`);
        if (duration <= 0) err(`Buffs[${id}].duration 必须 > 0`);
        const maxStacks = reqNum(r['maxStacks'], `Buffs[${id}].maxStacks`);
        if (maxStacks < 1) err(`Buffs[${id}].maxStacks 必须 ≥ 1`);
        const stackRule = reqStr(r['stackRule'], `Buffs[${id}].stackRule`);
        if (stackRule !== 'refresh' && stackRule !== 'add') err(`Buffs[${id}].stackRule 必须是 refresh/add`);
        const period = num(r['period']) ?? 0;
        const periodicList = parseEffectList(String(r['periodicEffect'] ?? ''), m => err(`Buffs[${id}].periodicEffect: ${m}`));
        if (period > 0 && periodicList.length === 0) err(`Buffs[${id}]: period>0 但没有 periodicEffect`);
        if (period <= 0 && periodicList.length > 0) err(`Buffs[${id}]: 有 periodicEffect 但 period<=0`);
        if (periodicList.length > 1) err(`Buffs[${id}].periodicEffect 只允许一个效果`);
        const statMods = parseStatMods(String(r['statMods'] ?? ''), m => err(`Buffs[${id}].statMods: ${m}`));
        const flags = String(r['flags'] ?? '').split('|').map(s => s.trim()).filter(Boolean);
        for (const f of flags) if (!['stun', 'taunt', 'silence'].includes(f)) err(`Buffs[${id}].flags: 未知标记 ${f}`);
        buffs.push({
            id, name: reqStr(r['name'], `Buffs[${id}].name`),
            duration, maxStacks, stackRule, period,
            periodicEffect: periodicList[0] ?? null,
            statMods, flags, dispelTag: String(r['dispelTag'] ?? ''),
        });
    }
    if (buffs.length === 0) err('Buffs: 至少需要 1 个 buff');
    return { config: { buffs }, summary: `buffs=${buffs.length}` };
}
```

注意:`sheetRows`/`reqStr`/`reqNum`/`num`/`err` 沿用文件内既有工具函数,写代码前先看 skill 解析器(703 行起)确认实际函数名并保持一致。SOURCES 数组里,在 skill 条目**之前**插入:

```ts
    {
        name: 'buff',
        xlsxRel: 'config-xlsx/buff.xlsx',
        outRel: '../assets/scripts/config/buff.config.generated.ts',
        exportVar: 'generatedBuffConfig',
        build: buildBuffConfig,
    },
```

(条目字段以 skill 条目实际结构为准,856 行附近照抄格式。)

- [ ] **Step 7: 写 `assets/scripts/config/BuffConfig.ts`**

```ts
// Buff 配置。
// ★★★ 数值由 Excel 管理 ★★★ 源文件 tools/config-xlsx/buff.xlsx;
// 改数值:编辑 Excel → `npm run config` → 生成 buff.config.generated.ts。
import { generatedBuffConfig } from './buff.config.generated';
import type { Effect, StatMod } from './EffectTypes';

export type BuffStackRule = 'refresh' | 'add';
export type BuffFlag = 'stun' | 'taunt' | 'silence';

export interface BuffDef {
    id: string;
    name: string;
    duration: number;
    maxStacks: number;
    stackRule: BuffStackRule;
    period: number;                  // 0 = 无周期效果
    periodicEffect: Effect | null;
    statMods: StatMod[];
    flags: BuffFlag[];
    dispelTag: string;               // '' = 不可驱散
}

export interface BuffConfigShape { buffs: BuffDef[]; }
export const BuffConfig = generatedBuffConfig as BuffConfigShape;

const byId = new Map(BuffConfig.buffs.map(b => [b.id, b] as const));
export function getBuffDef(id: string): BuffDef | undefined { return byId.get(id); }
```

- [ ] **Step 8: 加 npm scripts 并生成产物**

`package.json` scripts 加 `"seed:buff": "tsx tools/seed-buff-xlsx.ts"`、`"test:effect-types": "tsx tools/effect-types-test.ts"`,并在 `test` 链末尾追加 `&& npm run test:effect-types`。然后:

Run: `npm run seed:buff && npm run config && npm run typecheck`
Expected: buff.xlsx 生成;`npm run config` 输出含 `buff` 源 `buffs=4`;typecheck 双配置无错。

- [ ] **Step 9: Commit**

```bash
git add assets/scripts/config/EffectTypes.ts assets/scripts/config/BuffConfig.ts assets/scripts/config/buff.config.generated.ts tools/seed-buff-xlsx.ts tools/effect-types-test.ts tools/excel-to-config.ts tools/config-xlsx/buff.xlsx package.json
git commit -m "feat(战斗框架): Effect 类型编码 + buff.xlsx 导表链

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: BuffSystem 纯逻辑

**Files:**
- Create: `assets/scripts/combat/BuffSystem.ts`
- Modify: `assets/scripts/combat/EffectiveStats.ts`(把 `normalizeStats` 加 `export`,一行改动)
- Create: `tools/buff-test.ts`
- Modify: `package.json`(`test:buff` + test 链)

**Interfaces:**
- Consumes: Task 1 的 `BuffDef`/`StatMod`/`getBuffDef`。
- Produces:
```ts
export interface BuffInstance { id: string; stacks: number; remaining: number; periodAccum: number; srcAtk: number; }
export interface BehaviorGate { canMove: boolean; canAct: boolean; }
export function applyBuffStack(buffs: BuffInstance[], def: BuffDef, srcAtk: number, stacks?: number): boolean; // 返回"属性/门需要重算"
export function dispelByTag(buffs: BuffInstance[], getDef: (id: string) => BuffDef | undefined, tag: string, count: number): boolean;
export function tickBuffs(buffs: BuffInstance[], dt: number, getDef: (id: string) => BuffDef | undefined,
    onPeriodic: (def: BuffDef, inst: BuffInstance) => void,
    onExpired: (def: BuffDef) => void): boolean;
export function buffedStats(base: CombatStats, buffs: BuffInstance[], getDef: (id: string) => BuffDef | undefined): CombatStats;
export function buffGate(buffs: BuffInstance[], getDef: (id: string) => BuffDef | undefined): BehaviorGate;
```

**语义(写进文件头注释):**
- `srcAtk`:施加时快照施法者 atk,周期跳伤/跳疗用它结算(DoT 不走 calcDamage、无闪避暴击,可预期)。
- `applyBuffStack`:已有实例时 `refresh` 重置 remaining、`add` 层数 +stacks 钳 maxStacks 且重置 remaining;新实例 push。都刷新 `srcAtk` 快照。
- `tickBuffs`:`remaining -= dt`;`period > 0` 时 `periodAccum += dt`,每满一个 period 调一次 `onPeriodic`(单帧可多次,while 扣减);到期 swap-remove 并调 `onExpired`。返回是否有增删(层数变化只发生在 applyBuffStack,不在 tick)。
- `buffedStats`:`out = {...base}`;每个 buff 每条 StatMod 按 `flat×stacks`、`base[key]×pct×stacks` 叠加;最后 `normalizeStats(out)` 钳制(复用 EffectiveStats 导出的那份,概率类 [0,1]、attackSpeed 下限)。
- `buffGate`:任一 buff 带 `stun` → `{canMove:false, canAct:false}`;`taunt`/`silence` 本段只解析不消费(第 2 段接)。

- [ ] **Step 1: 写失败测试 `tools/buff-test.ts`**(骨架同前;用手工构造的 BuffDef,不依赖 xlsx):

```ts
import assert from 'node:assert/strict';
import { applyBuffStack, dispelByTag, tickBuffs, buffedStats, buffGate, type BuffInstance } from '../assets/scripts/combat/BuffSystem';
import type { BuffDef } from '../assets/scripts/config/BuffConfig';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';

function mkDef(p: Partial<BuffDef>): BuffDef {
    return {
        id: 'b', name: 'B', duration: 5, maxStacks: 1, stackRule: 'refresh',
        period: 0, periodicEffect: null, statMods: [], flags: [], dispelTag: '', ...p,
    };
}
const defs = new Map<string, BuffDef>();
const getDef = (id: string) => defs.get(id);
// …test/run 骨架同 combat-test…

test('refresh:重复施加重置时长不叠层', () => {
    const d = mkDef({ id: 'r', duration: 5 });
    defs.set('r', d);
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 10);
    tickBuffs(buffs, 3, getDef, () => {}, () => {});
    applyBuffStack(buffs, d, 10);
    assert.equal(buffs.length, 1);
    assert.equal(buffs[0].stacks, 1);
    assert.equal(buffs[0].remaining, 5);
});
test('add:叠层钳 maxStacks 且刷新时长', () => {
    const d = mkDef({ id: 'a', duration: 6, maxStacks: 3, stackRule: 'add' });
    defs.set('a', d);
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 10); applyBuffStack(buffs, d, 10); applyBuffStack(buffs, d, 10); applyBuffStack(buffs, d, 10);
    assert.equal(buffs[0].stacks, 3);
});
test('tick:到期移除并回调,返回脏', () => {
    const d = mkDef({ id: 'e', duration: 1 });
    defs.set('e', d);
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 10);
    const expired: string[] = [];
    const dirty = tickBuffs(buffs, 1.5, getDef, () => {}, def => expired.push(def.id));
    assert.equal(dirty, true);
    assert.equal(buffs.length, 0);
    assert.deepEqual(expired, ['e']);
});
test('周期:2.5 秒 period=1 触发 2 次;单帧跨多周期补触发', () => {
    const d = mkDef({ id: 'p', duration: 10, period: 1, periodicEffect: { kind: 'damage', mult: 0.5 } });
    defs.set('p', d);
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 10);
    let fires = 0;
    tickBuffs(buffs, 2.5, getDef, () => fires++, () => {});
    assert.equal(fires, 2);
});
test('buffedStats:flat×层数 + pct×层数,概率钳 [0,1]', () => {
    const d = mkDef({ id: 's', maxStacks: 2, stackRule: 'add', statMods: [
        { key: 'atk', flat: 5, pct: 0 }, { key: 'atk', flat: 0, pct: 0.1 }, { key: 'dodgeRate', flat: 0.9, pct: 0 },
    ]});
    defs.set('s', d);
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 0, 2);
    const base = { ...BattleConfig.stats.dps, atk: 100, dodgeRate: 0.5 };
    const out = buffedStats(base, buffs, getDef);
    assert.equal(out.atk, 100 + 5 * 2 + 100 * 0.1 * 2);
    assert.equal(out.dodgeRate, 1);   // 0.5+1.8 钳到 1
    assert.equal(base.atk, 100);       // 不改 base
});
test('dispel:按标签移除至多 count 个;gate:stun 关门', () => {
    const d1 = mkDef({ id: 'x1', dispelTag: 'debuff' });
    const d2 = mkDef({ id: 'x2', dispelTag: 'debuff', flags: ['stun'] });
    defs.set('x1', d1); defs.set('x2', d2);
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d1, 0); applyBuffStack(buffs, d2, 0);
    assert.equal(buffGate(buffs, getDef).canMove, false);
    dispelByTag(buffs, getDef, 'debuff', 1);
    assert.equal(buffs.length, 1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx tools/buff-test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现 `combat/BuffSystem.ts`**(纯函数,无 cc 依赖;`buffedStats` 里 import `normalizeStats` 前先给 `EffectiveStats.ts` 的该函数加 export)。swap-remove 写法参考 `BattleManager._cleanupDeadEnemies`。周期用 `while (inst.periodAccum >= def.period) { inst.periodAccum -= def.period; onPeriodic(def, inst); }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx tsx tools/buff-test.ts && npm run typecheck`
Expected: 6 通过;typecheck 无错

- [ ] **Step 5: Commit**

```bash
git add assets/scripts/combat/BuffSystem.ts assets/scripts/combat/EffectiveStats.ts tools/buff-test.ts package.json
git commit -m "feat(战斗框架): BuffSystem 纯逻辑——叠层/到期/周期/属性聚合/行为门

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: CombatUnit 统一单位模型(行为等价迁移)

**Files:**
- Create: `assets/scripts/combat/CombatUnit.ts`
- Modify: `assets/scripts/combat/BattleManager.ts`(删 `Soldier`/`Enemy` interface,全面迁移)
- Modify: `assets/scripts/ui/BattleStageView.ts`(字段改名的编译级修正)
- Modify: `tools/combat-test.ts`、`tools/skill-test.ts`(字段引用修正)
- 检查不改: `tools/pacing-sim.ts`(只用构造函数与 `phase`,应零改动;typecheck 兜底)

**Interfaces:**
- Produces:
```ts
// CombatUnit.ts(UnitAction 从 BattleManager 迁来,BattleManager 改为 re-export 保住外部 import)
export type UnitAction = 'idle' | 'run' | 'attack' | 'death';
export type UnitSide = 'ally' | 'enemy';
export interface CombatUnit {
    id: number;
    side: UnitSide;
    key: string;              // 原 soldier.cls / enemy.type
    displayName: string;      // 原 enemy.typeName;士兵填职业名
    archetype: AttackType;    // 'melee' | 'ranged' | 'heal',沿用 BattleConfig.AttackType
    x: number; y: number; homeX: number; homeY: number;
    baseStats: CombatStats;   // 开战面板(引用,ConfigPanel 实时调参依赖它)
    stats: CombatStats;       // 战时属性:无 buff 时 === baseStats(同一引用!);有 buff 时为聚合副本
    hp: number; maxHp: number;
    moveSpeed: number;        // 原 cdef.moveSpeed / enemy.speed
    attackInterval: number;   // 原 soldier.fireInterval / enemy.attackInterval
    advanceLimit: number;     // 敌人填 0
    healPerSec: number;       // 非治疗填 0
    radius: number;           // 士兵填 0(未使用),怪物命中半径
    color: [number, number, number] | null;
    cd: number;               // 原 s.cd / e.atkCd
    alive: boolean;
    action: UnitAction; actionTime: number; actionLock: number;
    buffs: BuffInstance[];
    gate: BehaviorGate;
    skills: UnitSkills | null;
}
export function createSoldierUnit(id: number, cls: SoldierClass, stats: CombatStats, homeX: number, homeY: number): CombatUnit;
export function createEnemyUnit(id: number, type: string, hpOverride: number | undefined, x: number, y: number): CombatUnit;
export function recomputeDerived(u: CombatUnit): void;  // stats 与 gate 的脏重算
```
- `recomputeDerived`:`u.buffs.length === 0` 时 `u.stats = u.baseStats`(**恢复引用**,保 ConfigPanel 调参实时生效),否则 `u.stats = buffedStats(u.baseStats, u.buffs, getBuffDef)`;gate 同步 `buffGate` 结果。
- 工厂函数内部读 `BattleConfig.classes[cls]` / `BattleConfig.enemyTypes[type]`,字段映射按上表;士兵 `cd: Math.random() * Math.max(cdef.fireInterval, 0.3)` 与 `skills: unitSkillsForClass(cls)` 原样保留;敌人 `cd: t.attackInterval * 0.5`、`action: 'run'`、`skills: null`。

**BattleManager 迁移要点(行为等价,只换类型和字段名):**
1. `soldiers: CombatUnit[]`、`enemies: CombatUnit[]`,数组名/公开性不变;`_setupSquad`/`_spawnEnemyOfType` 改调工厂(id 用自增 `_unitSeq`)。
2. 全文件字段改名:`s.cls`→`s.key`、`s.attackType`→`s.archetype`、`s.fireInterval`→`s.attackInterval`、`e.type`→`e.key`、`e.typeName`→`e.displayName`、`e.speed`→`e.moveSpeed`、`e.atkCd`→`e.cd`、`e.attackInterval`→`e.attackInterval`(不变)。
3. `_markDead` 里 `this.enemies.indexOf(...)` 的判断改为 `u.side === 'enemy'`(语义相同更直白)。
4. `SkillCastEvent.casterCls` 保持 `SoldierClass` 类型,赋值处 `s.key as SoldierClass`。
5. `skills` 现在可空:`_updateFiring` 的 `s.skills.onBasicAttack()` 与 `_updateSkills` 的调用处加 `s.skills` 判空(敌人数组不进这两个循环,士兵恒非空,判空只为类型收窄)。
6. 本 Task **不消费** buffs/gate(初始化为空数组和 `{canMove:true, canAct:true}`),不接 Effect——纯迁移,保证行为逐帧等价。

**BattleStageView 修正(编译驱动,逐个跟着报错改):** `soldier.cls` → `soldier.key as SoldierClass`(约 376/380/474 行);enemy 遍历若引用 `typeName` 改 `displayName`。**不加任何新表现。**

**测试修正:** `combat-test.ts` 71 行 `s.cls`→`s.key`;`skill-test.ts` 里 BattleManager 集成段若引用 soldier 字段同步改。

- [ ] **Step 1: 写 CombatUnit.ts(类型+工厂+recomputeDerived)**(代码按上面 Interfaces 落实,工厂字段映射照 BattleManager 现有 `_setupSquad`/`_spawnEnemyOfType` 逐字段搬)
- [ ] **Step 2: BattleManager 全面迁移**(按上面 6 个要点;`UnitAction` 定义迁到 CombatUnit.ts,BattleManager 顶部 `export type { UnitAction } from './CombatUnit';` 保住 BattleStageView 的既有 import)
- [ ] **Step 3: 修 BattleStageView / combat-test / skill-test 编译错**

Run: `npm run typecheck`
Expected: 双配置无错

- [ ] **Step 4: 全量测试 + pacing 回归**

Run: `npm test && npm run sim:pacing`
Expected: 17 组测试全过(新链共 19 组);pacing 13 门槛全绿(RNG 抖动复跑一次确认)

- [ ] **Step 5: Commit**

```bash
git add assets/scripts/combat/CombatUnit.ts assets/scripts/combat/BattleManager.ts assets/scripts/ui/BattleStageView.ts tools/combat-test.ts tools/skill-test.ts
git commit -m "refactor(战斗框架): Soldier/Enemy 合并为 CombatUnit 统一单位模型——行为等价迁移

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: applyEffect 唯一状态变更入口 + BattleManager 接线

**Files:**
- Create: `assets/scripts/combat/Effects.ts`
- Modify: `assets/scripts/combat/BattleManager.ts`(伤害/技能路径重构、`_updateBuffs`、事件扩展)
- Modify: `assets/scripts/ui/BattleStageView.ts`(FloatText `heal` kind 的颜色映射,一行)
- Create: `tools/effect-test.ts`
- Modify: `package.json`(`test:effect` + test 链)

**Interfaces:**
- Consumes: Task 1~3 全部签名。
- Produces:
```ts
// Effects.ts
export interface EffectSource { stats: CombatStats; }   // CombatUnit 和 Bullet 都满足
export interface EffectHooks {
    spawnFloat(x: number, y: number, r: DamageResult, kind?: FloatText['kind']): void;
    markDead(u: CombatUnit): void;
    onBuffChanged(target: CombatUnit, buffId: string, applied: boolean, stacks: number): void;
}
export interface EffectOutcome { damage: number; crit: boolean; dodged: boolean; }
export function applyEffect(source: EffectSource, target: CombatUnit, effect: Effect, hooks: EffectHooks, floatKind?: FloatText['kind']): EffectOutcome;
```
- 各 kind 语义:
  - `damage`:`r = calcDamage(source.stats, target.stats)`;`dmg = r.dodged ? 0 : Math.max(1, Math.round(r.damage * mult))`;扣血、`spawnFloat(target.x, target.y, {...r, damage: dmg}, floatKind)`、死亡走 `markDead`。`mult=1` 且不传 floatKind 时与旧 `_applyDamage` 逐字段等价。
  - `heal`:`amount = Math.max(1, Math.round(source.stats.atk * mult))`;`hp = min(maxHp, hp + amount)`;飘字 kind `'heal'`(FloatText kind union 加 `'heal'`)。
  - `applyBuff`:`getBuffDef` 查定义(查不到 no-op 返回零值);`applyBuffStack(target.buffs, def, source.stats.atk, stacks)` → `recomputeDerived(target)` → `onBuffChanged(target, buffId, true, stacks)`。
  - `dispel`:`dispelByTag` → 有移除则 `recomputeDerived` + `onBuffChanged(target, tag, false, 0)`。
  - `knockback`/`summon`:no-op 返回零值(注释标注第 2/3 段实装)。
- BattleEvent 扩展(BattleManager):
```ts
export interface BuffChangedEvent {
    type: 'buffChanged';
    targetSide: UnitSide; targetKey: string;
    buffId: string; applied: boolean; stacks: number;
}
export type BattleEvent = EnemyKilledEvent | SkillCastEvent | BuffChangedEvent;
```
(spec 写的 buffApplied/buffExpired 两个事件合并为一个带 `applied` 标志的事件,信息等价、union 更短;spec 偏差在收尾任务回写说明。)

**BattleManager 接线要点:**
1. 组一个复用的 `_effectHooks: EffectHooks`(构造函数里建一次,不每帧建):`spawnFloat` 绑 `_spawnFloat`、`markDead` 绑 `_markDead`、`onBuffChanged` push `BuffChangedEvent`。
2. `_applyDamage(att, defender)` 整个替换为 `applyEffect(源, defender, DMG1, this._effectHooks)`,其中 `DMG1` 是模块级常量 `{ kind: 'damage', mult: 1 } as const`(零分配);近战调用处源传士兵、子弹命中传 bullet(满足 EffectSource)、敌人攻击传敌人。
3. `_applySkillDamage` 删除,技能结算在 Task 5 重构(本 Task 先留 `applyEffect(s, target, { kind:'damage', mult: cast.def.dmgMult }, hooks, 'skill')` 的等价替换——注意这里有每次分配,Task 5 会随效果列表一起消掉)。
4. `tick()` 顺序里 `_updateActionClocks` 之后插 `_updateBuffs(dt)`:遍历两个数组,`u.buffs.length === 0` 直接 continue(零开销快路径);否则 `tickBuffs(u.buffs, dt, getBuffDef, onPeriodic, onExpired)`,脏则 `recomputeDerived(u)`。`onPeriodic`:`damage` → `dmg = Math.max(1, Math.round(inst.srcAtk * eff.mult * inst.stacks))` 直接扣血+飘字 `'skill'`+判死(DoT 不走 calcDamage);`heal` → 同理回血;`applyBuff` → 对自身 applyEffect。`onExpired` → push `BuffChangedEvent{applied:false}`。**注意回调闭包在循环外预建或用实例方法绑定,不在每单位每帧新建闭包**——用类私有方法 `_onBuffPeriodic = (def, inst) => {...}` 字段形式绑定一次,当前处理单位存 `_buffTickUnit` 私有字段。
5. gate 消费(本段只接 stun):`_updateMovement` 士兵循环开头 `if (!s.gate.canMove) continue;`;`_updateFiring`/`_updateSkills`/`_updateHealing` 循环开头 `if (!u.gate.canAct) continue;`;`_updateEnemies` 里怪的推进分支包在 `if (e.gate.canMove)`、攻击分支包在 `if (e.gate.canAct)`。

- [ ] **Step 1: 写失败测试 `tools/effect-test.ts`**——用 `createSoldierUnit`/`createEnemyUnit` 造单位(critRate/dodgeRate 清零保证确定性),覆盖:damage 等价性(与手算 calcDamage 减法一致)、heal 封顶 maxHp、applyBuff 后 `stats !== baseStats` 且 atk 生效、全部 buff 到期后 `stats === baseStats`(引用恢复)、dispel、stun 单位在 BattleManager 集成里一帧不移动不出手(构造 mgr 后手动给 `mgr.enemies[0].buffs` 施加 stun buff + recomputeDerived,tick 后位置不变)。周期跳伤:施 poison(用 getBuffDef 真配置),tick 1.05 秒断言怪掉血 `max(1, round(srcAtk*0.15*1))`。
- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx tools/effect-test.ts`
Expected: FAIL(Effects 模块不存在)

- [ ] **Step 3: 实现 Effects.ts + BattleManager 五点接线 + FloatText heal 颜色**(BattleStageView 飘字颜色 switch 里给 `'heal'` 配绿色,与既有 kind 写法一致)
- [ ] **Step 4: 全量验证**

Run: `npx tsx tools/effect-test.ts && npm run typecheck && npm test && npm run sim:pacing`
Expected: 全绿;pacing 13 门槛保持(本 Task 无行为变化——没人施 buff 时所有新路径都是快路径)

- [ ] **Step 5: Commit**

```bash
git add assets/scripts/combat/Effects.ts assets/scripts/combat/BattleManager.ts assets/scripts/ui/BattleStageView.ts tools/effect-test.ts package.json
git commit -m "feat(战斗框架): applyEffect 唯一状态变更入口——伤害/治疗/上下Buff/驱散统一结算,BattleManager 接线

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 技能迁移到效果列表 + 跨表校验

**Files:**
- Modify: `tools/seed-skill-xlsx.ts`(`dmgMult` 列 → `effects` 列)
- Modify: `tools/excel-to-config.ts`(skill 解析器读 effects 编码 + 用 Task 1 的 `knownBuffIds` 跨表校验 applyBuff 引用)
- Modify: `assets/scripts/config/SkillConfig.ts`(`SkillDef.dmgMult` → `effects: Effect[]`)
- Modify: `assets/scripts/combat/BattleManager.ts`(`_updateSkills` 走效果列表)
- Modify: `tools/skill-test.ts`(mkDef 适配 + 新增 applyBuff 集成测试)
- 产物: `tools/config-xlsx/skill.xlsx`、`skill.config.generated.ts` 重新生成提交

**Interfaces:**
- Consumes: `parseEffectList`、`knownBuffIds`、`applyEffect`、`EffectOutcome`。
- Produces: `SkillDef { id; name; cls; trigger; triggerValue; target; radius; maxTargets; effects: Effect[] }`(`dmgMult` 字段删除,全仓库 grep 确认无残留引用)。

**要点:**
1. seed 三行迁移为行为等价:`whirlwind → 'damage:0.5'`、`ground_smash → 'damage:1.2'`、`lethal_strike → 'damage:2.5'`。**不加新技能**(会动 pacing 平衡,数值内容留给待办 4)。
2. skill 解析器:`effects` 列 `parseEffectList` 解析;遍历结果中 `applyBuff` 的 `buffId` 不在 `knownBuffIds` → `err`;`effects` 为空 → `err`(技能必须有效果)。SOURCES 顺序已保证 buff 先于 skill 解析。
3. `_updateSkills` 重构:对每个 cast、每个目标遍历 `cast.def.effects` 调 `applyEffect(s, target, eff, hooks, 'skill')`;per-target 聚合 `hits` 条目:`damage` 累加、`crit` 任一为真、`dodged` 取首个 damage 效果的结果(单效果时与旧行为逐字段等价);全目标零命中(hits 空)沿用现有"落空不发事件"分支。`SkillCastEvent` 结构不变。
4. `skill-test.ts`:`mkDef` 的 `dmgMult: 1` 改 `effects: [{ kind: 'damage', mult: 1 }]`;新增集成测试:构造 BattleManager 后 `mgr.soldiers[0].skills = new UnitSkills([mkDef({ trigger:'timer', triggerValue:0.1, target:'single', effects:[{kind:'damage',mult:1},{kind:'applyBuff',buffId:'poison',stacks:1}] })])`,tick 若干帧后断言:目标怪 `buffs` 里有 poison 实例、事件流里有 `buffChanged{applied:true}`、继续 tick 1 秒+断言周期跳伤扣血。

- [ ] **Step 1: 改 skill-test(先红)**——mkDef 换 effects 字段 + 写上面的集成测试

Run: `npx tsx tools/skill-test.ts`
Expected: FAIL(SkillDef 无 effects 字段,编译错)

- [ ] **Step 2: SkillConfig.ts 类型迁移 + seed 脚本迁移 + 解析器迁移与跨表校验**
- [ ] **Step 3: 重新生成配置**

Run: `npm run seed:skill && npm run config`
Expected: skill 源输出 `skills=3`,无校验错误

- [ ] **Step 4: BattleManager._updateSkills 走效果列表,删 `_applySkillDamage` 与 Task 4 的临时 dmgMult 分配**
- [ ] **Step 5: 全量验证**

Run: `npm run typecheck && npm test && npm run sim:pacing`
Expected: 全绿(技能编码迁移行为等价,pacing 不动)

- [ ] **Step 6: Commit**

```bash
git add tools/seed-skill-xlsx.ts tools/excel-to-config.ts tools/config-xlsx/skill.xlsx assets/scripts/config/SkillConfig.ts assets/scripts/config/skill.config.generated.ts assets/scripts/combat/BattleManager.ts tools/skill-test.ts
git commit -m "feat(战斗框架): 技能升级为效果列表——dmgMult 迁移 effects 编码,applyBuff 跨表校验

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 收尾——文档同步 + 全量门禁

**Files:**
- Modify: `ai/memory/代码地图.md`(战斗核心表加 CombatUnit/Effects/BuffSystem 三行,BattleManager 行职责更新;配置表加 buff.xlsx/BuffConfig 两行;测试行更新)
- Modify: `ai/skills/战斗框架.md`(文件分工加三件套;"加新战斗维度"流程补"加 Effect 种类/加 Buff"两条标准流程;不变量补"applyEffect 是唯一状态变更入口,禁止绕过直接改 hp/buffs")
- Modify: `ai/memory/项目状态.md`(最近进展加一条;待办 6 的 Buff/Debuff 标记为地基已落)
- Modify: `docs/superpowers/specs/2026-07-11-combat-framework-design.md`(补一行:buffApplied/buffExpired 实做合并为 buffChanged{applied} 单事件)

- [ ] **Step 1: 按上面清单同步四个文档**
- [ ] **Step 2: 终验**

Run: `npm run verify && npm run sim:pacing`
Expected: 双 typecheck + 全部测试(17+3 组)+ pacing 13 门槛 + check:art + check:ui-alpha 全绿;pacing 复跑一次确认无边界抖动

- [ ] **Step 3: Commit**

```bash
git add ai/memory/代码地图.md ai/skills/战斗框架.md ai/memory/项目状态.md docs/superpowers/specs/2026-07-11-combat-framework-design.md
git commit -m "docs(战斗框架): 第 1 段收尾——代码地图/战斗框架skill/项目状态同步

Co-Authored-By: Claude <noreply@anthropic.com>"
```
