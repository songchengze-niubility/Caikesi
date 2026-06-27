# 装备存储系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给项目加一套装备的存储与管理子系统（背包/仓库/5 装备栏 + 掉落/转移/穿脱 + 本地持久化），不影响战斗数值。

**Architecture:** 纯逻辑数据模型 `InventoryModel`（不依赖 cc，可单测）+ Cocos 节点占位 UI `InventoryView`（覆盖层）+ 复用 `DataService` 持久化。BattleEntry 仅加两个按钮挂载，战斗逻辑零改动。

**Tech Stack:** TypeScript、Cocos Creator 3.8.8、tsx（跑纯逻辑单测，沿用现有 `tools/` 脚本风格）。

## Global Constraints

- 平台：微信小游戏（避免热路径同步 `wx.*`；本子系统不在战斗每帧循环里）。
- 逻辑/渲染分离：`InventoryModel`/`EquipDefs`/`InventoryConfig` **不得 import `cc`**（要能被 tsx 单测）；渲染只在 `InventoryView`。
- 阶段：色块占位，UI 用 Graphics/Label，接美术时换 Sprite，不动 Model。
- 不碰战斗：不改 `BattleManager` / `CombatFormula`。
- 操作原子：每个操作要么完整成功、要么完整失败，不留半成品状态。
- 装备只能进 `item.slot` 对应的装备栏。
- 持久化只走 `DataService` 这一个接缝。
- 测试文件放 `tools/` 下（`assets/` 会被 Cocos 编译，测试不能进去）。

---

### Task 1: 装备定义 EquipDefs + 配置 InventoryConfig

**Files:**
- Create: `assets/scripts/inventory/EquipDefs.ts`
- Create: `assets/scripts/inventory/InventoryConfig.ts`
- Test: `tools/inventory-test.ts`
- Modify: `package.json`（加 `test:inventory` 脚本）

**Interfaces:**
- Produces: `EquipSlot`, `Quality`, `EquipItem`, `SLOTS`, `SLOT_LABEL`, `QUALITIES`, `QUALITY_LABEL`, `QUALITY_COLOR`, `makeId(): string`, `randomItem(): EquipItem`；`InventoryConfig.{backpackCap,warehouseCap}`。

- [ ] **Step 1: 写失败测试** — 创建 `tools/inventory-test.ts`

```ts
// 装备存储系统单测（纯逻辑，tsx 运行）。assets 下的 Model/Defs 不依赖 cc，故可直接 import。
import * as assert from 'node:assert/strict';
import { randomItem, SLOTS, QUALITIES, makeId } from '../assets/scripts/inventory/EquipDefs';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('randomItem 产出合法 slot/quality/name', () => {
    for (let i = 0; i < 50; i++) {
        const it = randomItem();
        assert.ok(SLOTS.includes(it.slot), 'slot 非法: ' + it.slot);
        assert.ok(QUALITIES.includes(it.quality), 'quality 非法: ' + it.quality);
        assert.ok(typeof it.name === 'string' && it.name.length > 0, 'name 为空');
    }
});

test('makeId 连续调用唯一', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(makeId());
    assert.equal(ids.size, 1000);
});

console.log(`\n装备测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 运行确认失败**

Run: `npx tsx tools/inventory-test.ts`
Expected: FAIL —— 报找不到模块 `../assets/scripts/inventory/EquipDefs`。

- [ ] **Step 3: 实现 EquipDefs** — 创建 `assets/scripts/inventory/EquipDefs.ts`

```ts
// 装备定义（占位）：部位/品质/颜色/名字池 + 随机生成。
// 纯数据，不依赖 cc。后续接 equip.xlsx 时整体替换，Model/UI 接口不变。

export type EquipSlot = 'weapon' | 'helmet' | 'chest' | 'pants' | 'shoes'; // 武器/头盔/胸甲/裤子/鞋子
export type Quality = 'common' | 'fine' | 'rare' | 'epic' | 'legend';       // 白/绿/蓝/紫/橙

export interface EquipItem {
    id: string;        // 实例唯一 id
    slot: EquipSlot;   // 部位
    name: string;      // 占位名
    quality: Quality;  // 品质
}

export const SLOTS: EquipSlot[] = ['weapon', 'helmet', 'chest', 'pants', 'shoes'];
export const SLOT_LABEL: Record<EquipSlot, string> = {
    weapon: '武器', helmet: '头盔', chest: '胸甲', pants: '裤子', shoes: '鞋子',
};

export const QUALITIES: Quality[] = ['common', 'fine', 'rare', 'epic', 'legend'];
export const QUALITY_LABEL: Record<Quality, string> = {
    common: '普通', fine: '优秀', rare: '精良', epic: '史诗', legend: '传说',
};
export const QUALITY_COLOR: Record<Quality, [number, number, number]> = {
    common: [180, 180, 180], fine: [90, 200, 120], rare: [80, 150, 235],
    epic: [170, 90, 210], legend: [235, 160, 50],
};

const NAME_POOL: Record<EquipSlot, string[]> = {
    weapon: ['短剑', '长剑', '巨斧', '法杖'],
    helmet: ['皮帽', '铁盔', '头巾'],
    chest: ['布衣', '锁甲', '板甲'],
    pants: ['短裤', '护腿', '重甲裤'],
    shoes: ['草鞋', '皮靴', '战靴'],
};

let _seq = 0;
// Date(ms) + 自增序列 → 同一毫秒内也唯一
export function makeId(): string {
    return `eq_${Date.now().toString(36)}_${(_seq++).toString(36)}`;
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export function randomItem(): EquipItem {
    const slot = pick(SLOTS);
    const quality = pick(QUALITIES);
    const name = pick(NAME_POOL[slot]);
    return { id: makeId(), slot, name, quality };
}
```

