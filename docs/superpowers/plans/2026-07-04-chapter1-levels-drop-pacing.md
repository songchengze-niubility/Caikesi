# 第一章 10 关 · 关卡与掉落节奏 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把关卡从 2 关铺到第一章 10 关（第 10 关纯数值 Boss），掉落按台阶分成 4 组并接上装备等级区间，联动 chest/offline 表，并加一个节奏门槛自检脚本。

**Architecture:** 全部数值改动走「改种子脚本 → 重建 xlsx → `npm run config` 生成产物」管线（xlsx 是真源，种子脚本保持同步以便重建）；唯一运行时代码改动是 `ChestService` 对老存档旧掉落组名的兜底。新增 `tools/pacing-sim.ts` 用纯逻辑 `BattleManager` 头铁模拟验证三台阶卡点。

**Tech Stack:** TypeScript + tsx 脚本、xlsx（SheetJS）种子脚本、现有导表器 `tools/excel-to-config.ts`。

**设计依据:** `docs/superpowers/specs/2026-07-04-chapter1-levels-drop-pacing-design.md`（台阶在第 4/7/10 关；掉落组 `c1_early/c1_mid/c1_late/c1_boss`；Boss 为纯数值怪 `boss_butcher`）。

## Global Constraints

- 数值真源是 `tools/config-xlsx/*.xlsx`；本计划通过**改种子脚本再重建 xlsx** 的方式修改（AI 无法手编 Excel），改完必跑 `npm run config`。
- `assets/scripts/config/*.generated.ts` 是导表产物，**入库**（要一起提交），**勿手改**。
- `assets/scripts/config/BattleConfig.ts` 只放类型，勿加数值。
- 工作区里有**上一段未提交的改动**（美术序列帧 + ai/memory）——提交时**只 `git add` 本计划涉及的具体文件，严禁 `git add -A` / `git add .`**。
- 中文 commit message，结尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 所有关卡数值是**初版占位**，以 `sim:pacing` 门槛 + 后续 Cocos 手测为准微调。

---

### Task 1: 种子 ↔ xlsx 漂移自检

**Files:**
- 只读检查，不留任何改动（结束时 `git checkout` 还原）。

**Interfaces:**
- Produces: 确认「重建 xlsx 不会丢人工改动」的结论；已知漂移清单（至少含 `Misc.roster`）。

**背景：** 种子脚本注释说「从零重建才跑」，如果策划在 xlsx 里改过而种子没跟上，直接重建会丢改动。已确认一处漂移：`battle.xlsx` 的 `Misc` 里有 `roster=dps`（当前单人阵容），而 `tools/seed-battle-xlsx.ts` 的 `MISC_ROWS` 没有这一行（Task 3 会补上）。本任务确认**没有其它**未知漂移。

- [ ] **Step 1: 确认基线干净**

Run: `git status --short tools/config-xlsx assets/scripts/config`
Expected: 无输出（这两个目录当前无未提交改动；若有，先停下向用户确认）。

- [ ] **Step 2: 用现有种子重建 4 张表并重新导表**

Run:
```powershell
npx tsx tools/seed-battle-xlsx.ts; npm run seed:drop; npm run seed:chest; npm run seed:offline; npm run config
```
Expected: 每个种子打印 `✓ 已生成 ...`；`npm run config` 全部源打印 `✓`，无 `❌`。

- [ ] **Step 3: 对比产物差异**

Run: `git diff -- assets/scripts/config/`
Expected 只允许两类差异：
1. 每个 `.generated.ts` 的 `// 生成时间：` 行（时间戳，必然变）。
2. `battle.config.generated.ts` 里 `"roster": ["dps"]` 消失（已知漂移，Task 3 的种子会补 `['roster', 'dps']`）。

若出现**其它**数值差异：**停止**，把差异逐条回填进对应种子脚本（让种子与 xlsx 重新一致），再重复 Step 2~3 直到只剩上面两类差异，并把发现记录下来汇报用户。

- [ ] **Step 4: 还原工作区**

Run:
```powershell
git checkout -- tools/config-xlsx assets/scripts/config
git status --short tools/config-xlsx assets/scripts/config
```
Expected: 第二条命令无输出（完全还原）。

---

### Task 2: ChestService 老存档掉落组兜底

**Files:**
- Modify: `assets/scripts/chest/ChestService.ts`
- Test: `tools/services-test.ts`

