# 心法（全局天赋树）系统 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地账号级天赋树「心法」：金币点小节点、首通残页点大节点，四类加成（属性/经济/掉落/功能解锁）作用于全队与全局。

**Architecture:** 镜像 inlay 线模式——`talent.xlsx` 真源 → 导表 → `talent/` 三个纯逻辑文件（Config/Model/Stats）→ 消费方（EffectiveStats/结算/掉落/离线/宝箱/上阵/背包）以注入参数吃聚合值 → `TalentPanel` 占位 UI。存档挂 `PlayerData.talents`。

**Tech Stack:** TypeScript 5.8.2、Cocos Creator 3.8.8（仅 TalentPanel）、xlsx 导表管线、tsx 单测。

**Spec:** `docs/superpowers/specs/2026-07-12-talent-tree-design.md`

## Global Constraints

- 玩家展示名「心法」、材料「秘笈残页」（`talent_page`）；代码内部统一 `talent` 命名，与 inlay 线的 inscription 无关。
- 百分比数值一律 0~1 小数（PERCENT 语义红线）。
- `talent/TalentConfig.ts`、`TalentModel.ts`、`TalentStats.ts` 纯逻辑**不得 import cc**；`ui/panels/TalentPanel.ts` 是唯一 import cc 的心法文件。
- 消费方保持纯函数：心法聚合值一律由组合根（BattleEntry / OfflineClaimService）注入参数，新参数全部**可选并默认旧行为**（pacing-sim / progress-sim 不传即不受影响）。
- 心法默认一点未点 → 全部现有测试与 13 项 pacing 门槛必须保持全绿。
- **只暂存不提交**：每个任务结束 `git add` 暂存，提交由用户逐次授权（项目纪律，覆盖本模板的 commit 步骤）。
- 新生成的 `.meta` 文件由用户开 Cocos 编辑器时自动生成，本计划不手造。

---

### Task 1: 新材料 `talent_page`（秘笈残页）

**Files:**
- Modify: `assets/scripts/services/RewardTypes.ts`
- Test: `tools/reward-types-test.ts`（已有，追加用例）

**Interfaces:**
- Produces: `MaterialId` 联合新增 `'talent_page'`；`MATERIAL_LABEL['talent_page'] === '秘笈残页'`。后续任务（TalentModel 扣残页、BattleEntry 发残页）依赖这个键。

- [ ] **Step 1: 写失败测试** — 在 `tools/reward-types-test.ts` 末尾（现有 test() 之后、汇总输出之前）追加：

```ts
test('talent_page：材料标签为秘笈残页', () => {
    assert.equal(MATERIAL_LABEL['talent_page'], '秘笈残页');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:reward-types`
Expected: FAIL（类型错误或 label undefined）

- [ ] **Step 3: 最小实现** — `assets/scripts/services/RewardTypes.ts`：

```ts
// 第 9 行联合类型加一键：
export type MaterialId = 'forge_stone' | 'rune_scroll' | 'talent_page' | GemMaterialId;

// buildMaterialLabels() 的初始 out 对象加一行：
    const out: Record<string, string> = {
        forge_stone: '打造石',
        rune_scroll: '铭文卷轴',
        talent_page: '秘笈残页',
    };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:reward-types`
Expected: PASS 全绿

- [ ] **Step 5: 暂存**

```bash
git add assets/scripts/services/RewardTypes.ts tools/reward-types-test.ts
```

---

### Task 2: 配置管线（talent.xlsx 真源 → 导表产物）

**Files:**
- Create: `tools/seed-talent-xlsx.ts`
- Modify: `tools/excel-to-config.ts`（新增 buildTalentConfig + SOURCES 一行 + knownLevelCount）
- Modify: `package.json`（`seed:talent` 脚本）
- Generate: `tools/config-xlsx/talent.xlsx`、`assets/scripts/config/talent.config.generated.ts`

**Interfaces:**
- Produces: `talent.config.generated.ts` 导出 `generatedTalentConfig = { nodes: [...], firstClearPages: number[] }`。Nodes 字段：`id/label/branch/tier/prereq(string[])/maxLevel/effectKind/effectKey/valuePerLevel/goldBase/goldGrowth/pageCost`。

- [ ] **Step 1: 写种子脚本** — `tools/seed-talent-xlsx.ts`（全占位数值，24 节点；同支内 tier 唯一用于 UI 网格排布）：

```ts
// talent.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/talent.xlsx，之后策划直接编辑该 xlsx。
// 两表：Nodes（心法节点：分支/前置/效果/成本）、FirstClearPages（关卡首通发放秘笈残页）。
// 数值全占位（spec 2026-07-12 ⑦：份额反解进 balance 框架另属后续计划）。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/talent.xlsx');

// 效果四类：stat（EquipStatKey，叠全队）/ econ（gold|exp|offlineRate）/
//           drop（equipQuality，蓝+品质权重放大）/ unlock（squadSlot3|chestCapacity|autoSell|offlineCap）
// 前置规则：prereq 全部点满才可点本节点；pageCost 仅一次性大节点（maxLevel=1）可 >0。
// 百分比按 0~1 小数填。goldCost(n) = round(goldBase × goldGrowth^(n-1))。
const NODES_HEADER = ['id', 'label', 'branch', 'tier', 'prereq', 'maxLevel',
    'effectKind', 'effectKey', 'valuePerLevel', 'goldBase', 'goldGrowth', 'pageCost'];
const NODES_ROWS: (string | number)[][] = [
    // —— 主干（纯属性，逐段解锁三条分支的入口）——
    ['trunk_1', '吐纳', 'trunk', 1, '',        5, 'stat', 'hpPct',    0.01, 100, 1.5, 0],
    ['trunk_2', '凝神', 'trunk', 2, 'trunk_1', 5, 'stat', 'atkPct',   0.01, 150, 1.5, 0],
    ['trunk_3', '固本', 'trunk', 3, 'trunk_2', 5, 'stat', 'defPct',   0.01, 220, 1.5, 0],
    ['trunk_4', '周天', 'trunk', 4, 'trunk_3', 5, 'stat', 'dmgBonus', 0.01, 330, 1.5, 0],
    // —— 战斗支（入口 trunk_2；末端大节点 心法大成）——
    ['combat_atk',    '剑势',     'combat', 1, 'trunk_2',     5, 'stat', 'atkPct',        0.02,  200,  1.6, 0],
    ['combat_hp',     '铁骨',     'combat', 2, 'trunk_2',     5, 'stat', 'hpPct',         0.02,  200,  1.6, 0],
    ['combat_crit',   '锋芒',     'combat', 3, 'combat_atk',  5, 'stat', 'critRate',      0.01,  300,  1.6, 0],
    ['combat_def',    '云甲',     'combat', 4, 'combat_hp',   5, 'stat', 'defPct',        0.02,  300,  1.6, 0],
    ['combat_haste',  '疾风',     'combat', 5, 'combat_crit', 5, 'stat', 'skillHaste',    0.02,  450,  1.6, 0],
    ['combat_dmg',    '破军',     'combat', 6, 'combat_crit', 5, 'stat', 'dmgBonus',      0.015, 450,  1.6, 0],
    ['combat_basic',  '淬刃',     'combat', 7, 'combat_dmg',  5, 'stat', 'basicDmgBonus', 0.02,  600,  1.6, 0],
    ['combat_master', '心法大成', 'combat', 8, 'combat_basic,combat_haste,combat_def', 1, 'stat', 'dmgBonus', 0.05, 2000, 1, 2],
    // —— 经济支（入口 trunk_3；大节点 入定=离线收益、拂尘=自动卖白绿）——
    ['econ_gold',     '生财', 'economy', 1, 'trunk_3',   5, 'econ', 'gold',        0.03, 250,  1.6, 0],
    ['econ_exp',      '悟性', 'economy', 2, 'trunk_3',   5, 'econ', 'exp',         0.03, 250,  1.6, 0],
    ['econ_gold2',    '聚宝', 'economy', 3, 'econ_gold', 5, 'econ', 'gold',        0.03, 400,  1.6, 0],
    ['econ_exp2',     '闻道', 'economy', 4, 'econ_exp',  5, 'econ', 'exp',         0.03, 400,  1.6, 0],
    ['econ_offline',  '入定', 'economy', 5, 'econ_gold2', 1, 'econ', 'offlineRate', 0.25, 1500, 1, 2],
    ['econ_autosell', '拂尘', 'economy', 6, 'econ_exp2',  1, 'unlock', 'autoSell',  1,    1500, 1, 2],
    // —— 掉落支（入口 trunk_4；大节点 乾坤袋=宝箱扩容）——
    ['drop_quality',  '慧眼',   'drop', 1, 'trunk_4',       5, 'drop', 'equipQuality', 0.03, 300,  1.6, 0],
    ['drop_quality2', '鉴宝',   'drop', 2, 'drop_quality',  5, 'drop', 'equipQuality', 0.03, 450,  1.6, 0],
    ['drop_quality3', '寻珍',   'drop', 3, 'drop_quality2', 5, 'drop', 'equipQuality', 0.04, 700,  1.6, 0],
    ['drop_quality4', '探骊',   'drop', 4, 'drop_quality3', 5, 'drop', 'equipQuality', 0.04, 1000, 1.6, 0],
    ['drop_chest',    '乾坤袋', 'drop', 5, 'drop_quality2', 1, 'unlock', 'chestCapacity', 20, 1800, 1, 2],
    // —— 汇合大节点：第 3 上阵位（树最深处；三支末端各点满）——
    ['func_squad3', '三才阵', 'trunk', 6, 'combat_master,econ_autosell,drop_chest', 1, 'unlock', 'squadSlot3', 1, 5000, 1, 4],
];

// 关卡首通发放秘笈残页：普通关 1、末关（Boss+章节）4；第一章共 13 页，
// 大节点总需 12 页（2+2+2+2+4），留 1 页余量（spec ⑥）。
const PAGES_HEADER = ['levelIndex', 'pages'];
const PAGES_ROWS: (string | number)[][] = [
    [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 4],
];

const wb = XLSX.utils.book_new();
function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}
addSheet('Nodes', NODES_HEADER, NODES_ROWS);
addSheet('FirstClearPages', PAGES_HEADER, PAGES_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Nodes(${NODES_ROWS.length}) FirstClearPages(${PAGES_ROWS.length})`);
```

- [ ] **Step 2: package.json 加脚本** — `scripts` 里 `"seed:balance"` 之后加：

```json
    "seed:talent": "tsx tools/seed-talent-xlsx.ts",