- [ ] **Step 4: 实现 InventoryConfig** — 创建 `assets/scripts/inventory/InventoryConfig.ts`

```ts
// 装备存储配置（小常量，方便调）。纯数据，不依赖 cc。
export const InventoryConfig = {
    backpackCap: 20,    // 背包格子上限
    warehouseCap: 50,   // 仓库格子上限
};
```

- [ ] **Step 5: 加 npm 脚本** — 修改 `package.json` 的 `scripts`

```json
"scripts": {
    "config": "tsx tools/excel-to-config.ts",
    "test:inventory": "tsx tools/inventory-test.ts"
}
```

- [ ] **Step 6: 运行确认通过**

Run: `npm run test:inventory`
Expected: PASS —— `2 通过，0 失败`。

- [ ] **Step 7: 提交**

```bash
git add assets/scripts/inventory/EquipDefs.ts assets/scripts/inventory/InventoryConfig.ts tools/inventory-test.ts package.json
git commit -m "feat(equip): 装备定义 EquipDefs + 配置 + 单测骨架"
```

---

### Task 2: InventoryModel — 空构造 + dropRandom + 满判定

**Files:**
- Create: `assets/scripts/inventory/InventoryModel.ts`
- Test: `tools/inventory-test.ts`（追加）

**Interfaces:**
- Consumes: `EquipItem`, `EquipSlot`, `SLOTS`, `randomItem`（Task 1）；`InventoryConfig`（Task 1）。
- Produces: `OpResult { ok: boolean; reason?: string }`，`InventorySave { backpack: EquipItem[]; warehouse: EquipItem[]; equipped: Record<EquipSlot, EquipItem|null> }`，`class InventoryModel`，构造签名 `new InventoryModel(backpackCap?, warehouseCap?)`，字段 `backpack/warehouse/equipped`，getter `backpackFull/warehouseFull`，方法 `dropRandom(): OpResult`。

- [ ] **Step 1: 写失败测试** — 在 `tools/inventory-test.ts` 顶部 import 后追加测试（放在 `console.log` 汇总行之前）

```ts
import { InventoryModel } from '../assets/scripts/inventory/InventoryModel';

test('新建模型：背包/仓库空，5 装备栏均 null', () => {
    const m = new InventoryModel();
    assert.equal(m.backpack.length, 0);
    assert.equal(m.warehouse.length, 0);
    for (const s of SLOTS) assert.equal(m.equipped[s], null);
});

test('dropRandom 进背包；背包满则失败', () => {
    const m = new InventoryModel(2, 2); // 小上限便于测满
    assert.equal(m.dropRandom().ok, true);
    assert.equal(m.dropRandom().ok, true);
    assert.equal(m.backpack.length, 2);
    const r = m.dropRandom();
    assert.equal(r.ok, false);
    assert.equal(r.reason, '背包已满');
    assert.equal(m.backpack.length, 2);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:inventory`
Expected: FAIL —— 找不到模块 `InventoryModel`。

- [ ] **Step 3: 实现 InventoryModel（本任务部分）** — 创建 `assets/scripts/inventory/InventoryModel.ts`

```ts
// 装备存储模型（纯逻辑，不依赖 cc）：背包 / 仓库 / 5 装备栏 + 掉落/转移/穿脱 + 序列化。
// 所有操作返回 OpResult，满了/非法就失败，绝不静默丢装备。

import { EquipItem, EquipSlot, SLOTS, randomItem } from './EquipDefs';
import { InventoryConfig } from './InventoryConfig';

export interface OpResult { ok: boolean; reason?: string; }
const OK: OpResult = { ok: true };
function fail(reason: string): OpResult { return { ok: false, reason }; }

export interface InventorySave {
    backpack: EquipItem[];
    warehouse: EquipItem[];
    equipped: Record<EquipSlot, EquipItem | null>;
}

function emptyEquipped(): Record<EquipSlot, EquipItem | null> {
    const e = {} as Record<EquipSlot, EquipItem | null>;
    for (const s of SLOTS) e[s] = null;
    return e;
}

export class InventoryModel {
    backpack: EquipItem[] = [];
    warehouse: EquipItem[] = [];
    equipped: Record<EquipSlot, EquipItem | null> = emptyEquipped();

    constructor(
        private backpackCap = InventoryConfig.backpackCap,
        private warehouseCap = InventoryConfig.warehouseCap,
    ) {}

    get backpackFull(): boolean { return this.backpack.length >= this.backpackCap; }
    get warehouseFull(): boolean { return this.warehouse.length >= this.warehouseCap; }

    // 调试掉落：随机生成一件 → 背包
    dropRandom(): OpResult {
        if (this.backpackFull) return fail('背包已满');
        this.backpack.push(randomItem());
        return OK;
    }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:inventory`
