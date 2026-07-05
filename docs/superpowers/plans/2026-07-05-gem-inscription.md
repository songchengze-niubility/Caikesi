# 镶嵌（宝石）+ 铭文系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 装备加两组独立槽位——宝石孔（分类型/等级、可插拔）+ 铭文位（卷轴随机打入、可覆盖）；数据挂 `EquipItem`，加成走 `EffectiveStats` 同一路径；只做机制，平衡后置。

**Architecture:** 新纯逻辑模块 `inlay/`（`InlayConfig` 读表算系数、`InlayModel` 三个镶嵌操作 + `ensureInlaySlots`、`InlayStats` 汇总加成）+ 新配置真源 `inlay.xlsx`（三表走现有导表管线）+ `EquipItem` 加 `gemSockets`/`inscriptions` 字段 + 宝石按"类型_等级"拆成新 `MaterialId`（替换 `gem_shard`/`rune_dust`）+ `ChestService` 产宝石/卷轴 + 镶嵌面板走 BattleEntry 方法（镜像 CraftView/SquadView，从 InventoryView「镶嵌」按钮打开）。

**Tech Stack:** TypeScript（Cocos Creator 3.8.8 运行时子集，纯逻辑不依赖 cc）、tsx（跑纯逻辑单测）、xlsx（数值真源，`npm run config` 生成产物）。

## Global Constraints

- **数值真源在 Excel**：新配置改 `tools/seed-inlay-xlsx.ts` → `npx tsx tools/seed-inlay-xlsx.ts`（`npm run seed:inlay`）重生 `tools/config-xlsx/inlay.xlsx` → `npm run config` 生成 `assets/scripts/config/inlay.config.generated.ts`。**产物入库**（Cocos 不跑 npm）。
- **逻辑与渲染分离**：`InlayConfig`/`InlayModel`/`InlayStats` 不 import `cc`，可跑 tsx 单测；渲染/持久化只在 `BattleEntry`/`InventoryView`。
- **MaterialId 必须有限联合 + 等级耦合红线**：`MATERIAL_LABEL` 是 `Record<MaterialId, string>`，故 `MaterialId` 的宝石键写死 `gem_${GemType}_${1 | 2 | 3 | 4}`（等级范围 1~4）。这与 `inlay.xlsx` 的 `Gems.maxLevel` 耦合：**起手统一 `maxLevel=4`**；将来调宝石等级上限时，要同步拓宽这个联合类型的 `${1|2|3|4}`，否则超范围等级会产出未登记 `MaterialId`。
- **宝石只存类型+等级**：`GemSocket = { type, level }`，加成属性由 `InlayConfig.gemStatKey(type)` 从配置现查（config-driven，与项目"存 key、值由配置现算"一致）。
- **平铺加成、不新开公式**：宝石/铭文和装备词条同池、走 `EffectiveStats.calcEffectiveStats` 同一路径，`normalizeStats` 钳制之前累加；与角色/装备等级缩放互不干扰。
- **百分比属性语义**：`PERCENT_STATS`（attackSpeed/critRate/critDmg/dodgeRate/blockRate/blockRatio/dmgBonus/dmgReduce）在代码里是 0~1 小数，配 `baseValue`/`valueMin` 时按小数填（暴击 2% 填 `0.02`）；非百分比（hp/atk/def/range）为整数。
- **占位数值**（平衡后置，不在本计划验收范围）：见 Task 1 seed 行。
- **提交规范**：中文 commit，结尾带 `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`。只在本计划步骤要求时提交。

---

### Task 1: inlay 配置链路（EquipDefs 类型 + inlay.xlsx seed + 导表器 + 产物）

把宝石/铭文类型、成长曲线四类数据接入 Excel→配置产物链路，并给 `EquipItem` 加两个槽位字段（仅类型，本任务不写逻辑）。

**Files:**
- Modify: `assets/scripts/inventory/EquipDefs.ts`（加 `GemType`/`GemSocket`/`InscriptionEffect` + `EquipItem` 两字段）
- Create: `tools/seed-inlay-xlsx.ts`
- Modify: `tools/excel-to-config.ts`（加 `buildInlayConfig` + `SOURCES` 一行）
- Modify: `package.json`（加 `seed:inlay`）
- Regenerate: `tools/config-xlsx/inlay.xlsx`、`assets/scripts/config/inlay.config.generated.ts`

**Interfaces:**
- Produces: `GemType = 'atk'|'hp'|'def'|'crit'|'dmg'`；`GemSocket = { type: GemType; level: number }`；`InscriptionEffect = { stat: EquipStatKey; value: number }`；`EquipItem.gemSockets?: (GemSocket|null)[]`；`EquipItem.inscriptions?: (InscriptionEffect|null)[]`；`generatedInlayConfig`（shape：`{ gems: Record<type,{label,stat,baseValue,maxLevel}>, socketCounts: Record<quality,{gemSockets,inscriptionSlots}>, inscriptions: {stat,valueMin,valueMax}[] }`）。供 Task 2（`InlayConfig`）、Task 3（`MaterialId`）使用。

- [ ] **Step 1: EquipDefs 加类型 + EquipItem 字段**

`assets/scripts/inventory/EquipDefs.ts`，在 `EquipStats` 类型定义（当前第 9 行）后加：

```typescript
export type GemType = 'atk' | 'hp' | 'def' | 'crit' | 'dmg';   // 宝石类型（映射属性见 inlay.xlsx/Gems）
export interface GemSocket { type: GemType; level: number }     // 只记类型+等级，加成值由 InlayConfig 现算
export interface InscriptionEffect { stat: EquipStatKey; value: number }  // 卷轴抽定后固定存这
```

同文件 `EquipItem` 接口（当前 11-19 行），在 `locked?` 行后加两字段：

```typescript
export interface EquipItem {
    id: string;
    slot: EquipSlot;
    name: string;
    quality: Quality;
    level?: number;
    stats?: EquipStats;
    locked?: boolean;
    gemSockets?: (GemSocket | null)[];          // 长度=该品质宝石孔数；null=空孔；读老存档补齐
    inscriptions?: (InscriptionEffect | null)[]; // 长度=该品质铭文位数；null=空位；读老存档补齐
}
```

- [ ] **Step 2: 建 seed 脚本**

Create `tools/seed-inlay-xlsx.ts`：

```typescript
// inlay.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/inlay.xlsx，之后策划直接编辑该 xlsx。
// 三表：Gems（宝石类型→属性/基值/等级上限）、SocketCounts（品质→两组孔数）、Inscriptions（铭文效果池）。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/inlay.xlsx');

// 宝石加成 = baseValue × level。百分比属性(crit/dmg)按小数填。maxLevel 起手统一 4（与 MaterialId 联合类型耦合）。
const GEMS_HEADER = ['type', 'label', 'stat', 'baseValue', 'maxLevel'];
const GEMS_ROWS: (string | number)[][] = [
    ['atk', '攻击', 'atk', 30, 4],
    ['hp', '生命', 'hp', 120, 4],
    ['def', '防御', 'def', 8, 4],
    ['crit', '暴击', 'critRate', 0.02, 4],
    ['dmg', '增伤', 'dmgBonus', 0.03, 4],
];

// 两组独立孔数，按品质浮动（gemSockets / inscriptionSlots）。
const SOCKET_COUNTS_HEADER = ['quality', 'gemSockets', 'inscriptionSlots'];
const SOCKET_COUNTS_ROWS: (string | number)[][] = [
    ['common', 1, 0],
    ['fine', 1, 1],
    ['rare', 2, 1],
    ['epic', 2, 1],
    ['legend', 3, 2],
];

// 铭文效果池：打铭文时随机抽一行、在 [valueMin,valueMax] roll 出 value。百分比属性按小数填。
const INSCRIPTIONS_HEADER = ['stat', 'valueMin', 'valueMax'];
const INSCRIPTIONS_ROWS: (string | number)[][] = [
    ['atk', 10, 40],
    ['hp', 60, 200],
    ['def', 3, 10],
    ['critRate', 0.01, 0.05],
    ['critDmg', 0.05, 0.15],
    ['dmgBonus', 0.02, 0.08],
    ['dmgReduce', 0.01, 0.05],
];

const wb = XLSX.utils.book_new();
function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}
addSheet('Gems', GEMS_HEADER, GEMS_ROWS);
addSheet('SocketCounts', SOCKET_COUNTS_HEADER, SOCKET_COUNTS_ROWS);
addSheet('Inscriptions', INSCRIPTIONS_HEADER, INSCRIPTIONS_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Gems(${GEMS_ROWS.length}) SocketCounts(${SOCKET_COUNTS_ROWS.length}) Inscriptions(${INSCRIPTIONS_ROWS.length})`);
```

- [ ] **Step 3: 导表器加 inlay 解析器**

`tools/excel-to-config.ts`，在 `buildSkillConfig` 函数之后（`// ============ 源清单` 之前）插入：