```

- [ ] **Step 3: 生成 xlsx**

Run: `npm run seed:talent`
Expected: `✓ 已生成 ...talent.xlsx  sheets: Nodes(24) FirstClearPages(10)`

- [ ] **Step 4: excel-to-config 加解析器** — `tools/excel-to-config.ts`：

4a. 在 `const knownBuffIds = new Set<string>();`（buff 模块解析器上方的模块级变量）旁边加：

```ts
// battle 源的关卡数，供 talent 源校验 FirstClearPages.levelIndex（SOURCES 里 battle 排在 talent 前）
let knownLevelCount = 0;
```

4b. 在 `buildBattleConfig` 中 `if (levels.length === 0) err('Levels: 没有任何关卡');` 之后加一行：

```ts
    knownLevelCount = levels.length;
```

4c. 在 buildBalanceConfig 之后新增解析器：

```ts
// ============ talent 模块解析器 ============
// 读 talent.xlsx 的 2 sheet → 心法（全局天赋树）配置。
// Nodes: id,label,branch,tier,prereq,maxLevel,effectKind,effectKey,valuePerLevel,goldBase,goldGrowth,pageCost
// FirstClearPages: levelIndex, pages（关卡首通发放秘笈残页）
function buildTalentConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_BRANCHES = new Set(['trunk', 'combat', 'economy', 'drop']);
    const KIND_KEYS: Record<string, Set<string> | null> = {
        stat: null,   // null = 用 EQUIP_STAT_KEY_SET
        econ: new Set(['gold', 'exp', 'offlineRate']),
        drop: new Set(['equipQuality']),
        unlock: new Set(['squadSlot3', 'chestCapacity', 'autoSell', 'offlineCap']),
    };

    const { rows } = sheetToRows(wb, 'Nodes');
    interface RawNode {
        id: string; label: string; branch: string; tier: number; prereq: string[];
        maxLevel: number; effectKind: string; effectKey: string; valuePerLevel: number;
        goldBase: number; goldGrowth: number; pageCost: number;
    }
    const nodes: RawNode[] = [];
    const ids = new Set<string>();
    for (const r of rows) {
        const id = reqStr(r['id'], 'Nodes.id');
        if (ids.has(id)) err(`Nodes: id "${id}" 重复定义`);
        ids.add(id);
        const branch = reqStr(r['branch'], `Nodes[${id}].branch`);
        if (!VALID_BRANCHES.has(branch)) err(`Nodes[${id}].branch "${branch}" 非法（trunk/combat/economy/drop）`);
        const tier = reqNum(r['tier'], `Nodes[${id}].tier`);
        if (tier < 1) err(`Nodes[${id}].tier 必须 >= 1`);
        const prereq = String(r['prereq'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
        const maxLevel = reqNum(r['maxLevel'], `Nodes[${id}].maxLevel`);
        if (maxLevel < 1) err(`Nodes[${id}].maxLevel 必须 >= 1`);
        const effectKind = reqStr(r['effectKind'], `Nodes[${id}].effectKind`);
        const effectKey = reqStr(r['effectKey'], `Nodes[${id}].effectKey`);
        const validKeys = KIND_KEYS[effectKind];
        if (validKeys === undefined) err(`Nodes[${id}].effectKind "${effectKind}" 非法（stat/econ/drop/unlock）`);
        else if (validKeys === null) {
            if (!EQUIP_STAT_KEY_SET.has(effectKey)) err(`Nodes[${id}].effectKey "${effectKey}" 不是合法装备属性键`);
        } else if (!validKeys.has(effectKey)) {
            err(`Nodes[${id}].effectKey "${effectKey}" 与 effectKind "${effectKind}" 不匹配`);
        }
        const valuePerLevel = reqNum(r['valuePerLevel'], `Nodes[${id}].valuePerLevel`);
        if (valuePerLevel <= 0) warn(`Nodes[${id}].valuePerLevel = ${valuePerLevel} 应 > 0`);
        const goldBase = reqNum(r['goldBase'], `Nodes[${id}].goldBase`);
        if (goldBase < 0) err(`Nodes[${id}].goldBase 不可为负`);
        const goldGrowth = reqNum(r['goldGrowth'], `Nodes[${id}].goldGrowth`);
        if (goldGrowth < 1) warn(`Nodes[${id}].goldGrowth = ${goldGrowth} 应 >= 1`);
        const pageCost = reqNum(r['pageCost'], `Nodes[${id}].pageCost`);
        if (pageCost < 0) err(`Nodes[${id}].pageCost 不可为负`);
        if (pageCost > 0 && maxLevel !== 1) err(`Nodes[${id}]: pageCost>0 仅限一次性大节点（maxLevel=1）`);
        nodes.push({ id, label: reqStr(r['label'], `Nodes[${id}].label`), branch, tier, prereq, maxLevel, effectKind, effectKey, valuePerLevel, goldBase, goldGrowth, pageCost });
    }
    if (nodes.length === 0) err('Nodes: 至少需要 1 个节点');

    // 前置引用存在 + 无环（DFS 染色：0 访问中 / 1 完成）
    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const n of nodes) {
        for (const p of n.prereq) {
            if (p === n.id) err(`Nodes[${n.id}].prereq 引用了自身`);
            else if (!byId.has(p)) err(`Nodes[${n.id}].prereq 引用了不存在的节点 "${p}"`);
        }
    }
    const state = new Map<string, number>();
    const visit = (id: string, stack: string[]): void => {
        const st = state.get(id);
        if (st === 1) return;
        if (st === 0) { err(`Nodes: prereq 成环（${[...stack, id].join(' → ')}）`); return; }
        state.set(id, 0);
        for (const p of byId.get(id)?.prereq ?? []) if (byId.has(p)) visit(p, [...stack, id]);
        state.set(id, 1);
    };
    for (const n of nodes) visit(n.id, []);

    // FirstClearPages → 按 levelIndex 的稠密数组（缺行补 0）
    const { rows: pageRows } = sheetToRows(wb, 'FirstClearPages');
    const pageMap = new Map<number, number>();
    for (const r of pageRows) {
        const li = reqNum(r['levelIndex'], 'FirstClearPages.levelIndex');
        if (pageMap.has(li)) err(`FirstClearPages: levelIndex ${li} 重复定义`);
        const pages = reqNum(r['pages'], `FirstClearPages[${li}].pages`);
        if (pages < 0) err(`FirstClearPages[${li}].pages 不可为负`);
        if (knownLevelCount > 0 && (li < 0 || li >= knownLevelCount)) {
            err(`FirstClearPages: levelIndex ${li} 超出 battle 关卡范围 [0, ${knownLevelCount - 1}]`);
        }
        pageMap.set(li, pages);
    }
    const maxLi = pageMap.size > 0 ? Math.max(...pageMap.keys()) : -1;
    const firstClearPages: number[] = [];
    for (let i = 0; i <= maxLi; i++) firstClearPages.push(pageMap.get(i) ?? 0);

    const config = { nodes, firstClearPages };
    const summary = `nodes=${nodes.length} firstClearLevels=${pageMap.size}`;
    return { config, summary };
}
```

4d. `SOURCES` 数组末尾（balance 之后）加：

```ts
    {
        name: 'talent',
        xlsxRel: 'config-xlsx/talent.xlsx',
        outRel: '../assets/scripts/config/talent.config.generated.ts',
        exportVar: 'generatedTalentConfig',
        build: buildTalentConfig,
    },
```

- [ ] **Step 5: 生成产物并验证**

Run: `npm run config`
Expected: 全部源导出成功，末尾出现 `✓ [talent] 已生成 ...talent.config.generated.ts` 与 `nodes=24 firstClearLevels=10`，无 ❌。

- [ ] **Step 6: 校验器负例抽查（手工快检，不留代码）** — 临时把 seed 里 `func_squad3` 的 prereq 改成 `combat_master,不存在的节点`，跑 `npm run seed:talent && npm run config`，确认报 `prereq 引用了不存在的节点` 并退出非 0；改回后重新 `npm run seed:talent && npm run config` 恢复。

- [ ] **Step 7: 暂存**

```bash
git add tools/seed-talent-xlsx.ts tools/excel-to-config.ts package.json tools/config-xlsx/talent.xlsx assets/scripts/config/talent.config.generated.ts
```

---

### Task 3: 纯逻辑模块 TalentConfig + TalentModel

**Files:**
- Create: `assets/scripts/talent/TalentConfig.ts`
- Create: `assets/scripts/talent/TalentModel.ts`
- Create: `tools/talent-test.ts`
- Modify: `package.json`（`test:talent` 脚本 + 挂入 `test` 链）

**Interfaces:**
- Consumes: `generatedTalentConfig`（Task 2）、`MaterialSave`/`'talent_page'`（Task 1）。
- Produces:
  - `TalentConfig.ts`: `TalentNodeDef`、`talentNodes(): TalentNodeDef[]`、`talentNodeById(id): TalentNodeDef | undefined`、`talentLevelCost(node, nextLevel): { gold: number; pages: number }`、`firstClearPages(levelIndex): number`
  - `TalentModel.ts`: `TalentSave = Record<string, number>`、`nodeLevel(save, id): number`、`prereqMet(node, save): boolean`、`learnNode(save, nodeId, wallet: { gold: number }, materials: MaterialSave): TalentLearnResult`（`{ ok, reason?, spentGold?, spentPages?, newLevel? }`）

- [ ] **Step 1: 写失败测试** — `tools/talent-test.ts`：

```ts
// 心法（talent）纯逻辑单测（tsx 运行）：Config 成本/查询 + Model 点节点。
import * as assert from 'node:assert/strict';
import { talentNodeById, talentLevelCost, firstClearPages, talentNodes } from '../assets/scripts/talent/TalentConfig';
import { learnNode, nodeLevel, prereqMet, type TalentSave } from '../assets/scripts/talent/TalentModel';
import type { MaterialSave } from '../assets/scripts/services/RewardTypes';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