Expected: PASS —— `4 通过，0 失败`。

- [ ] **Step 5: 提交**

```bash
git add assets/scripts/inventory/InventoryModel.ts tools/inventory-test.ts
git commit -m "feat(equip): InventoryModel 空构造 + dropRandom + 满判定"
```

---

### Task 3: InventoryModel — 背包↔仓库转移

**Files:**
- Modify: `assets/scripts/inventory/InventoryModel.ts`
- Test: `tools/inventory-test.ts`（追加）

**Interfaces:**
- Produces: `InventoryModel.toWarehouse(id: string): OpResult`，`InventoryModel.toBackpack(id: string): OpResult`。

- [ ] **Step 1: 写失败测试** — 追加

```ts
test('toWarehouse：背包→仓库；id 不存在/仓库满则失败', () => {
    const m = new InventoryModel(5, 1);
    m.dropRandom();
    const id = m.backpack[0].id;
    assert.equal(m.toWarehouse(id).ok, true);
    assert.equal(m.backpack.length, 0);
    assert.equal(m.warehouse.length, 1);
    assert.equal(m.toWarehouse('不存在').ok, false);
    m.dropRandom();
    const r = m.toWarehouse(m.backpack[0].id); // 仓库满
    assert.equal(r.ok, false);
    assert.equal(r.reason, '仓库已满');
});

test('toBackpack：仓库→背包；背包满则失败', () => {
    const m = new InventoryModel(1, 5);
    m.dropRandom();
    const id = m.backpack[0].id;
    m.toWarehouse(id);              // 背包空、仓库 1
    assert.equal(m.toBackpack(id).ok, true);
    assert.equal(m.backpack.length, 1);
    m.warehouse.push({ id: 'x', slot: 'weapon', name: '测试', quality: 'common' });
    const r = m.toBackpack('x');   // 背包满
    assert.equal(r.ok, false);
    assert.equal(r.reason, '背包已满');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:inventory`
Expected: FAIL —— `m.toWarehouse is not a function`。

- [ ] **Step 3: 实现转移** — 在 `InventoryModel` 类内 `dropRandom` 之后追加

```ts
    // 背包 → 仓库
    toWarehouse(id: string): OpResult {
        const i = this.backpack.findIndex(it => it.id === id);
        if (i < 0) return fail('装备不在背包');
        if (this.warehouseFull) return fail('仓库已满');
        this.warehouse.push(this.backpack.splice(i, 1)[0]);
        return OK;
    }

    // 仓库 → 背包
    toBackpack(id: string): OpResult {
        const i = this.warehouse.findIndex(it => it.id === id);
        if (i < 0) return fail('装备不在仓库');
        if (this.backpackFull) return fail('背包已满');
        this.backpack.push(this.warehouse.splice(i, 1)[0]);
        return OK;
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:inventory`
Expected: PASS —— `6 通过，0 失败`。

- [ ] **Step 5: 提交**

```bash
git add assets/scripts/inventory/InventoryModel.ts tools/inventory-test.ts
git commit -m "feat(equip): InventoryModel 背包↔仓库转移"
```

---

### Task 4: InventoryModel — 穿戴 / 脱下

**Files:**
- Modify: `assets/scripts/inventory/InventoryModel.ts`
- Test: `tools/inventory-test.ts`（追加）

**Interfaces:**
- Produces: `InventoryModel.equip(id: string): OpResult`，`InventoryModel.unequip(slot: EquipSlot): OpResult`。

**实现要点（写进注释）：** equip 是「先从背包移除该件，再放回旧装备」，净背包数 ≤ 原数 → **永不超上限，无需回滚**；故 equip 只在 id 不在背包时失败。unequip 会让背包 +1，需判满。

- [ ] **Step 1: 写失败测试** — 追加

