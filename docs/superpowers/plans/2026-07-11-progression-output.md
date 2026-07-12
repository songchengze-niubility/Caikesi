# 养成材料与产出实施计划（产出 spec 的三个代码项）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `docs/superpowers/specs/2026-07-11-progression-output-design.md` 落地三个机制项——宝箱奖励表化（chest.xlsx 新 `Rewards` sheet，现值原样搬、行为等价）、经验曲线 100 级分段（`expToNext` 三段几何）、出售装备返打造石——为子计划 B 的生成式 derive 打通全部产出管道的配置源头。

**Architecture:** 全部纯逻辑层：导表管线加 sheet（seed → xlsx → parser → generated → 类型），`ChestService` 从硬编码档案改读配置；`CharGrowthConfig.expToNext` 无分段旋钮时保持旧公式逐位等价；出售返还复用现有 `returnedGems` 材料回流通路（改名 `returnedMaterials` 一次到位）。

**Tech Stack:** TypeScript 5.8.2（双 tsconfig）、tsx 单测、xlsx 导表管线。

## Global Constraints

- 数值真源是 xlsx：改数值 = 改 `tools/seed-*.ts` → `npm run seed:*` → `npm run config`；严禁手改 `*.config.generated.ts`；产物与 xlsx 都入库。
- 宝箱奖励表化必须**现值原样搬运**：同 seed 开箱结果与表化前逐位一致（spec §10 验收）。
- `expToNext` 不配分段旋钮时与旧纯几何公式**逐位等价**（老档/老表兼容）。
- 出售返石占位值 ≈ 合成价 15~20%（craft tier 10/25/50 石），真实数值子计划 B 反解。
- 每任务收尾 `npm run typecheck && npm test`；整计划收尾 `npm run verify` 全绿。
- 提交策略（用户指示）：**只 `git add` 暂存，不提交**；与 Codex 美术线未暂存改动严格分组。

---

### Task 1: 宝箱奖励表化（chest.xlsx `Rewards` sheet）

**Files:**
- Modify: `tools/seed-chest-xlsx.ts`（加 Rewards sheet）
- Modify: `tools/excel-to-config.ts:581-`（buildChestConfig 解析 Rewards）
- Modify: `assets/scripts/config/ChestConfig.ts`（类型 + shape.rewards）
- Modify: `assets/scripts/chest/ChestService.ts:15-46`（删硬编码档案，改读配置）
- Test: `tools/services-test.ts`

**Interfaces:**
- Produces: `ChestConfig.rewards: Record<ChestType, ChestRewardConfig>`，其中 `ChestRewardConfig = { equipmentRolls: number; forgeStoneMin: number; forgeStoneMax: number; gemCount: number; gemLevelMin: number; gemLevelMax: number; scrollMin: number; scrollMax: number }`。

- [ ] **Step 1: 写失败测试**

`tools/services-test.ts` 追加（沿用该文件 test() 风格）：

```ts
test('ChestConfig.rewards：三种箱型奖励档案由 chest.xlsx 驱动（表化取代硬编码）', () => {
    const r = ChestConfig.rewards;
    assert.deepEqual(r.normal, { equipmentRolls: 1, forgeStoneMin: 2, forgeStoneMax: 4, gemCount: 1, gemLevelMin: 1, gemLevelMax: 1, scrollMin: 0, scrollMax: 0 });
    assert.deepEqual(r.boss, { equipmentRolls: 2, forgeStoneMin: 4, forgeStoneMax: 8, gemCount: 1, gemLevelMin: 1, gemLevelMax: 2, scrollMin: 1, scrollMax: 1 });
    assert.deepEqual(r.chapter, { equipmentRolls: 3, forgeStoneMin: 8, forgeStoneMax: 12, gemCount: 2, gemLevelMin: 2, gemLevelMax: 3, scrollMin: 1, scrollMax: 2 });
});
```

（import 处补 `ChestConfig`。）

- [ ] **Step 2: 跑测确认失败**

Run: `npm run test:services`
Expected: FAIL——`ChestConfig.rewards` 为 undefined。

- [ ] **Step 3: seed 加 Rewards sheet（现值原样搬运）**

`tools/seed-chest-xlsx.ts` 在 TypeWeights 后追加，并在 `addSheet` 调用区补一行、console 摘要补计数：

