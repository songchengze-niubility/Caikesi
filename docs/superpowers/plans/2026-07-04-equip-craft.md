# 装备等级 + 材料合成系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给装备加一个与品质独立叠乘的"等级"维度（所有来源装备都带等级），并新建一个用材料（打造石/宝石碎片/铭文粉尘）合成装备的系统，让宝箱产出的材料第一次有消耗出口。

**Architecture:** 沿用项目现有的「Excel 数值 → `npm run config` 生成产物 → 纯逻辑计算层 → Cocos 胶水/UI」链路。装备等级系数并入 `EquipConfig.calcEquipItemStats`；掉落等级区间并入 `drop.xlsx`/`DropConfig`（宝箱开箱复用同一路径，无需单独改）；合成新增独立的 `craft.xlsx` → `CraftConfig.ts` → `craft/CraftService.ts`（纯逻辑）→ `BattleEntry.ts` 里新增一个 `CraftView` �covers 层（结构照抄现有 `ChestView` 的 Graphics 面板模式）。

**Tech Stack:** TypeScript、Cocos Creator 3.8.8（`cc` 模块）、`xlsx` 包读写 Excel、`tsx` 跑纯逻辑单测（无框架，`node:assert/strict`）。

## Global Constraints

- 装备不做强化：已生成的 `EquipItem.stats` 终身不变，本功能只影响**新生成**装备的属性计算。
- 装备等级与品质**独立叠乘**：`最终属性 = 部位基础 × 品质倍率 × 等级系数 × roll`。
- 掉落/宝箱装备的等级**暂不接关卡**，先用 `drop.xlsx` 里每个 `dropGroup` 的固定区间随机（`level_1: 1-10`，`level_2: 6-15`）。
- 合成：玩家选部位 + 档位（3 档，`tier_1`/`tier_2`/`tier_3`），品质按档位权重表随机；材料够就一定产出装备，不存在"失败不出货"。
- 材料不足 / 背包仓库空间不足 → 不消耗任何材料，不留半成品。
- 所有新数值（等级系数、掉落等级区间、合成档位材料成本/品质权重）必须走 Excel（`tools/config-xlsx/*.xlsx` → `npm run config`），不得硬编码在 TS 里。
- 新增/修改的公共函数默认参数必须保持**向后兼容**：已有调用点（尤其是测试文件）在不传新参数时行为不变（新参数追加在参数列表末尾，给默认值）。
- 纯逻辑层（`config/`、`craft/CraftService.ts`、`inventory/EquipDefs.ts`、`config/DropConfig.ts`）不得 `import` 任何 `cc` 模块，必须可被 `tsx` 直接单测。
- UI 新增面板复用 `BattleEntry.ts` 里 `ChestView` 的 Graphics 手绘面板模式（新建 Node + Graphics + Label 池 + 热区数组 + touch 事件），不引入新的 UI 框架/组件库。
- 不新增美术资源：合成入口复用底部导航栏当前是 `noop` 的 `NavSectHot` 热区。

---

## 前置说明（给实施者）

本仓库的纯逻辑测试**不是** Jest/Vitest，是手写的小测试跑者：每个 `tools/*-test.ts` 文件内部有

```ts
let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}
```

用 `npx tsx tools/xxx-test.ts` 直接跑（或 `npm run test:xxx`），失败会在 stdout 里打 `✗`，脚本以非零码退出（`process.exit(fail ? 1 : 0)`）。**判断测试是否通过看输出里有没有 `✗`，不要只看 exit code 之外的东西。**

Excel 相关文件是**生成产物**（`*.config.generated.ts`），永远不要手改，只能改 `tools/config-xlsx/*.xlsx`（或对应 `tools/seed-*.ts` 种子脚本）后跑 `npm run config` 重新生成。

---

### Task 1: 装备等级字段 + 等级属性缩放公式

**Files:**
- Modify: `tools/seed-equip-xlsx.ts`（加 `LevelScaling` sheet）
- Modify: `tools/excel-to-config.ts`（`buildEquipConfig` 解析新 sheet）
- Modify: `assets/scripts/config/EquipConfig.ts`（等级系数计算，`calcEquipItemStats` 加 `level` 参数）
- Modify: `assets/scripts/inventory/EquipDefs.ts`（`EquipItem.level` 字段、`createEquipItem`/`ensureEquipItemStats` 支持等级）
- Test: `tools/effective-stats-test.ts`（新增等级缩放断言）
- Test: `tools/inventory-test.ts`（新增老存档缺 `level` 兜底断言）

**Interfaces:**
- Consumes：无（本任务是地基）
- Produces：
  - `EquipItem.level?: number`（`inventory/EquipDefs.ts`）
  - `createEquipItem(slot: EquipSlot, quality: Quality, rng?: () => number, level?: number): EquipItem`（`level` 默认 `1`，**追加在末尾**，不影响任何现有 3 参调用）
  - `calcEquipItemStats(slot: EquipSlot, quality: Quality, rng?: () => number, level?: number): EquipStats`（`level` 默认 `1`，同样追加在末尾）
  - `ensureEquipItemStats(item: EquipItem): EquipItem`（现在同时兜底 `level`）
  - `EquipConfig.levelScaling: { growthPerLevel: number; maxLevel: number }`

- [ ] **Step 1: 给 `equip.xlsx` 种子脚本加 `LevelScaling` sheet**

编辑 `tools/seed-equip-xlsx.ts`，在 `AFFIXES_ROWS` 定义之后、`const wb = XLSX.utils.book_new();` 之前插入：

```ts
// 装备等级 → 属性系数：levelCoefficient = 1 + (level-1) × growthPerLevel。
const LEVEL_SCALING_HEADER = ['key', 'value'];
const LEVEL_SCALING_ROWS: (string | number)[][] = [
    ['growthPerLevel', 0.03],
    ['maxLevel', 30],
];
```

并在 `addSheet('Affixes', AFFIXES_HEADER, AFFIXES_ROWS);` 之后加一行：

```ts
addSheet('LevelScaling', LEVEL_SCALING_HEADER, LEVEL_SCALING_ROWS);
```

最后一行 `console.log` 的 sheets 摘要也加上：

```ts
console.log(`  sheets: Qualities(${QUALITIES_ROWS.length}) SlotBonuses(${SLOT_BONUSES_ROWS.length}) Affixes(${AFFIXES_ROWS.length}) LevelScaling(${LEVEL_SCALING_ROWS.length})`);
```

（这行是替换原有的最后一行 `console.log`，不是新增一行。）

- [ ] **Step 2: 重新生成 `equip.xlsx` 并跑一次导表确认当前会报错（缺 sheet 解析）**

```bash
npx tsx tools/seed-equip-xlsx.ts
```

Expected: 输出 `✓ 已生成 .../equip.xlsx`，sheets 摘要包含 `LevelScaling(2)`。

此时先**不要**跑 `npm run config`——`buildEquipConfig` 还不认识 `LevelScaling` sheet，跑了也不会报错但也不会用上新 sheet，Step 3 改完解析器后再跑。

- [ ] **Step 3: `excel-to-config.ts` 的 `buildEquipConfig` 解析 `LevelScaling` sheet**

打开 `tools/excel-to-config.ts`，找到 `buildEquipConfig` 函数体内 `Affixes` 解析结束、`const config = { qualities, slotBonuses, affixes };` 那一行（约第 379-382 行），在它之前插入：

```ts
    const { rows: levelScalingRows } = sheetToRows(wb, 'LevelScaling');
    const levelScaling: Record<string, number> = {};
    const levelScalingKeys = new Set<string>();
    for (const r of levelScalingRows) {
        const key = reqStr(r['key'], 'LevelScaling.key');
        if (levelScalingKeys.has(key)) err(`LevelScaling: key "${key}" 重复定义`);
        levelScalingKeys.add(key);
        levelScaling[key] = reqNum(r['value'], `LevelScaling[${key}].value`);
    }
    const LEVEL_SCALING_REQUIRED = ['growthPerLevel', 'maxLevel'];
    for (const k of LEVEL_SCALING_REQUIRED) if (!levelScalingKeys.has(k)) err(`LevelScaling: 缺少必填 key "${k}"`);
    if ((levelScaling.growthPerLevel ?? 0) < 0) warn(`LevelScaling.growthPerLevel = ${levelScaling.growthPerLevel} 为负`);
    if ((levelScaling.maxLevel ?? 0) < 1) err(`LevelScaling.maxLevel = ${levelScaling.maxLevel} 必须 >= 1`);
```

然后把原来的：

```ts
    const config = { qualities, slotBonuses, affixes };
    const summary = `qualities=${Object.keys(qualities).length} slots=${Object.keys(slotBonuses).length} bonuses=${bonusCount} affixes=${affixes.length}`;
    return { config, summary };
```

替换为：

```ts
    const config = {
        qualities,
        slotBonuses,
        affixes,
        levelScaling: {
            growthPerLevel: levelScaling.growthPerLevel,
            maxLevel: levelScaling.maxLevel,
        },
    };
    const summary = `qualities=${Object.keys(qualities).length} slots=${Object.keys(slotBonuses).length} bonuses=${bonusCount} affixes=${affixes.length} maxLevel=${levelScaling.maxLevel}`;
    return { config, summary };
```

- [ ] **Step 4: 跑导表，确认 equip 模块生成成功且带 `levelScaling`**

```bash
npm run config
```

Expected: 控制台里 `[equip]` 那一段打印 `✓ ... 已生成 .../equip.config.generated.ts`，摘要含 `maxLevel=30`，且没有 `[equip]` 的 `❌` 报错块。（其余模块 battle/drop/chest/offline 此时应仍照常成功，因为还没碰它们。）

打开生成的 `assets/scripts/config/equip.config.generated.ts`，确认里面 `JSON` 有 `"levelScaling": { "growthPerLevel": 0.03, "maxLevel": 30 }` 字段。

- [ ] **Step 5: `EquipConfig.ts` 加等级系数计算与新签名**

打开 `assets/scripts/config/EquipConfig.ts`，把：

```ts
export interface EquipConfigShape {
    qualities: Record<Quality, EquipQualityConfig>;
    slotBonuses: Record<EquipSlot, EquipStats>;
    affixes: EquipAffixConfig[];
}
```

替换为：

```ts
export interface EquipLevelScalingConfig {
    growthPerLevel: number;
    maxLevel: number;
}

export interface EquipConfigShape {
    qualities: Record<Quality, EquipQualityConfig>;
    slotBonuses: Record<EquipSlot, EquipStats>;
    affixes: EquipAffixConfig[];
    levelScaling: EquipLevelScalingConfig;
}
```

然后把整个 `calcEquipItemStats` 函数（含它上面的 `rollBetween`/`addStat` 之后的部分）：

```ts
export function calcEquipItemStats(slot: EquipSlot, quality: Quality, rng: () => number = Math.random): EquipStats {
    const base = EquipConfig.slotBonuses[slot] ?? {};
    const q = EquipConfig.qualities[quality];
    const mul = q?.multiplier ?? 1;
    const rollMin = q?.rollMin ?? 1;
    const rollMax = q?.rollMax ?? 1;
    const out: EquipStats = {};
    for (const k of Object.keys(base) as EquipStatKey[]) {
        const v = base[k] ?? 0;
        addStat(out, k, v * mul * rollBetween(rollMin, rollMax, rng));
    }
    const pool = (EquipConfig.affixes ?? []).filter(a => base[a.stat] === undefined);
    const used: Partial<Record<EquipStatKey, boolean>> = {};
    const count = Math.min(Math.floor(q?.extraStats ?? 0), pool.length);
    for (let i = 0; i < count; i++) {
        let pick = Math.floor(rng() * pool.length);
        for (let guard = 0; guard < pool.length && used[pool[pick].stat]; guard++) {
            pick = (pick + 1) % pool.length;
        }
        const affix = pool[pick];
        used[affix.stat] = true;
        addStat(out, affix.stat, affix.value * mul * rollBetween(rollMin, rollMax, rng));
    }
    return out;
}
```