// 点满一个节点的辅助：直接写档（测试专用，不走扣费）
function maxOut(save: TalentSave, ...ids: string[]) {
    for (const id of ids) save[id] = talentNodeById(id)!.maxLevel;
}

test('配置载入：24 节点，trunk_1 无前置', () => {
    assert.equal(talentNodes().length, 24);
    assert.deepEqual(talentNodeById('trunk_1')!.prereq, []);
});

test('talentLevelCost：金币等比、残页只在 0→1 级收', () => {
    const trunk1 = talentNodeById('trunk_1')!;   // goldBase=100, growth=1.5
    assert.equal(talentLevelCost(trunk1, 1).gold, 100);
    assert.equal(talentLevelCost(trunk1, 2).gold, 150);
    assert.equal(talentLevelCost(trunk1, 3).gold, 225);
    assert.equal(talentLevelCost(trunk1, 1).pages, 0);
    const squad3 = talentNodeById('func_squad3')!;   // pageCost=4
    assert.equal(talentLevelCost(squad3, 1).pages, 4);
});

test('firstClearPages：普通关 1、末关 4、越界 0', () => {
    assert.equal(firstClearPages(0), 1);
    assert.equal(firstClearPages(9), 4);
    assert.equal(firstClearPages(99), 0);
});

test('learnNode：金币够→扣费升 1 级', () => {
    const save: TalentSave = {};
    const wallet = { gold: 100 };
    const r = learnNode(save, 'trunk_1', wallet, {});
    assert.ok(r.ok);
    assert.equal(wallet.gold, 0);
    assert.equal(r.spentGold, 100);
    assert.equal(nodeLevel(save, 'trunk_1'), 1);
});

test('learnNode：金币不足→失败不改', () => {
    const save: TalentSave = {};
    const wallet = { gold: 99 };
    const r = learnNode(save, 'trunk_1', wallet, {});
    assert.equal(r.ok, false);
    assert.equal(wallet.gold, 99);
    assert.equal(nodeLevel(save, 'trunk_1'), 0);
});

test('learnNode：前置未点满→失败', () => {
    const save: TalentSave = { trunk_1: 3 };   // maxLevel=5，未满
    const r = learnNode(save, 'trunk_2', { gold: 99999 }, {});
    assert.equal(r.ok, false);
    assert.ok(!prereqMet(talentNodeById('trunk_2')!, save));
});

test('learnNode：点满后拒绝再点', () => {
    const save: TalentSave = { trunk_1: 5 };
    const r = learnNode(save, 'trunk_1', { gold: 99999 }, {});
    assert.equal(r.ok, false);
});

test('learnNode：大节点残页不足→失败不改；足够→扣页解锁', () => {
    const save: TalentSave = {};
    maxOut(save, 'trunk_1', 'trunk_2', 'combat_atk', 'combat_hp', 'combat_crit', 'combat_def', 'combat_haste', 'combat_dmg', 'combat_basic');
    const mats: MaterialSave = { talent_page: 1 };   // combat_master 需 2 页
    const r1 = learnNode(save, 'combat_master', { gold: 99999 }, mats);
    assert.equal(r1.ok, false);
    assert.equal(mats.talent_page, 1);
    mats.talent_page = 2;
    const wallet = { gold: 99999 };
    const r2 = learnNode(save, 'combat_master', wallet, mats);
    assert.ok(r2.ok);
    assert.equal(mats.talent_page, 0);
    assert.equal(r2.spentPages, 2);
    assert.equal(nodeLevel(save, 'combat_master'), 1);
});

test('learnNode：未知节点/未知存档键容忍', () => {
    const r = learnNode({}, 'no_such_node', { gold: 99999 }, {});
    assert.equal(r.ok, false);
    assert.equal(nodeLevel({ ghost_node: 3 }, 'ghost_node'), 3);   // 读不崩（配置删除后残留）
});