**Interfaces:**
- Consumes: `DropConfig.groups`（`assets/scripts/config/DropConfig.ts` 导出的组表）、`BattleConfig.levels[i].dropGroup`。
- Produces: `openChest(chest)` 在 `chest.sourceDropGroup` 不存在于掉落表时不再抛错，改按来源关卡的现行掉落组兜底。Task 3 的组名重命名依赖此兜底保护老存档宝箱。

**背景：** `DropConfig.getDropGroup` 对未知组名直接 `throw`。存档里已入库的宝箱身上带着 `sourceDropGroup: 'level_1'`，Task 3 重命名掉落组后，开这些老宝箱会崩。

- [ ] **Step 1: 写失败测试**

在 `tools/services-test.ts` 的 `ChestDropService：同 seed 的小怪/关底掉落结果一致` 测试**之前**插入：

```typescript
test('ChestService：宝箱掉落组已不存在时按来源关卡现行掉落组兜底', () => {
    const chest = createChestItem({
        type: 'normal',
        sourceLevelIndex: 0,
        sourceDropGroup: 'gone_group',
        seed: 'legacy-chest',
        createdAt: 1000,
    });
    const res = openChest(chest);
    assert.equal(res.ok, true);
    assert.ok(res.reward!.equipments.length > 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:services`
Expected: 新测试 ✗，报错含 `drop group "gone_group" 不存在`；其余测试 ✓。

- [ ] **Step 3: 实现兜底**

改 `assets/scripts/chest/ChestService.ts`：

第 2 行 import 改为：
```typescript
import { DropConfig, rollDropItems } from '../config/DropConfig';
```

`openChest` 里（`const levelIndex = clampLevelIndex(...)` 之后、装备掷取循环之前）加入解析，并把循环里的 `chest.sourceDropGroup` 换成解析结果：

```typescript
    const levelIndex = clampLevelIndex(chest.sourceLevelIndex);
    // 老存档兼容：宝箱身上的掉落组可能已在表里改名/删除，按来源关卡的现行掉落组兜底
    const dropGroup = DropConfig.groups[chest.sourceDropGroup]
        ? chest.sourceDropGroup
        : BattleConfig.levels[levelIndex].dropGroup;
```

```typescript
        const items = rollDropItems(dropGroup, rng);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:services`
Expected: 全部 ✓（含新测试）。

- [ ] **Step 5: 提交**

```powershell
git add assets/scripts/chest/ChestService.ts tools/services-test.ts
git commit -m @'
fix(chest): 开箱时掉落组失效按来源关卡现行掉落组兜底

为掉落组重命名（level_1/level_2 → c1_*）铺路，保护老存档已入库宝箱。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: 四表种子更新 + 重建 + 测试期望更新（本计划核心）

**Files:**
- Modify: `tools/seed-battle-xlsx.ts`（ENEMY_ROWS / LEVELS_ROWS / MISC_ROWS）
- Modify: `tools/seed-drop-xlsx.ts`（DROP_GROUPS_ROWS / QUALITY_WEIGHTS_ROWS）
- Modify: `tools/seed-chest-xlsx.ts`（GROUPS_ROWS / TYPE_WEIGHTS_ROWS）
- Modify: `tools/seed-offline-xlsx.ts`（LEVELS_ROWS）
- Modify: `tools/drop-config-test.ts`（整文件重写，见 Step 1）
- Modify: `tools/services-test.ts`（组名替换）
- Regenerate: `tools/config-xlsx/battle.xlsx` / `drop.xlsx` / `chest.xlsx` / `offline.xlsx` 及 `assets/scripts/config/battle.config.generated.ts` / `drop.config.generated.ts` / `chest.config.generated.ts` / `offline.config.generated.ts`

**Interfaces:**
- Consumes: Task 2 的 `openChest` 兜底（保护旧组名宝箱）。
- Produces: `BattleConfig.levels` 长 10、`enemyTypes` 含 `boss_butcher`、`DropConfig.groups` 为 `c1_early/c1_mid/c1_late/c1_boss` 四组、`ChestConfig.groups` 同名四组 + `final_boss` 权重组、`OfflineConfig.levels` 10 行。Task 4 的 pacing-sim 依赖这 10 关。

**TDD 顺序：先把测试期望改成新配置（红），再改种子重建（绿）。**

- [ ] **Step 1: 重写掉落配置测试**

`tools/drop-config-test.ts` 整文件替换为：

```typescript
// 掉落配置测试（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';
import { getDropGroup, rollDropItems } from '../assets/scripts/config/DropConfig';
import { QUALITIES, SLOTS } from '../assets/scripts/inventory/EquipDefs';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