替换为（新增 `levelCoefficient`/`clampEquipLevel`，并把等级系数乘进两处 `addStat` 调用）：

```ts
export function levelCoefficient(level: number): number {
    const growth = EquipConfig.levelScaling?.growthPerLevel ?? 0;
    const clamped = Math.max(1, Math.floor(level));
    return 1 + (clamped - 1) * growth;
}

export function clampEquipLevel(level: number): number {
    const max = EquipConfig.levelScaling?.maxLevel ?? 30;
    return Math.max(1, Math.min(max, Math.floor(level)));
}

export function calcEquipItemStats(
    slot: EquipSlot,
    quality: Quality,
    rng: () => number = Math.random,
    level = 1,
): EquipStats {
    const base = EquipConfig.slotBonuses[slot] ?? {};
    const q = EquipConfig.qualities[quality];
    const mul = q?.multiplier ?? 1;
    const rollMin = q?.rollMin ?? 1;
    const rollMax = q?.rollMax ?? 1;
    const lvlCoef = levelCoefficient(level);
    const out: EquipStats = {};
    for (const k of Object.keys(base) as EquipStatKey[]) {
        const v = base[k] ?? 0;
        addStat(out, k, v * mul * lvlCoef * rollBetween(rollMin, rollMax, rng));
    }
    const pool = (EquipConfig.affixes ?? []).filter(a => base[a.stat] === undefined);
    const used: Partial<Record<EquipStatKey, boolean>> = {};
    const count = Math.min(Math.floor(q?.extraStats ?? 0), pool.length);
    for (let i = 0; i < count; i++) {
        let pick = Math.floor(rng() * pool.length);
        for (let guard = 0; guard < pool.length && used[pool[pick].stat]; guard++) {
            pick = (pick + 1) % pool.length;
        }
        const affix = pool[pick];
        used[affix.stat] = true;
        addStat(out, affix.stat, affix.value * mul * lvlCoef * rollBetween(rollMin, rollMax, rng));
    }
    return out;
}
```

- [ ] **Step 6: `EquipDefs.ts` 加 `level` 字段并更新 `createEquipItem`/`ensureEquipItemStats`**

打开 `assets/scripts/inventory/EquipDefs.ts`，把 `EquipItem` 接口：

```ts
export interface EquipItem {
    id: string;        // 实例唯一 id
    slot: EquipSlot;   // 部位
    name: string;      // 占位名
    quality: Quality;  // 品质
    stats?: EquipStats; // 属性加成；读老存档时会补齐
    locked?: boolean;  // 锁定后不可出售；老存档缺字段按未锁处理
}
```

替换为：

```ts
export interface EquipItem {
    id: string;        // 实例唯一 id
    slot: EquipSlot;   // 部位
    name: string;      // 占位名
    quality: Quality;  // 品质
    level?: number;     // 装备等级；与品质独立叠乘，读老存档时按 1 补齐
    stats?: EquipStats; // 属性加成；读老存档时会补齐
    locked?: boolean;  // 锁定后不可出售；老存档缺字段按未锁处理
}
```

然后把：

```ts
export function ensureEquipItemStats(item: EquipItem): EquipItem {
    if (hasStats(item.stats)) return item;
    const seed = seedFromString(`${item.id}|${item.slot}|${item.quality}|${item.name}`);
    return { ...item, stats: calcEquipItemStats(item.slot, item.quality, seededRng(seed)) };
}
```

替换为：

```ts
export function ensureEquipItemStats(item: EquipItem): EquipItem {
    const level = item.level ?? 1;
    if (hasStats(item.stats)) {
        return item.level === level ? item : { ...item, level };
    }
    const seed = seedFromString(`${item.id}|${item.slot}|${item.quality}|${item.name}`);
    return { ...item, level, stats: calcEquipItemStats(item.slot, item.quality, seededRng(seed), level) };
}
```

然后把：

```ts
export function createEquipItem(slot: EquipSlot, quality: Quality, rng: () => number = Math.random): EquipItem {
    const name = pick(NAME_POOL[slot], rng);
    return { id: makeId(), slot, name, quality, stats: calcEquipItemStats(slot, quality, rng) };
}
```

替换为：

```ts
export function createEquipItem(
    slot: EquipSlot,
    quality: Quality,
    rng: () => number = Math.random,
    level = 1,
): EquipItem {
    const name = pick(NAME_POOL[slot], rng);
    return { id: makeId(), slot, name, quality, level, stats: calcEquipItemStats(slot, quality, rng, level) };
}
```

`randomItem` 函数不用改（它调用 `createEquipItem(pick(SLOTS, rng), pick(QUALITIES, rng), rng)`，`level` 走默认值 1，调试用途足够）。

- [ ] **Step 7: 补测试 —— 等级系数生效**

打开 `tools/effective-stats-test.ts`，在这一段之后：

```ts
test('calcEquipItemStats：同部位同品质也会因 roll/附加词条不同而不同', () => {
    const low = calcEquipItemStats('weapon', 'epic', () => 0.1);
    const high = calcEquipItemStats('weapon', 'epic', () => 0.9);
    assert.notDeepEqual(low, high);
    assert.ok(Object.keys(low).length >= 4, '史诗至少有基础属性 + 2 条附加词条');
    assert.ok(Object.keys(high).length >= 4, '史诗至少有基础属性 + 2 条附加词条');
});
```

插入新测试：

```ts
test('calcEquipItemStats：等级系数与品质倍率独立叠乘，不传 level 时等价于 1 级', () => {
    const noLevelArg = calcEquipItemStats('weapon', 'common', () => 0.5);
    const lvl1 = calcEquipItemStats('weapon', 'common', () => 0.5, 1);
    const lvl30 = calcEquipItemStats('weapon', 'common', () => 0.5, 30);
    assert.equal(noLevelArg.atk, lvl1.atk, '不传 level 应等价于 1 级');
    assert.equal(lvl1.atk, 12);   // 12(基础) × 1.0(普通品质) × 1.0(1级系数) × 1.0(roll中值)
    assert.equal(lvl30.atk, 22);  // 12 × 1.0 × 1.87(1+29×0.03) × 1.0 = 22.44 → 四舍五入
    assert.ok(lvl30.atk > lvl1.atk, '等级系数应让高等级装备属性更高');
});
```

- [ ] **Step 8: 补测试 —— 老存档缺 `level` 按 1 兜底**

打开 `tools/inventory-test.ts`，在这个测试块之后：

```ts
test('deserialize：老存档装备缺 stats 时自动补属性', () => {
    ...
    assert.ok(m.equipped.tank.helmet?.stats && Object.keys(m.equipped.tank.helmet.stats).length > 0, '已穿旧装备未补 stats');
});
```

（即紧接在它结尾的 `});` 之后、`console.log` 之前）插入：

```ts
test('deserialize：老存档装备缺 level 时按 1 补齐（不管是否已有 stats）', () => {
    const m = new InventoryModel();
    m.deserialize({
        backpack: [
            { id: 'no-level-no-stats', slot: 'helmet', name: '头巾', quality: 'rare' },
            { id: 'no-level-has-stats', slot: 'weapon', name: '铁剑', quality: 'common', stats: { atk: 5 } },
        ],
        warehouse: [],
        equipped: {
            tank: Object.fromEntries(SLOTS.map(s => [s, null])) as any,
            dps: Object.fromEntries(SLOTS.map(s => [s, null])) as any,
            healer: Object.fromEntries(SLOTS.map(s => [s, null])) as any,
        },
    });
    assert.equal(m.backpack[0].level, 1, '缺 stats 也缺 level 的老装备应按 1 补齐');
    assert.equal(m.backpack[1].level, 1, '已有 stats 但缺 level 的老装备应按 1 补齐');
    assert.deepEqual(m.backpack[1].stats, { atk: 5 }, '已有 stats 的老装备不应被重新计算覆盖');
});
```

- [ ] **Step 9: 跑受影响的测试，确认全绿**

```bash
npm run test:effective
npm run test:inventory
```

Expected: 两个命令输出末尾都是 `... 测试：N 通过，0 失败`，过程中没有任何 `✗` 行。

- [ ] **Step 10: 提交**

```bash
git add tools/seed-equip-xlsx.ts tools/excel-to-config.ts tools/config-xlsx/equip.xlsx assets/scripts/config/EquipConfig.ts assets/scripts/config/equip.config.generated.ts assets/scripts/inventory/EquipDefs.ts tools/effective-stats-test.ts tools/inventory-test.ts
git commit -m "$(cat <<'EOF'
feat(equip): 装备新增等级维度，与品质独立叠乘

equip.xlsx 新增 LevelScaling 表（growthPerLevel/maxLevel），
calcEquipItemStats/createEquipItem 追加可选 level 参数（默认 1，
不影响现有调用），EquipItem 新增 level 字段，老存档按 1 兜底。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 掉落/宝箱装备的等级区间

**Files:**
- Modify: `tools/seed-drop-xlsx.ts`（`DropGroups` 加 `levelMin`/`levelMax` 列）
- Modify: `tools/excel-to-config.ts`（`buildDropConfig` 解析新列）
- Modify: `assets/scripts/config/DropConfig.ts`（`rollDropItems` 随机等级并传给 `createEquipItem`）
- Test: `tools/drop-config-test.ts`（新增等级区间断言）

**Interfaces:**
- Consumes：Task 1 的 `createEquipItem(slot, quality, rng, level)`
- Produces：`DropGroupConfig.levelMin`/`levelMax`；`rollDropItems` 产出的每件 `EquipItem` 都带落在 `[levelMin, levelMax]` 内的 `level`

- [ ] **Step 1: `drop.xlsx` 种子脚本加等级区间列**

打开 `tools/seed-drop-xlsx.ts`，把：

```ts
const DROP_GROUPS_HEADER = ['group', 'itemCount', 'qualityGroup', 'slotGroup'];
const DROP_GROUPS_ROWS: (string | number)[][] = [
    ['level_1', 1, 'level_1', 'any'],
    ['level_2', 1, 'level_2', 'any'],
];
```

替换为：

```ts
const DROP_GROUPS_HEADER = ['group', 'itemCount', 'qualityGroup', 'slotGroup', 'levelMin', 'levelMax'];
const DROP_GROUPS_ROWS: (string | number)[][] = [
    ['level_1', 1, 'level_1', 'any', 1, 10],
    ['level_2', 1, 'level_2', 'any', 6, 15],
];
```

- [ ] **Step 2: 重新生成 `drop.xlsx`**

```bash
npx tsx tools/seed-drop-xlsx.ts
```

Expected: 输出 `✓ 已生成 .../drop.xlsx`。

- [ ] **Step 3: `excel-to-config.ts` 的 `buildDropConfig` 解析等级区间**

打开 `tools/excel-to-config.ts`，把 `buildDropConfig` 里的：

```ts
    const { rows: groupRows } = sheetToRows(wb, 'DropGroups');
    const groupDefs: Record<string, { itemCount: number; qualityGroup: string; slotGroup: string }> = {};
    for (const r of groupRows) {
        const group = reqStr(r['group'], 'DropGroups.group');
        if (groupDefs[group]) err(`DropGroups: group "${group}" 重复定义`);
        const itemCount = reqNum(r['itemCount'], `DropGroups[${group}].itemCount`);
        if (itemCount < 1) warn(`DropGroups[${group}].itemCount = ${itemCount}（胜利奖励通常应 ≥ 1）`);
        groupDefs[group] = {
            itemCount,
            qualityGroup: reqStr(r['qualityGroup'], `DropGroups[${group}].qualityGroup`),
            slotGroup: reqStr(r['slotGroup'], `DropGroups[${group}].slotGroup`),
        };
    }