```ts
// 开箱内容档案（2026-07-11 表化，取代 ChestService.CHEST_REWARD_PROFILE 硬编码；现值原样搬运）。
// forgeStone 实际落袋 = roll[min,max] + floor(来源关卡/2)（关卡加成在 ChestService）。
const REWARDS_HEADER = ['chestType', 'equipmentRolls', 'forgeStoneMin', 'forgeStoneMax', 'gemCount', 'gemLevelMin', 'gemLevelMax', 'scrollMin', 'scrollMax'];
const REWARDS_ROWS: (string | number)[][] = [
    ['normal',  1, 2, 4,  1, 1, 1, 0, 0],
    ['boss',    2, 4, 8,  1, 1, 2, 1, 1],
    ['chapter', 3, 8, 12, 2, 2, 3, 1, 2],
];
```

```ts
addSheet('Rewards', REWARDS_HEADER, REWARDS_ROWS);
```

- [ ] **Step 4: 解析器 + 类型**

`tools/excel-to-config.ts` `buildChestConfig` 内（TypeWeights 校验后、`config` 组装前）追加：

```ts
    const { rows: rewardRows } = sheetToRows(wb, 'Rewards');
    const rewards: Record<string, unknown> = {};
    for (const r of rewardRows) {
        const chestType = reqStr(r['chestType'], 'Rewards.chestType');
        if (!validChestSet.has(chestType)) err(`Rewards: chestType "${chestType}" 非法`);
        if (rewards[chestType]) err(`Rewards: chestType "${chestType}" 重复定义`);
        const nums: Record<string, number> = {};
        for (const k of ['equipmentRolls', 'forgeStoneMin', 'forgeStoneMax', 'gemCount', 'gemLevelMin', 'gemLevelMax', 'scrollMin', 'scrollMax']) {
            nums[k] = reqNum(r[k], `Rewards[${chestType}].${k}`);
            if (nums[k] < 0) err(`Rewards[${chestType}].${k} 不可为负`);
        }
        if (nums['forgeStoneMin'] > nums['forgeStoneMax']) err(`Rewards[${chestType}]: forgeStoneMin > forgeStoneMax`);
        if (nums['gemLevelMin'] > nums['gemLevelMax']) err(`Rewards[${chestType}]: gemLevelMin > gemLevelMax`);
        if (nums['scrollMin'] > nums['scrollMax']) err(`Rewards[${chestType}]: scrollMin > scrollMax`);
        rewards[chestType] = nums;
    }
    for (const t of VALID_CHESTS) if (!rewards[t]) err(`Rewards: 缺少箱型 "${t}"`);
```

`config` 对象加 `rewards`，summary 加 `rewards=${Object.keys(rewards).length}`。

`assets/scripts/config/ChestConfig.ts` 追加：

```ts
// 开箱内容档案（2026-07-11 表化）：装备 roll 次数 / 打造石区间 / 宝石数量与等级档 / 卷轴区间。
// 0 数量 / 0 区间 = 该箱型不产出该材料（rollInt 出 0 后 addMaterial 跳过，行为与旧"字段缺省"等价）。
export interface ChestRewardConfig {
    equipmentRolls: number;
    forgeStoneMin: number;
    forgeStoneMax: number;
    gemCount: number;
    gemLevelMin: number;
    gemLevelMax: number;
    scrollMin: number;
    scrollMax: number;
}
```

`ChestConfigShape` 加 `rewards: Record<ChestType, ChestRewardConfig>;`。

- [ ] **Step 5: ChestService 改读配置**

`assets/scripts/chest/ChestService.ts`：
- 删除 `ChestRewardProfile`/`MaterialRoll` 接口与 `CHEST_REWARD_PROFILE` 常量（15~46 行）；
- import 加 `import { ChestConfig, type ChestRewardConfig } from '../config/ChestConfig';`；
- `openChest` 中 `const profile = CHEST_REWARD_PROFILE[chest.type];` 换为 `const profile: ChestRewardConfig | undefined = ChestConfig.rewards[chest.type];`；
- 装备段沿用 `profile.equipmentRolls`；材料/宝石/卷轴段替换为（保持每类 rng 的 seed 串不变——行为等价的关键）：

```ts
    {
        const rng = createSeededRng(`${chest.seed}|material|${chest.type}|forge_stone|${levelIndex}`);
        addMaterial(reward, 'forge_stone', rollInt(profile.forgeStoneMin, profile.forgeStoneMax, rng) + materialLevelBonus);
    }
    // 宝石：随机类型 + 档位缩放等级（gemCount=0 时自然不产出）
    const types = gemTypes();
    for (let i = 0; i < profile.gemCount; i++) {
        const rng = createSeededRng(`${chest.seed}|gem|${chest.type}|${i}`);
        const type = types[Math.min(types.length - 1, Math.floor(rng() * types.length))];
        const lvRaw = rollInt(profile.gemLevelMin, profile.gemLevelMax, rng);
        const level = Math.max(1, Math.min(gemMaxLevel(type), lvRaw));
        addMaterial(reward, gemMaterialId(type, level), 1);
    }
    // 卷轴（scrollMax=0 时 rollInt 恒 0 → addMaterial 跳过，与旧"无 scrollRolls 字段"等价）
    {
        const rng = createSeededRng(`${chest.seed}|scroll|${chest.type}`);
        addMaterial(reward, 'rune_scroll', rollInt(profile.scrollMin, profile.scrollMax, rng));
    }
```