function rngSeq(values: number[]): () => number {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
}

test('第一章 10 关按台阶分段指向掉落组', () => {
    assert.equal(BattleConfig.levels.length, 10);
    assert.equal(BattleConfig.levels[0].dropGroup, 'c1_early');
    assert.equal(BattleConfig.levels[2].dropGroup, 'c1_early');
    assert.equal(BattleConfig.levels[3].dropGroup, 'c1_mid');
    assert.equal(BattleConfig.levels[5].dropGroup, 'c1_mid');
    assert.equal(BattleConfig.levels[6].dropGroup, 'c1_late');
    assert.equal(BattleConfig.levels[8].dropGroup, 'c1_late');
    assert.equal(BattleConfig.levels[9].dropGroup, 'c1_boss');
    assert.equal(getDropGroup('c1_early').itemCount, 1);
});

test('第 10 关最后一波包含 Boss 怪', () => {
    const finalWave = BattleConfig.levels[9].waves[BattleConfig.levels[9].waves.length - 1];
    assert.ok(finalWave.spawns.some(s => s.type === 'boss_butcher'), '末波缺少 boss_butcher');
    assert.ok(BattleConfig.enemyTypes.boss_butcher, 'enemyTypes 缺少 boss_butcher');
});

test('dropGroup 覆盖完整品质/部位权重', () => {
    for (const id of ['c1_early', 'c1_mid', 'c1_late', 'c1_boss']) {
        const g = getDropGroup(id);
        for (const q of QUALITIES) assert.ok(g.qualityWeights[q] !== undefined, `${id} 缺少品质权重 ${q}`);
        for (const s of SLOTS) assert.ok(g.slotWeights[s] !== undefined, `${id} 缺少部位权重 ${s}`);
    }
});

test('rollDropItems 按配置生成带属性装备', () => {
    const items = rollDropItems('c1_early', () => 0);
    assert.equal(items.length, 1);
    assert.equal(items[0].slot, 'weapon');
    assert.equal(items[0].quality, 'common');
    assert.ok(items[0].stats && Object.keys(items[0].stats).length > 0, '掉落装备缺少 stats');
});

test('高随机值可命中高品质尾段权重', () => {
    const items = rollDropItems('c1_mid', rngSeq([0, 0.995, 0, 0, 0, 0]));
    assert.equal(items[0].quality, 'legend');
});

test('掉落等级落在各 dropGroup 区间内', () => {
    const ranges: Array<[string, number, number]> = [
        ['c1_early', 1, 5],
        ['c1_mid', 4, 9],
        ['c1_late', 8, 14],
        ['c1_boss', 12, 18],
    ];
    for (const [id, min, max] of ranges) {
        for (let i = 0; i < 30; i++) {
            for (const item of rollDropItems(id, Math.random)) {
                assert.ok(item.level !== undefined && item.level >= min && item.level <= max,
                    `${id} 掉落等级应在 [${min},${max}]，得到 ${item.level}`);
            }
        }
    }
});

test('rollDropItems：level 区间边界（rng=0 取最低，rng 接近 1 取最高）', () => {
    const low = rollDropItems('c1_early', () => 0);
    assert.equal(low[0].level, 1);
    const high = rollDropItems('c1_early', () => 0.999999);
    assert.equal(high[0].level, 5);
});

test('Boss 掉落组一次掉两件', () => {
    const items = rollDropItems('c1_boss', Math.random);
    assert.equal(items.length, 2);
});