```

替换为：

```ts
    const { rows: groupRows } = sheetToRows(wb, 'DropGroups');
    const groupDefs: Record<string, { itemCount: number; qualityGroup: string; slotGroup: string; levelMin: number; levelMax: number }> = {};
    for (const r of groupRows) {
        const group = reqStr(r['group'], 'DropGroups.group');
        if (groupDefs[group]) err(`DropGroups: group "${group}" 重复定义`);
        const itemCount = reqNum(r['itemCount'], `DropGroups[${group}].itemCount`);
        if (itemCount < 1) warn(`DropGroups[${group}].itemCount = ${itemCount}（胜利奖励通常应 ≥ 1）`);
        const levelMin = reqNum(r['levelMin'], `DropGroups[${group}].levelMin`);
        const levelMax = reqNum(r['levelMax'], `DropGroups[${group}].levelMax`);
        if (levelMin < 1) err(`DropGroups[${group}].levelMin 必须 >= 1`);
        if (levelMax < levelMin) err(`DropGroups[${group}]: levelMax 必须 >= levelMin`);
        groupDefs[group] = {
            itemCount,
            qualityGroup: reqStr(r['qualityGroup'], `DropGroups[${group}].qualityGroup`),
            slotGroup: reqStr(r['slotGroup'], `DropGroups[${group}].slotGroup`),
            levelMin,
            levelMax,
        };
    }
```

然后把（同一函数末尾附近）：

```ts
    const groups: Record<string, unknown> = {};
    for (const [group, def] of Object.entries(groupDefs)) {
        groups[group] = {
            itemCount: def.itemCount,
            qualityWeights: completeWeights('QualityWeights', def.qualityGroup, VALID_QUALITIES, qualityWeightGroups),
            slotWeights: completeWeights('SlotWeights', def.slotGroup, VALID_SLOTS, slotWeightGroups),
        };
    }
```

替换为：

```ts
    const groups: Record<string, unknown> = {};
    for (const [group, def] of Object.entries(groupDefs)) {
        groups[group] = {
            itemCount: def.itemCount,
            levelMin: def.levelMin,
            levelMax: def.levelMax,
            qualityWeights: completeWeights('QualityWeights', def.qualityGroup, VALID_QUALITIES, qualityWeightGroups),
            slotWeights: completeWeights('SlotWeights', def.slotGroup, VALID_SLOTS, slotWeightGroups),
        };
    }
```

- [ ] **Step 4: 跑导表确认成功**

```bash
npm run config
```

Expected: `[drop]` 段打印 `✓ ... 已生成 .../drop.config.generated.ts`，无 `❌`。打开生成文件确认 `groups.level_1` 里有 `"levelMin": 1, "levelMax": 10`，`groups.level_2` 有 `"levelMin": 6, "levelMax": 15`。

- [ ] **Step 5: `DropConfig.ts` 随机等级并传给 `createEquipItem`**

打开 `assets/scripts/config/DropConfig.ts`，把：

```ts
export interface DropGroupConfig {
    itemCount: number;
    qualityWeights: Record<Quality, number>;
    slotWeights: Record<EquipSlot, number>;
}
```

替换为：

```ts
export interface DropGroupConfig {
    itemCount: number;
    levelMin: number;
    levelMax: number;
    qualityWeights: Record<Quality, number>;
    slotWeights: Record<EquipSlot, number>;
}
```

然后把：

```ts
export function rollDropItems(groupId: string, rng: () => number = Math.random): EquipItem[] {
    const group = getDropGroup(groupId);
    const count = Math.max(0, Math.floor(group.itemCount));
    const items: EquipItem[] = [];
    for (let i = 0; i < count; i++) {
        const slot = pickWeighted(SLOTS, group.slotWeights, rng);
        const quality = pickWeighted(QUALITIES, group.qualityWeights, rng);
        items.push(createEquipItem(slot, quality, rng));
    }
    return items;
}
```

替换为：

```ts
export function rollDropItems(groupId: string, rng: () => number = Math.random): EquipItem[] {
    const group = getDropGroup(groupId);
    const count = Math.max(0, Math.floor(group.itemCount));
    const items: EquipItem[] = [];
    for (let i = 0; i < count; i++) {
        const slot = pickWeighted(SLOTS, group.slotWeights, rng);
        const quality = pickWeighted(QUALITIES, group.qualityWeights, rng);
        const level = group.levelMin + Math.floor(rng() * (group.levelMax - group.levelMin + 1));
        items.push(createEquipItem(slot, quality, rng, level));
    }
    return items;
}
```

- [ ] **Step 6: 补测试 —— 掉落等级落在区间内**

打开 `tools/drop-config-test.ts`，在文件末尾 `console.log` 之前插入：

```ts
test('rollDropItems 产出的装备等级落在 dropGroup 的区间内', () => {
    for (let i = 0; i < 30; i++) {
        const items = rollDropItems('level_2', Math.random);
        for (const item of items) {
            assert.ok(item.level !== undefined && item.level >= 6 && item.level <= 15,
                `level_2 掉落等级应在 [6,15]，得到 ${item.level}`);
        }
    }
});

test('rollDropItems：level 区间边界（rng=0 取最低，rng 接近 1 取最高）', () => {
    const low = rollDropItems('level_1', () => 0);
    assert.equal(low[0].level, 1);
    const high = rollDropItems('level_1', () => 0.999999);
    assert.equal(high[0].level, 10);
});
```

- [ ] **Step 7: 跑相关测试确认全绿**

```bash
npm run test:drop
npm run test:services
```

Expected: 两者都以 `... 测试：N 通过，0 失败` 结尾，无 `✗`。（`test:services` 覆盖 `ChestService`，用来确认宝箱开箱路径没被搞坏——`ChestService.openChest` 复用 `rollDropItems`，不用改 `ChestService.ts` 本身。）

- [ ] **Step 8: 提交**

```bash
git add tools/seed-drop-xlsx.ts tools/excel-to-config.ts tools/config-xlsx/drop.xlsx assets/scripts/config/DropConfig.ts assets/scripts/config/drop.config.generated.ts tools/drop-config-test.ts
git commit -m "$(cat <<'EOF'
feat(drop): 掉落/宝箱装备按 dropGroup 区间生成等级

drop.xlsx 的 DropGroups 新增 levelMin/levelMax 列；ChestService
复用同一个 rollDropItems，因此宝箱开箱装备无需单独改动即可带上等级。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 合成配置 `craft.xlsx` → `CraftConfig.ts`

**Files:**
- Create: `tools/seed-craft-xlsx.ts`
- Create: `assets/scripts/config/CraftConfig.ts`
- Modify: `tools/excel-to-config.ts`（新增 `buildCraftConfig` + `SOURCES` 一行）
- Modify: `package.json`（新增 `seed:craft`、`test:craft` 脚本）

**Interfaces:**
- Consumes：`MaterialId`/`MaterialSave`（`services/RewardTypes.ts`）、`Quality`/`QUALITIES`（`inventory/EquipDefs.ts`）
- Produces：
  - `CraftTierConfig { label: string; levelMin: number; levelMax: number; cost: Partial<Record<MaterialId, number>>; qualityWeights: Record<Quality, number> }`
  - `getCraftTier(tierId: string): CraftTierConfig`（不存在则 `throw`）
  - `craftTierIds(): string[]`（按 `levelMin` 升序）
  - `canAffordCraftTier(materials: MaterialSave, tierId: string): boolean`
  - `rollCraftLevel(tierId: string, rng?: () => number): number`
  - `pickCraftQuality(tierId: string, rng?: () => number): Quality`

- [ ] **Step 1: 写 `craft.xlsx` 种子脚本**

创建 `tools/seed-craft-xlsx.ts`：

```ts
// craft.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/craft.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/craft.xlsx');

// 3 档，材料需求对齐现有材料稀有度：打造石处处产、宝石碎片需 boss 箱、铭文粉尘需章节箱。
const TIERS_HEADER = ['tierId', 'label', 'levelMin', 'levelMax', 'costForgeStone', 'costGemShard', 'costRuneDust'];
const TIERS_ROWS: (string | number)[][] = [
    ['tier_1', '初阶', 1, 10, 10, 0, 0],
    ['tier_2', '中阶', 11, 20, 20, 3, 0],
    ['tier_3', '高阶', 21, 30, 30, 6, 2],
];

// 档位越高，权重越往史诗/传说偏。
const QUALITY_WEIGHTS_HEADER = ['tierId', 'quality', 'weight'];
const QUALITY_WEIGHTS_ROWS: (string | number)[][] = [
    ['tier_1', 'common', 60],
    ['tier_1', 'fine', 30],
    ['tier_1', 'rare', 9],
    ['tier_1', 'epic', 1],
    ['tier_1', 'legend', 0],
    ['tier_2', 'common', 20],
    ['tier_2', 'fine', 40],
    ['tier_2', 'rare', 30],
    ['tier_2', 'epic', 9],
    ['tier_2', 'legend', 1],
    ['tier_3', 'common', 0],
    ['tier_3', 'fine', 10],
    ['tier_3', 'rare', 35],
    ['tier_3', 'epic', 40],
    ['tier_3', 'legend', 15],
];

const wb = XLSX.utils.book_new();

function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}

addSheet('Tiers', TIERS_HEADER, TIERS_ROWS);
addSheet('QualityWeights', QUALITY_WEIGHTS_HEADER, QUALITY_WEIGHTS_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Tiers(${TIERS_ROWS.length}) QualityWeights(${QUALITY_WEIGHTS_ROWS.length})`);
```

- [ ] **Step 2: 在 `package.json` 加 `seed:craft` 脚本并生成 `craft.xlsx`**

打开 `package.json`，在 `"seed:offline": "tsx tools/seed-offline-xlsx.ts",` 之后加一行：

```json
    "seed:craft": "tsx tools/seed-craft-xlsx.ts",
```

跑：

```bash
npm run seed:craft
```

Expected: 输出 `✓ 已生成 .../craft.xlsx`，`tools/config-xlsx/craft.xlsx` 文件被创建。

- [ ] **Step 3: `excel-to-config.ts` 加 `buildCraftConfig` 解析器**

打开 `tools/excel-to-config.ts`，在 `buildChestConfig` 函数结束（约第 592 行 `return { config, summary };` 及其闭合的 `}`）之后、`// ============ 源清单 ============` 注释之前插入：

```ts
// ============ craft 模块解析器 ============
// 读 craft.xlsx 的 2 sheet → 合成配置。
// Tiers: tierId, label, levelMin, levelMax, costForgeStone, costGemShard, costRuneDust
// QualityWeights: tierId, quality, weight
function buildCraftConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_QUALITIES = ['common', 'fine', 'rare', 'epic', 'legend'];
    const validQualitySet = new Set(VALID_QUALITIES);
    const MATERIAL_COLUMNS: [string, string][] = [
        ['forge_stone', 'costForgeStone'],
        ['gem_shard', 'costGemShard'],
        ['rune_dust', 'costRuneDust'],
    ];

    const { rows: tierRows } = sheetToRows(wb, 'Tiers');
    const tierDefs: Record<string, { label: string; levelMin: number; levelMax: number; cost: Record<string, number> }> = {};
    for (const r of tierRows) {
        const tierId = reqStr(r['tierId'], 'Tiers.tierId');
        if (tierDefs[tierId]) err(`Tiers: tierId "${tierId}" 重复定义`);
        const levelMin = reqNum(r['levelMin'], `Tiers[${tierId}].levelMin`);
        const levelMax = reqNum(r['levelMax'], `Tiers[${tierId}].levelMax`);
        if (levelMin < 1) err(`Tiers[${tierId}].levelMin 必须 >= 1`);
        if (levelMax < levelMin) err(`Tiers[${tierId}]: levelMax 必须 >= levelMin`);
        const cost: Record<string, number> = {};
        for (const [materialId, col] of MATERIAL_COLUMNS) {
            const value = reqNum(r[col], `Tiers[${tierId}].${col}`);
            if (value < 0) err(`Tiers[${tierId}].${col} 不可为负`);
            if (value > 0) cost[materialId] = value;
        }
        tierDefs[tierId] = {
            label: reqStr(r['label'], `Tiers[${tierId}].label`),
            levelMin,
            levelMax,
            cost,
        };
    }
    if (Object.keys(tierDefs).length === 0) err('Tiers: 至少需要 1 个合成档位');

    const { rows: weightRows } = sheetToRows(wb, 'QualityWeights');
    const qualityWeightsByTier: Record<string, Record<string, number>> = {};
    const seen = new Set<string>();
    for (const r of weightRows) {
        const tierId = reqStr(r['tierId'], 'QualityWeights.tierId');
        const quality = reqStr(r['quality'], `QualityWeights[${tierId}].quality`);
        const key = `${tierId}.${quality}`;
        if (!validQualitySet.has(quality)) err(`QualityWeights[${tierId}]: quality "${quality}" 非法`);
        if (seen.has(key)) err(`QualityWeights: ${key} 重复定义`);
        seen.add(key);
        const weight = reqNum(r['weight'], `QualityWeights[${key}].weight`);
        if (weight < 0) err(`QualityWeights[${key}].weight 不可为负`);
        if (!qualityWeightsByTier[tierId]) qualityWeightsByTier[tierId] = {};
        qualityWeightsByTier[tierId][quality] = weight;
    }

    const tiers: Record<string, unknown> = {};
    for (const [tierId, def] of Object.entries(tierDefs)) {
        const weights = qualityWeightsByTier[tierId];
        if (!weights) {
            err(`QualityWeights: 缺少档位 "${tierId}"`);
            continue;
        }
        const out: Record<string, number> = {};
        let total = 0;
        for (const q of VALID_QUALITIES) {
            if (weights[q] === undefined) err(`QualityWeights[${tierId}]: 缺少 "${q}" 权重`);
            const w = weights[q] ?? 0;
            out[q] = w;
            total += Math.max(0, w);
        }
        if (total <= 0) err(`QualityWeights[${tierId}]: 权重总和必须 > 0`);
        tiers[tierId] = { label: def.label, levelMin: def.levelMin, levelMax: def.levelMax, cost: def.cost, qualityWeights: out };
    }

    const config = { tiers };
    const summary = `tiers=${Object.keys(tiers).length}`;
    return { config, summary };
}

```