```ts
test('equip：背包→对应部位；同部位旧装备退回背包', () => {
    const m = new InventoryModel(5, 5);
    const a: any = { id: 'a', slot: 'weapon', name: '剑A', quality: 'common' };
    const b: any = { id: 'b', slot: 'weapon', name: '剑B', quality: 'rare' };
    m.backpack.push(a, b);
    assert.equal(m.equip('a').ok, true);
    assert.equal(m.equipped.weapon!.id, 'a');
    assert.equal(m.backpack.length, 1);          // 只剩 b
    assert.equal(m.equip('b').ok, true);         // 换装：b 上，a 退回
    assert.equal(m.equipped.weapon!.id, 'b');
    assert.deepEqual(m.backpack.map(i => i.id), ['a']);
    assert.equal(m.equip('不存在').ok, false);
});

test('equip：背包满时换装仍成功（净背包数不增）', () => {
    const m = new InventoryModel(2, 5);
    const a: any = { id: 'a', slot: 'helmet', name: '盔A', quality: 'common' };
    const b: any = { id: 'b', slot: 'helmet', name: '盔B', quality: 'epic' };
    m.backpack.push(a, b);                        // 背包满(2/2)
    m.equip('a');                                // a 上, 背包剩 [b] (1/2)
    assert.equal(m.equip('b').ok, true);         // b 上, a 退回 → [a] (1/2)
    assert.equal(m.equipped.helmet!.id, 'b');
    assert.deepEqual(m.backpack.map(i => i.id), ['a']);
});

test('unequip：装备栏→背包；空栏/背包满则失败', () => {
    const m = new InventoryModel(1, 5);
    const a: any = { id: 'a', slot: 'shoes', name: '靴', quality: 'fine' };
    m.backpack.push(a);
    m.equip('a');                                // 背包空，shoes=a
    assert.equal(m.unequip('shoes').ok, true);
    assert.deepEqual(m.backpack.map(i => i.id), ['a']);
    assert.equal(m.unequip('shoes').reason, '该装备栏为空');
    const b: any = { id: 'b', slot: 'chest', name: '甲', quality: 'common' };
    m.equipped.chest = b;                        // 直接塞一件已装备
    const r = m.unequip('chest');               // 背包满(1/1)
    assert.equal(r.ok, false);
    assert.equal(r.reason, '背包已满');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:inventory`
Expected: FAIL —— `m.equip is not a function`。

- [ ] **Step 3: 实现穿脱** — 在 `InventoryModel` 类内 `toBackpack` 之后追加

```ts
    // 背包某件 → 对应部位装备栏；该部位原有装备退回背包。
    // 净背包数 = -1(移出该件) +(0或1)(退回旧件) ≤ 原数 → 永不超上限，无需判满/回滚。
    equip(id: string): OpResult {
        const i = this.backpack.findIndex(it => it.id === id);
        if (i < 0) return fail('装备不在背包');
        const item = this.backpack.splice(i, 1)[0];
        const prev = this.equipped[item.slot];
        this.equipped[item.slot] = item;
        if (prev) this.backpack.push(prev);
        return OK;
    }

    // 装备栏 → 背包（背包 +1，需判满）
    unequip(slot: EquipSlot): OpResult {
        const item = this.equipped[slot];
        if (!item) return fail('该装备栏为空');
        if (this.backpackFull) return fail('背包已满');
        this.equipped[slot] = null;
        this.backpack.push(item);
        return OK;
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:inventory`
Expected: PASS —— `9 通过，0 失败`。

- [ ] **Step 5: 提交**

```bash
git add assets/scripts/inventory/InventoryModel.ts tools/inventory-test.ts
git commit -m "feat(equip): InventoryModel 穿戴/脱下（换装免回滚）"
```

---

### Task 5: InventoryModel — 序列化 / 反序列化

**Files:**
- Modify: `assets/scripts/inventory/InventoryModel.ts`
- Test: `tools/inventory-test.ts`（追加）

**Interfaces:**
- Produces: `InventoryModel.serialize(): InventorySave`，`InventoryModel.deserialize(save: Partial<InventorySave> | undefined): void`。

- [ ] **Step 1: 写失败测试** — 追加

```ts
test('serialize/deserialize 往返一致 + 深拷贝', () => {
    const m = new InventoryModel(5, 5);
    m.dropRandom();
    m.equip(m.backpack[0].id);
    m.dropRandom();
    const save = m.serialize();
    const m2 = new InventoryModel(5, 5);
    m2.deserialize(save);
    assert.deepEqual(m2.serialize(), save);
    // 深拷贝：改 m2 不影响 save
    m2.backpack.push({ id: 'z', slot: 'weapon', name: 'x', quality: 'common' });
    assert.notEqual(m2.backpack.length, save.backpack.length);
});

test('deserialize：undefined / 缺字段 → 空兜底', () => {
    const m = new InventoryModel();
    m.deserialize(undefined);
    assert.equal(m.backpack.length, 0);
    assert.equal(m.warehouse.length, 0);
    for (const s of SLOTS) assert.equal(m.equipped[s], null);
    m.deserialize({ backpack: [{ id: 'a', slot: 'weapon', name: 'n', quality: 'common' }] });
    assert.equal(m.backpack.length, 1);
    assert.equal(m.warehouse.length, 0);   // 缺 warehouse 兜底为空
    assert.equal(m.equipped.weapon, null); // 缺 equipped 兜底为 null
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:inventory`
Expected: FAIL —— `m.serialize is not a function`。