console.log(`\n掉落配置测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 替换服务层测试里的组名**

`tools/services-test.ts` 做纯文本替换（Task 2 已加的兜底测试里的 `'gone_group'` **不要动**）：
- 所有 `'level_1'` → `'c1_early'`（出现处：4 个 `createChestItem` 的 `sourceDropGroup`、4 个 `rollChestDrop` 的 `dropGroup`）。
- 所有 `'level_2'` → `'c1_mid'`（出现处：2 个 `createChestItem`）。
- `Offline：宝箱由 chest.xlsx 规则产生…` 测试里的 4 处 `ChestConfig.groups.level_1` → `ChestConfig.groups.c1_early`。

- [ ] **Step 3: 跑测试确认红**

Run: `npm run test:drop; npm run test:services`
Expected: 两者都有 ✗，报错含 `drop group "c1_early" 不存在`（当前配置还是旧组名）。

- [ ] **Step 4: 更新 `tools/seed-drop-xlsx.ts`**

`DROP_GROUPS_ROWS` 与 `QUALITY_WEIGHTS_ROWS` 替换为（`SLOT_WEIGHTS_ROWS` 不动）：

```typescript
const DROP_GROUPS_ROWS: (string | number)[][] = [
    // 第一章按台阶分段：1~3 / 4~6 / 7~9 / 10(Boss)；等级区间相邻重叠保证成长平滑
    ['c1_early', 1, 'c1_early', 'any', 1, 5],
    ['c1_mid',   1, 'c1_mid',   'any', 4, 9],
    ['c1_late',  1, 'c1_late',  'any', 8, 14],
    ['c1_boss',  2, 'c1_boss',  'any', 12, 18],
];

const QUALITY_WEIGHTS_ROWS: (string | number)[][] = [
    ['c1_early', 'common', 65],
    ['c1_early', 'fine', 25],
    ['c1_early', 'rare', 9],
    ['c1_early', 'epic', 1],
    ['c1_early', 'legend', 0],
    ['c1_mid', 'common', 50],
    ['c1_mid', 'fine', 30],
    ['c1_mid', 'rare', 15],
    ['c1_mid', 'epic', 4],
    ['c1_mid', 'legend', 1],
    ['c1_late', 'common', 35],
    ['c1_late', 'fine', 35],
    ['c1_late', 'rare', 22],
    ['c1_late', 'epic', 7],
    ['c1_late', 'legend', 1],
    ['c1_boss', 'common', 15],
    ['c1_boss', 'fine', 30],
    ['c1_boss', 'rare', 35],
    ['c1_boss', 'epic', 17],
    ['c1_boss', 'legend', 3],
];
```

- [ ] **Step 5: 更新 `tools/seed-battle-xlsx.ts`**

`ENEMY_ROWS` 追加 Boss 行（其余三行不动）：

```typescript
const ENEMY_ROWS: (string | number)[][] = [
    ['zombie', '丧尸',   90,  28, 0.8, '230,70,70',  120, 18, 4,  0, 1.0, 0.05, 0.5, 0.05, 0.0, 0.0, 0.0, 0.0],
    ['runner', '疾行者', 175, 22, 0.6, '240,150,60', 70,  14, 2,  0, 1.4, 0.05, 0.5, 0.15, 0.0, 0.0, 0.0, 0.0],
    ['brute',  '重装',   55,  40, 1.2, '170,80,200', 360, 30, 12, 0, 0.8, 0.05, 0.5, 0.0,  0.0, 0.0, 0.0, 0.15],
    // 第一章 Boss：纯数值型大体型（约普通重装 12.5 倍血、高减免），无技能机制
    ['boss_butcher', '屠夫领主', 40, 60, 1.5, '150,40,40', 4500, 55, 20, 0, 0.8, 0.05, 0.5, 0.0, 0.0, 0.0, 0.0, 0.30],
];
```

`LEVELS_ROWS` 整体替换为第一章 10 关（行内注释给出每关「总血量占位强度」，相对第 1 关 3570 的倍数，是调参锚点不是承诺值）：

```typescript
const LEVELS_ROWS: (string | number)[][] = [
    // 第1关 · 试炼 —— 3570（×1.0 基准），保持原样
    [0, '第1关 · 试炼', 2.0, 'c1_early', 0, 'zombie', 6,  0.7,  ''],
    [0, '第1关 · 试炼', 2.0, 'c1_early', 1, 'zombie', 8,  0.5,  ''],
    [0, '第1关 · 试炼', 2.0, 'c1_early', 1, 'runner', 3,  1.2,  ''],
    [0, '第1关 · 试炼', 2.0, 'c1_early', 2, 'brute',  2,  1.6,  ''],
    [0, '第1关 · 试炼', 2.0, 'c1_early', 2, 'zombie', 8,  0.45, ''],
    // 第2关 · 前哨 —— ≈4330（×1.2）
    [1, '第2关 · 前哨', 2.0, 'c1_early', 0, 'zombie', 10, 0.6,  ''],
    [1, '第2关 · 前哨', 2.0, 'c1_early', 1, 'zombie', 8,  0.5,  ''],
    [1, '第2关 · 前哨', 2.0, 'c1_early', 1, 'runner', 4,  1.0,  ''],
    [1, '第2关 · 前哨', 2.0, 'c1_early', 2, 'brute',  2,  1.6,  ''],
    [1, '第2关 · 前哨', 2.0, 'c1_early', 2, 'zombie', 8,  0.45, ''],
    [1, '第2关 · 前哨', 2.0, 'c1_early', 2, 'runner', 3,  1.0,  ''],
    // 第3关 · 溃堤 —— ≈5200（×1.46）
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 0, 'runner', 8,  0.45, ''],
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 1, 'zombie', 12, 0.4,  150],
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 1, 'runner', 4,  1.0,  ''],
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 2, 'brute',  3,  1.5,  ''],
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 2, 'zombie', 10, 0.4,  ''],
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 2, 'runner', 4,  0.8,  ''],
    // 第4关 · 铁壁 —— ≈7480（×2.1，台阶一：重装比例突增，检查 1~3 段装备）
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 0, 'zombie', 10, 0.5,  150],
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 1, 'brute',  4,  1.3,  ''],
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 2, 'brute',  3,  1.4,  ''],
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 2, 'runner', 6,  0.8,  ''],
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 3, 'brute',  4,  1.2,  460],
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 3, 'zombie', 8,  0.4,  150],
    // 第5关 · 缓坡 —— ≈7700（×2.16）
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 0, 'zombie', 14, 0.45, 150],
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 1, 'runner', 10, 0.5,  90],
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 2, 'brute',  3,  1.4,  460],
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 2, 'zombie', 10, 0.4,  150],
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 3, 'brute',  2,  1.5,  460],
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 3, 'runner', 10, 0.5,  90],
    // 第6关 · 夹击 —— ≈9000（×2.52）
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 0, 'runner', 12, 0.4,  90],
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 1, 'zombie', 14, 0.4,  160],
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 2, 'brute',  4,  1.3,  460],
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 2, 'runner', 6,  0.7,  90],
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 3, 'brute',  3,  1.4,  460],
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 3, 'zombie', 12, 0.4,  160],
    // 第7关 · 壁垒 —— ≈11980（×3.36，台阶二：检查 4~6 段装备 + 合成）
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 0, 'zombie', 12, 0.4,  200],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 1, 'brute',  4,  1.2,  560],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 2, 'runner', 12, 0.4,  110],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 3, 'brute',  4,  1.2,  560],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 3, 'zombie', 10, 0.4,  200],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 4, 'brute',  2,  1.4,  560],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 4, 'runner', 6,  0.6,  110],
    // 第8关 · 风暴 —— ≈12600（×3.53）
    [7, '第8关 · 风暴', 1.6, 'c1_late', 0, 'runner', 14, 0.35, 110],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 1, 'zombie', 16, 0.35, 200],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 2, 'brute',  4,  1.2,  560],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 3, 'zombie', 12, 0.4,  200],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 3, 'runner', 8,  0.5,  110],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 4, 'brute',  3,  1.3,  560],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 4, 'runner', 6,  0.6,  110],
    // 第9关 · 黑潮 —— ≈13920（×3.9）
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 0, 'zombie', 14, 0.35, 220],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 1, 'brute',  4,  1.2,  600],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 2, 'runner', 14, 0.35, 120],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 3, 'brute',  4,  1.2,  600],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 3, 'zombie', 10, 0.4,  220],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 4, 'brute',  2,  1.4,  600],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 4, 'runner', 8,  0.5,  120],
    // 第10关 · 屠夫领主 —— ≈16260（×4.55，台阶三：4 普通波 + Boss 波）
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 0, 'zombie', 14, 0.35, 240],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 1, 'runner', 12, 0.4,  120],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 2, 'brute',  4,  1.2,  600],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 3, 'zombie', 12, 0.4,  240],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 3, 'runner', 8,  0.5,  120],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 4, 'boss_butcher', 1, 1.0, ''],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 4, 'runner', 6,  0.8,  120],
];
```

`MISC_ROWS` 补回漂移的 roster 行（其余不动）：

```typescript
const MISC_ROWS: (string | number)[][] = [
    ['startLevel', 0],
    ['roster', 'dps'],
    ['combat.minDamageRate', 0.1],
    ['layout.frontMargin', 360],
    ['layout.spacing', 110],
    ['bullet.speed', 1100],
    ['bullet.radius', 8],
    ['formation.contactGap', 150],
];
```

- [ ] **Step 6: 更新 `tools/seed-chest-xlsx.ts`**

```typescript
const GROUPS_ROWS: (string | number)[][] = [
    ['default',  0.03, 0.35, 'mob_default', 'final_default'],
    ['c1_early', 0.03, 0.35, 'mob_default', 'final_default'],
    ['c1_mid',   0.03, 0.35, 'mob_default', 'final_default'],
    ['c1_late',  0.03, 0.35, 'mob_default', 'final_default'],
    // Boss 关：关底必掉宝箱，走独立权重组（首个章节宝箱产出点）
    ['c1_boss',  0.03, 1.0,  'mob_default', 'final_boss'],
];