- [ ] **Step 4: 在 `SOURCES` 清单里加 craft 一行**

打开 `tools/excel-to-config.ts`，找到 `SOURCES` 数组，把最后一项（`offline` 那条）之后的 `];` 前插入一个新条目：

```ts
    {
        name: 'craft',
        xlsxRel: 'config-xlsx/craft.xlsx',
        outRel: '../assets/scripts/config/craft.config.generated.ts',
        exportVar: 'generatedCraftConfig',
        build: buildCraftConfig,
    },
```

同时把文件顶部注释（约第 5-10 行列出模块的地方）：

```
// 目前包含 battle/equip/drop/chest/offline 五个模块：
// - tools/config-xlsx/battle.xlsx → battle.config.generated.ts
// - tools/config-xlsx/equip.xlsx  → equip.config.generated.ts
// - tools/config-xlsx/drop.xlsx   → drop.config.generated.ts
// - tools/config-xlsx/chest.xlsx  → chest.config.generated.ts
// - tools/config-xlsx/offline.xlsx → offline.config.generated.ts
```

替换为：

```
// 目前包含 battle/equip/drop/chest/offline/craft 六个模块：
// - tools/config-xlsx/battle.xlsx → battle.config.generated.ts
// - tools/config-xlsx/equip.xlsx  → equip.config.generated.ts
// - tools/config-xlsx/drop.xlsx   → drop.config.generated.ts
// - tools/config-xlsx/chest.xlsx  → chest.config.generated.ts
// - tools/config-xlsx/offline.xlsx → offline.config.generated.ts
// - tools/config-xlsx/craft.xlsx  → craft.config.generated.ts
```

- [ ] **Step 5: 跑导表，确认 craft 模块生成成功**

```bash
npm run config
```

Expected: 出现新的一段 `[craft]`：`✓ [craft] 已生成 .../craft.config.generated.ts`，摘要 `tiers=3`，无 `❌`。其余 5 个模块应仍照常成功（回归检查）。

打开生成的 `assets/scripts/config/craft.config.generated.ts`，确认 `tiers.tier_1.cost` 是 `{"forge_stone":10}`（没有 `gem_shard`/`rune_dust` 键，因为 Excel 里是 0），`tiers.tier_3.cost` 是 `{"forge_stone":30,"gem_shard":6,"rune_dust":2}`。

- [ ] **Step 6: 写 `CraftConfig.ts`**

创建 `assets/scripts/config/CraftConfig.ts`：

```ts
// 合成配置。
// ★★★ 数值由 Excel 管理 ★★★
//    源文件：tools/config-xlsx/craft.xlsx
//    改数值流程：编辑 Excel → 跑 `npm run config` → 生成 craft.config.generated.ts
//    本文件只保留 TypeScript 类型定义与纯计算辅助。

import { generatedCraftConfig } from './craft.config.generated';
import type { MaterialId, MaterialSave } from '../services/RewardTypes';
import { QUALITIES } from '../inventory/EquipDefs';
import type { Quality } from '../inventory/EquipDefs';

export interface CraftTierConfig {
    label: string;
    levelMin: number;
    levelMax: number;
    cost: Partial<Record<MaterialId, number>>;
    qualityWeights: Record<Quality, number>;
}

export interface CraftConfigShape {
    tiers: Record<string, CraftTierConfig>;
}

export const CraftConfig = generatedCraftConfig as CraftConfigShape;

export function getCraftTier(tierId: string): CraftTierConfig {
    const tier = CraftConfig.tiers[tierId];
    if (tier) return tier;
    throw new Error(`craft tier "${tierId}" 不存在，请检查 craft.xlsx 的 Tiers.tierId`);
}

// 按 levelMin 升序，供 UI 按档位从低到高排列按钮。
export function craftTierIds(): string[] {
    return Object.keys(CraftConfig.tiers).sort((a, b) => CraftConfig.tiers[a].levelMin - CraftConfig.tiers[b].levelMin);
}

export function canAffordCraftTier(materials: MaterialSave, tierId: string): boolean {
    const tier = getCraftTier(tierId);
    for (const materialId of Object.keys(tier.cost) as MaterialId[]) {
        if ((materials[materialId] ?? 0) < (tier.cost[materialId] ?? 0)) return false;
    }
    return true;
}

export function rollCraftLevel(tierId: string, rng: () => number = Math.random): number {
    const tier = getCraftTier(tierId);
    const min = Math.floor(tier.levelMin);
    const max = Math.floor(tier.levelMax);
    return min + Math.floor(rng() * (max - min + 1));
}

function pickWeighted<T extends string>(keys: readonly T[], weights: Record<T, number>, rng: () => number): T {
    let total = 0;
    for (const k of keys) total += Math.max(0, weights[k] ?? 0);
    if (total <= 0) return keys[0];
    let roll = rng() * total;
    for (const k of keys) {
        const weight = Math.max(0, weights[k] ?? 0);
        if (weight <= 0) continue;
        if (roll < weight) return k;
        roll -= weight;
    }
    return keys[keys.length - 1];
}

export function pickCraftQuality(tierId: string, rng: () => number = Math.random): Quality {
    const tier = getCraftTier(tierId);
    return pickWeighted(QUALITIES, tier.qualityWeights, rng);
}
```

- [ ] **Step 7: 加 `test:craft` 脚本占位（测试文件在 Task 4 才写）**

打开 `package.json`，在 `"test:art": "tsx tools/art-test.ts",` 之后加一行：

```json
    "test:craft": "tsx tools/craft-test.ts",
```

这一步先加脚本条目，`tools/craft-test.ts` 文件在 Task 4 创建；此时**不要**运行 `npm run test:craft`（文件还不存在会报错），等 Task 4 完成再跑。

- [ ] **Step 8: 提交**

```bash
git add tools/seed-craft-xlsx.ts tools/excel-to-config.ts tools/config-xlsx/craft.xlsx assets/scripts/config/CraftConfig.ts assets/scripts/config/craft.config.generated.ts package.json
git commit -m "$(cat <<'EOF'
feat(craft): 新增合成配置 craft.xlsx + CraftConfig

新建 3 档合成配方（材料成本 + 品质权重），走现有多源导表约定；
CraftConfig 提供档位查询/负担校验/等级与品质随机的纯计算辅助。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 合成服务 `CraftService.ts`

**Files:**
- Create: `assets/scripts/craft/CraftService.ts`
- Create: `tools/craft-test.ts`

**Interfaces:**
- Consumes：`getCraftTier`/`canAffordCraftTier`/`rollCraftLevel`/`pickCraftQuality`（`config/CraftConfig.ts`）、`createEquipItem`/`SLOTS`（`inventory/EquipDefs.ts`）、`MaterialSave`（`services/RewardTypes.ts`）
- Produces：
  - `CraftResult { ok: boolean; reason?: string; item?: EquipItem; remainingMaterials?: MaterialSave }`
  - `craftEquipment(materials: MaterialSave, tierId: string, slot: EquipSlot, rng?: () => number): CraftResult`

- [ ] **Step 1: 写 `CraftService.ts`**

创建 `assets/scripts/craft/CraftService.ts`：

```ts
// 材料合成装备（纯逻辑，不依赖 cc）。
// 玩家选部位 + 档位，材料够就一定产出一件装备；等级/品质在档位配置范围内随机。
// 失败（材料不足/参数非法）不修改传入的 materials，调用方决定何时把 remainingMaterials 落盘。

import { createEquipItem, SLOTS } from '../inventory/EquipDefs';
import type { EquipItem, EquipSlot } from '../inventory/EquipDefs';
import { canAffordCraftTier, getCraftTier, pickCraftQuality, rollCraftLevel } from '../config/CraftConfig';
import type { MaterialSave } from '../services/RewardTypes';

export interface CraftResult {
    ok: boolean;
    reason?: string;
    item?: EquipItem;
    remainingMaterials?: MaterialSave;
}

export function craftEquipment(
    materials: MaterialSave,
    tierId: string,
    slot: EquipSlot,
    rng: () => number = Math.random,
): CraftResult {
    if (!SLOTS.includes(slot)) return { ok: false, reason: '部位非法' };

    let tier;
    try {
        tier = getCraftTier(tierId);
    } catch {
        return { ok: false, reason: '合成档位不存在' };
    }

    if (!canAffordCraftTier(materials, tierId)) return { ok: false, reason: '材料不足' };

    const remainingMaterials: MaterialSave = { ...materials };
    for (const materialId of Object.keys(tier.cost) as (keyof MaterialSave)[]) {
        const need = tier.cost[materialId] ?? 0;
        remainingMaterials[materialId] = (remainingMaterials[materialId] ?? 0) - need;
    }

    const level = rollCraftLevel(tierId, rng);
    const quality = pickCraftQuality(tierId, rng);
    const item = createEquipItem(slot, quality, rng, level);

    return { ok: true, item, remainingMaterials };
}
```

- [ ] **Step 2: 写 `craft-test.ts`**

创建 `tools/craft-test.ts`：

```ts
// 合成服务单测（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { craftEquipment } from '../assets/scripts/craft/CraftService';
import { getCraftTier } from '../assets/scripts/config/CraftConfig';
import type { MaterialSave } from '../assets/scripts/services/RewardTypes';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('craftEquipment：材料充足时扣除材料并产出档位区间内的装备', () => {
    const tier = getCraftTier('tier_1');
    const materials: MaterialSave = { forge_stone: 10 };
    const result = craftEquipment(materials, 'tier_1', 'weapon', () => 0.5);
    assert.equal(result.ok, true);
    assert.ok(result.item);
    assert.equal(result.item!.slot, 'weapon');
    assert.ok(
        result.item!.level! >= tier.levelMin && result.item!.level! <= tier.levelMax,
        `等级应落在档位区间内，得到 ${result.item!.level}`,
    );
    assert.equal(result.remainingMaterials!.forge_stone, 0);
    assert.equal(materials.forge_stone, 10, '不应就地修改传入的 materials');
});