- [ ] **Step 3: 实现序列化** — 在 `InventoryModel` 类内 `unequip` 之后追加；并在文件顶部确保 `emptyEquipped` 已定义（Task 2 已加）

```ts
    serialize(): InventorySave {
        return {
            backpack: this.backpack.map(it => ({ ...it })),
            warehouse: this.warehouse.map(it => ({ ...it })),
            equipped: { ...this.equipped },
        };
    }

    // 缺字段/undefined 用空兜底（老存档加了新系统也不报错）
    deserialize(save: Partial<InventorySave> | undefined): void {
        this.backpack = (save?.backpack ?? []).map(it => ({ ...it }));
        this.warehouse = (save?.warehouse ?? []).map(it => ({ ...it }));
        const e = emptyEquipped();
        if (save?.equipped) {
            for (const s of SLOTS) {
                const it = save.equipped[s];
                e[s] = it ? { ...it } : null;
            }
        }
        this.equipped = e;
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:inventory`
Expected: PASS —— `11 通过，0 失败`。

- [ ] **Step 5: 提交**

```bash
git add assets/scripts/inventory/InventoryModel.ts tools/inventory-test.ts
git commit -m "feat(equip): InventoryModel 序列化/反序列化 + 缺字段兜底"
```

---

### Task 6: 持久化接缝（DataService 扩展 + InventoryPersistence）

**Files:**
- Modify: `assets/scripts/core/data/DataService.ts`（PlayerData 加 `inventory?` 字段）
- Create: `assets/scripts/inventory/InventoryPersistence.ts`

**Interfaces:**
- Consumes: `DataService`, `PlayerData`（现有）；`InventoryModel`, `InventorySave`（Task 2/5）。
- Produces: `loadInventory(model: InventoryModel): Promise<void>`，`saveInventory(model: InventoryModel): Promise<void>`。

> 本任务是 cc 耦合的薄胶水层（DataService 用 `sys.localStorage`），不走 tsx 单测；验证靠类型 + Task 8 的手动「掉落→刷新仍在」。

- [ ] **Step 1: 扩展 PlayerData** — 修改 `assets/scripts/core/data/DataService.ts` 的 `import` 与 `PlayerData`

文件顶部 `import { sys } from 'cc';` 下方加：

```ts
import type { InventorySave } from '../../inventory/InventoryModel';
```

`PlayerData` 接口加字段：

```ts
export interface PlayerData {
    gold: number;          // 金币
    power: number;         // 战力
    lastSaveTime: number;  // 上次存档时间戳（毫秒）
    inventory?: InventorySave;  // 装备存储（背包/仓库/装备栏）；老存档缺它，由默认值兜底
}
```

- [ ] **Step 2: 实现持久化胶水** — 创建 `assets/scripts/inventory/InventoryPersistence.ts`

```ts
// 装备持久化：把 InventoryModel 接到 DataService（唯一存档接缝）。
// 缓存一次 PlayerData，避免每次 save 都 load-改-存的整块往返。

import { DataService, PlayerData } from '../core/data/DataService';
import { InventoryModel } from './InventoryModel';

let _cache: PlayerData | null = null;

// 启动时调用一次：从存档恢复背包/仓库/装备栏
export async function loadInventory(model: InventoryModel): Promise<void> {
    _cache = await DataService.load();
    model.deserialize(_cache.inventory);
}

// 任何成功操作后调用：把当前模型写回存档
export async function saveInventory(model: InventoryModel): Promise<void> {
    if (!_cache) _cache = await DataService.load();
    _cache.inventory = model.serialize();
    await DataService.save(_cache);
}
```

- [ ] **Step 3: 类型自检** — 确认没有循环依赖/类型错误

Run: `npx tsc --noEmit -p tsconfig.json`（若项目无独立 tsconfig 可跳过，改为在 Cocos 编辑器里看控制台无报错）
Expected: 无与 inventory/DataService 相关的类型错误。

- [ ] **Step 4: 提交**

```bash
git add assets/scripts/core/data/DataService.ts assets/scripts/inventory/InventoryPersistence.ts
git commit -m "feat(equip): 持久化接缝（PlayerData 扩展 + InventoryPersistence）"
```

---

### Task 7: 占位 UI InventoryView（Cocos 节点）

**Files:**
- Create: `assets/scripts/inventory/InventoryView.ts`

**Interfaces:**
- Consumes: `InventoryModel`（Task 2-5）；`EquipDefs` 的 `SLOTS/SLOT_LABEL/QUALITY_COLOR/EquipSlot`；cc。
- Produces: `class InventoryView`，构造 `new InventoryView(parent: Node, halfW: number, halfH: number, model: InventoryModel, onChanged: () => void)`；方法 `toggle(): void`、`isOpen(): boolean`。