const TYPE_WEIGHTS_ROWS: (string | number)[][] = [
    ['mob_default', 'normal', 95],
    ['mob_default', 'boss', 5],
    ['mob_default', 'chapter', 0],
    ['final_default', 'normal', 65],
    ['final_default', 'boss', 35],
    ['final_default', 'chapter', 0],
    ['final_boss', 'normal', 20],
    ['final_boss', 'boss', 60],
    ['final_boss', 'chapter', 20],
];
```

- [ ] **Step 7: 更新 `tools/seed-offline-xlsx.ts`**

```typescript
const LEVELS_ROWS: (string | number)[][] = [
    // 台阶关（第4/7/10 = levelIndex 3/6/9）胜率下调，体现卡点
    [0, 45,  1,    8,  5],
    [1, 50,  0.95, 10, 7],
    [2, 60,  0.9,  13, 9],
    [3, 75,  0.85, 17, 12],
    [4, 80,  0.9,  22, 15],
    [5, 90,  0.88, 28, 20],
    [6, 100, 0.75, 36, 26],
    [7, 105, 0.82, 47, 33],
    [8, 115, 0.8,  60, 43],
    [9, 120, 0.6,  78, 56],
];
```

- [ ] **Step 8: 重建 xlsx 并导表**

Run:
```powershell
npx tsx tools/seed-battle-xlsx.ts; npm run seed:drop; npm run seed:chest; npm run seed:offline; npm run config
```
Expected: 4 个 `✓ 已生成`；`npm run config` 各源全 `✓` 无 `❌`。打开 `battle.config.generated.ts` 抽查：`levels` 长度 10、含 `boss_butcher`、`roster: ["dps"]` 仍在。

- [ ] **Step 9: 全套测试确认绿**

Run:
```powershell
npm run test:drop; npm run test:services; npm run test:combat; npm run test:inventory; npm run test:effective; npm run test:progression; npm run test:craft
```
Expected: 全部通过、`0 失败`。（`test:combat` 用第 1 关且未改动，应天然绿。）

- [ ] **Step 10: 提交**

```powershell
git add tools/seed-battle-xlsx.ts tools/seed-drop-xlsx.ts tools/seed-chest-xlsx.ts tools/seed-offline-xlsx.ts tools/drop-config-test.ts tools/services-test.ts tools/config-xlsx/battle.xlsx tools/config-xlsx/drop.xlsx tools/config-xlsx/chest.xlsx tools/config-xlsx/offline.xlsx assets/scripts/config/battle.config.generated.ts assets/scripts/config/drop.config.generated.ts assets/scripts/config/chest.config.generated.ts assets/scripts/config/offline.config.generated.ts
git commit -m @'
feat(level): 第一章 10 关 + 屠夫领主 Boss + 台阶式掉落分组