注意旧 materials 循环的 seed 串是 `|material|${chest.type}|${roll.id}|${levelIndex}`（roll.id='forge_stone'）——新代码字面保持一致。

- [ ] **Step 6: 重导 + 全量验证（行为等价）**

Run: `npm run seed:chest && npm run config && npm run typecheck && npm test`
Expected: 全绿；`services-test` 原有"同 seed 开箱结果一致/高阶宝箱奖励更多/离线宝箱走 chest 规则"等用例不改一字通过 = 行为等价证据。

- [ ] **Step 7: 暂存**

```bash
git add tools/seed-chest-xlsx.ts tools/excel-to-config.ts assets/scripts/config/ChestConfig.ts assets/scripts/chest/ChestService.ts tools/config-xlsx/chest.xlsx assets/scripts/config/chest.config.generated.ts tools/services-test.ts
```

---

### Task 2: 经验曲线 100 级分段（expToNext 三段几何）

**Files:**
- Modify: `assets/scripts/config/BattleConfig.ts:70-75`（charGrowth 类型加 4 个可选旋钮）
- Modify: `tools/seed-battle-xlsx.ts`（Misc 加 4 行）
- Modify: `assets/scripts/growth/CharGrowthConfig.ts:12-18`（expToNext 分段）
- Test: `tools/char-growth-config-test.ts`

**Interfaces:**
- Consumes: `BattleConfig.charGrowth`（Misc 点分键自动聚合，解析器无需改动）。
- Produces: `charGrowth` 新增 `expSeg2Start?/expSeg2Growth?/expSeg3Start?/expSeg3Growth?: number`；`expToNext(level)` 语义：升到 lv 级那一步的增长率 = lv≥seg3Start 用 seg3Growth，否则 lv≥seg2Start 用 seg2Growth，否则用 expGrowthPerLevel；无旋钮时 = 旧纯几何公式逐位等价。

- [ ] **Step 1: 写失败测试**

`tools/char-growth-config-test.ts` 追加：

```ts
test('expToNext：三段几何——段边界单调、后段增速放缓、Lv100 有限（2026-07-11）', () => {
    const cfg = (BattleConfig.charGrowth ?? {}) as Record<string, number>;
    assert.equal(cfg.expSeg2Start, 31, 'Misc 应配 expSeg2Start=31');
    assert.equal(cfg.expSeg3Start, 61, 'Misc 应配 expSeg3Start=61');
    // 段内比率：30→31 步用 seg2Growth，60→61 步用 seg3Growth
    assert.ok(Math.abs(expToNext(31) / expToNext(30) - cfg.expSeg2Growth) < 0.01, '31 级步进应按 seg2Growth');
    assert.ok(Math.abs(expToNext(61) / expToNext(60) - cfg.expSeg3Growth) < 0.01, '61 级步进应按 seg3Growth');
    // 单调递增 + 上限有限（纯 ×1.15 到 100 级是 ~5000 万/级的天文数字，分段后应远小于它）
    let prev = 0;
    for (let lv = 1; lv <= 100; lv++) { const e = expToNext(lv); assert.ok(e > prev, `Lv${lv} 应单调`); prev = e; }
    assert.ok(expToNext(100) < 50 * Math.pow(1.15, 99) / 100, 'Lv100 门槛应远小于纯几何');
    // 1~30 段与旧公式逐位等价
    assert.equal(expToNext(12), Math.round(50 * Math.pow(1.15, 11)), '首段维持旧公式');
});
```

（import 处补 `BattleConfig`。）

- [ ] **Step 2: 跑测确认失败**

Run: `npm run test:growth-config`
Expected: FAIL——`expSeg2Start` 为 undefined。

- [ ] **Step 3: 类型 + Misc 旋钮**

`BattleConfig.ts` `charGrowth` 块改为：

```ts
    charGrowth: {
        expBase: number;
        expGrowthPerLevel: number;   // 第 1 段（2~seg2Start-1 级）每级增长率
        statGrowthPerLevel: number;
        maxLevel: number;
        // 经验曲线分段（2026-07-11，防纯几何到 100 级爆炸；缺省 = 单段旧公式）
        expSeg2Start?: number;   // 第 2 段起始等级（升到该级起用 seg2Growth）
        expSeg2Growth?: number;
        expSeg3Start?: number;
        expSeg3Growth?: number;
    };
```