```typescript
// ============ inlay 模块解析器 ============
// 读 inlay.xlsx 的 3 sheet → 镶嵌配置。
// Gems: type, label, stat, baseValue, maxLevel
// SocketCounts: quality, gemSockets, inscriptionSlots
// Inscriptions: stat, valueMin, valueMax
function buildInlayConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_GEM_TYPES = new Set(['atk', 'hp', 'def', 'crit', 'dmg']);
    const VALID_QUALITIES = ['common', 'fine', 'rare', 'epic', 'legend'];

    const { rows: gemRows } = sheetToRows(wb, 'Gems');
    const gems: Record<string, unknown> = {};
    const gemKeys = new Set<string>();
    for (const r of gemRows) {
        const type = reqStr(r['type'], 'Gems.type');
        if (!VALID_GEM_TYPES.has(type)) err(`Gems: type "${type}" 非法（须为 atk/hp/def/crit/dmg）`);
        if (gemKeys.has(type)) err(`Gems: type "${type}" 重复定义`);
        gemKeys.add(type);
        const stat = reqStr(r['stat'], `Gems[${type}].stat`);
        if (!STAT_KEY_SET.has(stat)) err(`Gems[${type}]: stat "${stat}" 不在 CombatStats 中`);
        const baseValue = reqNum(r['baseValue'], `Gems[${type}].baseValue`);
        if (baseValue <= 0) warn(`Gems[${type}].baseValue = ${baseValue} 应 > 0`);
        const maxLevel = reqNum(r['maxLevel'], `Gems[${type}].maxLevel`);
        if (maxLevel < 1) err(`Gems[${type}].maxLevel 必须 >= 1`);
        if (maxLevel > 4) warn(`Gems[${type}].maxLevel = ${maxLevel} 超过 4：MaterialId 联合类型只覆盖 1~4，需同步拓宽 RewardTypes`);
        gems[type] = { label: reqStr(r['label'], `Gems[${type}].label`), stat, baseValue, maxLevel };
    }
    if (Object.keys(gems).length === 0) err('Gems: 至少需要 1 个宝石类型');

    const { rows: socketRows } = sheetToRows(wb, 'SocketCounts');
    const socketCounts: Record<string, unknown> = {};
    const socketKeys = new Set<string>();
    for (const r of socketRows) {
        const quality = reqStr(r['quality'], 'SocketCounts.quality');
        if (!VALID_QUALITIES.includes(quality)) err(`SocketCounts: quality "${quality}" 非法`);
        if (socketKeys.has(quality)) err(`SocketCounts: quality "${quality}" 重复定义`);
        socketKeys.add(quality);
        const gemSockets = reqNum(r['gemSockets'], `SocketCounts[${quality}].gemSockets`);
        const inscriptionSlots = reqNum(r['inscriptionSlots'], `SocketCounts[${quality}].inscriptionSlots`);
        if (gemSockets < 0) err(`SocketCounts[${quality}].gemSockets 不可为负`);
        if (inscriptionSlots < 0) err(`SocketCounts[${quality}].inscriptionSlots 不可为负`);
        socketCounts[quality] = { gemSockets, inscriptionSlots };
    }
    for (const q of VALID_QUALITIES) if (!socketKeys.has(q)) err(`SocketCounts: 缺少品质 "${q}"`);

    const { rows: inscRows } = sheetToRows(wb, 'Inscriptions');
    const inscriptions: unknown[] = [];
    for (const r of inscRows) {
        const stat = reqStr(r['stat'], 'Inscriptions.stat');
        if (!STAT_KEY_SET.has(stat)) err(`Inscriptions: stat "${stat}" 不在 CombatStats 中`);
        const valueMin = reqNum(r['valueMin'], `Inscriptions[${stat}].valueMin`);
        const valueMax = reqNum(r['valueMax'], `Inscriptions[${stat}].valueMax`);
        if (valueMin <= 0) warn(`Inscriptions[${stat}].valueMin = ${valueMin} 应 > 0`);
        if (valueMax < valueMin) err(`Inscriptions[${stat}]: valueMax 必须 >= valueMin`);
        inscriptions.push({ stat, valueMin, valueMax });
    }
    if (inscriptions.length === 0) err('Inscriptions: 至少需要 1 条铭文效果');

    const config = { gems, socketCounts, inscriptions };
    const summary = `gems=${Object.keys(gems).length} socketCounts=${Object.keys(socketCounts).length} inscriptions=${inscriptions.length}`;
    return { config, summary };
}
```

- [ ] **Step 4: SOURCES 加 inlay 一行**

`tools/excel-to-config.ts` 的 `SOURCES` 数组，在 `skill` 那一项之后加：

```typescript
    {
        name: 'inlay',
        xlsxRel: 'config-xlsx/inlay.xlsx',
        outRel: '../assets/scripts/config/inlay.config.generated.ts',
        exportVar: 'generatedInlayConfig',
        build: buildInlayConfig,
    },
```

- [ ] **Step 5: package.json 加 seed:inlay**

`package.json` 的 `scripts`，在 `"seed:skill"` 行后加：

```json
    "seed:skill": "tsx tools/seed-skill-xlsx.ts",
    "seed:inlay": "tsx tools/seed-inlay-xlsx.ts",
```

- [ ] **Step 6: 重生 xlsx + 产物**

Run:
```bash
npm run seed:inlay && npm run config
```
Expected: `✓ 已生成 .../inlay.xlsx`；config 输出含 `✓ [inlay] 已生成 ...`、`gems=5 socketCounts=5 inscriptions=7`，无报错。

- [ ] **Step 7: 校验产物含新字段**

Run:
```bash
grep '"baseValue": 30' assets/scripts/config/inlay.config.generated.ts
grep '"gemSockets": 3' assets/scripts/config/inlay.config.generated.ts
```
Expected: 两条都命中（atk 宝石 baseValue=30；legend 品质 gemSockets=3）。

- [ ] **Step 8: 回归现有链路仍全绿**

Run:
```bash
npm run test:combat && npm run test:effective && npm run sim:pacing
```
Expected: 全过；`sim:pacing`「全部达标」（新增字段/产物不影响既有路径）。

- [ ] **Step 9: Commit**

```bash
git add assets/scripts/inventory/EquipDefs.ts tools/seed-inlay-xlsx.ts tools/excel-to-config.ts package.json tools/config-xlsx/inlay.xlsx assets/scripts/config/inlay.config.generated.ts
git commit -m "feat(inlay): inlay.xlsx 配置链路 + EquipItem 宝石/铭文槽位字段

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: InlayConfig 纯计算（TDD）

读产物算：孔数、宝石加成、宝石属性映射、铭文随机 roll、四舍五入。镜像 `EquipConfig` 的纯计算风格。

**Files:**
- Create: `assets/scripts/inlay/InlayConfig.ts`
- Create: `tools/inlay-config-test.ts`
- Modify: `package.json`（加 `test:inlay-config`）

**Interfaces:**
- Consumes: `generatedInlayConfig`（Task 1）；`GemType`/`Quality`/`EquipStatKey`/`PERCENT_STATS`（`EquipDefs`）。
- Produces: `socketCounts(quality): { gemSockets: number; inscriptionSlots: number }`、`gemStatKey(type): EquipStatKey`、`gemStatValue(type, level): number`、`gemMaxLevel(type): number`、`gemTypes(): GemType[]`、`rollInscription(rng): InscriptionEffect`、`roundInlayStat(key, value): number`。供 Task 4/5/7 使用。

- [ ] **Step 1: 写失败测试**

Create `tools/inlay-config-test.ts`：

```typescript
// InlayConfig 纯计算单测（tsx 运行）。
import * as assert from 'node:assert/strict';
import { socketCounts, gemStatKey, gemStatValue, gemMaxLevel, gemTypes, rollInscription } from '../assets/scripts/inlay/InlayConfig';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('socketCounts：按品质返回两组孔数（占位 legend=3/2）', () => {
    assert.deepEqual(socketCounts('legend'), { gemSockets: 3, inscriptionSlots: 2 });
    assert.deepEqual(socketCounts('common'), { gemSockets: 1, inscriptionSlots: 0 });
});

test('gemStatKey：宝石类型映射到战斗属性（crit→critRate, dmg→dmgBonus）', () => {
    assert.equal(gemStatKey('atk'), 'atk');
    assert.equal(gemStatKey('crit'), 'critRate');
    assert.equal(gemStatKey('dmg'), 'dmgBonus');
});

test('gemStatValue：baseValue × level，等级钳到 maxLevel', () => {
    assert.equal(gemStatValue('atk', 1), 30);
    assert.equal(gemStatValue('atk', 3), 90);
    assert.equal(gemStatValue('atk', 999), 30 * gemMaxLevel('atk'));   // 超上限钳到 maxLevel
    assert.equal(gemStatValue('atk', 0), 30);                          // 低于1按1
});

test('gemTypes：列出全部 5 个类型', () => {
    assert.equal(gemTypes().length, 5);
    assert.ok(gemTypes().indexOf('atk') >= 0);
});

test('rollInscription：产出池内某条、value 落在该 stat 的 [min,max]', () => {
    // rng 固定返回 0 → 取池第一行、value=valueMin（atk: [10,40] → stat=atk, value=10）
    const insc = rollInscription(() => 0);
    assert.equal(insc.stat, 'atk');
    assert.equal(insc.value, 10);
});

test('rollInscription：rng 接近 1 时取末行、value 接近 valueMax', () => {
    const insc = rollInscription(() => 0.999999);
    assert.equal(insc.stat, 'dmgReduce');   // 池末行
    assert.ok(insc.value <= 0.05 && insc.value >= 0.01, `dmgReduce value=${insc.value} 应在 [0.01,0.05]`);
});