- 关卡铺到 10 关，台阶卡点在第 4/7/10 关，第 10 关纯数值 Boss（boss_butcher）
- 掉落按台阶分 4 组（c1_early/mid/late/boss），装备等级区间随段位递进，闭环"掉落等级挂钩关卡"待办
- chest.xlsx 新增 final_boss 权重组（Boss 关底必掉宝箱、首个章节宝箱产出点）；offline.xlsx 扩到 10 关
- 种子脚本补回 Misc.roster 漂移；数值为占位初版待手测调参

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

（若 xlsx/meta 提交被 Cocos 相关 hook 阻拦，如实报告，不要绕过。）

---

### Task 4: pacing-sim 节奏门槛自检

**Files:**
- Create: `tools/pacing-sim.ts`
- Modify: `package.json`（scripts 加一行）

**Interfaces:**
- Consumes: `new BattleManager(width, height, levelIndex, statsOverride)`（`assets/scripts/combat/BattleManager.ts`；`phase: 'spawning'|'gap'|'won'|'lost'`，`tick(dt)`，`drainEvents()`）；`BattleConfig.stats.dps` / `BattleConfig.levels`。
- Produces: `npm run sim:pacing` —— 三台阶卡点断言，失败退出码 1。**不加入常规测试链**（跑一次约数十秒，数值调参后按需跑）。