test('craftEquipment：材料不足时拒绝且不返回 remainingMaterials', () => {
    const materials: MaterialSave = { forge_stone: 5 };
    const result = craftEquipment(materials, 'tier_1', 'weapon', () => 0.5);
    assert.equal(result.ok, false);
    assert.equal(result.reason, '材料不足');
    assert.equal(result.remainingMaterials, undefined);
    assert.equal(materials.forge_stone, 5);
});

test('craftEquipment：高档位需要多种材料，缺一种也拒绝', () => {
    const materials: MaterialSave = { forge_stone: 100, gem_shard: 0 };
    const result = craftEquipment(materials, 'tier_2', 'helmet', () => 0.5);
    assert.equal(result.ok, false);
    assert.equal(result.reason, '材料不足');
});

test('craftEquipment：非法部位/档位返回失败而非抛异常', () => {
    const materials: MaterialSave = { forge_stone: 999, gem_shard: 999, rune_dust: 999 };
    const badSlot = craftEquipment(materials, 'tier_1', 'invalid-slot' as any, () => 0.5);
    assert.equal(badSlot.ok, false);
    const badTier = craftEquipment(materials, 'no-such-tier', 'weapon', () => 0.5);
    assert.equal(badTier.ok, false);
});

test('craftEquipment：高档位平均品质高于低档位（抽样趋势，非精确断言）', () => {
    const materials: MaterialSave = { forge_stone: 9999, gem_shard: 9999, rune_dust: 9999 };
    const qualityRank: Record<string, number> = { common: 0, fine: 1, rare: 2, epic: 3, legend: 4 };
    let sumTier1 = 0;
    let sumTier3 = 0;
    const rounds = 200;
    for (let i = 0; i < rounds; i++) {
        const r1 = craftEquipment(materials, 'tier_1', 'weapon', Math.random);
        const r3 = craftEquipment(materials, 'tier_3', 'weapon', Math.random);
        sumTier1 += qualityRank[r1.item!.quality];
        sumTier3 += qualityRank[r3.item!.quality];
    }
    assert.ok(
        sumTier3 / rounds > sumTier1 / rounds,
        `高档位平均品质应更高（tier1=${sumTier1 / rounds} tier3=${sumTier3 / rounds}）`,
    );
});