`tools/seed-battle-xlsx.ts` Misc 在 `charGrowth.maxLevel` 行后追加：

```ts
    // 经验曲线分段（2026-07-11）：1~30 ×1.15 / 31~60 ×1.08 / 61~100 ×1.04（占位，子计划 B 反解）
    ['charGrowth.expSeg2Start', 31],
    ['charGrowth.expSeg2Growth', 1.08],
    ['charGrowth.expSeg3Start', 61],
    ['charGrowth.expSeg3Growth', 1.04],
```

- [ ] **Step 4: expToNext 分段实现（无旋钮 = 旧公式逐位等价）**

`CharGrowthConfig.ts` 替换 `expToNext`：

```ts
// 经验曲线：分段几何（2026-07-11）。升到 lv 级那一步的增长率：
// lv≥expSeg3Start 用 expSeg3Growth；否则 lv≥expSeg2Start 用 expSeg2Growth；否则 expGrowthPerLevel。
// 未配置分段旋钮时退化为单段 base×g^(level-1)，与旧公式逐位等价（老表兼容）。
export function expToNext(level: number): number {
    const cfg = BattleConfig.charGrowth;
    const base = cfg?.expBase ?? 50;
    const g1 = cfg?.expGrowthPerLevel ?? 1.15;
    const clamped = Math.max(1, Math.floor(level));
    const s2 = cfg?.expSeg2Start;
    if (!s2 || !cfg?.expSeg2Growth) return Math.round(base * Math.pow(g1, clamped - 1));
    const g2 = cfg.expSeg2Growth;
    const s3 = cfg.expSeg3Start && cfg.expSeg3Growth ? cfg.expSeg3Start : Infinity;
    const g3 = cfg.expSeg3Growth ?? g2;
    // 总步数 clamped-1；各段步数 = 落在该段的"升级步"（步 lv 属于 [2..clamped]）
    const n1 = Math.max(0, Math.min(clamped, s2 - 1) - 1);
    const n3 = s3 === Infinity ? 0 : Math.max(0, clamped - s3 + 1);
    const n2 = Math.max(0, (clamped - 1) - n1 - n3);
    return Math.round(base * Math.pow(g1, n1) * Math.pow(g2, n2) * Math.pow(g3, n3));
}
```

- [ ] **Step 5: 重导 + 验证**

Run: `npm run seed:battle && npm run config && npm run typecheck && npm test`
Expected: 全绿。注意 `char-growth-test` 的满级用例（喂 10 亿）在分段曲线下累计需求更低，仍应封顶 100 通过。

- [ ] **Step 6: 暂存**

```bash
git add assets/scripts/config/BattleConfig.ts tools/seed-battle-xlsx.ts assets/scripts/growth/CharGrowthConfig.ts tools/config-xlsx/battle.xlsx assets/scripts/config/battle.config.generated.ts tools/char-growth-config-test.ts
```

---

### Task 3: 出售装备返打造石（returnedGems → returnedMaterials）

**Files:**
- Modify: `assets/scripts/inventory/InventoryModel.ts:10`、`:16-22` 附近、`:148-180`
- Modify: `assets/scripts/inventory/InventoryView.ts:679`（透传字段名）
- Modify: `assets/scripts/BattleEntry.ts:329-332`（消费字段名）
- Test: `tools/inventory-test.ts`

**Interfaces:**
- Produces: `SellResult.returnedMaterials?: MaterialItem[]`（**改名**自 `returnedGems`，含镶嵌宝石退回 + 出售返还打造石）；`SELL_FORGE_STONE: Record<Quality, number>` 占位 = common 1 / fine 2 / rare 4 / epic 8 / legend 15（≈合成价 10/25/50 的 15~20% 档，子计划 B 反解）。

- [ ] **Step 1: 写失败测试**

`tools/inventory-test.ts` 追加：