**原理：** 用「期望装备战力倍率」占位（hp/atk 同乘）模拟不同装备段位的玩家，验证：台阶关低一档战力大概率失败、达标战力大概率通过；非台阶关本段战力大概率通过。战斗内有暴击/闪避随机，所以跑多次取胜率。

- [ ] **Step 1: 写脚本**

Create `tools/pacing-sim.ts`:

```typescript
// 关卡节奏门槛自检（纯逻辑，tsx 运行，不进常规测试链）。
// 用途：关卡/掉落数值调参后跑 `npm run sim:pacing`，验证三台阶（第4/7/10关）卡点成立。
// GEAR_POWER 是「期望装备战力倍率」占位（相对裸装 hp/atk 同乘），
// 与掉落段位对应：裸装 / 1~3段成型 / 4~6段成型 / 7~9段成型；
// 后续可用 EffectiveStats + 实际掉落装备实测校准。
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';

const RUNS = 5;            // 每个场景模拟次数（战斗内含暴击/闪避随机）
const MAX_TICKS = 24000;   // 0.05s/tick → 最长 20 分钟战斗，防不收敛
const PASS_RATE = 0.8;     // 「大概率通过」阈值
const FAIL_RATE = 0.4;     // 「大概率卡关」阈值（胜率必须低于它）

const GEAR_POWER = [1.0, 1.6, 2.4, 3.6];

function winRate(levelIndex: number, powerMult: number): number {
    let wins = 0;
    for (let run = 0; run < RUNS; run++) {
        const base = BattleConfig.stats.dps;
        const mgr = new BattleManager(470, 836, levelIndex, {
            dps: { ...base, hp: Math.round(base.hp * powerMult), atk: Math.round(base.atk * powerMult) },
        });
        for (let i = 0; i < MAX_TICKS && mgr.phase !== 'won' && mgr.phase !== 'lost'; i++) {
            mgr.tick(0.05);
            mgr.drainEvents();
        }
        if (mgr.phase === 'won') wins++;
    }
    return wins / RUNS;
}

// 每个门槛：level 下标 + 应卡关的战力档（可缺省）+ 应通过的战力档
const GATES: Array<{ level: number; failPower?: number; passPower: number }> = [
    { level: 0, passPower: GEAR_POWER[0] },
    { level: 2, passPower: GEAR_POWER[0] },
    { level: 3, failPower: GEAR_POWER[0], passPower: GEAR_POWER[1] }, // 台阶一
    { level: 5, passPower: GEAR_POWER[1] },
    { level: 6, failPower: GEAR_POWER[1], passPower: GEAR_POWER[2] }, // 台阶二
    { level: 8, passPower: GEAR_POWER[2] },
    { level: 9, failPower: GEAR_POWER[2], passPower: GEAR_POWER[3] }, // 台阶三 Boss
];

let failed = 0;
for (const gate of GATES) {
    const name = BattleConfig.levels[gate.level].name;
    if (gate.failPower !== undefined) {
        const rate = winRate(gate.level, gate.failPower);
        const ok = rate < FAIL_RATE;
        if (!ok) failed++;
        console.log(`  ${ok ? '✓' : '✗'} ${name} ×${gate.failPower} 应卡关：胜率 ${(rate * 100).toFixed(0)}%（要求 <${FAIL_RATE * 100}%）`);
    }
    const rate = winRate(gate.level, gate.passPower);
    const ok = rate >= PASS_RATE;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name} ×${gate.passPower} 应通过：胜率 ${(rate * 100).toFixed(0)}%（要求 ≥${PASS_RATE * 100}%）`);
}