console.log(`\n合成服务测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: 跑测试确认全绿**

```bash
npm run test:craft
```

Expected: 输出 5 行 `✓`，末尾 `合成服务测试：5 通过，0 失败`。

- [ ] **Step 4: 提交**

```bash
git add assets/scripts/craft/CraftService.ts tools/craft-test.ts
git commit -m "$(cat <<'EOF'
feat(craft): 新增 CraftService 纯逻辑合成服务

材料够就产出装备（等级/品质按档位配置随机），材料不足/参数非法
返回失败且不修改传入的 materials；新增 tools/craft-test.ts 覆盖
成功/失败/多材料校验/抽样品质趋势。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `BattleEntry` 合成面板数据流（状态字段、材料缓存、开关面板、点击合成）

> 本任务只做**非视觉**的状态与逻辑接线：字段声明、面板开关、材料缓存的读写、点击"合成"按钮后的完整业务流程。**画面渲染留到 Task 6**——本任务结束时面板还是空的（`_renderCraftPanel` 先给一个占位实现，Task 6 再补完整绘制），但整条数据链路（材料够不够、扣材料、生成装备、装备入库、存档）已经能跑通并可通过手动调用验证。

**Files:**
- Modify: `assets/scripts/BattleEntry.ts`

**Interfaces:**
- Consumes：
  - `craftEquipment(materials, tierId, slot, rng)`（Task 4，`craft/CraftService.ts`）
  - `getCraftTier(tierId)`/`craftTierIds()`（Task 3，`config/CraftConfig.ts`）
  - `MaterialSave`/`MaterialId`（`services/RewardTypes.ts`）
  - `EquipSlot`/`SLOTS`（`inventory/EquipDefs.ts`）
  - 已有的 `_addRewardEquipments(drops: EquipItem[]): { received: RewardEntry[]; failed: number }`（同文件已存在方法，`BattleEntry.ts:1731`）
  - 已有的 `loadPlayerData()`/`savePlayerData()`（`core/data/PlayerDataStore.ts`）
- Produces（给 Task 6 用）：
  - 类字段 `_craftRoot`/`_craftGfx`/`_craftLabels`/`_craftHots`/`_pressedCraftKind`/`_pressedCraftTierId`/`_pressedCraftSlot`/`_craftSelectedTier`/`_craftSelectedSlot`/`_craftMessage`/`_lastCraftResult`/`_materials`
  - 方法 `_craftOpen()`/`_toggleCraftPanel()`/`_showCraftPanel()`/`_hideCraftPanel()`/`_ensureSelectedCraftTier()`/`_craftSelectedEquipment()`（Task 6 会重写 `_renderCraftPanel` 的内容，但方法名不变）

- [ ] **Step 1: 加新 import**

打开 `assets/scripts/BattleEntry.ts`，把第 32-35 行：

```ts
import { QUALITY_LABEL, QUALITY_COLOR, SLOT_LABEL, formatEquipStats } from './inventory/EquipDefs';
import type { EquipItem } from './inventory/EquipDefs';
import { MATERIAL_LABEL } from './services/RewardTypes';
import type { MaterialItem } from './services/RewardTypes';
```

替换为：

```ts
import { QUALITY_LABEL, QUALITY_COLOR, SLOT_LABEL, SLOTS, formatEquipStats } from './inventory/EquipDefs';
import type { EquipItem, EquipSlot } from './inventory/EquipDefs';
import { MATERIAL_LABEL } from './services/RewardTypes';
import type { MaterialId, MaterialItem, MaterialSave } from './services/RewardTypes';
import { craftEquipment } from './craft/CraftService';
import { craftTierIds, getCraftTier } from './config/CraftConfig';
import type { CraftTierConfig } from './config/CraftConfig';
```

- [ ] **Step 2: 加 `CraftHot` 接口**

在同文件第 41 行 `interface ChestHot { ... }` 之后插入：

```ts
interface CraftHot { x: number; y: number; w: number; h: number; kind: 'tier' | 'slot' | 'craft' | 'close'; tierId?: string; slot?: EquipSlot; }
```

- [ ] **Step 3: 加类字段**

找到第 215 行 `private _lastChestOpen: ChestOpenDisplay | null = null;`，在它之后插入：

```ts
    private _craftRoot: Node = null!;
    private _craftGfx: Graphics = null!;
    private _craftLabels: Label[] = [];
    private _craftHots: CraftHot[] = [];
    private _pressedCraftKind: CraftHot['kind'] | null = null;
    private _pressedCraftTierId = '';
    private _pressedCraftSlot: EquipSlot | null = null;
    private _craftSelectedTier = '';
    private _craftSelectedSlot: EquipSlot = 'weapon';
    private _craftMessage = '';
    private _lastCraftResult: RewardEntry | null = null;
    private _materials: MaterialSave = {};
```

- [ ] **Step 4: 创建面板节点、接入 `onLoad` 数据链、材料缓存初始化**

找到第 341 行的 `dataReady` 链：

```ts
        const dataReady = loadInventory(this._inv).then(() => loadProgress(this._progress)).then(() => this._claimOfflineRewards()).then(() => loadChests(this._chests)).then(() => {
            this._invView.refresh();
        }).catch(() => {
            // 读档失败时仍允许进游戏，掉落会从空背包开始存。
        });
        this._createSettlementView();
        this._createChestView();
```

替换为：

```ts
        const dataReady = loadInventory(this._inv).then(() => loadProgress(this._progress)).then(() => this._claimOfflineRewards()).then(() => loadChests(this._chests)).then(() => this._refreshMaterialsCache()).then(() => {
            this._invView.refresh();
        }).catch(() => {
            // 读档失败时仍允许进游戏，掉落会从空背包开始存。
        });
        this._createSettlementView();
        this._createChestView();
        this._createCraftView();
```

紧接着找到第 359 行：

```ts
        this._makeUiHotZone('NavSectHot', UI_RECTS.navSect, noop, 'BottomNav');
```

替换为：

```ts
        this._makeUiHotZone('NavSectHot', UI_RECTS.navSect, () => this._toggleCraftPanel(), 'BottomNav');
```

- [ ] **Step 5: 新增 `_refreshMaterialsCache`、面板开关方法（占位渲染）**

找到 `_createChestView()` 方法（约第 964-979 行）：

```ts
    private _createChestView() {
        this._chestRoot = new Node('ChestView');
        this._chestRoot.layer = this.node.layer;
        this._chestRoot.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        const gfxNode = new Node('ChestGfx');
        gfxNode.layer = this.node.layer;
        gfxNode.addComponent(UITransform);
        this._chestGfx = gfxNode.addComponent(Graphics);
        this._chestRoot.addChild(gfxNode);
        this.node.addChild(this._chestRoot);
        this._chestRoot.active = false;
        this._chestRoot.on(Node.EventType.TOUCH_START, this._onChestTouchStart, this);
        this._chestRoot.on(Node.EventType.TOUCH_MOVE, this._onChestTouchMove, this);
        this._chestRoot.on(Node.EventType.TOUCH_END, this._onChestTap, this);
        this._chestRoot.on(Node.EventType.TOUCH_CANCEL, this._onChestTouchCancel, this);
    }
```

在它之后（`_chestOpen()` 方法之前）插入：

```ts
    private async _refreshMaterialsCache(): Promise<void> {
        const data = await loadPlayerData();
        this._materials = { ...(data.materials ?? {}) };
    }

    private _createCraftView() {
        this._craftRoot = new Node('CraftView');
        this._craftRoot.layer = this.node.layer;
        this._craftRoot.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        const gfxNode = new Node('CraftGfx');
        gfxNode.layer = this.node.layer;
        gfxNode.addComponent(UITransform);
        this._craftGfx = gfxNode.addComponent(Graphics);
        this._craftRoot.addChild(gfxNode);
        this.node.addChild(this._craftRoot);
        this._craftRoot.active = false;
        this._craftRoot.on(Node.EventType.TOUCH_START, this._onCraftTouchStart, this);
        this._craftRoot.on(Node.EventType.TOUCH_MOVE, this._onCraftTouchMove, this);
        this._craftRoot.on(Node.EventType.TOUCH_END, this._onCraftTap, this);
        this._craftRoot.on(Node.EventType.TOUCH_CANCEL, this._onCraftTouchCancel, this);
    }

    private _craftOpen(): boolean {
        return !!this._craftRoot && this._craftRoot.active;
    }

    private _toggleCraftPanel() {
        if (this._craftOpen()) this._hideCraftPanel();
        else this._showCraftPanel();
    }

    private _showCraftPanel() {
        if (!this._craftRoot) return;
        this._hideSettlement();
        this._hideChestPanel();
        this._ensureSelectedCraftTier();
        this._craftRoot.active = true;
        this._craftRoot.setSiblingIndex(this.node.children.length - 1);
        this._renderCraftPanel();
    }

    private _hideCraftPanel() {
        if (this._craftRoot) this._craftRoot.active = false;
        this._pressedCraftKind = null;
        this._pressedCraftTierId = '';
        this._pressedCraftSlot = null;
    }

    private _ensureSelectedCraftTier(): string {
        const ids = craftTierIds();
        if (ids.includes(this._craftSelectedTier)) return this._craftSelectedTier;
        this._craftSelectedTier = ids[0] ?? '';
        return this._craftSelectedTier;
    }

    private _craftLabel(i: number): Label {
        while (i >= this._craftLabels.length) {
            const n = new Node('CraftLbl');
            n.layer = this._craftRoot.layer;
            n.addComponent(UITransform);
            const lb = n.addComponent(Label);
            this._craftRoot.addChild(n);
            this._craftLabels.push(lb);
        }
        return this._craftLabels[i];
    }

    // Task 6 会把这里替换成完整的 Graphics 绘制；本任务先给一个最小占位，
    // 保证「面板能打开/关闭 + 数据链路能跑」可以先验证。
    private _renderCraftPanel() {
        const g = this._craftGfx;
        g.clear();
        this._craftHots = [];
        const lb = this._craftLabel(0);
        lb.node.active = true;
        lb.node.setPosition(0, 0, 0);
        lb.string = `[占位] 合成面板 · 材料=${JSON.stringify(this._materials)} · 消息=${this._craftMessage}`;
        lb.fontSize = 16;
        lb.color = new Color(230, 230, 230);
        for (let i = 1; i < this._craftLabels.length; i++) this._craftLabels[i].node.active = false;
    }
```

同时给 `_showChestPanel()` 方法（约第 990-997 行）补一行"打开宝箱面板时关闭合成面板"，保持面板互斥。把：

```ts
    private _showChestPanel() {
        if (!this._chestRoot) return;
        this._hideSettlement();
        this._ensureSelectedChest();
        this._chestRoot.active = true;
        this._chestRoot.setSiblingIndex(this.node.children.length - 1);
        this._renderChestPanel();
    }
```

替换为：

```ts
    private _showChestPanel() {
        if (!this._chestRoot) return;
        this._hideSettlement();
        this._hideCraftPanel();
        this._ensureSelectedChest();
        this._chestRoot.active = true;
        this._chestRoot.setSiblingIndex(this.node.children.length - 1);
        this._renderChestPanel();
    }
```

- [ ] **Step 6: 加点击"合成"按钮的业务逻辑 + 触摸事件骨架**

在 `_hideCraftPanel`/`_ensureSelectedCraftTier`/`_craftLabel`/`_renderCraftPanel` 之后（紧跟着，仍在 Task 6 会继续扩充的这一块区域末尾）插入：

```ts
    private async _craftSelectedEquipment(): Promise<void> {
        if (this._availableEquipmentSlots() < 1) {
            this._craftMessage = '背包/仓库空间不足，无法合成';
            this._renderCraftPanel();
            return;
        }
        const tierId = this._ensureSelectedCraftTier();
        const result = craftEquipment(this._materials, tierId, this._craftSelectedSlot, Math.random);
        if (!result.ok || !result.item || !result.remainingMaterials) {
            this._craftMessage = result.reason ?? '合成失败';
            this._renderCraftPanel();
            return;
        }
        const placed = this._addRewardEquipments([result.item]);
        if (placed.failed > 0 || placed.received.length === 0) {
            this._craftMessage = '装备入库失败，材料未消耗';
            this._renderCraftPanel();
            return;
        }
        const data = await loadPlayerData();
        data.materials = result.remainingMaterials;
        data.inventory = this._inv.serialize();
        this._materials = { ...result.remainingMaterials };
        await savePlayerData();
        this._invView.refresh();
        const receivedEntry = placed.received[0];
        this._lastCraftResult = receivedEntry;
        this._craftMessage = `合成成功：${this._formatEquipReward(receivedEntry.item)}（进${receivedEntry.target}）`;
        this._renderCraftPanel();
    }

    private _craftHit(e: EventTouch): CraftHot | null {
        if (!this._craftOpen()) return null;
        const ui = e.getUILocation();
        const p = this._craftRoot.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        return this._craftHots.find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) ?? null;
    }

    private _onCraftTouchStart(e: EventTouch) {
        if (!this._craftOpen()) return;
        e.propagationStopped = true;
        const hit = this._craftHit(e);
        this._pressedCraftKind = hit?.kind ?? null;
        this._pressedCraftTierId = hit?.tierId ?? '';
        this._pressedCraftSlot = hit?.slot ?? null;
        if (this._pressedCraftKind) this._renderCraftPanel();
    }

    private _onCraftTouchMove(e: EventTouch) {
        if (!this._pressedCraftKind) return;
        const hit = this._craftHit(e);
        if (hit?.kind === this._pressedCraftKind && (hit.tierId ?? '') === this._pressedCraftTierId && (hit.slot ?? null) === this._pressedCraftSlot) return;
        this._pressedCraftKind = null;
        this._pressedCraftTierId = '';
        this._pressedCraftSlot = null;
        this._renderCraftPanel();
    }

    private _onCraftTouchCancel() {
        if (!this._pressedCraftKind) return;
        this._pressedCraftKind = null;
        this._pressedCraftTierId = '';
        this._pressedCraftSlot = null;
        this._renderCraftPanel();
    }

    private _onCraftTap(e: EventTouch) {
        if (!this._craftOpen()) return;
        e.propagationStopped = true;
        const hit = this._craftHit(e);
        if (this._pressedCraftKind) {
            this._pressedCraftKind = null;
            this._pressedCraftTierId = '';
            this._pressedCraftSlot = null;
            this._renderCraftPanel();
        }
        if (!hit) return;
        if (hit.kind === 'close') {
            this._hideCraftPanel();
            return;
        }
        if (hit.kind === 'tier' && hit.tierId) {
            this._craftSelectedTier = hit.tierId;
            this._craftMessage = '';
            this._renderCraftPanel();
            return;
        }
        if (hit.kind === 'slot' && hit.slot) {
            this._craftSelectedSlot = hit.slot;
            this._craftMessage = '';
            this._renderCraftPanel();
            return;
        }
        if (hit.kind === 'craft') void this._craftSelectedEquipment();
    }
```

- [ ] **Step 7: 在 `_openSelectedChest` 里同步刷新材料缓存**

找到 `_openSelectedChest` 方法内（约第 1783-1787 行）：

```ts
        const data = await loadPlayerData();
        data.materials = data.materials ?? {};
        for (const material of reward.materials) {
            data.materials[material.id] = (data.materials[material.id] ?? 0) + material.count;
        }
        this._chests.removeChest(chest.id);
```

替换为：

```ts
        const data = await loadPlayerData();
        data.materials = data.materials ?? {};
        for (const material of reward.materials) {
            data.materials[material.id] = (data.materials[material.id] ?? 0) + material.count;
        }
        this._materials = { ...data.materials };
        this._chests.removeChest(chest.id);
```

这样宝箱开出材料后，如果玩家紧接着打开合成面板，能看到最新数量。

- [ ] **Step 8: 手动验证数据链路（先用占位渲染跑通逻辑，不看画面细节）**

由于本任务还没做真实绘制（Task 6 才做），先用一次性脚本验证 `craftEquipment` 集成本身没有明显问题即可——这一步的验证已经被 Task 4 的 `npm run test:craft` 覆盖了 `CraftService` 本身；本任务新增的是 **BattleEntry 里调用它的胶水代码**，Cocos 组件代码无法用 `tsx` 单测，只能在 Task 6 完成后一起做手动 Cocos 预览验证（见 Task 6 Step 后 和 Task 8）。

这一步先做一个静态检查代替：确认改动没有引入 TypeScript 明显的类型错误。由于项目 `tsc` 全量检查被已知的 Cocos/Node 类型声明问题挡住（不是本次改动引入的），改用 Cocos 编辑器自身的脚本编译校验：

```bash
git status
```

Expected: 确认改动的文件只有 `assets/scripts/BattleEntry.ts`（以及 Task 1-4 已提交的文件不在本次 diff 里）。人工检查一遍新增代码里 `EquipSlot`/`MaterialId`/`MaterialSave`/`CraftTierConfig`/`craftEquipment`/`craftTierIds`/`getCraftTier` 等标识符都能对应到 Step 1 新加的 import——本步骤不追求自动化编译验证，Task 6/8 里打开 Cocos 编辑器加载场景即会暴露任何真实的编译错误（Cocos 会在控制台报 TS 编译失败）。

- [ ] **Step 9: 提交**

```bash
git add assets/scripts/BattleEntry.ts
git commit -m "$(cat <<'EOF'
feat(craft): BattleEntry 接入合成面板数据流（材料缓存/点击合成）

新增材料本地缓存 _materials（初始加载 + 宝箱开箱后同步刷新）、
合成面板开关与点击"合成"后的完整业务流程（校验空间 → 调用
CraftService → 装备入库 → 落盘）；渲染先占位，下个任务补完整绘制。
NavSectHot 热区从 noop 改为打开合成面板。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `CraftView` 完整渲染（Graphics 面板）

> 本任务只替换 Task 5 里 `_renderCraftPanel` 的占位实现，并新增它调用的几个绘制辅助方法。所有触摸事件、状态字段、业务逻辑在 Task 5 已经写好，这里不再改动。

**Files:**
- Modify: `assets/scripts/BattleEntry.ts`

**Interfaces:**
- Consumes：Task 5 的全部字段/方法；`getCraftTier`/`craftTierIds`/`canAffordCraftTier`（需从 Task 3 补 import，见 Step 1）
- Produces：完整可视的合成面板

- [ ] **Step 1: 补 `canAffordCraftTier` import**

打开 `assets/scripts/BattleEntry.ts`，把 Task 5 Step 1 加的这一行：

```ts
import { craftTierIds, getCraftTier } from './config/CraftConfig';
```

替换为：

```ts
import { canAffordCraftTier, craftTierIds, getCraftTier } from './config/CraftConfig';
```

- [ ] **Step 2: 替换 `_renderCraftPanel` 占位实现为完整绘制**

找到 Task 5 写的占位版本：

```ts
    // Task 6 会把这里替换成完整的 Graphics 绘制；本任务先给一个最小占位，
    // 保证「面板能打开/关闭 + 数据链路能跑」可以先验证。
    private _renderCraftPanel() {
        const g = this._craftGfx;
        g.clear();
        this._craftHots = [];
        const lb = this._craftLabel(0);
        lb.node.active = true;
        lb.node.setPosition(0, 0, 0);
        lb.string = `[占位] 合成面板 · 材料=${JSON.stringify(this._materials)} · 消息=${this._craftMessage}`;
        lb.fontSize = 16;
        lb.color = new Color(230, 230, 230);
        for (let i = 1; i < this._craftLabels.length; i++) this._craftLabels[i].node.active = false;
    }
```

整体替换为：

```ts
    private _renderCraftPanel() {
        const g = this._craftGfx;
        g.clear();
        this._craftHots = [];
        const tierId = this._ensureSelectedCraftTier();
        const tier = tierId ? getCraftTier(tierId) : null;
        let li = 0;
        const lbl = (x: number, y: number, text: string, size = 20, color = new Color(235, 238, 245)) => {
            const lb = this._craftLabel(li++);
            lb.node.active = true;
            lb.node.setPosition(x, y, 0);
            lb.string = text;
            lb.fontSize = size;
            lb.lineHeight = size + 4;
            lb.color = color;
            lb.horizontalAlign = Label.HorizontalAlign.CENTER;
            lb.verticalAlign = Label.VerticalAlign.CENTER;
        };

        g.fillColor = new Color(8, 10, 14, 170);
        g.rect(-this._halfW, -this._halfH, this._halfW * 2, this._halfH * 2);
        g.fill();

        const w = Math.min(760, this._halfW * 2 - 80);
        const h = Math.min(650, this._halfH * 2 - 90);
        const x = -w / 2;
        const y = -h / 2;
        g.fillColor = new Color(28, 31, 40, 246);
        g.roundRect(x, y, w, h, 8);
        g.fill();
        g.strokeColor = new Color(140, 200, 255, 205);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8);
        g.stroke();

        lbl(0, y + h - 42, '材料合成', 30, new Color(140, 200, 255));
        lbl(0, y + h - 82, this._materialsHoldingText(), 18, new Color(190, 220, 190));

        this._drawCraftTierRow(g, lbl, x + 28, y + h - 130, w - 56, 54);
        this._drawCraftSlotRow(g, lbl, x + 28, y + h - 206, w - 56, 54);
        this._drawCraftCost(g, lbl, x + 28, y + h - 260, w - 56, 78, tier);
        this._drawCraftResult(g, lbl, x + 28, y + 96, w - 56, 150);
        if (this._craftMessage) lbl(0, y + 78, this._craftMessage, 17, new Color(255, 210, 150));

        const by = y + 40;
        const canCraft = !!tier && canAffordCraftTier(this._materials, tierId);
        this._craftButton(g, lbl, x + 70, by, 200, 50, '合成', 'craft', canCraft);
        this._craftButton(g, lbl, x + w - 250, by, 180, 50, '关闭', 'close', true);

        for (let i = li; i < this._craftLabels.length; i++) this._craftLabels[i].node.active = false;
    }

    private _materialsHoldingText(): string {
        const ids: MaterialId[] = ['forge_stone', 'gem_shard', 'rune_dust'];
        return ids.map(id => `${MATERIAL_LABEL[id]} ${this._materials[id] ?? 0}`).join('  ·  ');
    }

    private _drawCraftTierRow(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        rowH: number,
    ) {
        const ids = craftTierIds();
        const gap = 10;
        const btnW = (w - gap * Math.max(0, ids.length - 1)) / Math.max(1, ids.length);
        for (let i = 0; i < ids.length; i++) {
            const tierId = ids[i];
            const tier = getCraftTier(tierId);
            const bx = x + i * (btnW + gap);
            const selected = tierId === this._craftSelectedTier;
            const pressed = this._pressedCraftKind === 'tier' && this._pressedCraftTierId === tierId;
            const r = this._pressRect(bx, topY, btnW, rowH, pressed);
            g.fillColor = selected ? new Color(72, 110, 150, 245) : new Color(43, 48, 60, 235);
            g.roundRect(r.x, r.y, r.w, r.h, 8); g.fill();
            g.strokeColor = selected ? new Color(140, 200, 255, 230) : new Color(88, 96, 112, 190);
            g.lineWidth = selected ? 3 : 2;
            g.roundRect(r.x, r.y, r.w, r.h, 8); g.stroke();
            lbl(bx + btnW / 2, topY + rowH / 2 + 8, tier.label, 17, new Color(245, 248, 255));
            lbl(bx + btnW / 2, topY + rowH / 2 - 13, `Lv.${tier.levelMin}-${tier.levelMax}`, 13, new Color(180, 188, 204));
            this._craftHots.push({ x: bx, y: topY, w: btnW, h: rowH, kind: 'tier', tierId });
        }
    }

    private _drawCraftSlotRow(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        rowH: number,
    ) {
        const gap = 8;
        const btnW = (w - gap * (SLOTS.length - 1)) / SLOTS.length;
        for (let i = 0; i < SLOTS.length; i++) {
            const slot = SLOTS[i];
            const bx = x + i * (btnW + gap);
            const selected = slot === this._craftSelectedSlot;
            const pressed = this._pressedCraftKind === 'slot' && this._pressedCraftSlot === slot;
            const r = this._pressRect(bx, topY, btnW, rowH, pressed);
            g.fillColor = selected ? new Color(72, 110, 150, 245) : new Color(43, 48, 60, 235);
            g.roundRect(r.x, r.y, r.w, r.h, 8); g.fill();
            g.strokeColor = selected ? new Color(140, 200, 255, 230) : new Color(88, 96, 112, 190);
            g.lineWidth = selected ? 3 : 2;
            g.roundRect(r.x, r.y, r.w, r.h, 8); g.stroke();
            lbl(bx + btnW / 2, topY + rowH / 2, SLOT_LABEL[slot], 16, new Color(245, 248, 255));
            this._craftHots.push({ x: bx, y: topY, w: btnW, h: rowH, kind: 'slot', slot });
        }
    }

    private _drawCraftCost(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        h: number,
        tier: CraftTierConfig | null,
    ) {
        g.fillColor = new Color(35, 39, 50, 235);
        g.roundRect(x, topY - h, w, h, 8); g.fill();
        g.strokeColor = new Color(88, 96, 112, 190);
        g.lineWidth = 2;
        g.roundRect(x, topY - h, w, h, 8); g.stroke();
        if (!tier) {
            lbl(x + w / 2, topY - h / 2, '暂无可用合成档位', 17, new Color(170, 178, 194));
            return;
        }
        const materialIds: MaterialId[] = ['forge_stone', 'gem_shard', 'rune_dust'];
        const costText = materialIds
            .filter(id => (tier.cost[id] ?? 0) > 0)
            .map(id => {
                const need = tier.cost[id] ?? 0;
                const have = this._materials[id] ?? 0;
                return `${MATERIAL_LABEL[id]} ${have}/${need}${have >= need ? '' : '（不足）'}`;
            })
            .join('   ');
        lbl(x + w / 2, topY - 26, `消耗材料：${costText}`, 16, new Color(230, 232, 238));
        lbl(x + w / 2, topY - 54, `产出：Lv.${tier.levelMin}-${tier.levelMax} 随机品质装备`, 15, new Color(180, 220, 190));
    }

    private _drawCraftResult(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
    ) {
        g.fillColor = new Color(32, 35, 45, 235);
        g.roundRect(x, y, w, h, 8); g.fill();
        g.strokeColor = new Color(88, 96, 112, 190);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8); g.stroke();
        lbl(x + w / 2, y + h - 28, '本次合成结果', 20, new Color(230, 232, 238));
        if (!this._lastCraftResult) {
            lbl(x + w / 2, y + h / 2 - 8, '合成后在这里查看结果', 17, new Color(165, 174, 192));
            return;
        }
        const r = this._lastCraftResult;
        const qc = QUALITY_COLOR[r.item.quality];
        const cardW = Math.min(260, w - 40);
        const cx = x + (w - cardW) / 2;
        const cy = y + h - 118;
        g.fillColor = new Color(qc[0], qc[1], qc[2], 210);
        g.roundRect(cx, cy, cardW, 60, 6); g.fill();
        g.strokeColor = new Color(255, 255, 255, 90);
        g.lineWidth = 1;
        g.roundRect(cx, cy, cardW, 60, 6); g.stroke();
        lbl(cx + cardW / 2, cy + 38, `Lv.${r.item.level ?? 1} ${QUALITY_LABEL[r.item.quality]} · ${r.item.name}`, 15, new Color(245, 248, 255));
        lbl(cx + cardW / 2, cy + 16, `${SLOT_LABEL[r.item.slot]} → ${r.target}`, 13, new Color(245, 248, 255));
    }

    private _craftButton(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
        text: string,
        kind: CraftHot['kind'],
        enabled: boolean,
    ) {
        const r = this._pressRect(x, y, w, h, enabled && this._pressedCraftKind === kind);
        g.fillColor = enabled ? new Color(67, 76, 96, 245) : new Color(48, 52, 62, 200);
        g.roundRect(r.x, r.y, r.w, r.h, 8);
        g.fill();
        g.strokeColor = enabled ? new Color(140, 200, 255, 220) : new Color(90, 94, 104, 180);
        g.lineWidth = 2;
        g.roundRect(r.x, r.y, r.w, r.h, 8);
        g.stroke();
        lbl(x + w / 2, y + h / 2, text, 18, enabled ? new Color(245, 248, 255) : new Color(145, 150, 160));
        if (enabled) this._craftHots.push({ x, y, w, h, kind });
    }