console.log(`\nInlayConfig：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 加测试脚本 + 运行确认失败**

`package.json` 的 `scripts`，在 `"test:growth"` 行后加：

```json
    "test:growth": "tsx tools/char-growth-test.ts",
    "test:inlay-config": "tsx tools/inlay-config-test.ts",
```

Run: `npm run test:inlay-config`
Expected: FAIL — `Cannot find module '.../inlay/InlayConfig'`。

- [ ] **Step 3: 写最小实现**

Create `assets/scripts/inlay/InlayConfig.ts`：

```typescript
// 镶嵌纯计算：孔数 / 宝石加成 / 宝石属性映射 / 铭文随机 roll / 四舍五入。
// 不依赖 cc，可 tsx 单测。数值来自 inlay.xlsx → inlay.config.generated.ts。

import { generatedInlayConfig } from '../config/inlay.config.generated';
import { GemType, InscriptionEffect, EquipStatKey, Quality, PERCENT_STATS } from '../inventory/EquipDefs';

export interface InlayGemDef { label: string; stat: EquipStatKey; baseValue: number; maxLevel: number }
export interface InlaySocketCount { gemSockets: number; inscriptionSlots: number }
export interface InlayInscriptionDef { stat: EquipStatKey; valueMin: number; valueMax: number }
export interface InlayConfigShape {
    gems: Record<GemType, InlayGemDef>;
    socketCounts: Record<Quality, InlaySocketCount>;
    inscriptions: InlayInscriptionDef[];
}

export const InlayConfig = generatedInlayConfig as InlayConfigShape;

// 整数属性(hp/atk/def/range)取整；百分比属性保留 4 位小数。镜像 EquipConfig.roundStat。
export function roundInlayStat(key: EquipStatKey, value: number): number {
    if (PERCENT_STATS.indexOf(key) >= 0) return Number(value.toFixed(4));
    return Math.round(value);
}

export function socketCounts(quality: Quality): InlaySocketCount {
    return InlayConfig.socketCounts[quality] ?? { gemSockets: 0, inscriptionSlots: 0 };
}

export function gemStatKey(type: GemType): EquipStatKey {
    return InlayConfig.gems[type]?.stat ?? 'atk';
}

export function gemMaxLevel(type: GemType): number {
    return InlayConfig.gems[type]?.maxLevel ?? 1;
}

export function gemStatValue(type: GemType, level: number): number {
    const def = InlayConfig.gems[type];
    if (!def) return 0;
    const clamped = Math.max(1, Math.min(gemMaxLevel(type), Math.floor(level)));
    return def.baseValue * clamped;
}

export function gemTypes(): GemType[] {
    return Object.keys(InlayConfig.gems) as GemType[];
}

// 从铭文池随机抽一行，在 [valueMin,valueMax] roll 出 value 并按属性四舍五入。
export function rollInscription(rng: () => number = Math.random): InscriptionEffect {
    const pool = InlayConfig.inscriptions;
    const i = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    const def = pool[i];
    const raw = def.valueMin + (def.valueMax - def.valueMin) * rng();
    return { stat: def.stat, value: roundInlayStat(def.stat, raw) };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:inlay-config`
Expected: PASS — `InlayConfig：6 通过，0 失败`。

- [ ] **Step 5: Commit**

```bash
git add assets/scripts/inlay/InlayConfig.ts tools/inlay-config-test.ts package.json
git commit -m "feat(inlay): InlayConfig 纯计算（孔数/宝石加成/铭文roll，TDD）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: RewardTypes 宝石/卷轴材料扩容（暂留旧 id）

给 `MaterialId` 加宝石(`gem_<type>_<level>`)与卷轴(`rune_scroll`)，程序化生成标签，加 `gemMaterialId` 构造器。**本任务保留 `gem_shard`/`rune_dust`**（等 Task 7 全部引用迁完再删），保证编译一路绿。

**Files:**
- Modify: `assets/scripts/services/RewardTypes.ts`
- Create: `tools/reward-types-test.ts`
- Modify: `package.json`（加 `test:reward-types`）

**Interfaces:**
- Consumes: `GemType`（`EquipDefs`，Task 1）。
- Produces: `MaterialId` 含 `` `gem_${GemType}_${1|2|3|4}` `` + `'rune_scroll'`；`gemMaterialId(type: GemType, level: number): MaterialId`；`MATERIAL_LABEL` 覆盖全部新键。供 Task 4/7 使用。

- [ ] **Step 1: 写失败测试**

Create `tools/reward-types-test.ts`：

```typescript
// RewardTypes 材料标签/构造器单测（tsx 运行）。
import * as assert from 'node:assert/strict';
import { MATERIAL_LABEL, gemMaterialId } from '../assets/scripts/services/RewardTypes';
import { gemTypes, gemMaxLevel } from '../assets/scripts/inlay/InlayConfig';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('gemMaterialId：拼出 gem_<type>_<level>', () => {
    assert.equal(gemMaterialId('atk', 2), 'gem_atk_2');
    assert.equal(gemMaterialId('crit', 4), 'gem_crit_4');
});

test('MATERIAL_LABEL：覆盖全部宝石键(类型×1~4) + rune_scroll + forge_stone', () => {
    for (const t of gemTypes()) {
        for (let lv = 1; lv <= Math.min(4, gemMaxLevel(t)); lv++) {
            const id = gemMaterialId(t, lv);
            assert.ok(MATERIAL_LABEL[id], `缺少标签: ${id}`);
        }
    }
    assert.ok(MATERIAL_LABEL['rune_scroll']);
    assert.ok(MATERIAL_LABEL['forge_stone']);
});

console.log(`\nRewardTypes：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 加测试脚本 + 运行确认失败**

`package.json` 的 `scripts`，在 `"test:inlay-config"` 行后加：

```json
    "test:inlay-config": "tsx tools/inlay-config-test.ts",
    "test:reward-types": "tsx tools/reward-types-test.ts",
```

Run: `npm run test:reward-types`
Expected: FAIL — `gemMaterialId` 未导出 / `MATERIAL_LABEL` 缺 gem 键。

- [ ] **Step 3: 改 RewardTypes 实现**

`assets/scripts/services/RewardTypes.ts` 全文替换为：

```typescript
import type { EquipItem, GemType } from '../inventory/EquipDefs';
import type { ChestItem } from '../chest/ChestModel';

export type RewardSource = 'Monster' | 'StageClear' | 'Boss' | 'Offline';

// 宝石按"类型_等级"拆细（替换旧 gem_shard）；卷轴替换旧 rune_dust；打造石保留。
// ⚠️ 等级范围 1~4 与 inlay.xlsx/Gems.maxLevel 耦合（见 plan Global Constraints）。
// gem_shard/rune_dust 暂留，Task 7 迁完所有引用后删除。
export type GemMaterialId = `gem_${GemType}_${1 | 2 | 3 | 4}`;
export type MaterialId = 'forge_stone' | 'rune_scroll' | GemMaterialId | 'gem_shard' | 'rune_dust';

export interface MaterialItem {
    id: MaterialId;
    count: number;
}

export type MaterialSave = Partial<Record<MaterialId, number>>;

const GEM_TYPE_LABEL: Record<GemType, string> = {
    atk: '攻击', hp: '生命', def: '防御', crit: '暴击', dmg: '增伤',
};

// 程序化生成材料标签（宝石键 = 类型×1~4，避免手写 20 行），断言为完整 Record。
function buildMaterialLabels(): Record<MaterialId, string> {
    const out: Record<string, string> = {
        forge_stone: '打造石',
        rune_scroll: '铭文卷轴',
        gem_shard: '宝石碎片',   // 旧键，Task 7 删
        rune_dust: '铭文粉尘',   // 旧键，Task 7 删
    };
    const types: GemType[] = ['atk', 'hp', 'def', 'crit', 'dmg'];
    for (const t of types) {
        for (let lv = 1; lv <= 4; lv++) {
            out[`gem_${t}_${lv}`] = `${GEM_TYPE_LABEL[t]}宝石·Lv.${lv}`;
        }
    }
    return out as Record<MaterialId, string>;
}

export const MATERIAL_LABEL: Record<MaterialId, string> = buildMaterialLabels();

export function gemMaterialId(type: GemType, level: number): MaterialId {
    return `gem_${type}_${level}` as MaterialId;
}

export interface RewardBundle {
    gold: number;
    exp: number;
    equipments: EquipItem[];
    chests: ChestItem[];
    materials: MaterialItem[];
}

export function emptyRewardBundle(): RewardBundle {
    return { gold: 0, exp: 0, equipments: [], chests: [], materials: [] };
}
```

- [ ] **Step 4: 运行测试确认通过 + 编译回归**

Run: `npm run test:reward-types`
Expected: PASS — `RewardTypes：2 通过，0 失败`。

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS" | grep -viE "TS5107" | grep -iE "RewardTypes|CraftConfig|ChestService|BattleEntry"
```
Expected: 空输出（旧 id 仍在，现有引用不报错）。

- [ ] **Step 5: Commit**

```bash
git add assets/scripts/services/RewardTypes.ts tools/reward-types-test.ts package.json
git commit -m "feat(inlay): 宝石/卷轴材料扩容（gem_<type>_<level>/rune_scroll，暂留旧id）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: InlayModel 镶嵌操作 + 补孔（TDD）

三个操作（镶入/取出/打铭文，`OpResult` 风格）+ `ensureInlaySlots` 补齐孔位长度。纯逻辑，不依赖 cc。

**Files:**
- Create: `assets/scripts/inlay/InlayModel.ts`
- Create: `tools/inlay-test.ts`
- Modify: `package.json`（加 `test:inlay`）

**Interfaces:**
- Consumes: `socketCounts`/`rollInscription`（`InlayConfig`，Task 2）；`gemMaterialId`/`MaterialSave`（`RewardTypes`，Task 3）；`EquipItem`/`GemType`（`EquipDefs`）。
- Produces: `socketGem(item, socketIndex, gemType, gemLevel, materials): OpResult`、`unsocketGem(item, socketIndex, materials): OpResult`、`applyInscription(item, slotIndex, materials, rng?): OpResult`、`ensureInlaySlots(item): EquipItem`。供 Task 5（`ensureInlaySlots` 被 InventoryModel 调）、Task 8（BattleEntry 面板调操作）使用。`OpResult = { ok: boolean; reason?: string }`（本模块自定义，勿 import InventoryModel 以免环）。

- [ ] **Step 1: 写失败测试**

Create `tools/inlay-test.ts`：

```typescript
// InlayModel 单测（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { socketGem, unsocketGem, applyInscription, ensureInlaySlots } from '../assets/scripts/inlay/InlayModel';
import { gemMaterialId } from '../assets/scripts/services/RewardTypes';
import type { EquipItem } from '../assets/scripts/inventory/EquipDefs';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

function legendItem(): EquipItem {
    // legend：gemSockets=3, inscriptionSlots=2
    return ensureInlaySlots({ id: 'x', slot: 'weapon', name: '测试剑', quality: 'legend' });
}

test('ensureInlaySlots：按品质补齐孔位长度（legend=3孔/2位）', () => {
    const it = legendItem();
    assert.equal(it.gemSockets!.length, 3);
    assert.equal(it.inscriptions!.length, 2);
    assert.ok(it.gemSockets!.every(s => s === null));
});

test('ensureInlaySlots：幂等 + 保留已有格', () => {
    const it = legendItem();
    it.gemSockets![0] = { type: 'atk', level: 2 };
    const again = ensureInlaySlots(it);
    assert.equal(again.gemSockets!.length, 3);
    assert.deepEqual(again.gemSockets![0], { type: 'atk', level: 2 });
});

test('ensureInlaySlots：common 无铭文位（inscriptionSlots=0）', () => {
    const it = ensureInlaySlots({ id: 'c', slot: 'helmet', name: '帽', quality: 'common' });
    assert.equal(it.gemSockets!.length, 1);
    assert.equal(it.inscriptions!.length, 0);
});

test('socketGem：材料够→扣材料、写入孔位', () => {
    const it = legendItem();
    const mats = { [gemMaterialId('atk', 2)]: 1 };
    const r = socketGem(it, 0, 'atk', 2, mats);
    assert.ok(r.ok);
    assert.deepEqual(it.gemSockets![0], { type: 'atk', level: 2 });
    assert.equal(mats[gemMaterialId('atk', 2)], 0);
});

test('socketGem：材料不足→失败不改', () => {
    const it = legendItem();
    const mats = {};
    const r = socketGem(it, 0, 'atk', 2, mats);
    assert.equal(r.ok, false);
    assert.equal(it.gemSockets![0], null);
});

test('socketGem：占用孔位→旧宝石退回材料、装入新宝石', () => {
    const it = legendItem();
    it.gemSockets![0] = { type: 'hp', level: 1 };
    const mats = { [gemMaterialId('atk', 3)]: 1 };
    const r = socketGem(it, 0, 'atk', 3, mats);
    assert.ok(r.ok);
    assert.deepEqual(it.gemSockets![0], { type: 'atk', level: 3 });
    assert.equal(mats[gemMaterialId('hp', 1)], 1);   // 旧 hp 宝石退回
    assert.equal(mats[gemMaterialId('atk', 3)], 0);  // 新 atk 宝石扣掉
});

test('socketGem：非法孔位→失败', () => {
    const it = legendItem();
    const r = socketGem(it, 9, 'atk', 1, { [gemMaterialId('atk', 1)]: 1 });
    assert.equal(r.ok, false);
});

test('unsocketGem：宝石退回材料、孔位清空', () => {
    const it = legendItem();
    it.gemSockets![1] = { type: 'def', level: 2 };
    const mats: Record<string, number> = {};
    const r = unsocketGem(it, 1, mats);
    assert.ok(r.ok);
    assert.equal(it.gemSockets![1], null);
    assert.equal(mats[gemMaterialId('def', 2)], 1);
});

test('unsocketGem：空孔→失败', () => {
    const it = legendItem();
    const r = unsocketGem(it, 0, {});
    assert.equal(r.ok, false);
});

test('applyInscription：有卷轴→扣卷轴、写入随机效果', () => {
    const it = legendItem();
    const mats = { rune_scroll: 1 };
    const r = applyInscription(it, 0, mats, () => 0);
    assert.ok(r.ok);
    assert.ok(it.inscriptions![0]);
    assert.equal(mats.rune_scroll, 0);
});

test('applyInscription：无卷轴→失败不改', () => {
    const it = legendItem();
    const r = applyInscription(it, 0, {}, () => 0);
    assert.equal(r.ok, false);
    assert.equal(it.inscriptions![0], null);
});

test('applyInscription：覆盖重抽（已有效果被替换）', () => {
    const it = legendItem();
    it.inscriptions![0] = { stat: 'hp', value: 999 };
    const r = applyInscription(it, 0, { rune_scroll: 1 }, () => 0);
    assert.ok(r.ok);
    assert.notEqual(it.inscriptions![0]!.value, 999);   // 被重抽覆盖
});

console.log(`\nInlayModel：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 加测试脚本 + 运行确认失败**

`package.json` 的 `scripts`，在 `"test:reward-types"` 行后加：

```json
    "test:reward-types": "tsx tools/reward-types-test.ts",
    "test:inlay": "tsx tools/inlay-test.ts",
```

Run: `npm run test:inlay`
Expected: FAIL — `Cannot find module '.../inlay/InlayModel'`。

- [ ] **Step 3: 写最小实现**

Create `assets/scripts/inlay/InlayModel.ts`：

```typescript
// 镶嵌操作纯逻辑（不依赖 cc）：镶入/取出宝石、打铭文（覆盖重抽）、补齐孔位。
// 操作同时改 EquipItem（孔位）与 materials（材料背包），返回 OpResult，失败不留半成品。

import { EquipItem, GemType, GemSocket, InscriptionEffect } from '../inventory/EquipDefs';
import { gemMaterialId, MaterialSave } from '../services/RewardTypes';
import { socketCounts, rollInscription } from './InlayConfig';

export interface OpResult { ok: boolean; reason?: string }
const OK: OpResult = { ok: true };
function fail(reason: string): OpResult { return { ok: false, reason }; }

function padSlots<T>(arr: (T | null)[] | undefined, n: number): (T | null)[] {
    const out: (T | null)[] = [];
    for (let i = 0; i < n; i++) {
        const v = arr?.[i] ?? null;
        out.push(v ? { ...v } : null);
    }
    return out;
}

// 把 gemSockets/inscriptions 补齐到该品质应有的长度（幂等、保留已有格、多余截断、深拷贝条目）。
export function ensureInlaySlots(item: EquipItem): EquipItem {
    const c = socketCounts(item.quality);
    item.gemSockets = padSlots<GemSocket>(item.gemSockets, c.gemSockets);
    item.inscriptions = padSlots<InscriptionEffect>(item.inscriptions, c.inscriptionSlots);
    return item;
}

function addMaterial(materials: MaterialSave, type: GemType, level: number): void {
    const id = gemMaterialId(type, level);
    materials[id] = (materials[id] ?? 0) + 1;
}

export function socketGem(item: EquipItem, socketIndex: number, gemType: GemType, gemLevel: number, materials: MaterialSave): OpResult {
    const sockets = item.gemSockets;
    if (!sockets || socketIndex < 0 || socketIndex >= sockets.length) return fail('宝石孔不存在');
    const id = gemMaterialId(gemType, gemLevel);
    if ((materials[id] ?? 0) < 1) return fail('宝石不足');
    const prev = sockets[socketIndex];
    if (prev) addMaterial(materials, prev.type, prev.level);   // 旧宝石退回
    materials[id] = (materials[id] ?? 0) - 1;
    sockets[socketIndex] = { type: gemType, level: gemLevel };
    return OK;
}

export function unsocketGem(item: EquipItem, socketIndex: number, materials: MaterialSave): OpResult {
    const sockets = item.gemSockets;
    if (!sockets || socketIndex < 0 || socketIndex >= sockets.length) return fail('宝石孔不存在');
    const gem = sockets[socketIndex];
    if (!gem) return fail('该孔为空');
    addMaterial(materials, gem.type, gem.level);
    sockets[socketIndex] = null;
    return OK;
}

export function applyInscription(item: EquipItem, slotIndex: number, materials: MaterialSave, rng: () => number = Math.random): OpResult {
    const slots = item.inscriptions;
    if (!slots || slotIndex < 0 || slotIndex >= slots.length) return fail('铭文位不存在');
    if ((materials['rune_scroll'] ?? 0) < 1) return fail('卷轴不足');
    materials['rune_scroll'] = (materials['rune_scroll'] ?? 0) - 1;
    slots[slotIndex] = rollInscription(rng);   // 覆盖重抽
    return OK;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:inlay`
Expected: PASS — `InlayModel：12 通过，0 失败`。

- [ ] **Step 5: Commit**

```bash
git add assets/scripts/inlay/InlayModel.ts tools/inlay-test.ts package.json
git commit -m "feat(inlay): InlayModel 镶入/取出/打铭文/补孔（TDD）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: InlayStats 汇总加成 + EffectiveStats 接入（TDD）

宝石/铭文加成汇总成一份 `EquipStats`，`calcEffectiveStats` 每件装备贡献 = 装备词条 + 镶嵌加成。不传镶嵌的装备行为不变。

**Files:**
- Create: `assets/scripts/inlay/InlayStats.ts`
- Modify: `assets/scripts/combat/EffectiveStats.ts`
- Modify: `tools/effective-stats-test.ts`（追加测试）

**Interfaces:**
- Consumes: `gemStatKey`/`gemStatValue`/`roundInlayStat`（`InlayConfig`，Task 2）；`EquipItem`/`EquipStats`/`EquipStatKey`（`EquipDefs`）。
- Produces: `itemInlayStats(item: EquipItem): EquipStats`。`calcEffectiveStats` 行为扩展（叠加镶嵌加成）。

- [ ] **Step 1: 写失败测试**

先在 `tools/effective-stats-test.ts` 顶部 import 区（现有 `import { calcEffectiveStats, buildEffectiveStatsMap } ...` 行之后）加一行：

```typescript
import { itemInlayStats } from '../assets/scripts/inlay/InlayStats';
```

再在文件末尾（汇总输出 `console.log` 之前）追加：

```typescript
test('itemInlayStats：汇总宝石(gemStatValue)+铭文({stat,value})加成', () => {
    const item = {
        id: 'g', slot: 'weapon', name: '剑', quality: 'legend',
        gemSockets: [{ type: 'atk', level: 2 }, { type: 'hp', level: 1 }, null],
        inscriptions: [{ stat: 'atk', value: 15 }, null],
    };
    const s = itemInlayStats(item as any);
    assert.equal(s.atk, 30 * 2 + 15);   // 宝石 atk Lv.2=60 + 铭文 atk 15
    assert.equal(s.hp, 120 * 1);         // 宝石 hp Lv.1=120
});

test('itemInlayStats：无镶嵌装备返回空加成', () => {
    const s = itemInlayStats({ id: 'p', slot: 'shoes', name: '鞋', quality: 'common' } as any);
    assert.deepEqual(s, {});
});

test('calcEffectiveStats：叠加装备词条 + 镶嵌加成', () => {
    const base = baseStats();
    const item = {
        id: 'w', slot: 'weapon', name: '剑', quality: 'legend',
        stats: { atk: 100 },
        gemSockets: [{ type: 'atk', level: 1 }, null, null],
        inscriptions: [null, null],
    };
    const out = calcEffectiveStats(base, [item as any]);
    assert.equal(out.atk, base.atk + 100 + 30);   // 基础10 + 词条100 + 宝石atk Lv.1=30
});
```

（`baseStats()` / `calcEffectiveStats` 已在文件头部导入。）

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:effective`
Expected: FAIL — `Cannot find module '.../inlay/InlayStats'`（前两条）+ `calcEffectiveStats` 未叠加镶嵌导致 atk 断言失败（第三条）。

- [ ] **Step 3: 写 InlayStats 实现**

Create `assets/scripts/inlay/InlayStats.ts`：

```typescript
// 汇总一件装备的宝石 + 铭文加成为一份 EquipStats（纯函数，不依赖 cc）。
// 供 EffectiveStats 在装备词条之外再叠这一份。

import { EquipItem, EquipStats, EquipStatKey } from '../inventory/EquipDefs';
import { gemStatKey, gemStatValue, roundInlayStat } from './InlayConfig';

export function itemInlayStats(item: EquipItem): EquipStats {
    const out: EquipStats = {};
    const add = (key: EquipStatKey, v: number) => {
        out[key] = roundInlayStat(key, (out[key] ?? 0) + v);
    };
    for (const gem of item.gemSockets ?? []) {
        if (!gem) continue;
        add(gemStatKey(gem.type), gemStatValue(gem.type, gem.level));
    }
    for (const insc of item.inscriptions ?? []) {
        if (!insc) continue;
        add(insc.stat, insc.value);
    }
    return out;
}
```

- [ ] **Step 4: 改 EffectiveStats 叠加镶嵌**

`assets/scripts/combat/EffectiveStats.ts` 顶部 import 区加：

```typescript
import { itemInlayStats } from '../inlay/InlayStats';
```

同文件 `calcEffectiveStats` 函数（当前 32-43 行）整体替换为：

```typescript
export function calcEffectiveStats(base: CombatStats, items: (EquipItem | null | undefined)[]): CombatStats {
    const out: CombatStats = { ...base };
    for (const item of items) {
        if (!item) continue;
        const inlay = itemInlayStats(item);
        for (const k of STAT_KEYS) {
            const bonus = (item.stats?.[k] ?? 0) + (inlay[k] ?? 0);
            if (bonus) out[k] += bonus;
        }
    }
    return normalizeStats(out);
}
```

（行为变化：原 `if (!item?.stats) continue;` 会跳过"无词条但有镶嵌"的装备；新实现改为只跳过 `null` 装备，无镶嵌无词条时 `bonus=0` 不影响结果——对现有测试等价。）

- [ ] **Step 5: 运行测试确认通过 + 全套回归**

Run: `npm run test:effective`
Expected: PASS，全部通过（含新增 3 条）。

Run:
```bash
npm run test:combat && npm run test:inventory && npm run test:services && npm run sim:pacing
```
Expected: 全过；`sim:pacing`「全部达标」（`pacing-sim` 手工构造 effectiveStats、不经 `calcEffectiveStats`，不受影响）。

- [ ] **Step 6: Commit**

```bash
git add assets/scripts/inlay/InlayStats.ts assets/scripts/combat/EffectiveStats.ts tools/effective-stats-test.ts
git commit -m "feat(inlay): InlayStats 汇总加成 + EffectiveStats 叠镶嵌（TDD）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: InventoryModel 接线（入库/读档补孔 + 出售退回宝石）（TDD）

装备进 InventoryModel 时补孔位；出售装备时把已镶宝石算进 `SellResult.returnedGems`（由调用方退回材料背包，Task 8 接）。

**Files:**
- Modify: `assets/scripts/inventory/InventoryModel.ts`
- Modify: `tools/inventory-test.ts`（追加测试）

**Interfaces:**
- Consumes: `ensureInlaySlots`（`InlayModel`，Task 4）；`gemMaterialId`/`MaterialItem`（`RewardTypes`）。
- Produces: `SellResult.returnedGems?: MaterialItem[]`（`sellItem`/`sellBatch` 汇总卖出装备身上的宝石）；`cloneItem` 内补孔（入库/读档/序列化统一经过）。供 Task 8（BattleEntry 出售后退回材料）使用。

- [ ] **Step 1: 写失败测试**

`tools/inventory-test.ts` 末尾（汇总输出之前）追加：

```typescript
test('入库装备自动补孔位（legend=3孔/2位）', () => {
    const m = new InventoryModel();
    m.addItemToBackpack({ id: 'z', slot: 'weapon', name: '剑', quality: 'legend' } as any);
    const it = m.backpack[m.backpack.length - 1];
    assert.equal(it.gemSockets!.length, 3);
    assert.equal(it.inscriptions!.length, 2);
});

test('出售镶了宝石的装备→returnedGems 汇总退回宝石', () => {
    const m = new InventoryModel();
    m.addItemToBackpack({
        id: 'gemmed', slot: 'weapon', name: '剑', quality: 'legend',
        gemSockets: [{ type: 'atk', level: 2 }, { type: 'hp', level: 1 }, null],
    } as any);
    const id = m.backpack[m.backpack.length - 1].id;
    const r = m.sellItem(id);
    assert.ok(r.ok);
    assert.ok(r.returnedGems && r.returnedGems.length === 2);
    const atkGem = r.returnedGems!.find(g => g.id === 'gem_atk_2');
    assert.ok(atkGem && atkGem.count === 1);
});

test('出售无宝石装备→returnedGems 为空数组或省略', () => {
    const m = new InventoryModel();
    m.dropRandom();
    const id = m.backpack[0].id;
    const r = m.sellItem(id);
    assert.ok(r.ok);
    assert.ok(!r.returnedGems || r.returnedGems.length === 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:inventory`
Expected: FAIL — 入库未补孔（`gemSockets` undefined）；`sellItem` 无 `returnedGems`。

- [ ] **Step 3: 改 InventoryModel 实现**

`assets/scripts/inventory/InventoryModel.ts` 顶部 import：

第 4 行 import 之后加：

```typescript
import { ensureInlaySlots } from '../inlay/InlayModel';
import { gemMaterialId, MaterialItem } from '../services/RewardTypes';
```

`cloneItem`（当前 43-46 行）改为补孔：

```typescript
function cloneItem(it: EquipItem): EquipItem {
    const item = ensureEquipItemStats(it);
    const cloned = { ...item, stats: item.stats ? { ...item.stats } : undefined };
    return ensureInlaySlots(cloned);   // 补齐/深拷贝 gemSockets/inscriptions
}
```

`SellResult` 接口（当前第 8 行）加字段：

```typescript
export interface SellResult extends OpResult { gold?: number; sold?: EquipItem[]; returnedGems?: MaterialItem[]; }
```

在 `sellPriceOf` 函数之后加一个宝石汇总辅助：

```typescript
// 把一批卖出装备身上已镶的宝石汇总成 MaterialItem[]（同 id 合并数量）。
function collectReturnedGems(items: EquipItem[]): MaterialItem[] {
    const counts: Record<string, number> = {};
    for (const it of items) {
        for (const gem of it.gemSockets ?? []) {
            if (!gem) continue;
            const id = gemMaterialId(gem.type, gem.level);
            counts[id] = (counts[id] ?? 0) + 1;
        }
    }
    return Object.keys(counts).map(id => ({ id: id as MaterialItem['id'], count: counts[id] }));
}
```

`sellItem`（当前 132-144 行）的成功分支加 `returnedGems`：

```typescript
    sellItem(id: string): SellResult {
        if (this.findEquippedById(id)) return { ok: false, reason: '已穿装备不能出售' };
        for (const zone of ['backpack', 'warehouse'] as InventoryZone[]) {
            const list = this.list(zone);
            const i = list.findIndex(it => it.id === id);
            if (i < 0) continue;
            const item = list[i];
            if (item.locked) return { ok: false, reason: '锁定装备不能出售' };
            list.splice(i, 1);
            return { ok: true, item, sold: [item], gold: sellPriceOf(item), returnedGems: collectReturnedGems([item]) };
        }
        return { ok: false, reason: '装备不存在' };
    }
```

`sellBatch`（当前 146-164 行）的成功分支加 `returnedGems`：

```typescript
        if (sold.length === 0) return { ok: false, reason: '没有可出售装备', sold, gold: 0 };
        return { ok: true, sold, gold, returnedGems: collectReturnedGems(sold) };
```

- [ ] **Step 4: 运行测试确认通过 + 回归**

Run: `npm run test:inventory`
Expected: PASS，全部通过（含新增 3 条）。

Run:
```bash
npm run test:effective && npm run test:services
```
Expected: 全过（`cloneItem` 补孔对老测试无副作用——补的都是 null 空孔）。

- [ ] **Step 5: Commit**

```bash
git add assets/scripts/inventory/InventoryModel.ts tools/inventory-test.ts
git commit -m "feat(inlay): InventoryModel 入库/读档补孔 + 出售汇总退回宝石（TDD）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: 宝箱产宝石/卷轴 + 移除旧材料 + 合成成本迁移

`ChestService` 改产随机宝石 + 卷轴；`craft.xlsx` 合成成本去掉宝石/铭文（只留打造石）；`MaterialId` 删掉 `gem_shard`/`rune_dust` 并修所有残留引用。做完编译一路绿、无残留旧材料引用。

**Files:**
- Modify: `assets/scripts/chest/ChestService.ts`
- Modify: `tools/seed-craft-xlsx.ts`（去 gem/rune 成本列）
- Modify: `tools/excel-to-config.ts`（`buildCraftConfig` 的 `MATERIAL_COLUMNS` 只留 forge_stone）
- Modify: `assets/scripts/services/RewardTypes.ts`（删 `gem_shard`/`rune_dust`）
- Modify: `assets/scripts/BattleEntry.ts`（`_materialsHoldingText`/`_drawCraftCost` 的材料 id 列表）
- Regenerate: `tools/config-xlsx/craft.xlsx`、`assets/scripts/config/craft.config.generated.ts`

**Interfaces:**
- Consumes: `gemTypes`/`gemMaxLevel`（`InlayConfig`）；`gemMaterialId`（`RewardTypes`）。
- Produces: 宝箱奖励含 `gem_<type>_<level>` 与 `rune_scroll`；`MaterialId` 不再含旧两键。

- [ ] **Step 1: ChestService 改产宝石/卷轴**

`assets/scripts/chest/ChestService.ts` 顶部 import 区，`RewardTypes` 导入行后加：

```typescript
import { gemTypes, gemMaxLevel } from '../inlay/InlayConfig';
import { gemMaterialId } from '../services/RewardTypes';
```

`ChestRewardProfile` 接口（当前 14-17 行）加两字段：

```typescript
interface ChestRewardProfile {
    equipmentRolls: number;
    materials: MaterialRoll[];
    gemRolls?: { count: number; levelMin: number; levelMax: number };
    scrollRolls?: { min: number; max: number };
}
```

`CHEST_REWARD_PROFILE`（当前 25-45 行）整体替换为（去 gem_shard/rune_dust，加 gemRolls/scrollRolls）：

```typescript
const CHEST_REWARD_PROFILE: Record<ChestType, ChestRewardProfile> = {
    normal: {
        equipmentRolls: 1,
        materials: [{ id: 'forge_stone', min: 2, max: 4 }],
        gemRolls: { count: 1, levelMin: 1, levelMax: 1 },
    },
    boss: {
        equipmentRolls: 2,
        materials: [{ id: 'forge_stone', min: 4, max: 8 }],
        gemRolls: { count: 1, levelMin: 1, levelMax: 2 },
        scrollRolls: { min: 1, max: 1 },
    },
    chapter: {
        equipmentRolls: 3,
        materials: [{ id: 'forge_stone', min: 8, max: 12 }],
        gemRolls: { count: 2, levelMin: 2, levelMax: 3 },
        scrollRolls: { min: 1, max: 2 },
    },
};
```

在 `openChest` 函数里，材料 for 循环（当前 93-96 行 `for (const roll of profile.materials)`）之后、`return { ok: true, ... }` 之前，插入宝石/卷轴产出：

```typescript
    // 宝石：随机类型 + 档位缩放等级
    if (profile.gemRolls) {
        const types = gemTypes();
        for (let i = 0; i < profile.gemRolls.count; i++) {
            const rng = createSeededRng(`${chest.seed}|gem|${chest.type}|${i}`);
            const type = types[Math.min(types.length - 1, Math.floor(rng() * types.length))];
            const lvRaw = rollInt(profile.gemRolls.levelMin, profile.gemRolls.levelMax, rng);
            const level = Math.max(1, Math.min(gemMaxLevel(type), lvRaw));
            addMaterial(reward, gemMaterialId(type, level), 1);
        }
    }
    // 卷轴
    if (profile.scrollRolls) {
        const rng = createSeededRng(`${chest.seed}|scroll|${chest.type}`);
        addMaterial(reward, 'rune_scroll', rollInt(profile.scrollRolls.min, profile.scrollRolls.max, rng));
    }
```

- [ ] **Step 2: craft.xlsx 成本去 gem/rune**

`tools/seed-craft-xlsx.ts` 的 `TIERS_HEADER`/`TIERS_ROWS`（当前 11-16 行）改为只留打造石成本：

```typescript
const TIERS_HEADER = ['tierId', 'label', 'levelMin', 'levelMax', 'costForgeStone'];
const TIERS_ROWS: (string | number)[][] = [
    ['tier_1', '初阶', 1, 10, 10],
    ['tier_2', '中阶', 11, 20, 25],
    ['tier_3', '高阶', 21, 30, 50],
];
```

`tools/excel-to-config.ts` 的 `buildCraftConfig` 里 `MATERIAL_COLUMNS`（当前 635-639 行）改为只留 forge_stone：

```typescript
    const MATERIAL_COLUMNS: [string, string][] = [
        ['forge_stone', 'costForgeStone'],
    ];
```

- [ ] **Step 3: 重生 craft.xlsx + 产物**

Run:
```bash
npm run seed:craft && npm run config
```
Expected: `✓ 已生成 .../craft.xlsx`；config 全模块 `ok`，`[craft] ... tiers=3`。

- [ ] **Step 4: RewardTypes 删旧两键**

`assets/scripts/services/RewardTypes.ts`：

`MaterialId` 类型（Task 3 加的那行）去掉 `| 'gem_shard' | 'rune_dust'`：

```typescript
export type MaterialId = 'forge_stone' | 'rune_scroll' | GemMaterialId;
```

`buildMaterialLabels` 里删掉 `gem_shard`/`rune_dust` 两行：

```typescript
    const out: Record<string, string> = {
        forge_stone: '打造石',
        rune_scroll: '铭文卷轴',
    };
```

- [ ] **Step 5: BattleEntry 材料 id 列表去旧键**

`assets/scripts/BattleEntry.ts` 的 `_materialsHoldingText`（当前 1294-1297 行）：

```typescript
    private _materialsHoldingText(): string {
        const ids: MaterialId[] = ['forge_stone', 'rune_scroll'];
        return ids.map(id => `${MATERIAL_LABEL[id]} ${this._materials[id] ?? 0}`).join('  ·  ');
    }
```

`_drawCraftCost`（当前 1372 行）的 `materialIds`：

```typescript
        const materialIds: MaterialId[] = ['forge_stone'];
```

- [ ] **Step 6: 类型检查 + 无残留旧材料引用**

Run:
```bash
grep -rn "gem_shard\|rune_dust" assets/ tools/
```
Expected: 空输出（除了本 plan/spec 文档；若 `assets/`/`tools/` 里还有命中，逐个改掉）。

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS" | grep -viE "TS5107" | grep -iE "RewardTypes|CraftConfig|ChestService|BattleEntry|Inlay"
```
Expected: 空输出。

- [ ] **Step 7: 回归测试**

Run:
```bash
npm run test:services && npm run test:reward-types && npm run test:inlay && npm run test:inventory && npm run config && npm run sim:pacing
```
Expected: 全过；config 7+1 模块无错；`sim:pacing`「全部达标」。

- [ ] **Step 8: Commit**

```bash
git add assets/scripts/chest/ChestService.ts tools/seed-craft-xlsx.ts tools/excel-to-config.ts assets/scripts/services/RewardTypes.ts assets/scripts/BattleEntry.ts tools/config-xlsx/craft.xlsx assets/scripts/config/craft.config.generated.ts
git commit -m "feat(inlay): 宝箱产宝石/卷轴 + 移除 gem_shard/rune_dust + 合成成本改纯打造石

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: 镶嵌面板（BattleEntry）+ InventoryView「镶嵌」入口 + 出售退宝石接线

从背包装备详情「镶嵌」按钮打开镶嵌面板（BattleEntry 方法，镜像 CraftView/SquadView），可镶入/取出宝石、打铭文；出售装备时把 `returnedGems` 退回材料。占位 UI（色块+文字），**人工 Cocos 预览验证**。

**Files:**
- Modify: `assets/scripts/inventory/InventoryView.ts`（详情加「镶嵌」按钮 + `InventoryChangeKind` 加 `'inlay'` + payload 加 `itemId`）
- Modify: `assets/scripts/BattleEntry.ts`（镶嵌面板方法 + `_handleInventoryChanged` 开面板 + 出售退宝石）

**Interfaces:**
- Consumes: `socketGem`/`unsocketGem`/`applyInscription`（`InlayModel`）；`socketCounts`/`gemStatKey`/`gemStatValue`/`gemTypes`/`gemMaxLevel`（`InlayConfig`）；`gemMaterialId`/`MATERIAL_LABEL`（`RewardTypes`）；`this._inv`/`this._materials`（既有）；`SellResult.returnedGems`（Task 6）。

- [ ] **Step 1: InventoryView 加「镶嵌」信号**

`assets/scripts/inventory/InventoryView.ts` 的 `InventoryChangeKind`（第 14 行）加 `'inlay'`：

```typescript
export type InventoryChangeKind = 'drop' | 'transfer' | 'equip' | 'unequip' | 'lock' | 'sell' | 'batchSell' | 'sort' | 'inlay';
```

紧接其后的 `InventoryChangePayload` 接口加可选 `itemId`（若该接口在别处定义，就地补字段）：

```typescript
export interface InventoryChangePayload { gold?: number; sold?: number; itemId?: string; }
```

`render()` 底部按钮区（当前 184-192 行 `btn(...)` 序列），把「批售白绿」之后、「关闭」之前插入一个镶嵌按钮（`xStart + step * 8`）：

```typescript
        btn(xStart + step * 7, '批售白绿', 'batchSell');
        btn(xStart + step * 8, '镶嵌', 'inlay');
        btn(this.halfW - 110, '关闭', 'close');
```

底部按钮 tap 处理（当前约 578-618 行 `switch`/分支区，与 lock/sell 同级），加 `inlay` 分支：选中装备才发信号，交给 BattleEntry 开面板（InventoryView 不做模型操作）。在 `close` 分支之前插入：

```typescript
            } else if (kind === 'inlay') {
                if (!selected) { this.setToast('先选要镶嵌的装备'); this.render(); return; }
                this.onChanged('inlay', { itemId: selected.id });
                return;
```

（按现有 tap 分支写法对齐：`selected` 变量已在该作用域取到；若该分支块用的是 `if (kind === ...)` 链，就照同样风格加。）

- [ ] **Step 2: BattleEntry 加镶嵌面板字段与创建**

`assets/scripts/BattleEntry.ts` 顶部 import 区，`craft/CraftService` 导入行（第 40 行）后加：

```typescript
import { socketGem, unsocketGem, applyInscription } from './inlay/InlayModel';
import { socketCounts, gemTypes, gemMaxLevel } from './inlay/InlayConfig';
import { gemMaterialId } from './services/RewardTypes';
```

`EquipItem` 已在第 37 行导入。`STAT_LABEL`/`formatStatValue` 面板要用但当前未导入——把第 36 行的 EquipDefs 具名导入补上这两个：

```typescript
import { QUALITY_LABEL, QUALITY_COLOR, SLOT_LABEL, SLOTS, formatEquipStats, CHARACTERS, CHARACTER_LABEL, STAT_LABEL, formatStatValue } from './inventory/EquipDefs';
```

在 SquadView 字段区（`private _squadHots...` 之后）加镶嵌面板字段：

```typescript
    // ===== 镶嵌面板（占位）：镶入/取出宝石 + 打铭文，镜像 SquadView =====
    private _inlayRoot: Node = null!;
    private _inlayGfx: Graphics = null!;
    private _inlayLabels: Label[] = [];
    private _inlayHots: { rect: { x: number; y: number; w: number; h: number }; act: () => void }[] = [];
    private _inlayItemId: string | null = null;       // 当前聚焦装备
    private _inlaySelSocket: number | null = null;     // 选中的空宝石孔（待填）
    private _inlayMsg = '';
```

在 `_createSquadView` 之后加 `_createInlayView`（复制 SquadView 结构）：

```typescript
    private _createInlayView() {
        this._inlayRoot = new Node('InlayView');
        this._inlayRoot.layer = this.node.layer;
        this._inlayRoot.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        const gfxNode = new Node('InlayGfx');
        gfxNode.layer = this.node.layer;
        gfxNode.addComponent(UITransform);
        this._inlayGfx = gfxNode.addComponent(Graphics);
        this._inlayRoot.addChild(gfxNode);
        this.node.addChild(this._inlayRoot);
        this._inlayRoot.active = false;
        this._inlayRoot.on(Node.EventType.TOUCH_END, this._onInlayTap, this);
    }

    private _inlayLabel(i: number): Label {
        while (i >= this._inlayLabels.length) {
            const n = new Node('InlayLbl');
            n.layer = this._inlayRoot.layer;
            n.addComponent(UITransform);
            const lb = n.addComponent(Label);
            this._inlayRoot.addChild(n);
            this._inlayLabels.push(lb);
        }
        return this._inlayLabels[i];
    }

    private _hideInlayPanel() { if (this._inlayRoot) this._inlayRoot.active = false; }

    private _openInlayPanel(itemId: string) {
        if (!this._inlayRoot) return;
        this._inlayItemId = itemId;
        this._inlaySelSocket = null;
        this._inlayMsg = '';
        this._hideSettlement();
        this._hideChestPanel();
        this._hideCraftPanel();
        this._hideSquadPanel();
        this._inlayRoot.active = true;
        this._inlayRoot.setSiblingIndex(this.node.children.length - 1);
        this._drawInlayPanel();
    }

    // 在 backpack/warehouse 里按 id 找当前聚焦装备（镶嵌只针对未穿戴装备）
    private _inlayItem(): EquipItem | null {
        if (!this._inlayItemId || !this._inv) return null;
        return this._inv.backpack.find(it => it.id === this._inlayItemId)
            ?? this._inv.warehouse.find(it => it.id === this._inlayItemId)
            ?? null;
    }
```

（`EquipItem` 类型已在 BattleEntry 导入；若未导入，在 `InventoryModel` 导入行补 `import type { EquipItem } from './inventory/EquipDefs';`。）

- [ ] **Step 3: BattleEntry 画镶嵌面板 + 命中**

在 `_createInlayView` 相关方法之后加 `_drawInlayPanel`/`_onInlayTap` 与操作方法。占位布局，数字可微调：

```typescript
    private _drawInlayPanel() {
        const g = this._inlayGfx;
        g.clear();
        this._inlayHots.length = 0;
        for (const l of this._inlayLabels) l.node.active = false;
        let li = 0;
        const label = (s: string, x: number, y: number, size = 22, color?: Color) => {
            const lb = this._inlayLabel(li++);
            lb.node.active = true; lb.string = s; lb.fontSize = size;
            if (color) lb.color = color;
            lb.node.setPosition(x, y, 0);
        };
        g.fillColor = new Color(20, 24, 30, 235);
        g.rect(-this._halfW, -this._halfH, this._halfW * 2, this._halfH * 2);
        g.fill();

        const item = this._inlayItem();
        if (!item) {
            label('装备不存在（可能已穿戴/售出）', 0, 0, 24);
            this._pushInlayClose();
            return;
        }
        label(`镶嵌  ${QUALITY_LABEL[item.quality]} · ${item.name}`, 0, 600, 28);
        if (this._inlayMsg) label(this._inlayMsg, 0, 552, 20, new Color(255, 200, 120));

        const counts = socketCounts(item.quality);
        let y = 470;

        // —— 宝石孔 ——
        label('宝石孔（点空孔选中→点下方宝石镶入；点已镶取出）', 0, y + 40, 20, new Color(180, 210, 255));
        for (let i = 0; i < counts.gemSockets; i++) {
            const gem = item.gemSockets?.[i] ?? null;
            const sel = this._inlaySelSocket === i;
            g.fillColor = sel ? new Color(72, 110, 150, 245) : new Color(48, 58, 72, 255);
            g.roundRect(-300, y - 40, 600, 72, 10); g.fill();
            const txt = gem
                ? `孔${i + 1}：${MATERIAL_LABEL[gemMaterialId(gem.type, gem.level)]}（点取出）`
                : `孔${i + 1}：空${sel ? '（已选中）' : '（点选中）'}`;
            label(txt, 0, y - 4, 22);
            const idx = i;
            this._inlayHots.push({ rect: { x: -300, y: y - 40, w: 600, h: 72 }, act: () => this._onInlaySocketTap(idx) });
            y -= 84;
        }

        // —— 铭文位 ——
        y -= 20;
        label('铭文位（点“打铭文”消耗卷轴随机抽/覆盖）', 0, y + 40, 20, new Color(200, 180, 255));
        for (let i = 0; i < counts.inscriptionSlots; i++) {
            const insc = item.inscriptions?.[i] ?? null;
            g.fillColor = new Color(48, 58, 72, 255);
            g.roundRect(-300, y - 40, 440, 72, 10); g.fill();
            const txt = insc ? `位${i + 1}：${STAT_LABEL[insc.stat]}+${formatStatValue(insc.stat, insc.value)}` : `位${i + 1}：空`;
            label(txt, -80, y - 4, 22);
            g.fillColor = new Color(120, 90, 160, 255);
            g.roundRect(160, y - 40, 140, 72, 10); g.fill();
            label('打铭文', 230, y - 4, 22);
            const idx = i;
            this._inlayHots.push({ rect: { x: 160, y: y - 40, w: 140, h: 72 }, act: () => this._onInlayInscribeTap(idx) });
            y -= 84;
        }

        // —— 持有宝石（点击镶入选中孔）——
        y -= 20;
        label('持有宝石（先选空孔再点这里镶入）', 0, y + 40, 20, new Color(180, 255, 200));
        const held: { type: any; level: number; id: string; count: number }[] = [];
        for (const t of gemTypes()) {
            for (let lv = 1; lv <= gemMaxLevel(t); lv++) {
                const id = gemMaterialId(t, lv);
                const c = this._materials[id] ?? 0;
                if (c > 0) held.push({ type: t, level: lv, id, count: c });
            }
        }
        if (held.length === 0) label('（暂无宝石，去开宝箱）', 0, y - 4, 20, new Color(160, 168, 184));
        held.slice(0, 6).forEach((h, k) => {
            const bx = -300 + (k % 3) * 205;
            const byy = y - Math.floor(k / 3) * 70;
            g.fillColor = new Color(40, 70, 55, 255);
            g.roundRect(bx, byy - 30, 195, 60, 8); g.fill();
            label(`${MATERIAL_LABEL[h.id]}×${h.count}`, bx + 97, byy, 18);
            this._inlayHots.push({ rect: { x: bx, y: byy - 30, w: 195, h: 60 }, act: () => this._onInlayGemTap(h.type, h.level) });
        });

        this._pushInlayClose();
    }

    private _pushInlayClose() {
        const g = this._inlayGfx;
        g.fillColor = new Color(120, 60, 60, 255);
        g.roundRect(-90, -600, 180, 70, 12); g.fill();
        const lb = this._inlayLabel(this._inlayLabels.filter(l => l.node.active).length);
        lb.node.active = true; lb.string = '关闭'; lb.fontSize = 26; lb.node.setPosition(0, -565, 0);
        this._inlayHots.push({ rect: { x: -90, y: -600, w: 180, h: 70 }, act: () => this._hideInlayPanel() });
    }

    private _onInlayTap(e: EventTouch) {
        const ui = e.getUILocation();
        const p = this._inlayRoot.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        for (const h of this._inlayHots) {
            if (p.x >= h.rect.x && p.x <= h.rect.x + h.rect.w && p.y >= h.rect.y && p.y <= h.rect.y + h.rect.h) {
                h.act();
                return;
            }
        }
    }

    private _onInlaySocketTap(i: number) {
        const item = this._inlayItem();
        if (!item) return;
        const gem = item.gemSockets?.[i] ?? null;
        if (gem) {
            const r = unsocketGem(item, i, this._materials);
            this._inlayMsg = r.ok ? '已取出宝石' : (r.reason ?? '取出失败');
            if (r.ok) { void this._persistInlay(); return; }
        } else {
            this._inlaySelSocket = i;
            this._inlayMsg = `已选中孔${i + 1}，点下方宝石镶入`;
        }
        this._drawInlayPanel();
    }

    private _onInlayGemTap(type: any, level: number) {
        const item = this._inlayItem();
        if (!item) return;
        if (this._inlaySelSocket === null) { this._inlayMsg = '先点上方一个空孔'; this._drawInlayPanel(); return; }
        const r = socketGem(item, this._inlaySelSocket, type, level, this._materials);
        this._inlayMsg = r.ok ? '已镶入宝石' : (r.reason ?? '镶入失败');
        if (r.ok) { this._inlaySelSocket = null; void this._persistInlay(); }
        else this._drawInlayPanel();
    }

    private _onInlayInscribeTap(i: number) {
        const item = this._inlayItem();
        if (!item) return;
        const r = applyInscription(item, i, this._materials, Math.random);
        this._inlayMsg = r.ok ? '已打入铭文' : (r.reason ?? '打铭文失败');
        if (r.ok) void this._persistInlay();
        else this._drawInlayPanel();
    }

    // 镶嵌操作改了 item(在 _inv 内) + this._materials → 落库并刷新
    private async _persistInlay(): Promise<void> {
        const data = await loadPlayerData();
        data.materials = { ...this._materials };
        data.inventory = this._inv.serialize();
        await savePlayerData();
        this._invView.refresh();
        this._drawInlayPanel();
    }
```

（`QUALITY_LABEL` 已在 BattleEntry 从 `EquipDefs` 导入；`STAT_LABEL`/`formatStatValue` 由 Step 2 补入导入。）

- [ ] **Step 4: 加载链创建面板 + 消费 inlay 信号 + 出售退宝石**

`assets/scripts/BattleEntry.ts` 的 `_createSquadView()` 调用处（当前 382 行 `this._createSquadView();`）后加：

```typescript
        this._createSquadView();
        this._createInlayView();
```

`_handleInventoryChanged`（InventoryView 的 onChanged 回调，当前 437-446 行）整体替换为——开头处理 `inlay`（开面板），出售时退回 `returnedGems`：

```typescript
    private async _handleInventoryChanged(kind: InventoryChangeKind, payload?: InventoryChangePayload): Promise<void> {
        if (kind === 'inlay') {
            if (payload?.itemId) this._openInlayPanel(payload.itemId);
            return;
        }
        const data = await loadPlayerData();
        if (payload?.gold && payload.gold > 0) data.gold = (data.gold ?? 0) + payload.gold;
        // 出售退回已镶宝石（Task 6 的 returnedGems 经此落到 materials）
        const returned = (payload as any)?.returnedGems as { id: string; count: number }[] | undefined;
        if (returned && returned.length) {
            data.materials = data.materials ?? {};
            for (const g of returned) data.materials[g.id] = (data.materials[g.id] ?? 0) + g.count;
            this._materials = { ...data.materials };
        }
        data.inventory = this._inv.serialize();
        await savePlayerData();

        if (this._gameStarted && (kind === 'equip' || kind === 'unequip') && !this._settlementOpen()) {
            this._startBattle(); // 穿脱后立即刷新战斗属性；结算页打开时先不打断结算
        }
    }
```

并在 InventoryView 出售发信号处把 `returnedGems` 带进 payload：`assets/scripts/inventory/InventoryView.ts` 当前 618 行 `this.onChanged(kind as InventoryChangeKind, { gold: r.gold, sold: r.sold?.length })` 改为：

```typescript
            this.onChanged(kind as InventoryChangeKind, { gold: r.gold, sold: r.sold?.length, returnedGems: r.returnedGems } as any);
```

（`returnedGems` 用 `as any` 透传，避免在 View 层引 MaterialItem 类型——BattleEntry 侧只读 `{id,count}`。）

- [ ] **Step 5: 类型检查**

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS" | grep -viE "TS5107" | grep -iE "BattleEntry|InventoryView|Inlay"
```
Expected: 空输出。

- [ ] **Step 6: 全套回归**

Run:
```bash
npm run test:inventory && npm run test:effective && npm run test:inlay && npm run test:inlay-config && npm run test:reward-types && npm run test:services && npm run config && npm run sim:pacing
```
Expected: 全绿；`sim:pacing`「全部达标」。

- [ ] **Step 7: 人工验证（Cocos 预览，列入待办）**

自动测试不覆盖 Graphics/Label 渲染。人工在 Cocos 预览确认：背包选中装备→点「镶嵌」开面板；开几个宝箱拿到宝石/卷轴（右上奖励卡开箱）；点空孔选中→点持有宝石镶入，装备属性变强（战斗内下一场生效）；点已镶孔取出，宝石回材料；点「打铭文」消耗卷轴随机出效果、再点覆盖重抽；卖掉镶了宝石的装备后宝石回材料背包。记入 `ai/memory/项目状态.md` 待办的「Cocos 预览手测」。

- [ ] **Step 8: Commit**

```bash
git add assets/scripts/inventory/InventoryView.ts assets/scripts/BattleEntry.ts
git commit -m "feat(inlay): 镶嵌面板 + 背包镶嵌入口 + 出售退回宝石接线

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## 收尾（实现全部 Task 后，按开发收尾.md）

- [ ] 全套回归：`npm run test:inventory && npm run test:effective && npm run test:drop && npm run test:combat && npm run test:progression && npm run test:services && npm run test:art && npm run test:craft && npm run test:skill && npm run test:squad && npm run test:growth-config && npm run test:growth && npm run test:inlay-config && npm run test:reward-types && npm run test:inlay && npm run config && npm run sim:pacing` 全绿。
- [ ] 刷新 `ai/memory/项目状态.md`「最近进展」+「已完成」+「待办」（镶嵌/铭文已落地、Cocos 手测项、宝石/铭文数值平衡待办）。
- [ ] `ai/memory/设计日志.md`：把「装备系统」的宝石/铭文方向条从"规划中/待处理冲突"更新为已实现，补最终数值占位与「平衡后置」取舍；注明 `gem_shard`/`rune_dust` 已被 `gem_<type>_<level>`/`rune_scroll` 替换。
- [ ] `ai/memory/代码地图.md`：新增 `inlay/` 模块（InlayConfig/InlayModel/InlayStats 职责）+ `inlay.xlsx` 真源 + EffectiveStats/InventoryModel/ChestService/BattleEntry/RewardTypes 改动点。
- [ ] 提交收尾。

## 自检对照（spec → task 覆盖）

- spec ① 数据模型（EquipItem 两字段 + 类型）→ Task 1 ✓
- spec ② 宝石存储（A1 拆细 MaterialId + 生成标签 + gemMaterialId）→ Task 3；旧键移除 → Task 7 ✓
- spec ③ 配置（inlay.xlsx 三表 + InlayConfig 访问器）→ Task 1（表）+ Task 2（访问器）✓
- spec ④ 操作逻辑（socket/unsocket/inscribe/ensureInlaySlots）→ Task 4 ✓
- spec ⑤ 战斗接入（itemInlayStats + calcEffectiveStats）→ Task 5 ✓
- spec ⑥ 出售/持久化/兼容（退回宝石、补孔、老键忽略）→ Task 6（退宝石/补孔）+ Task 8（退宝石落库）✓
- spec ⑦ 宝箱产出（ChestService 扩产）→ Task 7 ✓
- spec ⑧ UI（详情按钮 → 镶嵌面板）→ Task 8 ✓
- spec 迁移（craft 成本 + 引用点）→ Task 7 ✓
- spec 验收（tsx 单测 + 全套回归 + 人工验证待办）→ Task 2/3/4/5/6 单测 + Task 7/8 回归 + Task 8 人工验证 ✓
```