> Cocos UI，不走单测，靠 Task 8 手动验证。命中检测用「热区矩形 + 触摸点 hit-test」，避免给每格建节点。

- [ ] **Step 1: 实现 InventoryView** — 创建 `assets/scripts/inventory/InventoryView.ts`

```ts
// 装备背包占位 UI（覆盖层）：顶部 5 装备栏 + 左背包 + 右仓库 + 底部按钮。
// 色块格子（品质上色）+ Label 名字。点击命中用热区 hit-test。接美术时换 Sprite。

import { Node, Graphics, Label, UITransform, Color, Vec3, EventTouch, color } from 'cc';
import { InventoryModel } from './InventoryModel';
import { SLOTS, SLOT_LABEL, QUALITY_COLOR, EquipSlot, EquipItem } from './EquipDefs';

type Zone = 'backpack' | 'warehouse' | 'equipped';
interface Hot { x: number; y: number; w: number; h: number; kind: string; zone?: Zone; id?: string; slot?: EquipSlot; }

const CELL = 92, GAP = 8, COLS = 4;

export class InventoryView {
    private root: Node;
    private gfx: Graphics;
    private labelPool: Label[] = [];
    private hots: Hot[] = [];
    private sel: { zone: Zone; id?: string; slot?: EquipSlot } | null = null;
    private toast = '';
    private toastT = 0;

    constructor(
        private parent: Node,
        private halfW: number,
        private halfH: number,
        private model: InventoryModel,
        private onChanged: () => void,
    ) {
        this.root = new Node('InventoryView');
        this.root.layer = parent.layer;
        this.root.addComponent(UITransform).setContentSize(halfW * 2, halfH * 2);
        const g = new Node('InvGfx');
        g.layer = parent.layer;
        g.addComponent(UITransform);
        this.gfx = g.addComponent(Graphics);
        this.root.addChild(g);
        parent.addChild(this.root);
        this.root.active = false;
        this.root.on(Node.EventType.TOUCH_END, this.onTap, this);
    }

    isOpen(): boolean { return this.root.active; }
    toggle(): void { this.root.active = !this.root.active; if (this.root.active) { this.sel = null; this.render(); } }

    private setToast(s: string) { this.toast = s; this.toastT = 1.5; }

    // 每帧由 BattleEntry.update 调；只在打开时重画（toast 淡出）
    update(dt: number) {
        if (!this.root.active) return;
        if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) { this.toast = ''; } this.render(); }
    }

    private getLabel(i: number): Label {
        while (i >= this.labelPool.length) {
            const n = new Node('InvLbl'); n.layer = this.root.layer; n.addComponent(UITransform);
            const lb = n.addComponent(Label); lb.fontSize = 18; lb.lineHeight = 20;
            this.root.addChild(n); this.labelPool.push(lb);
        }
        return this.labelPool[i];
    }

    private render() {
        const g = this.gfx; g.clear();
        this.hots = [];
        let li = 0;
        const lbl = (x: number, y: number, s: string, size = 18, col = new Color(240, 240, 240)) => {
            const lb = this.getLabel(li++); lb.node.active = true; lb.string = s; lb.fontSize = size;
            lb.lineHeight = size + 2; lb.color = col; lb.node.setPosition(x, y, 0);
        };

        // 背板
        g.fillColor = new Color(18, 20, 26, 235);
        g.rect(-this.halfW, -this.halfH, this.halfW * 2, this.halfH * 2); g.fill();

        // —— 顶部：装备栏 ——
        const topY = this.halfH - 70;
        lbl(0, topY + 44, '装备栏', 22, new Color(255, 220, 120));
        const ew = SLOTS.length * (CELL + GAP) - GAP;
        let ex = -ew / 2;
        for (const slot of SLOTS) {
            const it = this.model.equipped[slot];
            this.drawCell(g, ex, topY, it, this.sel?.zone === 'equipped' && this.sel.slot === slot);
            lbl(ex + CELL / 2, topY + CELL + 2, SLOT_LABEL[slot], 14, new Color(170, 170, 180));
            if (it) lbl(ex + CELL / 2, topY + CELL / 2, it.name, 16);
            this.hots.push({ x: ex, y: topY, w: CELL, h: CELL, kind: 'cell', zone: 'equipped', slot });
            ex += CELL + GAP;
        }

        // —— 中部：左背包 / 右仓库 ——
        const midTop = topY - 70;
        this.drawGrid(g, lbl, 'backpack', -this.halfW + 30, midTop, `背包 ${this.model.backpack.length}/${(this.model as any).backpackCap ?? ''}`, this.model.backpack);
        this.drawGrid(g, lbl, 'warehouse', 30, midTop, `仓库 ${this.model.warehouse.length}/${(this.model as any).warehouseCap ?? ''}`, this.model.warehouse);

        // —— 底部按钮 ——
        const by = -this.halfH + 50;
        const btn = (x: number, s: string, kind: string) => {
            g.fillColor = new Color(60, 66, 80); g.roundRect(x, by, 110, 44, 8); g.fill();
            lbl(x + 55, by + 22, s, 18);
            this.hots.push({ x, y: by, w: 110, h: 44, kind });
        };
        btn(-this.halfW + 20, '掉落', 'drop');
        btn(-this.halfW + 140, '转移', 'transfer');
        btn(-this.halfW + 260, '穿', 'equip');
        btn(-this.halfW + 380, '脱', 'unequip');
        btn(this.halfW - 130, '关闭', 'close');

        if (this.toast) lbl(0, by + 70, this.toast, 20, new Color(255, 120, 120));

        // 隐藏多余 label
        for (let i = li; i < this.labelPool.length; i++) this.labelPool[i].node.active = false;
    }

    private drawGrid(g: Graphics, lbl: (x: number, y: number, s: string, size?: number, c?: Color) => void,
                     zone: Zone, x0: number, yTop: number, title: string, list: EquipItem[]) {
        lbl(x0 + 200, yTop + 26, title, 20, new Color(200, 210, 230));
        for (let i = 0; i < list.length; i++) {
            const r = Math.floor(i / COLS), c = i % COLS;
            const x = x0 + c * (CELL + GAP), y = yTop - 10 - (r + 1) * (CELL + GAP);
            const it = list[i];
            this.drawCell(g, x, y, it, this.sel?.zone === zone && this.sel.id === it.id);
            lbl(x + CELL / 2, y + CELL / 2, it.name, 16);
            this.hots.push({ x, y, w: CELL, h: CELL, kind: 'cell', zone, id: it.id });
        }
    }

    private drawCell(g: Graphics, x: number, y: number, it: EquipItem | null, selected: boolean) {
        if (it) { const c = QUALITY_COLOR[it.quality]; g.fillColor = new Color(c[0], c[1], c[2], 220); }
        else g.fillColor = new Color(50, 54, 64, 200);
        g.roundRect(x, y, CELL, CELL, 6); g.fill();
        g.strokeColor = selected ? new Color(255, 230, 120) : new Color(90, 96, 110);
        g.lineWidth = selected ? 4 : 2; g.roundRect(x, y, CELL, CELL, 6); g.stroke();
    }

    private onTap(e: EventTouch) {
        // 屏幕坐标 → root 本地坐标
        const ui = e.getUILocation();
        const p = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const hit = this.hots.find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h);
        if (!hit) return;
        if (hit.kind === 'cell') {
            this.sel = { zone: hit.zone!, id: hit.id, slot: hit.slot };
            this.render(); return;
        }
        this.handleButton(hit.kind);
    }

    private handleButton(kind: string) {
        const m = this.model;
        let r = { ok: true, reason: '' } as { ok: boolean; reason?: string };
        switch (kind) {
            case 'close': this.toggle(); return;
            case 'drop': r = m.dropRandom(); break;
            case 'transfer':
                if (!this.sel || !this.sel.id) { this.setToast('先选背包或仓库里的装备'); this.render(); return; }
                r = this.sel.zone === 'backpack' ? m.toWarehouse(this.sel.id) : m.toBackpack(this.sel.id);
                break;
            case 'equip':
                if (!this.sel || this.sel.zone !== 'backpack' || !this.sel.id) { this.setToast('先在背包选要穿的装备'); this.render(); return; }
                r = m.equip(this.sel.id); break;
            case 'unequip':
                if (!this.sel || this.sel.zone !== 'equipped' || !this.sel.slot) { this.setToast('先选装备栏里的装备'); this.render(); return; }
                r = m.unequip(this.sel.slot); break;
        }
        if (!r.ok) { this.setToast(r.reason || '操作失败'); }
        else { this.sel = null; this.onChanged(); }
        this.render();
    }
}
```