```

- [ ] **Step 3: 打开 Cocos 编辑器手动验证面板**

打开 Cocos Creator 编辑器加载本项目场景，进入预览（或直接在编辑器内播放）。检查控制台没有 TS 编译错误（若有，编辑器会在底部/控制台面板报出，按报错信息定位并修正拼写/类型问题）。

在预览里：
1. 点开始进入战斗界面，点击底部导航栏原来"门派/NavSect"位置的图标（现在应该弹出"材料合成"面板而不是无反应）。
2. 面板应显示：三种材料持有量（初始应为 0/0/0，因为还没开过宝箱）、3 个档位按钮（初阶/中阶/高阶）、5 个部位按钮、消耗材料行、"合成"按钮（材料不足时应是灰色不可点状态）、"关闭"按钮。
3. 点击"关闭"应该正确关回战斗界面。
4. 点击底部导航栏"背包"按钮打开背包，确认合成面板会自动关闭（面板互斥）。

Expected: 以上行为都符合描述，没有崩溃或 Graphics 报错。此时材料应该都是 0，合成按钮应为不可点——这是正确的（Task 8 会通过临时刷材料的方式做一次完整合成流程验证）。

- [ ] **Step 4: 提交**

```bash
git add assets/scripts/BattleEntry.ts
git commit -m "$(cat <<'EOF'
feat(craft): CraftView 完整 Graphics 渲染

补完材料合成面板的绘制：材料持有量、档位/部位选择按钮、消耗材料
明细（不足高亮）、合成结果卡片、合成/关闭按钮；结构照抄现有
ChestView 的 Graphics 面板模式。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 装备等级在各处展示

**Files:**
- Modify: `assets/scripts/inventory/InventoryView.ts`
- Modify: `assets/scripts/BattleEntry.ts`

**Interfaces:**
- Consumes：`EquipItem.level`（Task 1）
- Produces：无新接口，纯展示格式统一为 `Lv.{level} {品质} {名字}`（紧凑处为 `Lv.{level} {名字}`）

- [ ] **Step 1: 背包/仓库网格 + 已穿装备栏 + 拖拽预览 —— 加等级前缀**

打开 `assets/scripts/inventory/InventoryView.ts`。

第一处（角色已穿装备栏格子内文字），把：

```ts
            if (it) {
                lbl(ex + CELL / 2, topY + CELL / 2 + 12, it.name, 15);
                const st = formatEquipStats(it.stats);
```

替换为：

```ts
            if (it) {
                lbl(ex + CELL / 2, topY + CELL / 2 + 12, `Lv.${it.level ?? 1} ${it.name}`, 15);
                const st = formatEquipStats(it.stats);
```

第二处（背包/仓库网格格子内文字），把：

```ts
            lbl(x + CELL / 2, y + CELL / 2 + 12, it.name, 15);
            const st = formatEquipStats(it.stats);
```

替换为：

```ts
            lbl(x + CELL / 2, y + CELL / 2 + 12, `Lv.${it.level ?? 1} ${it.name}`, 15);
            const st = formatEquipStats(it.stats);
```

第三处（拖拽预览标签），把：

```ts
    private drawDragPreview(g: Graphics, lbl: (x: number, y: number, s: string, size?: number, c?: Color) => void) {
        const d = this.touch?.drag;
        if (!d) return;
        const x = d.x - CELL / 2, y = d.y - CELL / 2;
        this.drawCell(g, x, y, d.item, true);
        lbl(d.x, d.y + 10, d.item.name, 15);
        const st = formatEquipStats(d.item.stats);
```

替换为：

```ts
    private drawDragPreview(g: Graphics, lbl: (x: number, y: number, s: string, size?: number, c?: Color) => void) {
        const d = this.touch?.drag;
        if (!d) return;
        const x = d.x - CELL / 2, y = d.y - CELL / 2;
        this.drawCell(g, x, y, d.item, true);
        lbl(d.x, d.y + 10, `Lv.${d.item.level ?? 1} ${d.item.name}`, 15);
        const st = formatEquipStats(d.item.stats);
```

- [ ] **Step 2: 详情面板标题 —— 加等级前缀**

同文件，把：

```ts
        const qColor = QUALITY_COLOR[item.quality];
        const titleColor = new Color(qColor[0], qColor[1], qColor[2]);
        lbl(x + 80, y + h - 28, `${QUALITY_LABEL[item.quality]} · ${item.name}`, 20, titleColor);
```

替换为：

```ts
        const qColor = QUALITY_COLOR[item.quality];
        const titleColor = new Color(qColor[0], qColor[1], qColor[2]);
        lbl(x + 80, y + h - 28, `Lv.${item.level ?? 1} ${QUALITY_LABEL[item.quality]} · ${item.name}`, 20, titleColor);
```

- [ ] **Step 3: 宝箱开箱结果卡片 + 共用的 `_formatEquipReward` —— 加等级前缀**

打开 `assets/scripts/BattleEntry.ts`。

把宝箱结果卡片这一行（`_drawChestOpenResult` 方法内）：

```ts
            lbl(cx + cardW / 2, cy + 28, `${QUALITY_LABEL[r.item.quality]} · ${r.item.name}`, 14, new Color(245, 248, 255));
```

替换为：

```ts
            lbl(cx + cardW / 2, cy + 28, `Lv.${r.item.level ?? 1} ${QUALITY_LABEL[r.item.quality]} · ${r.item.name}`, 14, new Color(245, 248, 255));
```