console.log(`\ntalent: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: package.json 挂脚本** — `"test:inlay"` 行后加 `"test:talent": "tsx tools/talent-test.ts",`，并在 `"test"` 链末尾追加 `&& npm run test:talent`。

- [ ] **Step 3: 跑测试确认失败**

Run: `npm run test:talent`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 TalentConfig.ts** — `assets/scripts/talent/TalentConfig.ts`：

```ts
// 心法（全局天赋树）配置纯计算层（不依赖 cc）。
// ★★★ 数值由 Excel 管理 ★★★ 源文件：tools/config-xlsx/talent.xlsx → npm run config
// 玩家展示名「心法」；与装备铭文（inlay 线 inscription）无关。

import { generatedTalentConfig } from '../config/talent.config.generated';

export type TalentBranch = 'trunk' | 'combat' | 'economy' | 'drop';
export type TalentEffectKind = 'stat' | 'econ' | 'drop' | 'unlock';

export interface TalentNodeDef {
    id: string;
    label: string;
    branch: TalentBranch;
    tier: number;             // 同支内唯一，UI 网格排布用
    prereq: string[];         // 全部前置点满才可点本节点
    maxLevel: number;         // 小节点多级；大节点 1
    effectKind: TalentEffectKind;
    effectKey: string;        // stat→EquipStatKey / econ→gold|exp|offlineRate / drop→equipQuality / unlock→squadSlot3|chestCapacity|autoSell|offlineCap
    valuePerLevel: number;    // 每级效果值（百分比 0~1 小数）
    goldBase: number;         // 第 n 级金币成本 = round(goldBase × goldGrowth^(n-1))
    goldGrowth: number;
    pageCost: number;         // 秘笈残页，仅 0→1 级收（一次性大节点）
}

export interface TalentConfigShape {
    nodes: TalentNodeDef[];
    firstClearPages: number[];   // 按 levelIndex；越界=0
}

export const TalentConfig = generatedTalentConfig as TalentConfigShape;

let _byId: Map<string, TalentNodeDef> | null = null;

export function talentNodes(): TalentNodeDef[] {
    return TalentConfig.nodes;
}

export function talentNodeById(id: string): TalentNodeDef | undefined {
    if (!_byId) {
        _byId = new Map();
        for (const n of TalentConfig.nodes) _byId.set(n.id, n);
    }
    return _byId.get(id);
}

// 第 nextLevel 级（1 起）的成本；残页只在 0→1 级收（多级节点 pageCost=0，导表已校验）
export function talentLevelCost(node: TalentNodeDef, nextLevel: number): { gold: number; pages: number } {
    const gold = Math.round(node.goldBase * Math.pow(node.goldGrowth, Math.max(0, nextLevel - 1)));
    return { gold, pages: nextLevel === 1 ? node.pageCost : 0 };
}

// 关卡首通发放的秘笈残页数
export function firstClearPages(levelIndex: number): number {
    return TalentConfig.firstClearPages[levelIndex] ?? 0;
}
```

- [ ] **Step 5: 实现 TalentModel.ts** — `assets/scripts/talent/TalentModel.ts`：

```ts
// 心法点树纯逻辑（不依赖 cc）：learnNode 校验+扣费，失败不留半成品（镜像 InlayModel）。
// 存档形状 TalentSave 挂 PlayerData.talents；未知 nodeId（配置删除后残留）读到只忽略不崩。

import type { MaterialSave } from '../services/RewardTypes';
import { talentNodeById, talentLevelCost, type TalentNodeDef } from './TalentConfig';

export type TalentSave = Record<string, number>;

export interface TalentLearnResult {
    ok: boolean;
    reason?: string;
    spentGold?: number;
    spentPages?: number;
    newLevel?: number;
}
function fail(reason: string): TalentLearnResult { return { ok: false, reason }; }

export function nodeLevel(save: TalentSave | undefined, id: string): number {
    const v = save?.[id];
    return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
}

export function prereqMet(node: TalentNodeDef, save: TalentSave | undefined): boolean {
    return node.prereq.every(pid => {
        const p = talentNodeById(pid);
        return !!p && nodeLevel(save, pid) >= p.maxLevel;
    });
}

// 点一级：校验节点存在/未满/前置点满/金币/残页，成功即扣费写档。
// wallet.gold 就地扣减；materials 就地扣 talent_page；任一校验失败不改任何状态。
export function learnNode(save: TalentSave, nodeId: string, wallet: { gold: number }, materials: MaterialSave): TalentLearnResult {
    const node = talentNodeById(nodeId);
    if (!node) return fail('心法节点不存在');
    const cur = nodeLevel(save, nodeId);
    if (cur >= node.maxLevel) return fail('该心法已点满');
    if (!prereqMet(node, save)) return fail('前置心法未点满');
    const cost = talentLevelCost(node, cur + 1);
    if (wallet.gold < cost.gold) return fail('金币不足');
    if (cost.pages > 0 && (materials['talent_page'] ?? 0) < cost.pages) return fail('秘笈残页不足');
    wallet.gold -= cost.gold;
    if (cost.pages > 0) materials['talent_page'] = (materials['talent_page'] ?? 0) - cost.pages;
    save[nodeId] = cur + 1;
    return { ok: true, spentGold: cost.gold, spentPages: cost.pages, newLevel: cur + 1 };
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm run test:talent`
Expected: 全部 ✓，`talent: N passed, 0 failed`

- [ ] **Step 7: 暂存**

```bash
git add assets/scripts/talent/TalentConfig.ts assets/scripts/talent/TalentModel.ts tools/talent-test.ts package.json
```

---

### Task 4: TalentStats 聚合

**Files:**
- Create: `assets/scripts/talent/TalentStats.ts`
- Test: `tools/talent-test.ts`（追加用例）

**Interfaces:**
- Produces: `TalentAggregate = { stats: EquipStats; econ: { gold; exp; offlineRate }; drop: { equipQuality }; unlocks: { squadSlot3: boolean; chestCapacity: number; autoSell: boolean; offlineCap: number } }`、`talentAggregate(save?): TalentAggregate`、`emptyTalentAggregate(): TalentAggregate`。后续所有消费方任务依赖这三个导出。

- [ ] **Step 1: 写失败测试** — `tools/talent-test.ts` 追加（import 区加 `import { talentAggregate, emptyTalentAggregate } from '../assets/scripts/talent/TalentStats';`）：

```ts
test('talentAggregate：空档全零', () => {
    const agg = talentAggregate(undefined);
    assert.deepEqual(agg, emptyTalentAggregate());
    assert.equal(agg.unlocks.squadSlot3, false);
});

test('talentAggregate：四类效果聚合（stat 同键叠加/econ/drop/unlock）', () => {
    const save: TalentSave = {
        trunk_2: 2,        // stat atkPct 0.01×2
        combat_atk: 3,     // stat atkPct 0.02×3 → 合计 0.08
        econ_exp: 2,       // econ exp 0.03×2
        drop_quality: 1,   // drop equipQuality 0.03
        drop_chest: 1,     // unlock chestCapacity 20
        func_squad3: 1,    // unlock squadSlot3
        econ_autosell: 1,  // unlock autoSell
        econ_offline: 1,   // econ offlineRate 0.25
    };
    const agg = talentAggregate(save);
    assert.ok(Math.abs((agg.stats.atkPct ?? 0) - 0.08) < 1e-9);
    assert.ok(Math.abs(agg.econ.exp - 0.06) < 1e-9);
    assert.ok(Math.abs(agg.econ.offlineRate - 0.25) < 1e-9);
    assert.ok(Math.abs(agg.drop.equipQuality - 0.03) < 1e-9);
    assert.equal(agg.unlocks.chestCapacity, 20);
    assert.equal(agg.unlocks.squadSlot3, true);
    assert.equal(agg.unlocks.autoSell, true);
});

test('talentAggregate：未知 nodeId 忽略不崩', () => {
    const agg = talentAggregate({ ghost_node: 5 });
    assert.deepEqual(agg, emptyTalentAggregate());
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:talent`
Expected: FAIL（TalentStats 不存在）

- [ ] **Step 3: 实现** — `assets/scripts/talent/TalentStats.ts`：

```ts
// 心法聚合纯函数（不依赖 cc）：把 TalentSave 汇总成四类加成，供组合根注入各消费方。
// stats → EffectiveStats（全上阵角色）；econ → 结算/离线；drop → 掉落品质；unlocks → 功能开关。

import type { EquipStats, EquipStatKey } from '../inventory/EquipDefs';
import { talentNodes } from './TalentConfig';
import { nodeLevel, type TalentSave } from './TalentModel';

export interface TalentAggregate {
    stats: EquipStats;
    econ: { gold: number; exp: number; offlineRate: number };
    drop: { equipQuality: number };
    unlocks: { squadSlot3: boolean; chestCapacity: number; autoSell: boolean; offlineCap: number };
}

export function emptyTalentAggregate(): TalentAggregate {
    return {
        stats: {},
        econ: { gold: 0, exp: 0, offlineRate: 0 },
        drop: { equipQuality: 0 },
        unlocks: { squadSlot3: false, chestCapacity: 0, autoSell: false, offlineCap: 0 },
    };
}

export function talentAggregate(save: TalentSave | undefined): TalentAggregate {
    const out = emptyTalentAggregate();
    if (!save) return out;
    for (const node of talentNodes()) {
        const lv = nodeLevel(save, node.id);
        if (lv <= 0) continue;
        const total = node.valuePerLevel * Math.min(lv, node.maxLevel);
        if (node.effectKind === 'stat') {
            const k = node.effectKey as EquipStatKey;
            out.stats[k] = (out.stats[k] ?? 0) + total;
        } else if (node.effectKind === 'econ') {
            if (node.effectKey === 'gold') out.econ.gold += total;
            else if (node.effectKey === 'exp') out.econ.exp += total;
            else if (node.effectKey === 'offlineRate') out.econ.offlineRate += total;
        } else if (node.effectKind === 'drop') {
            if (node.effectKey === 'equipQuality') out.drop.equipQuality += total;
        } else if (node.effectKind === 'unlock') {
            if (node.effectKey === 'squadSlot3') out.unlocks.squadSlot3 = true;
            else if (node.effectKey === 'chestCapacity') out.unlocks.chestCapacity += total;
            else if (node.effectKey === 'autoSell') out.unlocks.autoSell = true;
            else if (node.effectKey === 'offlineCap') out.unlocks.offlineCap += total;
        }
    }
    return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:talent`
Expected: 全部 ✓

- [ ] **Step 5: 暂存**

```bash
git add assets/scripts/talent/TalentStats.ts tools/talent-test.ts
```

---

### Task 5: ProgressModel 首通判定（maxClearedLevel）

**Files:**
- Modify: `assets/scripts/progression/ProgressModel.ts`
- Test: `tools/progression-test.ts`（已有，追加用例）

**Interfaces:**
- Produces: `ProgressSave.maxClearedLevel?: number`（-1=未通任何关；老档缺省=maxUnlockedLevel-1）；`CompleteLevelResult.firstClear: boolean`。Task 9（BattleEntry 首通发残页）依赖 `complete.firstClear`。

- [ ] **Step 1: 写失败测试** — `tools/progression-test.ts` 追加（沿用文件内既有 test() 风格）：

```ts
test('firstClear：首通 true、重打 false', () => {
    const m = new ProgressModel(10, 0);
    const r1 = m.completeLevel(0);
    assert.equal(r1.firstClear, true);
    const r2 = m.completeLevel(0);
    assert.equal(r2.firstClear, false);
});

test('firstClear：末关也能判首通（maxUnlocked 推导不出的场景）', () => {
    const m = new ProgressModel(3, 0);
    m.completeLevel(0); m.completeLevel(1);
    const first = m.completeLevel(2);   // 末关
    assert.equal(first.firstClear, true);
    const again = m.completeLevel(2);
    assert.equal(again.firstClear, false);
});

test('firstClear：老档缺 maxClearedLevel → 解锁之下视为已通', () => {
    const m = new ProgressModel(10, 0);
    m.deserialize({ currentLevel: 4, maxUnlockedLevel: 5 });   // 老档：无 maxClearedLevel
    assert.equal(m.completeLevel(3).firstClear, false);   // 4(=maxUnlocked-1) 及以下视为已通
    assert.equal(m.completeLevel(5).firstClear, true);    // 新推进的关正常判首通
});

test('firstClear：序列化往返保留', () => {
    const m = new ProgressModel(10, 0);
    m.completeLevel(0);
    const m2 = new ProgressModel(10, 0);
    m2.deserialize(m.serialize());
    assert.equal(m2.completeLevel(0).firstClear, false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:progression`
Expected: FAIL（firstClear undefined）

- [ ] **Step 3: 实现** — `assets/scripts/progression/ProgressModel.ts`：

```ts
// ProgressSave 加字段：
export interface ProgressSave {
    currentLevel: number;
    maxUnlockedLevel: number;
    maxClearedLevel?: number;   // 已实际通关的最高关（-1=未通任何关）；老档缺省 = maxUnlockedLevel-1
}

// CompleteLevelResult 加字段：
export interface CompleteLevelResult {
    completedLevel: number;
    nextLevel: number;
    hasNext: boolean;
    unlockedNext: boolean;
    firstClear: boolean;   // 本次是否首通（心法秘笈残页发放依据）
}

// class ProgressModel 加属性（constructor 内无需额外初始化，字段默认值即可）：
    maxClearedLevel = -1;

// deserialize 末尾追加（在 this.maxUnlockedLevel = ... 之后）：
        const savedCleared = save?.maxClearedLevel;
        this.maxClearedLevel = Number.isFinite(savedCleared as number)
            ? Math.max(-1, Math.min(Math.floor(savedCleared as number), this.lastLevel))
            : this.maxUnlockedLevel - 1;   // 老档兜底：解锁之下视为已通（末关可能多判一次首通，占位期接受）

// serialize 返回对象加一项：
            maxClearedLevel: Math.max(-1, Math.min(this.maxClearedLevel, this.lastLevel)),

// completeLevel 在 return 之前加，并把 firstClear 放进返回值：
        const firstClear = completedLevel > this.maxClearedLevel;
        if (firstClear) this.maxClearedLevel = completedLevel;
        return {
            completedLevel,
            nextLevel,
            hasNext: completedLevel < this.lastLevel,
            unlockedNext: this.maxUnlockedLevel > before,
            firstClear,
        };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:progression`
Expected: 全部 ✓（含既有用例）

- [ ] **Step 5: 暂存**

```bash
git add assets/scripts/progression/ProgressModel.ts tools/progression-test.ts
```

---

### Task 6: 掉落品质加成链（qualityBonus）

**Files:**
- Modify: `assets/scripts/config/DropConfig.ts`
- Modify: `assets/scripts/loot/LootService.ts`
- Modify: `assets/scripts/chest/ChestService.ts`
- Modify: `assets/scripts/ui/panels/ChestPanel.ts`
- Test: `tools/drop-config-test.ts`（已有，追加用例）

**Interfaces:**
- Produces: `rollDropItems(groupId, rng?, qualityBonus = 0)`；`StageRewardInput.qualityBonus?: number`；`openChest(chest, qualityBonus = 0)`；ChestPanel options 新增 `qualityBonus?: () => number`。Task 9 注入 `_talentAgg.drop.equipQuality`。

- [ ] **Step 1: 写失败测试** — `tools/drop-config-test.ts` 追加（沿用文件内既有 test() 风格与已存在的掉落组 id；文件里现有用例引用了真实 group id，选同一个）：

```ts
test('qualityBonus：蓝+权重放大后高品质占比上升（seed 对比统计）', () => {
    // 同一 rng 序列下，bonus=10 时高品质(rare/epic/legend)件数应 ≥ bonus=0 时
    const mkRng = () => { let s = 42; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; };
    const count = (bonus: number) => {
        const rng = mkRng();
        let high = 0;
        for (let i = 0; i < 200; i++) {
            for (const it of rollDropItems('c1_early', rng, bonus)) {
                if (it.quality === 'rare' || it.quality === 'epic' || it.quality === 'legend') high++;
            }
        }
        return high;
    };
    const base = count(0), boosted = count(10);
    assert.ok(boosted > base, `boosted=${boosted} 应 > base=${base}`);
});

test('qualityBonus=0：与不传参数逐位一致（默认行为不变）', () => {
    const mkRng = (seed: number) => { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; };
    const a = rollDropItems('c1_early', mkRng(7));
    const b = rollDropItems('c1_early', mkRng(7), 0);
    assert.deepEqual(a.map(i => [i.slot, i.quality, i.level]), b.map(i => [i.slot, i.quality, i.level]));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:drop`
Expected: FAIL（rollDropItems 不接受第 3 参）

- [ ] **Step 3: 实现 DropConfig** — `assets/scripts/config/DropConfig.ts`：

```ts
// pickWeighted 之后新增（心法掉落支：蓝及以上品质权重 ×(1+bonus)，pickWeighted 按总权重天然重新归一）：
const HIGH_QUALITIES: Quality[] = ['rare', 'epic', 'legend'];
function boostQualityWeights(weights: Record<Quality, number>, bonus: number): Record<Quality, number> {
    if (bonus <= 0) return weights;
    const out = { ...weights };
    for (const q of HIGH_QUALITIES) out[q] = (out[q] ?? 0) * (1 + bonus);
    return out;
}

// rollDropItems 签名与品质行改为：
export function rollDropItems(groupId: string, rng: () => number = Math.random, qualityBonus = 0): EquipItem[] {
    const group = getDropGroup(groupId);
    const qualityWeights = boostQualityWeights(group.qualityWeights, qualityBonus);
    const count = Math.max(0, Math.floor(group.itemCount));
    const items: EquipItem[] = [];
    for (let i = 0; i < count; i++) {
        const slot = pickWeighted(SLOTS, group.slotWeights, rng);
        const quality = pickWeighted(QUALITIES, qualityWeights, rng);
        const level = group.levelMin + Math.floor(rng() * (group.levelMax - group.levelMin + 1));
        items.push(createEquipItem(slot, quality, rng, level));
    }
    return items;
}
```

注意 `Quality` 已在文件顶部 import（`from '../inventory/EquipDefs'`），无需新增 import。

- [ ] **Step 4: 实现 LootService** — `assets/scripts/loot/LootService.ts`：

```ts
// StageRewardInput 加可选字段：
export interface StageRewardInput {
    levelIndex: number;
    source: RewardSource;
    seed: string | number;
    rng?: Rng;
    qualityBonus?: number;   // 心法掉落支：蓝+品质权重放大
}

// generateStageReward 里 rollDropItems 调用改为：
    reward.equipments = rollDropItems(level.dropGroup, rng, input.qualityBonus ?? 0).map((item, i) => ({
```

- [ ] **Step 5: 实现 ChestService** — `assets/scripts/chest/ChestService.ts`：

```ts
// openChest 签名加参（默认 0 = 旧行为）：
export function openChest(chest: ChestItem, qualityBonus = 0): OpenChestResult {

// 装备 roll 处改为：
        const items = rollDropItems(dropGroup, rng, qualityBonus);
```

- [ ] **Step 6: ChestPanel 透传** — `assets/scripts/ui/panels/ChestPanel.ts`：面板的 options 接口（文件内导出的 `ChestPanelOptions`，与 `getChests`/`availableEquipmentSlots` 并列）加一项：

```ts
    qualityBonus?: () => number;   // 心法掉落支加成（组合根注入；缺省 0）
```

文件内**两处** `openChest(chest)` 调用（约 235 行预览、约 321 行实开）都改为：

```ts
        const preview = openChest(chest, this.options.qualityBonus?.() ?? 0);
```
```ts
        const result = openChest(chest, this.options.qualityBonus?.() ?? 0);
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npm run test:drop && npm run typecheck`
Expected: 全部 ✓、两套编译无错

- [ ] **Step 8: 暂存**

```bash
git add assets/scripts/config/DropConfig.ts assets/scripts/loot/LootService.ts assets/scripts/chest/ChestService.ts assets/scripts/ui/panels/ChestPanel.ts tools/drop-config-test.ts
```

---

### Task 7: EffectiveStats 心法属性注入

**Files:**
- Modify: `assets/scripts/combat/EffectiveStats.ts`
- Test: `tools/effective-stats-test.ts`（已有，追加用例）

**Interfaces:**
- Produces: `calcEffectiveStats(base, items, levelPct = 0, extraStats?: EquipStats)`、`buildEffectiveStatsMap(equipped, levels = {}, extraStats?: EquipStats)`。extraStats 与装备词条同池：平铺键直接累加、百分比键进双层公式的百分比池。Task 9 注入 `_talentAgg.stats`。

- [ ] **Step 1: 写失败测试** — `tools/effective-stats-test.ts` 追加（沿用文件内既有 test() 风格与 base stats 构造方式；若文件有现成的 mkBase/BASE 辅助就复用）：

```ts
test('extraStats：平铺键累加、百分比键进双层公式', () => {
    const base = { ...BattleConfig.stats.tank };
    const noTalent = calcEffectiveStats(base, []);
    const withTalent = calcEffectiveStats(base, [], 0, { atk: 10, atkPct: 0.10, critRate: 0.05 });
    assert.equal(withTalent.atk, Math.round((base.atk + 10) * 1.10));
    assert.ok(Math.abs(withTalent.critRate - (noTalent.critRate + 0.05)) < 1e-9);
});

test('extraStats 缺省：行为与旧签名逐位一致', () => {
    const base = { ...BattleConfig.stats.tank };
    assert.deepEqual(calcEffectiveStats(base, []), calcEffectiveStats(base, [], 0, undefined));
});

test('buildEffectiveStatsMap：extraStats 叠给每个职业', () => {
    const plain = buildEffectiveStatsMap(undefined, {});
    const boosted = buildEffectiveStatsMap(undefined, {}, { hpPct: 0.10 });
    for (const cls of ['tank', 'dps', 'healer'] as const) {
        assert.equal(boosted[cls]!.hp, Math.round(plain[cls]!.hp * 1.10));
    }
});
```

（若该文件未 import `BattleConfig`，在顶部补 `import { BattleConfig } from '../assets/scripts/config/BattleConfig';`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:effective`
Expected: FAIL（第 4 参不存在）

- [ ] **Step 3: 实现** — `assets/scripts/combat/EffectiveStats.ts`：

```ts
// import 区补充类型：
import type { EquipStats } from '../inventory/EquipDefs';

// calcEffectiveStats 签名加第 4 参，items 循环之后、最终乘算之前合入 extraStats：
export function calcEffectiveStats(base: CombatStats, items: (EquipItem | null | undefined)[], levelPct = 0, extraStats?: EquipStats): CombatStats {
    const out: CombatStats = { ...base };
    const pct = { hp: levelPct, atk: levelPct, def: levelPct, moveSpeed: 0 };
    for (const item of items) {
        // ……原循环体不动……
    }
    // 心法等全局加成：与装备词条同池同路径（平铺加算 / 百分比进双层公式）
    if (extraStats) {
        for (const k of STAT_KEYS) {
            const bonus = extraStats[k] ?? 0;
            if (bonus) out[k] += bonus;
        }
        for (const pk of PCT_KEYS) {
            const bonus = extraStats[pk] ?? 0;
            if (bonus) pct[PCT_MAP[pk]] += bonus;
        }
    }
    out.hp = Math.round(out.hp * (1 + pct.hp));
    // ……以下不动……

// buildEffectiveStatsMap 签名加第 3 参并透传：
export function buildEffectiveStatsMap(
    equipped: CharEquipped | undefined,
    levels: Partial<Record<SoldierClass, number>> = {},
    extraStats?: EquipStats,
): EffectiveStatsMap {
    // …循环内：
        map[cls] = calcEffectiveStats(base, slots ? SLOTS.map(s => slots[s]) : [], level ? charLevelCoef(level) - 1 : 0, extraStats);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:effective && npm run sim:pacing`
Expected: 测试全绿；pacing 13 门槛不动（sim 不传 extraStats）

- [ ] **Step 5: 暂存**

```bash
git add assets/scripts/combat/EffectiveStats.ts tools/effective-stats-test.ts
```

---

### Task 8: 离线收益心法加成（econ + offlineCap）

**Files:**
- Modify: `assets/scripts/offline/OfflineCombatService.ts`
- Modify: `assets/scripts/offline/OfflineClaimService.ts`
- Test: `tools/talent-test.ts`（追加用例——OfflineCombatService 是纯逻辑可直接 tsx 跑）

**Interfaces:**
- Consumes: `talentAggregate`（Task 4）。
- Produces: `OfflineRewardInput.talentEcon?: { gold: number; exp: number; offlineRate: number; offlineCapSeconds: number }`；不传 = 旧行为。`OfflineClaimService` 自行从 `data.talents` 聚合注入（组合根职责）。

- [ ] **Step 1: 写失败测试** — `tools/talent-test.ts` 追加（import 区加 `import { calculateOfflineReward } from '../assets/scripts/offline/OfflineCombatService';`）：

```ts
test('离线 talentEcon：金币/经验按 (1+econ)×(1+offlineRate) 放大，不传=旧行为', () => {
    const base = { lastOnlineAt: 1_000_000_000_000, now: 1_000_000_000_000 + 3600_000, levelIndex: 0, seed: 'talent-offline-t' };
    const plain = calculateOfflineReward(base);
    const boosted = calculateOfflineReward({ ...base, talentEcon: { gold: 0.06, exp: 0, offlineRate: 0.25, offlineCapSeconds: 0 } });
    assert.equal(plain.wins, boosted.wins);   // 同 seed 胜负序列一致（econ 不进 rng seed 串）
    if (plain.wins > 0) {
        assert.ok(boosted.gold > plain.gold, `boosted.gold=${boosted.gold} 应 > plain.gold=${plain.gold}`);
        // offlineRate 同时放大 exp（econ.exp=0 也放大）
        assert.ok(boosted.exp > plain.exp || plain.exp === 0);
    }
});

test('离线 offlineCapSeconds：时长上限外的时间因加成变现', () => {
    // 离线 100 小时（远超 maxHours），cap 增加 3600 秒应产出更多局数
    const base = { lastOnlineAt: 0, now: 360_000_000_000, levelIndex: 0, seed: 'talent-offline-cap' };
    const plain = calculateOfflineReward(base);
    const capped = calculateOfflineReward({ ...base, talentEcon: { gold: 0, exp: 0, offlineRate: 0, offlineCapSeconds: 7200 } });
    assert.ok(capped.seconds > plain.seconds);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:talent`
Expected: FAIL（talentEcon 字段无效果/类型错误）

- [ ] **Step 3: 实现 OfflineCombatService** — `assets/scripts/offline/OfflineCombatService.ts`：

```ts
// 类型区新增：
export interface OfflineTalentEcon {
    gold: number;          // 金币获取加成（心法经济支）
    exp: number;           // 经验获取加成
    offlineRate: number;   // 离线收益整体加成（大节点「入定」）
    offlineCapSeconds: number;   // 离线时长上限追加（秒）
}

export interface OfflineRewardInput {
    lastOnlineAt: number;
    now: number;
    levelIndex: number;
    seed: string | number;
    talentEcon?: OfflineTalentEcon;   // 缺省 = 无加成（旧行为）
}

// calcSeconds 加第 3 参：
function calcSeconds(lastOnlineAt: number, now: number, extraCapSeconds = 0): number {
    const raw = Math.floor((now - lastOnlineAt) / 1000);
    return Math.max(0, Math.min(raw, maxOfflineSeconds() + Math.max(0, extraCapSeconds)));
}

// calculateOfflineReward 里：
    const econ = input.talentEcon ?? { gold: 0, exp: 0, offlineRate: 0, offlineCapSeconds: 0 };
    const seconds = calcSeconds(input.lastOnlineAt, input.now, econ.offlineCapSeconds);
    // …
        reward.gold += Math.floor(cfg.goldPerWin * (1 + econ.gold) * (1 + econ.offlineRate));
        reward.exp += Math.floor(cfg.expPerWin * (1 + econ.exp) * (1 + econ.offlineRate));
```

（宝箱 roll 的 seed 串不含 econ → 同 seed 宝箱序列与旧版一致。）

- [ ] **Step 4: 实现 OfflineClaimService 注入** — `assets/scripts/offline/OfflineClaimService.ts`：

```ts
// import 区加：
import { talentAggregate } from '../talent/TalentStats';

// claimOfflineReward 里 calculateOfflineReward 调用改为：
    const agg = talentAggregate(data.talents);
    const reward = calculateOfflineReward({
        lastOnlineAt, now, levelIndex, seed,
        talentEcon: { gold: agg.econ.gold, exp: agg.econ.exp, offlineRate: agg.econ.offlineRate, offlineCapSeconds: agg.unlocks.offlineCap },
    });
```

（`data.talents` 字段在 Task 9 加进 PlayerData；本任务先写 `(data as { talents?: TalentSave }).talents` 会引类型噪音——直接把 Task 9 Step 3 的 PlayerData 字段改动提前到本任务做，见下。）

- [ ] **Step 5: PlayerData 加字段** — `assets/scripts/core/data/DataService.ts`：

```ts
// import 区加：
import type { TalentSave } from '../../talent/TalentModel';

// PlayerData 接口加两字段（charGrowth 之后）：
    talents?: TalentSave;        // 心法（全局天赋树）已点等级；老存档缺它 = 一点未点
    autoSellLowQuality?: boolean; // 心法「拂尘」解锁后的自动卖白/绿装开关（默认关）
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm run test:talent && npm run typecheck`
Expected: 全部 ✓

- [ ] **Step 7: 暂存**

```bash
git add assets/scripts/offline/OfflineCombatService.ts assets/scripts/offline/OfflineClaimService.ts assets/scripts/core/data/DataService.ts tools/talent-test.ts
```

---

### Task 9: 注入点改造（上阵位 / 宝箱容量）

**Files:**
- Modify: `assets/scripts/squad/SquadPersistence.ts`
- Modify: `assets/scripts/chest/ChestModel.ts`
- Test: `tools/squad-test.ts`（追加一条）

**Interfaces:**
- Produces: `loadSquad(extraCap = 0)`（cap = `BattleConfig.squadCap + extraCap`）；`ChestInventoryModel.maxChests` 由 readonly 改为可变（心法解锁后组合根直接改写）。Task 10 依赖。

- [ ] **Step 1: 写失败测试** — `tools/squad-test.ts` 追加（沿用文件既有风格；SquadModel 直接可测）：

```ts
test('squadCap 注入：cap=3 时可上 3 人', () => {
    const m = SquadModel.deserialize(undefined, 3);
    assert.equal(m.squadCap, 3);
});
```

（`ChestInventoryModel.maxChests` 可变性由 typecheck 验证，无需运行时测试。）

- [ ] **Step 2: 实现 SquadPersistence** — `assets/scripts/squad/SquadPersistence.ts` 的 `loadSquad`：

```ts
// 签名加 extraCap（心法「三才阵」解锁第 3 上阵位时组合根传 1）：
export async function loadSquad(extraCap = 0): Promise<SquadModel> {
    const data = await loadPlayerData();
    return SquadModel.deserialize(data.squad, BattleConfig.squadCap + Math.max(0, Math.floor(extraCap)));
}
```

（保持函数其余部分不动；若原函数体行数不同，以「cap 表达式替换 + 参数追加」为准。）

- [ ] **Step 3: 实现 ChestModel** — `assets/scripts/chest/ChestModel.ts`：

```ts
// readonly 移除（心法「乾坤袋」解锁后由组合根改写容量；deserializeChests/addChest 读的都是实时值）：
    constructor(public maxChests = MAX_CHEST_COUNT) {}
```

- [ ] **Step 4: 跑测试**

Run: `npm run test:squad && npm run typecheck`
Expected: 全部 ✓

- [ ] **Step 5: 暂存**

```bash
git add assets/scripts/squad/SquadPersistence.ts assets/scripts/chest/ChestModel.ts tools/squad-test.ts
```

---### Task 10: BattleEntry 组合根接线

**Files:**
- Modify: `assets/scripts/BattleEntry.ts`

**Interfaces:**
- Consumes: Task 3~9 全部导出。
- Produces: `_talents`/`_talentAgg`/`_gold`/`_autoSellOn` 缓存与 `_refreshTalentCache()`；首通发残页；经验加成；自动卖白绿；各面板/服务注入值。Task 11 的 TalentPanel 挂在这些回调上。

- [ ] **Step 1: import 与字段** — `BattleEntry.ts`：

```ts
// import 区加：
import { talentAggregate, emptyTalentAggregate, type TalentAggregate } from './talent/TalentStats';
import type { TalentSave } from './talent/TalentModel';
import { firstClearPages } from './talent/TalentConfig';
import { MAX_CHEST_COUNT } from './chest/ChestModel';
import type { MaterialItem } from './services/RewardTypes';

// 字段区（_materials 附近）加：
    private _talents: TalentSave = {};
    private _talentAgg: TalentAggregate = emptyTalentAggregate();
    private _gold = 0;
    private _autoSellOn = false;
```

- [ ] **Step 2: 心法缓存刷新** — 新增私有方法（放 `_refreshMaterialsCache` 旁）：

```ts
    // 心法缓存：已点档/聚合值/金币/自动卖开关；宝箱容量按解锁扩容（须在 loadChests 之前跑）
    private async _refreshTalentCache(): Promise<void> {
        const data = await loadPlayerData();
        this._talents = { ...(data.talents ?? {}) };
        this._talentAgg = talentAggregate(this._talents);
        this._gold = data.gold ?? 0;
        this._autoSellOn = !!data.autoSellLowQuality;
        this._chests.maxChests = MAX_CHEST_COUNT + this._talentAgg.unlocks.chestCapacity;
    }
```

- [ ] **Step 3: 读档链插入** — `_loadAllPlayerData` 链改为（在 `_claimOfflineRewards` 后、`loadChests` 前插入心法刷新；`loadSquad` 传第 3 位解锁）：

```ts
    private _loadAllPlayerData(): Promise<void> {
        return loadInventory(this._inv)
            .then(() => loadProgress(this._progress))
            .then(() => this._claimOfflineRewards())
            .then(() => this._refreshTalentCache())
            .then(() => loadChests(this._chests))
            .then(() => this._refreshMaterialsCache())
            .then(() => loadSquad(this._talentAgg.unlocks.squadSlot3 ? 1 : 0))
            .then((squad) => { this._squad = squad; })
            .then(() => loadGrowth())
            .then((growth) => { this._growth = growth; })
            .then(() => { this._invView.refresh(); })
            .catch(() => {
                // 读档失败时仍允许进游戏，掉落会从空背包开始存。
            });
    }
```

- [ ] **Step 4: 战斗属性注入** — `_startBattle` 里 effective 一行改为：

```ts
        const effective = this._inv
            ? buildEffectiveStatsMap(this._inv.equipped, levels, this._talentAgg.stats)
            : buildEffectiveStatsMap(undefined, levels, this._talentAgg.stats);
```

- [ ] **Step 5: 经验加成** — `_commitBattleExp` 里 gainExp 循环改为：

```ts
        const exp = Math.round(this._battleExpGained * (1 + this._talentAgg.econ.exp));
        for (const cls of this._squad.deployedList()) {
            this._growth.gainExp(cls, exp);
        }
```

- [ ] **Step 6: 首通发残页** — `_awardVictoryDrop` 在 `this._settlementPanel.show(...)` 之前加：

```ts
        if (complete.firstClear) {
            const pages = firstClearPages(complete.completedLevel);
            if (pages > 0) {
                void this._grantTalentPages(pages);
                this._winRewardText += `；秘笈残页 +${pages}`;
            }
        }
```

新增私有方法：

```ts
    private async _grantTalentPages(count: number): Promise<void> {
        const data = await loadPlayerData();
        data.materials = data.materials ?? {};
        data.materials['talent_page'] = (data.materials['talent_page'] ?? 0) + count;
        this._materials = { ...data.materials };
        await savePlayerData();
    }
```

- [ ] **Step 7: 掉落品质注入** — `_grantDropItems` 的 generateStageReward 加 `qualityBonus`；ChestPanel 构造 options 加 `qualityBonus` 回调：

```ts
        const reward = generateStageReward({
            levelIndex,
            source: 'StageClear',
            seed: `stage-clear|${levelIndex}|${Date.now()}|${Math.random()}`,
            qualityBonus: this._talentAgg.drop.equipQuality,
        });
```

```ts
        this._chestPanel = new ChestPanel({
            // …现有 options 不动，追加一项：
            qualityBonus: () => this._talentAgg.drop.equipQuality,
```

- [ ] **Step 8: 自动卖白绿** — `_addRewardEquipments` 改为：

```ts
    private _addRewardEquipments(drops: EquipItem[]): { received: RewardEntry[]; failed: number } {
        const received: RewardEntry[] = [];
        let failed = 0;
        let autoSold = 0, autoGold = 0;
        const autoMaterials: MaterialItem[] = [];
        const autoSell = this._talentAgg.unlocks.autoSell && this._autoSellOn;

        for (const item of drops) {
            let r = this._inv.addItemToBackpack(item);
            let target = '背包';
            if (!r.ok && r.reason === '背包已满') {
                r = this._inv.addItemToWarehouse(item);
                target = '仓库';
            }
            if (r.ok && r.item) {
                if (autoSell && (r.item.quality === 'common' || r.item.quality === 'fine') && !r.item.locked) {
                    const s = this._inv.sellItem(r.item.id);
                    if (s.ok) {
                        autoSold++;
                        autoGold += s.gold ?? 0;
                        if (s.returnedMaterials) autoMaterials.push(...s.returnedMaterials);
                        continue;
                    }
                }
                received.push({ item: r.item, target });
            } else {
                failed++;
            }
        }
        if (autoSold > 0) {
            void this._commitAutoSell(autoGold, autoMaterials);
            this._offlineNoticeText = `自动出售 ${autoSold} 件白/绿装 +${autoGold} 金币`;
            this._offlineNoticeTtl = 5;
        }
        return { received, failed };
    }

    private async _commitAutoSell(gold: number, materials: MaterialItem[]): Promise<void> {
        const data = await loadPlayerData();
        data.gold = (data.gold ?? 0) + gold;
        this._gold = data.gold;
        data.materials = data.materials ?? {};
        for (const m of materials) data.materials[m.id] = (data.materials[m.id] ?? 0) + m.count;
        this._materials = { ...data.materials };
        data.inventory = this._inv.serialize();
        await savePlayerData();
    }
```

- [ ] **Step 9: 金币缓存同步** — `_handleInventoryChanged` 里 `data.gold` 更新行后加一行：

```ts
        if (payload?.gold && payload.gold > 0) data.gold = (data.gold ?? 0) + payload.gold;
        this._gold = data.gold ?? 0;
```

- [ ] **Step 10: 编译验证**

Run: `npm run typecheck && npm test`
Expected: 全绿（TalentPanel 尚未接，onTalent 未加——本任务不改 BattleStageView）

- [ ] **Step 11: 暂存**

```bash
git add assets/scripts/BattleEntry.ts
```

---

### Task 11: TalentPanel 占位面板 + HUD 入口

**Files:**
- Create: `assets/scripts/ui/panels/TalentPanel.ts`
- Modify: `assets/scripts/ui/BattleStageView.ts`（options 加 `onTalent`，NavHome 热区绑定）
- Modify: `assets/scripts/BattleEntry.ts`（构造面板 + onTalent + onDestroy）

**Interfaces:**
- Consumes: TalentConfig/TalentModel/TalentStats 全部导出、BattleEntry 的心法缓存（Task 10）。
- Produces: `TalentPanel`（`open/toggle/hide/isOpen/destroy`），options 见代码。

- [ ] **Step 1: 实现 TalentPanel** — `assets/scripts/ui/panels/TalentPanel.ts`（镜像 SquadPanel 的 Graphics+Label+热区模式）：

```ts
// 心法（全局天赋树）覆盖层：分支分列、tier 分行、前置未满灰显；点节点走 TalentModel。
// 持久化由回调注入（组合根 BattleEntry）。占位色块阶段：不画连线，靠列/行 + 灰显表达树结构。

import { Color, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { talentNodes, talentLevelCost, type TalentBranch, type TalentNodeDef } from '../../talent/TalentConfig';
import { learnNode, nodeLevel, prereqMet, type TalentSave } from '../../talent/TalentModel';
import { talentAggregate } from '../../talent/TalentStats';
import type { MaterialSave } from '../../services/RewardTypes';

interface TalentHot {
    rect: { x: number; y: number; w: number; h: number };
    act: () => void;
}

export interface TalentPanelOptions {
    host: Node;
    halfW: number;
    halfH: number;
    getTalents: () => TalentSave;        // 组合根缓存，learnNode 就地写
    getMaterials: () => MaterialSave;    // 同上
    getGold: () => number;
    getAutoSellOn: () => boolean;
    setAutoSellOn: (on: boolean) => void;
    beforeShow: () => void;
    // 点节点成功后持久化：spentGold 为本次扣减额（delta，防并发面板改金币互相覆盖）
    persist: (spentGold: number) => void;
}

const BRANCH_X: Record<TalentBranch, number> = { trunk: -352, combat: -117, economy: 117, drop: 352 };
const BRANCH_LABEL: Record<TalentBranch, string> = { trunk: '主干', combat: '战斗', economy: '经济', drop: '掉落' };

const EFFECT_LABEL: Record<string, string> = {
    hpPct: '生命', atkPct: '攻击', defPct: '防御', critRate: '暴击率', dmgBonus: '全伤害',
    skillHaste: '技能急速', basicDmgBonus: '普攻伤害',
    gold: '金币获取', exp: '经验获取', offlineRate: '离线收益',
    equipQuality: '稀有装备率',
    squadSlot3: '第3上阵位', chestCapacity: '宝箱容量', autoSell: '自动卖白绿', offlineCap: '离线时长',
};

function fmtEffect(node: TalentNodeDef, lv: number): string {
    const name = EFFECT_LABEL[node.effectKey] ?? node.effectKey;
    if (node.effectKind === 'unlock' && (node.effectKey === 'squadSlot3' || node.effectKey === 'autoSell')) {
        return lv > 0 ? `${name}（已解锁）` : name;
    }
    const v = node.valuePerLevel * Math.max(1, lv);   // 未点时展示 1 级效果
    if (node.effectKey === 'chestCapacity') return `${name} +${v}`;
    if (node.effectKey === 'offlineCap') return `${name} +${Math.round(v / 3600)}小时`;
    if (v > 0 && v < 1) return `${name} +${Math.round(v * 1000) / 10}%`;
    return `${name} +${v}`;
}

export class TalentPanel {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly labels: Label[] = [];
    private readonly hots: TalentHot[] = [];
    private message = '';

    constructor(private readonly options: TalentPanelOptions) {
        this.root = new Node('TalentView');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);

        const gfxNode = new Node('TalentGfx');
        gfxNode.layer = this.root.layer;
        gfxNode.addComponent(UITransform);
        this.gfx = gfxNode.addComponent(Graphics);
        this.root.addChild(gfxNode);
        options.host.addChild(this.root);
        this.root.active = false;
        this.root.on(Node.EventType.TOUCH_END, this.onTap, this);
    }

    isOpen(): boolean { return this.root.active; }

    toggle(): void {
        if (this.isOpen()) this.hide();
        else this.show();
    }

    show(): void {
        this.options.beforeShow();
        this.message = '';
        this.root.active = true;
        this.root.setSiblingIndex(this.options.host.children.length - 1);
        this.render();
    }

    hide(): void { this.root.active = false; }

    destroy(): void {
        this.root.off(Node.EventType.TOUCH_END, this.onTap, this);
    }

    private labelAt(i: number): Label {
        while (i >= this.labels.length) {
            const node = new Node('TalentLbl');
            node.layer = this.root.layer;
            node.addComponent(UITransform);
            const label = node.addComponent(Label);
            this.root.addChild(node);
            this.labels.push(label);
        }
        return this.labels[i];
    }

    private render(): void {
        const g = this.gfx;
        g.clear();
        this.hots.length = 0;
        for (const label of this.labels) label.node.active = false;
        let li = 0;
        const label = (text: string, x: number, y: number, size = 20, color?: Color) => {
            const item = this.labelAt(li++);
            item.node.active = true;
            item.string = text;
            item.fontSize = size;
            if (color) item.color = color;
            else item.color = new Color(235, 235, 240, 255);
            item.node.setPosition(x, y, 0);
        };

        g.fillColor = new Color(18, 22, 28, 235);
        g.rect(-this.options.halfW, -this.options.halfH, this.options.halfW * 2, this.options.halfH * 2);
        g.fill();

        const save = this.options.getTalents();
        const mats = this.options.getMaterials();
        const gold = this.options.getGold();
        label(`心法  金币 ${gold}  秘笈残页 ${mats['talent_page'] ?? 0}`, 0, 640, 28, new Color(255, 226, 126));
        label('前置点满解锁后继；小节点花金币，大节点另需残页（关卡首通获得）', 0, 600, 16, new Color(170, 178, 194));

        // 分支列头
        for (const b of Object.keys(BRANCH_X) as TalentBranch[]) {
            label(BRANCH_LABEL[b], BRANCH_X[b], 555, 22, new Color(200, 210, 230, 255));
        }

        // 节点网格：列=branch，行=tier
        const w = 208, h = 84;
        for (const node of talentNodes()) {
            const x = BRANCH_X[node.branch] - w / 2;
            const y = 520 - node.tier * 100;
            const lv = nodeLevel(save, node.id);
            const maxed = lv >= node.maxLevel;
            const unlocked = prereqMet(node, save);
            g.fillColor = maxed ? new Color(146, 116, 44, 255)
                : unlocked ? new Color(52, 74, 104, 255)
                : new Color(44, 48, 56, 255);
            g.roundRect(x, y - h / 2, w, h, 10);
            g.fill();
            const textColor = unlocked || maxed ? undefined : new Color(120, 126, 138, 255);
            label(`${node.label}  ${lv}/${node.maxLevel}`, x + w / 2, y + 16, 20, textColor);
            if (maxed) {
                label(fmtEffect(node, lv), x + w / 2, y - 14, 15, new Color(255, 226, 126, 255));
            } else {
                const cost = talentLevelCost(node, lv + 1);
                const costText = cost.pages > 0 ? `${cost.gold}金 ${cost.pages}页` : `${cost.gold}金`;
                label(`${fmtEffect(node, lv)} · ${costText}`, x + w / 2, y - 14, 14, textColor);
                this.hots.push({ rect: { x, y: y - h / 2, w, h }, act: () => this.learn(node.id) });
            }
        }

        // 自动卖开关（「拂尘」解锁后出现）
        const agg = talentAggregate(save);
        if (agg.unlocks.autoSell) {
            const on = this.options.getAutoSellOn();
            g.fillColor = on ? new Color(64, 110, 74, 255) : new Color(70, 74, 84, 255);
            g.roundRect(-210, -608, 420, 56, 10);
            g.fill();
            label(`自动出售白/绿装：${on ? '开' : '关'}（点击切换）`, 0, -580, 20);
            this.hots.push({ rect: { x: -210, y: -608, w: 420, h: 56 }, act: () => { this.options.setAutoSellOn(!on); this.render(); } });
        }

        if (this.message) label(this.message, 0, -650, 18, new Color(255, 160, 140, 255));

        g.fillColor = new Color(120, 60, 60, 255);
        g.roundRect(-90, -730, 180, 60, 12);
        g.fill();
        label('关闭', 0, -700, 24);
        this.hots.push({ rect: { x: -90, y: -730, w: 180, h: 60 }, act: () => this.hide() });
    }

    private learn(nodeId: string): void {
        const wallet = { gold: this.options.getGold() };
        const r = learnNode(this.options.getTalents(), nodeId, wallet, this.options.getMaterials());
        if (r.ok) {
            this.message = '';
            this.options.persist(r.spentGold ?? 0);
        } else {
            this.message = r.reason ?? '无法修炼';
        }
        this.render();
    }

    private onTap(e: EventTouch): void {
        const ui = e.getUILocation();
        const p = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        for (const hot of this.hots) {
            const rect = hot.rect;
            if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) {
                hot.act();
                return;
            }
        }
    }
}
```

- [ ] **Step 2: BattleStageView 入口** — `assets/scripts/ui/BattleStageView.ts`：

options 接口（含 `onHeroes/onInventory/onCraft/onChests` 的那个）加：

```ts
    onTalent: () => void;
```

热区绑定处把 NavHome 从 noop 改为：

```ts
        this.makeHotZone('NavHomeHot', UI_RECTS.navHome, options.onTalent, 'BottomNav');
```

- [ ] **Step 3: BattleEntry 挂面板** — `assets/scripts/BattleEntry.ts`：

```ts
// import 区加：
import { TalentPanel } from './ui/panels/TalentPanel';
import { loadSquad } from './squad/SquadPersistence';   // 已 import，无需重复
// 字段区加：
    private _talentPanel: TalentPanel = null!;
```

`_stageView` 构造 options 加一行：

```ts
            onTalent: () => { void this._refreshTalentCache().then(() => this._talentPanel.toggle()); },
```

`_inlayPanel` 构造之后加：

```ts
        this._talentPanel = new TalentPanel({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            getTalents: () => this._talents,
            getMaterials: () => this._materials,
            getGold: () => this._gold,
            getAutoSellOn: () => this._autoSellOn,
            setAutoSellOn: (on) => { void this._persistAutoSell(on); },
            beforeShow: () => {
                this._settlementPanel.hide();
                this._chestPanel.hide();
                this._craftPanel.hide();
                this._squadPanel.hide();
            },
            persist: (spentGold) => { void this._persistTalents(spentGold); },
        });
```

新增两个私有方法（`_refreshTalentCache` 旁）：

```ts
    // 点节点后落盘：金币按 delta 扣（防与卖装/离线并发覆盖）；聚合值重算并即时应用容量/上阵位
    private async _persistTalents(spentGold: number): Promise<void> {
        const data = await loadPlayerData();
        data.gold = Math.max(0, (data.gold ?? 0) - spentGold);
        this._gold = data.gold;
        data.talents = { ...this._talents };
        data.materials = { ...this._materials };
        const hadSquad3 = this._talentAgg.unlocks.squadSlot3;
        this._talentAgg = talentAggregate(this._talents);
        this._chests.maxChests = MAX_CHEST_COUNT + this._talentAgg.unlocks.chestCapacity;
        await savePlayerData();
        if (!hadSquad3 && this._talentAgg.unlocks.squadSlot3) {
            this._squad = await loadSquad(1);   // 第 3 位解锁：按新 cap 重灌小队（保留已上阵）
        }
    }

    private async _persistAutoSell(on: boolean): Promise<void> {
        const data = await loadPlayerData();
        data.autoSellLowQuality = on;
        this._autoSellOn = on;
        await savePlayerData();
    }
```

`onDestroy` 加：

```ts
        this._talentPanel?.destroy();
```

- [ ] **Step 4: 编译与全量回归**

Run: `npm run typecheck && npm test`
Expected: 全绿

- [ ] **Step 5: 暂存**

```bash
git add assets/scripts/ui/panels/TalentPanel.ts assets/scripts/ui/BattleStageView.ts assets/scripts/BattleEntry.ts
```

---

### Task 12: 终验与收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-07-12-talent-tree-design.md`（偏差回写）
- Modify: `ai/memory/代码地图.md`、`ai/memory/项目状态.md`（按 `ai/skills/开发收尾.md`）

- [ ] **Step 1: 全量门禁**

Run: `npm run verify`
Expected: typecheck 两套 + 全部测试（含新 talent）+ balance:check + sim:pacing 13 门槛 + check:art + check:ui-alpha 全绿。

- [ ] **Step 2: 推进模拟不回归**

Run: `npm run sim:progress`
Expected: 与基线一致（心法默认未点，不影响 20 虚拟玩家链路）。

- [ ] **Step 3: spec 偏差回写** — 在 spec 文档末尾加「实施偏差」小节，至少记录：
  - 自动卖开关放在 TalentPanel 内而非背包面板（实现更简单、发现路径就在解锁处）；
  - 心法入口用 HUD `NavHomeHot`（原 noop 热区）；
  - econ.gold 现阶段只作用于离线金币（在线胜利暂无金币产出，未来加入自动吃到）；
  - 其余实现中发现的偏差照实补。

- [ ] **Step 4: 记忆文件收尾** — 按 `ai/skills/开发收尾.md`：`代码地图.md` 加 `talent/` 模块章节与消费方改动注记；`项目状态.md` 顶部「最近进展」加心法条目。

- [ ] **Step 5: 暂存（不提交）**

```bash
git add docs/superpowers/specs/2026-07-12-talent-tree-design.md ai/memory/代码地图.md ai/memory/项目状态.md
git status --short
```

- [ ] **Step 6: 人工验收清单（Cocos 预览，交用户）** — 开面板（HUD 左下 Home 键）→ 点 trunk_1 金币减、下一场战斗生命面板涨 → 打第 1 关首通得 1 残页（结算文案）→ 重打不再给 → 点满一条链后解锁大节点 → 乾坤袋后宝箱容量 50 → 拂尘后开关出现、开着打一局白绿装自动卖 → 三才阵后上阵面板可上 3 人 → 切账号心法互相隔离。

---

## Self-Review 记录

- **Spec 覆盖**：①配置（Task 2）②材料/首通（Task 1/5/10）③存档/操作（Task 3/8-Step5）④消费方六处（Task 6/7/8/9/10）⑤UI（Task 11）⑥树骨架（Task 2 种子 24 节点）⑦门禁（Task 12）。spec「背包开关」改为面板内开关——已列入偏差回写。
- **占位扫描**：无 TBD；ChestPanel/SquadPersistence 两处以「定位说明+完整替换代码」给出（原文件行号可能漂移，以符号定位为准）。
- **类型一致性**：`TalentSave`/`TalentAggregate`/`TalentLearnResult`/`talentLevelCost` 签名在 Task 3/4 定义、Task 8/10/11 消费，名称已逐一核对；`firstClearPages` 既是配置函数名（TalentConfig）也是 xlsx 列语义，消费方只 import 函数。