- [ ] **Step 2: 编辑器编译自检**

在 Cocos Creator 里打开项目，确认控制台**无编译报错**（InventoryView 引用的 cc API、Model 方法名都存在）。

- [ ] **Step 3: 提交**

```bash
git add assets/scripts/inventory/InventoryView.ts
git commit -m "feat(equip): 占位 UI InventoryView（色块格子 + 热区点击）"
```

---

### Task 8: 接入 BattleEntry（按钮 + 挂载 + 持久化）

**Files:**
- Modify: `assets/scripts/BattleEntry.ts`

**Interfaces:**
- Consumes: `InventoryModel`（Task 2-5）、`InventoryView`（Task 7）、`loadInventory/saveInventory`（Task 6）。

- [ ] **Step 1: import + 字段** — 在 `BattleEntry.ts` 顶部 import 区加

```ts
import { InventoryModel } from './inventory/InventoryModel';
import { InventoryView } from './inventory/InventoryView';
import { loadInventory, saveInventory } from './inventory/InventoryPersistence';
```

在 `BattleEntry` 类字段区（`_bg` 附近）加：

```ts
    private _inv: InventoryModel = null!;
    private _invView: InventoryView = null!;
```

- [ ] **Step 2: onLoad 里初始化** — 在 `onLoad()` 的 `mountConfigPanel(...)` 之前插入