```ts
test('出售返打造石：按品质返还并与退回宝石合入 returnedMaterials', () => {
    const m = new InventoryModel();
    m.backpack.push(fixedItem('s1', 'common'), fixedItem('s2', 'rare'));
    const r1 = m.sellItem('s1');
    assert.equal(r1.ok, true);
    const stone1 = r1.returnedMaterials?.find(x => x.id === 'forge_stone');
    assert.equal(stone1?.count, 1, 'common 应返 1 打造石');
    const r2 = m.sellItem('s2');
    assert.equal(r2.returnedMaterials?.find(x => x.id === 'forge_stone')?.count, 4, 'rare 应返 4 打造石');
});

test('sellBatch：批量返石累计，且与退回宝石共存', () => {
    const m = new InventoryModel();
    m.backpack.push(fixedItem('b1', 'common'), fixedItem('b2', 'fine'));
    const r = m.sellBatch('fine');
    assert.equal(r.ok, true);
    assert.equal(r.returnedMaterials?.find(x => x.id === 'forge_stone')?.count, 1 + 2, 'common1+fine2 应返 3');
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `npm run test:inventory`
Expected: FAIL——`returnedMaterials` 为 undefined。

- [ ] **Step 3: 实现**

`InventoryModel.ts`：
- `SellResult` 字段改名：`returnedGems?` → `returnedMaterials?: MaterialItem[]`（注释：镶嵌宝石退回 + 出售返石）。
- `SELL_PRICE` 旁新增：

```ts
// 出售返还打造石（2026-07-11 spec §6）：≈ 合成价（craft tier 10/25/50 石）的 15~20% 档。
// 占位值，子计划 B 按经济流速反解重写。
const SELL_FORGE_STONE: Record<Quality, number> = {
    common: 1,
    fine: 2,
    rare: 4,
    epic: 8,
    legend: 15,
};
```

- 原 `collectReturnedGems(items)` 调用处改为合并函数（在 `collectReturnedGems` 定义旁加）：

```ts
// 出售返还材料 = 镶嵌宝石退回 + 按品质返打造石
function collectReturnedMaterials(items: EquipItem[]): MaterialItem[] {
    const out = collectReturnedGems(items);
    let stones = 0;
    for (const it of items) stones += SELL_FORGE_STONE[it.quality] ?? 0;
    if (stones > 0) out.push({ id: 'forge_stone', count: stones });
    return out;
}
```

- `sellItem`/`sellBatch` 返回处：`returnedGems: collectReturnedGems([item])` → `returnedMaterials: collectReturnedMaterials([item])`（sellBatch 同理传 `sold`）。

`InventoryView.ts:679`：`returnedGems: (r as any).returnedGems` → `returnedMaterials: (r as any).returnedMaterials`。
`BattleEntry.ts:329-331`：注释与字段同步改 `returnedMaterials`（`(payload as any)?.returnedMaterials`），落袋逻辑不变（本来就按通用 MaterialItem 累加）。
`tools/inventory-test.ts` 原有两个 `returnedGems` 用例的字段名同步改 `returnedMaterials`，并把"无宝石装备→返回空数组或省略"的断言改为"无宝石时仅含 forge_stone 条目"。

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm test`
Expected: 全绿（全仓 `returnedGems` 引用应清零：`rg returnedGems` 无命中）。

- [ ] **Step 5: 暂存**

```bash
git add assets/scripts/inventory/InventoryModel.ts assets/scripts/inventory/InventoryView.ts assets/scripts/BattleEntry.ts tools/inventory-test.ts
```

---

### Task 4: 终验与收尾

- [ ] **Step 1:** Run `npm run verify` → 全绿（含 13 项 pacing——三项改动均不触战斗数值）。
- [ ] **Step 2:** 按 `ai/skills/开发收尾.md`：`项目状态.md` 最近进展加一条 + 待办①推进到"第③步完成，下一步子计划 B"；`代码地图.md` 同步 ChestService（表化）/CharGrowthConfig（分段）/InventoryModel（returnedMaterials）三行与 chest.xlsx 行。
- [ ] **Step 3:** `git add docs/superpowers/specs/2026-07-11-progression-output-design.md docs/superpowers/plans/2026-07-11-progression-output.md`（记忆文件因与 Codex 线混改仍不暂存）。

## Self-Review 记录

- **Spec 覆盖**：§7 表化→Task 1；§2 分段曲线→Task 2；§6 出售返石→Task 3；§10 三条验收各对应 Task 1 Step 6 / Task 2 Step 1 / Task 3 Step 1。§3~§5 的掉率/定价数值属子计划 B，无代码项。
- **类型一致性**：`ChestRewardConfig` 字段名在 seed 表头/解析器/类型/Service 四处一致；`returnedMaterials` 全链改名含测试；`expSeg*` 旋钮名在类型/seed/实现/测试一致。
- **行为等价链**：Task 1 保持 rng seed 串字面不变+现值搬运；Task 2 无旋钮路径保留旧公式（本项目配了旋钮，等价性由"首段与旧公式逐位等价"断言覆盖）；Task 3 是纯新增返还，不改既有金币/宝石语义。