把共用的格式化方法：

```ts
    private _formatEquipReward(item: EquipItem): string {
        return `${QUALITY_LABEL[item.quality]}·${item.name}`;
    }
```

替换为：

```ts
    private _formatEquipReward(item: EquipItem): string {
        return `Lv.${item.level ?? 1} ${QUALITY_LABEL[item.quality]}·${item.name}`;
    }
```

（这个方法同时被结算页胜利奖励文案和合成成功提示共用，改这一处两边都生效。）

- [ ] **Step 4: 手动验证展示**

打开 Cocos 编辑器预览：
1. 用调试掉落按钮（或正常打关卡）掉一件装备，打开背包，确认格子/详情面板标题都显示 `Lv.数字 ...` 前缀。
2. 打开宝箱（如果库存里有），确认开箱结果卡片也带等级前缀。
3. 完成一次合成（可先在 Task 8 补材料后再验证这一条，或如果手头已有材料可以现在就试），确认合成结果卡片带等级前缀。

Expected: 所有装备展示位置都能看到 `Lv.N` 前缀，数字与该装备生成时的等级一致（对着同一件装备在背包列表和详情面板里看到的等级应该相同）。

- [ ] **Step 5: 提交**

```bash
git add assets/scripts/inventory/InventoryView.ts assets/scripts/BattleEntry.ts
git commit -m "$(cat <<'EOF'
feat(equip): 装备等级接入背包/详情/宝箱/合成展示

背包仓库网格、已穿装备栏、拖拽预览、详情面板标题、宝箱开箱结果、
合成结果卡片统一加 Lv.{level} 前缀；胜利奖励文案共用同一个
_formatEquipReward，改一处两边生效。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 全量验证 + 记忆同步 + 收尾提交

**Files:**
- Modify: `ai/memory/项目状态.md`
- Modify: `ai/memory/代码地图.md`
- Modify: `ai/memory/设计日志.md`

**Interfaces:**
- Consumes：无（收尾任务）
- Produces：无新代码接口，只更新项目记忆文档

- [ ] **Step 1: 跑全量导表 + 所有纯逻辑测试**

```bash
npm run config
```

Expected: 六个模块（battle/equip/drop/chest/offline/craft）全部 `✓`，无 `❌`。

```bash
npm run test:effective
npm run test:drop
npm run test:craft
npm run test:inventory
npm run test:services
npm run test:combat
npm run test:progression
npm run test:art
npm run check:art
```

Expected: 每条命令输出都以 `N 通过，0 失败`（或 `check:art` 的等价"全部资源存在"提示）结尾，全程没有任何 `✗` 行。如果某条历史测试因为本次改动意外失败，回到对应 Task 排查（大概率是某个手改遗漏的调用点没传新参数导致行为变化，或 Excel sheet 拼写不一致）。

- [ ] **Step 2: 完整手动合成流程验证（Cocos 编辑器预览）**

由于种子数据初始材料是 0，先用调试掉落或现有的宝箱库存路径攒够材料再测（如果本地已有旧存档且宝箱库存有货，直接开箱攒材料即可；没有的话可以在 `ConfigPanel`/`ActionPreviewPanel` 之外，临时在浏览器控制台跑一段一次性脚本调大 `PlayerData.materials`，测完再清掉，**不要把调试代码提交进仓库**）。

验证清单：
1. 打开合成面板，材料够 `tier_1` 消耗时"合成"按钮应变为可点状态。
2. 选择"武器"部位，点击"合成"：材料应正确扣减（面板顶部材料数量刷新）、结果卡片显示新装备（等级应落在 1-10 区间）、背包里能找到这件新装备。
3. 材料不够 `tier_2`/`tier_3` 时按钮应保持不可点，强行点击热区外区域不应误触发合成。
4. 关闭游戏重进（或重新加载场景），确认材料数量和新合成的装备都被正确持久化（存档没丢）。

Expected: 以上 4 点全部符合，没有材料被消耗但装备没到账、或装备到账但材料没扣的"半成品"情况。

- [ ] **Step 3: 更新 `ai/memory/代码地图.md`**

在"装备系统"表格（约第 70-85 行区域）之后（或紧邻现有装备系统章节内），补充新模块行。找到装备系统表格的表头行：

```
## 装备系统（`inventory/` 存储/UI + `EffectiveStats` 接战斗）

| 文件 | 职责 |
|------|------|
```

在该表格最后一行（`tools/drop-config-test.ts` 那一行）之后、下一个 `>` 注释行之前插入新的一行：

```
| `craft/CraftService.ts` | 材料合成装备纯逻辑：`craftEquipment(materials, tierId, slot, rng)`，材料够就产出装备（等级/品质按 `CraftConfig` 档位随机），不够/非法参数返回失败且不改材料 |
```

并在"配置（数值由 Excel 管理...）"那张大表格里（`config/offline.config.generated.ts` 那一行之后）加两行：

```
| `config/CraftConfig.ts` | 合成数值类型 + `getCraftTier`/`craftTierIds`/`canAffordCraftTier`/`rollCraftLevel`/`pickCraftQuality` |
| `config/craft.config.generated.ts` | 合成导表产物（勿手改）：由 `craft.xlsx` 生成，3 档材料成本 + 品质权重 |
```

同一大段的说明文字（"改战斗/关卡数值：编辑 ... 改离线金币/经验效率：..."那一句）末尾补一句：

```
改合成配方：编辑 `tools/config-xlsx/craft.xlsx` → 生成 `craft.config.generated.ts`。
```

顶部"最后更新"日期改成今天：

```
> 最后更新：2026-07-04。
```

（如果实际实施日期不是 2026-07-04，改成实际执行这份计划的日期。）

- [ ] **Step 4: 更新 `ai/memory/项目状态.md`**

把顶部"最近进展（给新对话）"整段替换为（保留 3-6 行的滚动窗口约定，删掉最旧的、加最新的）：

```markdown
## 最近进展（给新对话）

> 这是新对话的第一落点。每次开发收尾时刷新成 3~6 行：刚做完什么、下一步、有什么坑。

- 装备新增"等级"维度（与品质独立叠乘，`1+(level-1)×growthPerLevel`，默认每级 +3%）；所有来源装备（掉落/宝箱/合成）都带等级；老存档缺字段按 1 兜底。
- 新增材料合成系统：`craft.xlsx`（3 档，材料成本对齐现有稀有度）+ `CraftService` 纯逻辑 + `BattleEntry` 里的 `CraftView` 面板（复用底部导航 `NavSectHot` 热区），材料第一次有了消耗出口。
- 掉落等级区间接入 `drop.xlsx`（`level_1: 1-10`、`level_2: 6-15`，暂未挂钩关卡，后续关卡扩展时再精调）；宝箱开箱复用同一路径自动带上等级，`ChestService.ts` 本身未改动。
- 装备等级已接入所有展示位置（背包/仓库/详情/拖拽预览/宝箱结果/合成结果），统一格式 `Lv.{level} {品质} · {名字}`。
- 本段自动验收已跑：`test:effective/drop/craft/inventory/services/combat/progression/art`、`check:art`、`npm run config`（六模块）全绿；Cocos 预览手测完整合成流程（材料够/不够、背包持久化）通过。
- 待办：合成档位的具体材料数量/品质权重目前是占位值（`tools/seed-craft-xlsx.ts` 里给的初始值），需要策划在 `craft.xlsx` 里实际调参；掉落等级区间同理待关卡系统扩展后再挂钩 `levelIndex`。
```

在"已完成"小节里，找到装备系统那一行（"**装备系统**：背包/仓库/每角色 5 装备栏 + ..."），在其后紧跟着加一行：

```markdown
- **装备等级 + 合成**：所有装备携带等级（与品质独立叠乘），玩家用材料（打造石/宝石碎片/铭文粉尘）选部位+档位合成装备，材料够就必出装备（等级/品质按档位配置随机）；`craft.xlsx` 管理档位材料成本与品质权重。
```

在"待办（未做）"小节里加一行（放在"装备深化"那一条附近）：

```markdown
- 合成/等级深化：`craft.xlsx` 材料成本与品质权重数值平衡；掉落等级区间接关卡 `levelIndex`；后续评估是否需要装备等级对战斗数值影响的进一步打磨（当前只做了生成时属性缩放）。
```

顶部日期改成今天：

```
> 当前进度、方向、待办。改了项目就更新这里。最后更新：2026-07-04。
```

- [ ] **Step 5: 追加 `ai/memory/设计日志.md` 条目**

在"装备系统"小节末尾（最后一条 `- **(2026-07-01) 装备整理先落锁定/排序/出售/批售白绿**...` 之后）追加：

```markdown
- **(2026-07-04) 装备加等级维度 + 材料合成系统落地**：`EquipItem` 新增 `level`，与品质独立叠乘（`calcEquipItemStats` 的等级系数配置进 `equip.xlsx` 的 `LevelScaling` 表）；掉落/宝箱装备等级由 `drop.xlsx` 的 `DropGroups.levelMin/levelMax` 决定（宝箱复用同一路径，未单独改 `ChestService`）；新增 `craft.xlsx`/`CraftConfig`/`CraftService`，玩家选部位+档位、材料够就必出装备、品质按档位权重随机，UI 复用底部导航栏原本 `noop` 的 `NavSectHot` 热区。理由：宝箱材料此前只产不消耗；用户明确装备不做强化（已生成装备属性终身不变），所以消耗方向定为"材料换新装备"而非"材料强化旧装备"；等级独立于品质是为了让同品质装备也能因来源关卡/合成档位不同而有梯度，不需要品质数量翻倍就能拉开数值区间。设计文档见 `docs/superpowers/specs/2026-07-04-equip-craft-design.md`。
```

- [ ] **Step 6: 最终提交**

```bash
git add ai/memory/代码地图.md ai/memory/项目状态.md ai/memory/设计日志.md
git commit -m "$(cat <<'EOF'
docs(memory): 同步装备等级 + 材料合成系统的项目记忆

代码地图补 craft/ 与 CraftConfig 模块行；项目状态刷新最近进展/
已完成/待办；设计日志追加本次落地的决策与理由。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 记录（写计划时的自检，供实施者参考）

- **Spec 覆盖**：设计文档 5 个部分（① 等级公式、② 掉落等级区间、③ 合成配置、④ 合成服务、⑤ UI 入口/展示、⑥ 测试计划）分别对应 Task 1、Task 2、Task 3、Task 4、Task 5+6+7、贯穿全部 Task 的测试步骤 + Task 8 的全量验证——无遗漏。
- **实现比设计文档更简化的一处**：设计文档写"`craftEquipment` 拼出完整 `EquipItem`（id 用 `EquipDefs.makeId()`）"，实际实现直接复用 `createEquipItem(slot, quality, rng, level)`（Task 1 已经让它支持 `level` 参数），不需要在 `CraftService` 里重新拼装 `id`/`name`/`stats`——这是同一件事的更简单实现，不是范围变化。
- **参数顺序与设计文档的差异**：设计文档写"`calcEquipItemStats` 签名从 `(slot,quality,rng)` 扩展为 `(slot,quality,level,rng)`"，实际实现把 `level` 追加在 `rng` **之后**（`(slot,quality,rng,level)`），是为了让现有测试文件里所有 3 参调用（`calcEquipItemStats('weapon','rare',()=>0.5)` 这类）保持字面兼容、不用逐个改到 4 参。效果一致（等级系数确实独立叠乘进去了），只是参数顺序为了兼容性做了调整，已在 Task 1 里写清楚。
- **未使用的 `craftTierIds`/`canAffordCraftTier` 双重查表**：`craftEquipment` 内部会调用一次 `getCraftTier`，`canAffordCraftTier` 内部又调用一次 `getCraftTier`——同一次合成请求里 `getCraftTier` 被调用两次。这是纯内存对象查找（`Record` 索引），不是性能热路径（合成是玩家点击触发的一次性操作，不在 `update`/`tick` 里），符合 `ai/skills/性能约束.md` 的"先数据后表现"原则，无需为此额外优化。