console.log(`\n节奏自检：${failed === 0 ? '全部达标' : failed + ' 项不达标'}`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: 加 npm script**

`package.json` 的 `scripts` 里 `"check:art"` 之前加：

```json
    "sim:pacing": "tsx tools/pacing-sim.ts",
```

- [ ] **Step 3: 跑并调参到达标**

Run: `npm run sim:pacing`
Expected: 打印每个门槛的胜率；目标「全部达标」退出码 0。

首跑大概率有不达标项（关卡数值是拍脑袋占位）。调参循环：
1. 看哪个门槛错：应卡关却能过 → 提高该关强度（波内 `count` 或 `hp` 覆盖上调）；应通过却卡 → 降低。优先调 `hp` 覆盖，其次 `count`。
2. 改 `tools/seed-battle-xlsx.ts` 对应行 → `npx tsx tools/seed-battle-xlsx.ts; npm run config` → 重跑 `npm run sim:pacing`。
3. 若怎么调都矛盾（例如 ×1.6 过不了第 5 关但 ×1.6 又能过第 4 关卡点），允许微调 `GEAR_POWER` 的档位值（保持 1.0 起步、单调递增），并在脚本注释里说明理由。
4. 收敛后跑 `npm run test:combat` 确认第 1 关行为未被调坏。

- [ ] **Step 4: 提交**

```powershell
git add tools/pacing-sim.ts package.json tools/seed-battle-xlsx.ts tools/config-xlsx/battle.xlsx assets/scripts/config/battle.config.generated.ts
git commit -m @'
feat(tools): pacing-sim 关卡节奏门槛自检 + 首轮数值校准

用 BattleManager 头铁模拟验证第 4/7/10 关台阶卡点：低一档战力大概率失败、达标战力大概率通过。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

（若 Step 3 没改过种子/配置，`git add` 去掉后三个文件。）

---

### Task 5: 开发收尾（记忆同步）

**Files:**
- Modify: `ai/memory/项目状态.md`（「最近进展」+ 待办勾销）
- Modify: `ai/memory/设计日志.md`（追加决策）
- Modify: `ai/memory/代码地图.md`（工具行 + ChestService 职责）

**Interfaces:**
- Consumes: Task 2~4 的落地结果。
- Produces: 新对话可接力的记忆状态。

按 `ai/skills/开发收尾.md` 走。**注意：`ai/memory/项目状态.md` 在工作区有上一段未提交的改动，本任务在其基础上追加，不要回退已有内容。**

- [ ] **Step 1: 更新 `ai/memory/项目状态.md`**

- 「最近进展」刷新（3~6 行）：第一章 10 关 + 屠夫领主 Boss（纯数值）落地；掉落按台阶 4 组、装备等级区间随段位递进（"掉落等级挂钩 levelIndex"待办闭环）；Boss 关底必掉宝箱且章节宝箱首次可产出；新增 `npm run sim:pacing` 节奏门槛自检；老存档旧组名宝箱开箱有兜底；**尚未人工验证**：Cocos 里 10 关手感与台阶卡点体验。
- 「待办」：删掉/改写「掉落等级区间待关卡系统扩展后挂钩 levelIndex」和「关卡深化…后续做 Boss 波」两条；补一条「关卡数值手测调参（ConfigPanel → 回填 Excel → sim:pacing 回归）」。

- [ ] **Step 2: 追加 `ai/memory/设计日志.md`**

带日期（2026-07-04）记录：① 台阶式节奏（第 4/7/10 关卡点）+ 理由（验证掉落/合成/重打循环的存在感）；② 掉落按台阶分 4 组而非每关一组 + 理由（配置量小、同段刷任意关收益相同）；③ Boss 纯数值不加机制 + 理由（技能系统后置，色块期先验证数值卡点）；④ 开箱掉落组失效按来源关卡兜底 + 理由（掉落组改名不能崩老存档）。

- [ ] **Step 3: 更新 `ai/memory/代码地图.md`**

- 「渲染与调试」或工具相关表加一行：`tools/pacing-sim.ts` | 关卡节奏门槛自检（`npm run sim:pacing`，不进常规测试链）。
- `chest/ChestService.ts` 行职责补一句：掉落组失效时按来源关卡现行掉落组兜底。

- [ ] **Step 4: 提交**

```powershell
git add ai/memory/项目状态.md ai/memory/设计日志.md ai/memory/代码地图.md
git commit -m @'
docs(memory): 同步第一章 10 关与台阶掉落节奏的项目记忆

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

**注意**：`ai/memory/项目状态.md` 若已含上一段未提交改动，此提交会把它们一并带上——提交前 `git diff --staged ai/memory/项目状态.md` 检查，若混入上一段内容且用户未要求提交，先向用户确认。

---

## 计划外（明确不做）

- 在线胜利金币/经验接入（当前只掉装备+宝箱，节奏设计已考虑）。
- Boss 技能/机制、真实 Boss 美术（色块占位，`color 150,40,40` 大圆）。
- 开箱装备卷数/材料数量配置化（`ChestService` 内固定值，另列待办）。
- Cocos 编辑器人工手感验收（计划完成后由用户执行，`sim:pacing` 只兜数值门槛）。