```ts
        // —— 装备背包（独立子系统，不影响战斗）——
        this._inv = new InventoryModel();
        this._invView = new InventoryView(this.node, this._halfW, this._halfH, this._inv, () => {
            void saveInventory(this._inv);   // 任何成功操作后存盘
        });
        void loadInventory(this._inv).then(() => { if (this._invView.isOpen()) this._invView['render'](); });

        // 「背包」「掉落」两个按钮（占位 Label，点了切换面板 / 调试掉落）
        this._makeButton('背包', -this._halfW + 70, -this._halfH + 40, () => this._invView.toggle());
        this._makeButton('掉落', -this._halfW + 180, -this._halfH + 40, () => {
            const r = this._inv.dropRandom();
            if (r.ok) void saveInventory(this._inv);
        });
```

- [ ] **Step 3: 加按钮工具方法 + 驱动 update** — 在 `_makeLabel` 方法之后加 `_makeButton`；并在 `update(dt)` 末尾加一行驱动面板 toast 淡出

`_makeButton`：

```ts
    private _makeButton(text: string, x: number, y: number, onClick: () => void): Label {
        const node = new Node('Btn');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(100, 44);
        const label = node.addComponent(Label);
        label.string = text; label.fontSize = 22; label.lineHeight = 26;
        this.node.addChild(node);
        node.setPosition(x, y, 0);
        node.on(Node.EventType.TOUCH_END, (e: any) => { e.propagationStopped = true; onClick(); }, this);
        return label;
    }
```

`update(dt)` 末尾（`_updateLabels()` 之后）加：

```ts
        this._invView.update(dt);
```

- [ ] **Step 4: 重开不清背包** — 确认 `_startBattle()` 只重建 `BattleManager`，**不碰 `_inv`**（装备活在战斗之外）。检查 `_onTap` 重开逻辑：面板打开时点击不应触发重开。

在 `_onTap()` 开头加：

```ts
        if (this._invView && this._invView.isOpen()) return;  // 面板打开时，点击交给面板，不重开战斗
```

- [ ] **Step 5: 手动验证（网页预览）**

在 Cocos 编辑器点预览，按顺序验证：
1. 点「掉落」几次 → 点「背包」打开面板，背包格子出现对应数量装备（品质颜色不同）。
2. 选背包一件 → 点「转移」→ 移到仓库；在仓库选中 → 「转移」→ 回背包。
3. 选背包一件 → 点「穿」→ 进对应部位装备栏；选装备栏 → 「脱」→ 回背包。
4. 背包堆到 20 满 → 再「掉落」→ 顶部红字提示「背包已满」，不丢。
5. **刷新浏览器页面** → 重新打开背包，**装备仍在**（持久化生效）。
6. 关闭面板后点屏幕 → 正常重开战斗（面板打开时点击不重开）。

Expected: 以上全部符合。

- [ ] **Step 6: 提交**

```bash
git add assets/scripts/BattleEntry.ts
git commit -m "feat(equip): 接入 BattleEntry（背包/掉落按钮 + 挂载 + 持久化）"
```

---

## 收尾（实现完成后）

按 `ai/skills/开发收尾.md` 走：
- 更新 `ai/memory/项目状态.md`（最近进展、已完成加「装备存储系统」、待办移除装备的存储部分、保留"装备影响战斗"为下一版）。
- `ai/memory/代码地图.md` 加 `inventory/` 区（Model/Defs/Config/View/Persistence 各一行职责）。
- `ai/memory/设计日志.md` 追加「装备存储系统（纯存储层，不影响战斗）」决策一行。
- README 技能索引视情况加一条「装备系统」skill（可选，等系统再长再加）。

## 自检（已核对）

- **Spec 覆盖**：数据模型(Task1-5)、装备生成(Task1)、持久化(Task6)、UI(Task7)、接入+掉落按钮(Task8)、格子上限(Task1 config)、品质/部位(Task1)、背包满失败提示(Task7-8)、装备栏穿脱(Task4/7) —— 全覆盖。
- **类型一致**：`OpResult`/`EquipItem`/`InventorySave` 跨任务一致；方法名 `dropRandom/toWarehouse/toBackpack/equip/unequip/serialize/deserialize` 全程统一。
- **无 placeholder**：每步均有完整代码/命令/预期。
- **换装回滚**：已在 Task4 用「先移除再放回」证明净背包数不增 → 无需回滚，并有专门测试覆盖背包满换装。
