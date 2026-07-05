# 多人小队上阵系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把出战阵容 `roster` 从配置常量变成玩家可选（选人 + 排前后站位 + 持久化 + 接战斗），并重调多人组合的关卡平衡。

**Architecture:** 新增 `SquadModel` 纯逻辑管出战有序列表与上限约束；`BattleManager` 构造函数新增 roster 入参（缺省回退配置），让实战与 pacing-sim 都能跑任意组合；`BattleEntry` 加载玩家小队、传出战列表、按出战集合建视觉、挂上阵面板到 `NavHeroesHot` 热区；最后参数化 `pacing-sim` 并逐关重调怪物 hp。

**Tech Stack:** TypeScript（Cocos Creator 3.8.8 运行时子集，纯逻辑不依赖 cc）、tsx（跑纯逻辑单测与 sim）、xlsx（数值真源，`npm run config` 生成产物）。

## Global Constraints

- **数值真源在 Excel**：改战斗数值只改 `tools/seed-battle-xlsx.ts` → `npx tsx tools/seed-battle-xlsx.ts` 重生 `tools/config-xlsx/battle.xlsx` → `npm run config` 生成 `assets/scripts/config/battle.config.generated.ts`。**产物入库**（Cocos 不跑 npm）。
- **逻辑与渲染分离**：纯逻辑（`SquadModel`）不 import `cc`，可跑 tsx 单测；`BattleManager` 不认识 UI；渲染/面板只在 `BattleEntry`。
- **class = character 1:1**：出战条目类型是 `SoldierClass`（= `CharacterId`，tank/dps/healer）。
- **色块占位期**：上阵面板用 Graphics/Label 占位，镜像现有 `CraftView` 模式，不接真实美术。
- **提交规范**：中文 commit，结尾带 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。只在本计划步骤要求时提交。
- **替用户定的默认值**（配置/存档可改）：`squadCap = 2`，默认出战组合 `tank+dps`（Task 6 才把配置 roster 从 `dps` 翻成 `tank,dps`，前 5 个 Task 保持单人默认以免中途破坏平衡）。

---

### Task 1: squadCap 配置接线

把队伍上限 `squadCap` 接入 Excel→配置产物链路。**本 Task 不动 roster 值**（仍 `dps`），只加 squadCap，保证 `sim:pacing` 与现有测试仍全绿。

**Files:**
- Modify: `tools/seed-battle-xlsx.ts:126-135`（MISC_ROWS 加一行）
- Modify: `tools/excel-to-config.ts:297-310`（config 组装加 squadCap）
- Modify: `assets/scripts/config/BattleConfig.ts:63-91`（类型加 squadCap）
- Modify: `package.json:8`（加 `seed:battle` 脚本）
- Regenerate: `tools/config-xlsx/battle.xlsx`、`assets/scripts/config/battle.config.generated.ts`

**Interfaces:**
- Produces: `BattleConfig.squadCap: number`（值 2），供 Task 4 的 `SquadPersistence`/`BattleEntry` 读取。

- [ ] **Step 1: seed 脚本 MISC_ROWS 加 squadCap**

`tools/seed-battle-xlsx.ts` 的 `MISC_ROWS`（当前 126-135 行）加一行（放在 `startLevel` 后）：

```typescript
const MISC_ROWS: (string | number)[][] = [
    ['startLevel', 0],
    ['squadCap', 2],
    ['roster', 'dps'],
    ['combat.minDamageRate', 0.1],
    ['layout.frontMargin', 360],
    ['layout.spacing', 110],
    ['bullet.speed', 1100],
    ['bullet.radius', 8],
    ['formation.contactGap', 150],
];
```

- [ ] **Step 2: 导表器组装 squadCap**

`tools/excel-to-config.ts` 的 config 组装块（当前 298-310 行），在 `startLevel` 行后加 `squadCap`：

```typescript
    const config = {
        stats,
        enemyTypes,
        levels,
        startLevel: misc['startLevel'] ?? 0,
        squadCap: misc['squadCap'] ?? 2,
        combat: misc['combat'] ?? {},
        classes,
        roster,
        layout: misc['layout'] ?? {},
        bullet: misc['bullet'] ?? {},
        formation: misc['formation'] ?? {},
        scene,
    };
```

- [ ] **Step 3: BattleConfig 类型加 squadCap**

`assets/scripts/config/BattleConfig.ts` 的 `BattleConfig` 断言类型（当前 63-91 行），在 `startLevel: number;` 后加：

```typescript
    startLevel: number;
    squadCap: number;
```

- [ ] **Step 4: package.json 加 seed:battle 脚本**

`package.json` 的 `scripts` 里，在 `"config"` 行后加（让 battle.xlsx 重生有正式入口）：

```json
    "config": "tsx tools/excel-to-config.ts",
    "seed:battle": "tsx tools/seed-battle-xlsx.ts",
```

- [ ] **Step 5: 重生 xlsx + 产物**

Run:
```bash
npm run seed:battle && npm run config
```
Expected: `✓ 已生成 .../battle.xlsx`；config 输出各模块 `ok`，无报错。

- [ ] **Step 6: 校验产物含 squadCap**

Run:
```bash
grep '"squadCap": 2' assets/scripts/config/battle.config.generated.ts
```
Expected: 命中一行 `"squadCap": 2,`。

- [ ] **Step 7: 回归现有链路仍全绿**

Run:
```bash
npm run test:combat && npm run sim:pacing
```
Expected: combat 测试全过；`sim:pacing` 输出「全部达标」（roster 未变，平衡不受影响）。

- [ ] **Step 8: Commit**

```bash
git add tools/seed-battle-xlsx.ts tools/excel-to-config.ts assets/scripts/config/BattleConfig.ts assets/scripts/config/battle.config.generated.ts tools/config-xlsx/battle.xlsx package.json
git commit -m "feat(squad): squadCap 接入 battle 配置链路

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: SquadModel 纯逻辑 + SquadSave 类型（TDD）

出战小队核心逻辑：出战有序列表、上限约束、上阵/下阵/重排、非法存档自愈。纯逻辑、tsx 单测。

**Files:**
- Create: `assets/scripts/squad/SquadModel.ts`
- Create: `tools/squad-test.ts`
- Modify: `package.json`（加 `test:squad`）

**Interfaces:**
- Consumes: `CHARACTERS`, `CharacterId`（`assets/scripts/inventory/EquipDefs.ts`）；`BattleConfig.roster`（默认组合来源）。
- Produces:
  - `interface SquadSave { deployed: CharacterId[] }`
  - `class SquadModel`，方法：`deployedList(): CharacterId[]`、`benchList(): CharacterId[]`、`isDeployed(id): boolean`、`isFull(): boolean`、`deploy(id): boolean`、`undeploy(id): boolean`、`move(id, toIndex): boolean`、`serialize(): SquadSave`、静态 `deserialize(save: SquadSave | undefined, squadCap: number): SquadModel`。

- [ ] **Step 1: 写失败测试**

Create `tools/squad-test.ts`：

```typescript
// 出战小队单测（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { SquadModel } from '../assets/scripts/squad/SquadModel';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('构造：超过 squadCap 截断到上限', () => {
    const m = new SquadModel(['tank', 'dps', 'healer'], 2);
    assert.deepEqual(m.deployedList(), ['tank', 'dps']);
});

test('deploy：满员时拒绝', () => {
    const m = new SquadModel(['tank', 'dps'], 2);
    assert.equal(m.deploy('healer'), false);
    assert.equal(m.isFull(), true);
    assert.deepEqual(m.deployedList(), ['tank', 'dps']);
});

test('deploy：未满且未上阵则加到末尾', () => {
    const m = new SquadModel(['tank'], 2);
    assert.equal(m.deploy('healer'), true);
    assert.deepEqual(m.deployedList(), ['tank', 'healer']);
});

test('deploy：重复上阵拒绝', () => {
    const m = new SquadModel(['tank'], 2);
    assert.equal(m.deploy('tank'), false);
});

test('undeploy：最后 1 人不可下阵', () => {
    const m = new SquadModel(['dps'], 2);
    assert.equal(m.undeploy('dps'), false);
    assert.deepEqual(m.deployedList(), ['dps']);
});

test('undeploy：多于 1 人可下阵', () => {
    const m = new SquadModel(['tank', 'dps'], 2);
    assert.equal(m.undeploy('tank'), true);
    assert.deepEqual(m.deployedList(), ['dps']);
});

test('move：重排前后顺序', () => {
    const m = new SquadModel(['tank', 'dps'], 2);
    assert.equal(m.move('dps', 0), true);
    assert.deepEqual(m.deployedList(), ['dps', 'tank']);
});

test('benchList：派生未出战列表', () => {
    const m = new SquadModel(['dps'], 2);
    assert.deepEqual(m.benchList().slice().sort(), ['healer', 'tank']);
});

test('deserialize：非法存档自愈（去重/过滤未知/截断上限）', () => {
    const m = SquadModel.deserialize({ deployed: ['tank', 'tank', 'bogus', 'healer', 'dps'] as any }, 2);
    assert.deepEqual(m.deployedList(), ['tank', 'healer']);
});

test('deserialize：空存档回落默认组合（1~squadCap 个合法角色）', () => {
    const m = SquadModel.deserialize(undefined, 2);
    const list = m.deployedList();
    assert.ok(list.length >= 1 && list.length <= 2, `默认组合长度应在 1~2，得到 ${list.length}`);
});

test('serialize/deserialize 往返一致', () => {
    const m = new SquadModel(['dps', 'tank'], 2);
    const back = SquadModel.deserialize(m.serialize(), 2);
    assert.deepEqual(back.deployedList(), ['dps', 'tank']);
});

console.log(`\nSquadModel：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 运行测试确认失败**

先加脚本 `package.json` 的 `scripts`（在 `"test:skill"` 行后）：

```json
    "test:skill": "tsx tools/skill-test.ts",
    "test:squad": "tsx tools/squad-test.ts",
```

Run: `npm run test:squad`
Expected: FAIL — `Cannot find module '.../squad/SquadModel'`。

- [ ] **Step 3: 写最小实现**

Create `assets/scripts/squad/SquadModel.ts`：

```typescript
// 出战小队（纯逻辑，不依赖 cc）：谁上阵、前后站位顺序、上限约束、非法存档自愈。
// BattleEntry 用它决定传给 BattleManager 的 roster；持久化经 PlayerData.squad。
// deployed[0] = 一字阵最前（贴敌），越靠后越靠后排。

import { CHARACTERS, CharacterId } from '../inventory/EquipDefs';
import { BattleConfig } from '../config/BattleConfig';

export interface SquadSave {
    deployed: CharacterId[];   // 有序，deployed[0] = 一字阵最前
}

function isCharacterId(x: unknown): x is CharacterId {
    return typeof x === 'string' && (CHARACTERS as string[]).indexOf(x) >= 0;
}

// 合法默认出战组合：取配置 roster 里合法、去重的前 squadCap 个；空则回落首个角色。
function defaultDeployed(squadCap: number): CharacterId[] {
    const out: CharacterId[] = [];
    for (const c of BattleConfig.roster as CharacterId[]) {
        if (isCharacterId(c) && out.indexOf(c) < 0) out.push(c);
        if (out.length >= squadCap) break;
    }
    if (out.length === 0 && CHARACTERS.length > 0) out.push(CHARACTERS[0]);
    return out;
}

export class SquadModel {
    private _deployed: CharacterId[];
    readonly squadCap: number;

    constructor(deployed: CharacterId[], squadCap: number) {
        this.squadCap = Math.max(1, squadCap);
        this._deployed = deployed.slice(0, this.squadCap);
        if (this._deployed.length === 0) this._deployed = defaultDeployed(this.squadCap);
    }

    deployedList(): CharacterId[] { return this._deployed.slice(); }
    benchList(): CharacterId[] { return CHARACTERS.filter(c => this._deployed.indexOf(c) < 0); }
    isDeployed(id: CharacterId): boolean { return this._deployed.indexOf(id) >= 0; }
    isFull(): boolean { return this._deployed.length >= this.squadCap; }

    deploy(id: CharacterId): boolean {
        if (!isCharacterId(id) || this.isDeployed(id) || this.isFull()) return false;
        this._deployed.push(id);
        return true;
    }

    undeploy(id: CharacterId): boolean {
        const i = this._deployed.indexOf(id);
        if (i < 0 || this._deployed.length <= 1) return false;   // 保底至少 1 人
        this._deployed.splice(i, 1);
        return true;
    }

    move(id: CharacterId, toIndex: number): boolean {
        const from = this._deployed.indexOf(id);
        if (from < 0) return false;
        const to = Math.max(0, Math.min(toIndex, this._deployed.length - 1));
        if (to === from) return true;
        this._deployed.splice(from, 1);
        this._deployed.splice(to, 0, id);
        return true;
    }

    serialize(): SquadSave { return { deployed: this._deployed.slice() }; }

    static deserialize(save: SquadSave | undefined, squadCap: number): SquadModel {
        const cap = Math.max(1, squadCap);
        const raw = save?.deployed ?? [];
        const seen = new Set<CharacterId>();
        const clean: CharacterId[] = [];
        for (const c of raw) {
            if (isCharacterId(c) && !seen.has(c)) { seen.add(c); clean.push(c); }
        }
        const capped = clean.slice(0, cap);
        return new SquadModel(capped.length ? capped : defaultDeployed(cap), cap);
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:squad`
Expected: PASS — `SquadModel：11 通过，0 失败`。

- [ ] **Step 5: Commit**

```bash
git add assets/scripts/squad/SquadModel.ts tools/squad-test.ts package.json
git commit -m "feat(squad): SquadModel 纯逻辑（TDD，上限/上阵/下阵/重排/存档自愈）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: BattleManager roster 入参（TDD）

让 `BattleManager` 按传入的出战列表布阵，而非硬读 `BattleConfig.roster`。缺省回退配置，保持现有调用/测试不破。

**Files:**
- Modify: `assets/scripts/combat/BattleManager.ts:131-181`（构造函数 + `_setupSquad`）
- Modify: `tools/combat-test.ts`（追加测试）

**Interfaces:**
- Consumes: `SoldierClass`（BattleManager 已 import，第 6 行）。
- Produces: `new BattleManager(halfW, halfH, levelIndex?, effectiveStats?, roster?: SoldierClass[])`——第 5 参 `roster` 缺省 `BattleConfig.roster`；供 Task 4（BattleEntry）与 Task 6（pacing-sim）传自定义组合。

- [ ] **Step 1: 写失败测试**

`tools/combat-test.ts` 末尾（`console.log`/run 汇总之前，追加两条 `test(...)`）：

```typescript
test('BattleManager：roster 入参决定出战单位（覆盖配置默认）', () => {
    const mgr = new BattleManager(470, 836, 0, {}, ['tank', 'dps']);
    const classes = mgr.soldiers.map(s => s.cls).slice().sort();
    assert.deepEqual(classes, ['dps', 'tank']);
});

test('BattleManager：缺省 roster 回退配置默认（至少 1 名士兵）', () => {
    const mgr = new BattleManager(470, 836, 0, {});
    assert.ok(mgr.soldiers.length >= 1, '缺省应按配置 roster 布阵');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:combat`
Expected: FAIL —「roster 入参决定出战单位」得到 `['dps']`（当前忽略入参，只按配置 `['dps']` 布阵），断言不等于 `['dps','tank']`。

- [ ] **Step 3: 改构造函数存 roster**

`assets/scripts/combat/BattleManager.ts` 构造函数（当前 131 行）签名加第 5 参，函数体存字段：

```typescript
    private _roster: SoldierClass[];

    constructor(halfW: number, halfH: number, levelIndex = BattleConfig.startLevel, effectiveStats: EffectiveStatsMap = {}, roster: SoldierClass[] = BattleConfig.roster) {
        this.halfW = halfW;
        this.halfH = halfH;
        this.effectiveStats = effectiveStats;
        this._roster = roster;
        this.levelIndex = Math.max(0, Math.min(levelIndex, BattleConfig.levels.length - 1));
        this._setupSquad();
        this._startWave(0);
    }
```

（`private _roster` 字段声明放在类字段区，例如现有 `private effectiveStats: EffectiveStatsMap;` 声明附近。）

- [ ] **Step 4: `_setupSquad` 遍历 `this._roster`**

同文件 `_setupSquad`（当前 155 行）把 `BattleConfig.roster.forEach` 改为 `this._roster.forEach`：

```typescript
    private _setupSquad() {
        const L = BattleConfig.layout;
        const frontX = -this.halfW + L.frontMargin;
        this._roster.forEach((cls, i) => {
            const cdef = BattleConfig.classes[cls];   // 职业行为配置
            const st = this.effectiveStats[cls] ?? BattleConfig.stats[cls]; // 职业战斗属性（统一表）
            const hx = frontX - i * L.spacing;   // 越靠后（i 越大）越靠左
            this.soldiers.push({
```

（`forEach` 内部其余不变。）

- [ ] **Step 5: 运行测试确认通过**

Run: `npm run test:combat`
Expected: PASS — 全部 combat 测试通过（含两条新测试）。

- [ ] **Step 6: 回归 pacing-sim 仍绿**

Run: `npm run sim:pacing`
Expected:「全部达标」（缺省 roster 仍 `['dps']`，平衡不受影响）。

- [ ] **Step 7: Commit**

```bash
git add assets/scripts/combat/BattleManager.ts tools/combat-test.ts
git commit -m "feat(squad): BattleManager 新增 roster 入参，缺省回退配置（TDD）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 持久化 + BattleEntry 接线（出战列表进战斗）

把玩家小队存档接进 `PlayerData`，让实战按玩家出战列表布阵、按出战集合建视觉。

**Files:**
- Modify: `assets/scripts/core/data/DataService.ts:8-24`（PlayerData 加 squad + 导入 SquadSave 类型）
- Create: `assets/scripts/squad/SquadPersistence.ts`
- Modify: `assets/scripts/BattleEntry.ts`（字段、加载链、`_startBattle`、视觉同步）

**Interfaces:**
- Consumes: `SquadModel`/`SquadSave`（Task 2）；`BattleConfig.squadCap`（Task 1）；`BattleManager(..., roster)`（Task 3）；`CHARACTERS`（EquipDefs）。
- Produces: `loadSquad(): Promise<SquadModel>`、`saveSquad(model): Promise<void>`（`SquadPersistence`）；`BattleEntry` 私有 `this._squad: SquadModel`、`_syncSoldierVisualsToRoster(deployed)`，供 Task 5 的上阵面板读写。

- [ ] **Step 1: PlayerData 加 squad 字段**

`assets/scripts/core/data/DataService.ts` 顶部类型 import 区（当前 12 行 `MaterialSave` 附近）加：

```typescript
import type { SquadSave } from '../../squad/SquadModel';
```

`PlayerData` 接口（当前 15-24 行）在 `materials?` 后加：

```typescript
    materials?: MaterialSave;   // 材料库存；开箱产打造/宝石/铭文等材料
    squad?: SquadSave;          // 出战小队（有序出战角色）；老存档缺它，由默认组合兜底
}
```

- [ ] **Step 2: 建 SquadPersistence**

Create `assets/scripts/squad/SquadPersistence.ts`：

```typescript
// 出战小队持久化：把 SquadModel 接到共享 PlayerData 存档。
// squadCap 在反序列化时注入，非法/缺失存档由 SquadModel.deserialize 自愈。

import { loadPlayerData, savePlayerData } from '../core/data/PlayerDataStore';
import { BattleConfig } from '../config/BattleConfig';
import { SquadModel } from './SquadModel';

export async function loadSquad(): Promise<SquadModel> {
    const data = await loadPlayerData();
    return SquadModel.deserialize(data.squad, BattleConfig.squadCap);
}

export async function saveSquad(model: SquadModel): Promise<void> {
    const data = await loadPlayerData();
    data.squad = model.serialize();
    await savePlayerData();
}
```

- [ ] **Step 3: BattleEntry 加字段与 import**

`assets/scripts/BattleEntry.ts` import 区（`SquadModel`/persistence/CHARACTERS）：

```typescript
import { SquadModel } from './squad/SquadModel';
import { loadSquad } from './squad/SquadPersistence';
import { CHARACTERS } from './inventory/EquipDefs';
```

（`CHARACTERS` 若已被其它 import 覆盖则复用，勿重复导入。）

字段区（当前 `private _progress: ProgressModel = null!;` 第 182 行附近）加：

```typescript
    private _squad: SquadModel = null!;
```

- [ ] **Step 4: 加载链里载入小队**

`assets/scripts/BattleEntry.ts` 数据就绪链（当前 367 行 `const dataReady = loadInventory(...).then(...)...`），在链中接入 `loadSquad`。把该链改成先载小队再继续（`loadSquad` 返回 model，存到字段）：

```typescript
        const dataReady = loadInventory(this._inv)
            .then(() => loadProgress(this._progress))
            .then(() => this._claimOfflineRewards())
            .then(() => loadChests(this._chests))
            .then(() => this._refreshMaterialsCache())
            .then(() => loadSquad())
            .then((squad) => { this._squad = squad; })
            .then(() => {
```

（保留原链末尾 `.then(() => { ... })` 的原有回调体，只是在它前面插入 `loadSquad` 两步。）

- [ ] **Step 5: `_startBattle` 传出战列表 + 同步视觉**

`assets/scripts/BattleEntry.ts` `_startBattle`（当前 406-421 行）里，构造 `BattleManager` 前取出战列表并传入，之后同步视觉：

```typescript
        const effective = this._inv ? buildEffectiveStatsMap(this._inv.equipped) : {};
        const levelIndex = this._progress ? this._progress.currentLevel : BattleConfig.startLevel;
        const roster = this._squad ? (this._squad.deployedList() as SoldierClass[]) : BattleConfig.roster;
        this._battleSeed = `${Date.now()}|${Math.random()}|${levelIndex}`;
        this._battleChestDropCount = 0;
        this._shownWaveKey = -1;   // 强制下一帧刷新波次文本
        this._syncSoldierVisualsToRoster(roster);
        this._mgr = new BattleManager(this._halfW, this._halfH, levelIndex, effective, roster);
```

- [ ] **Step 6: 视觉同步方法 + 换掉建视觉循环**

`assets/scripts/BattleEntry.ts` `_loadBattleArt` 里建士兵视觉的循环（当前 446-448 行）：

```typescript
        for (const cls of BattleConfig.roster) {
            this._buildSoldierVisual(cls);
        }
```

改为按当前出战列表同步：

```typescript
        const initialRoster = this._squad ? (this._squad.deployedList() as SoldierClass[]) : BattleConfig.roster;
        this._syncSoldierVisualsToRoster(initialRoster);
```

并在 `_buildSoldierVisual`（512 行）附近新增同步方法——建缺失视觉、隐藏未出战角色已建视觉（防止预建节点滞留原点露出）：

```typescript
    // 按出战列表同步士兵视觉：缺的建、未出战的已建视觉隐藏。
    // 渲染循环只遍历 mgr.soldiers（出战单位），未出战角色若已建节点会滞留原点，故显式隐藏。
    private _syncSoldierVisualsToRoster(deployed: SoldierClass[]) {
        for (const cls of deployed) {
            if (!this._solSprite[cls]) this._buildSoldierVisual(cls);
        }
        for (const cls of CHARACTERS as SoldierClass[]) {
            const v = this._solSprite[cls];
            if (v && deployed.indexOf(cls) < 0) v.node.active = false;
        }
    }
```

- [ ] **Step 7: 类型检查 + 回归测试**

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "squad|BattleEntry|DataService" || echo "no squad/entry type errors"
npm run test:combat && npm run test:squad
```
Expected: 无 squad/BattleEntry/DataService 相关类型错误；combat 与 squad 测试全过。
（若仓库无独立 tsconfig 供 `--noEmit`，跳过 tsc 步，靠 Cocos 编译在人工验证阶段兜底。）

- [ ] **Step 8: Commit**

```bash
git add assets/scripts/core/data/DataService.ts assets/scripts/squad/SquadPersistence.ts assets/scripts/BattleEntry.ts
git commit -m "feat(squad): 出战小队持久化 + 实战按出战列表布阵/建视觉

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 上阵面板（SquadView + NavHeroesHot 热区）

一个占位面板：列角色、点选上阵/下阵、调前后序、保存触发战斗刷新。镜像现有 `CraftView` 结构，挂到当前 `noop` 的「英雄」导航热区 `NavHeroesHot`。

**Files:**
- Modify: `assets/scripts/BattleEntry.ts`（新增 SquadView 面板方法群 + 改 `NavHeroesHot` 回调 + 启动时创建面板）

**Interfaces:**
- Consumes: `this._squad`（SquadModel）、`saveSquad`（SquadPersistence）、`_startBattle`、`_syncSoldierVisualsToRoster`、`CHARACTER_LABEL`（EquipDefs）。
- Produces: 面板方法 `_createSquadView()`、`_toggleSquadPanel()`、`_showSquadPanel()`、`_hideSquadPanel()`、`_squadOpen()`、`_drawSquadPanel()` 及触摸命中处理。

- [ ] **Step 1: import 角色标签 + saveSquad**

`assets/scripts/BattleEntry.ts` import：`CHARACTER_LABEL` 并入现有 `EquipDefs` 导入；`saveSquad` 并入 `SquadPersistence` 导入：

```typescript
import { CHARACTERS, CHARACTER_LABEL } from './inventory/EquipDefs';
import { loadSquad, saveSquad } from './squad/SquadPersistence';
```

- [ ] **Step 2: 启动时创建面板**

`assets/scripts/BattleEntry.ts` 现有 `this._createCraftView();`（当前 374 行）后加：

```typescript
        this._createCraftView();
        this._createSquadView();
```

- [ ] **Step 3: 「英雄」热区接上阵面板**

同文件 `NavHeroesHot` 热区（当前 382 行）把 `noop` 换成打开上阵面板：

```typescript
        this._makeUiHotZone('NavHeroesHot', UI_RECTS.navHeroes, () => this._toggleSquadPanel(), 'BottomNav');
```

- [ ] **Step 4: 面板骨架（镜像 CraftView）**

`assets/scripts/BattleEntry.ts` `_createCraftView`（1014 行）附近新增面板方法群。骨架镜像 CraftView（一个覆盖 Node + Graphics + 触摸），命中区用「出战行 / 板凳行 / 每行的上移按钮」矩形自绘：

```typescript
    private _squadRoot: Node = null!;
    private _squadGfx: Graphics = null!;
    private _squadLabels: Label[] = [];
    private _squadHots: { rect: { x: number; y: number; w: number; h: number }; act: () => void }[] = [];

    private _createSquadView() {
        this._squadRoot = new Node('SquadView');
        this._squadRoot.layer = this.node.layer;
        this._squadRoot.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        const gfxNode = new Node('SquadGfx');
        gfxNode.layer = this.node.layer;
        this._squadGfx = gfxNode.addComponent(Graphics);
        this._squadRoot.addChild(gfxNode);
        this.node.addChild(this._squadRoot);
        this._squadRoot.active = false;
        this._squadRoot.on(Node.EventType.TOUCH_END, this._onSquadTap, this);
    }

    private _squadOpen(): boolean { return !!this._squadRoot && this._squadRoot.active; }

    private _toggleSquadPanel() {
        if (this._squadOpen()) this._hideSquadPanel();
        else this._showSquadPanel();
    }

    private _showSquadPanel() {
        this._hideCraftPanel();
        this._squadRoot.active = true;
        this._squadRoot.setSiblingIndex(this._squadRoot.parent!.children.length - 1);
        this._drawSquadPanel();
    }

    private _hideSquadPanel() {
        if (this._squadRoot) this._squadRoot.active = false;
    }

    // 面板本地 Label 工厂：必须挂到 _squadRoot（不能用 _makeLabel——那个挂 _battleRoot，
    // 面板隐藏后标签会残留在战斗层）。镜像现有 _craftLabel。
    private _squadLabel(i: number): Label {
        while (i >= this._squadLabels.length) {
            const n = new Node('SquadLbl');
            n.layer = this._squadRoot.layer;
            n.addComponent(UITransform);
            const lb = n.addComponent(Label);
            this._squadRoot.addChild(n);
            this._squadLabels.push(lb);
        }
        return this._squadLabels[i];
    }
```

- [ ] **Step 5: 画面板 + 命中区（出战/板凳/上移）**

同区新增绘制方法：出战角色一列（标「出战 i」+ 点击下阵 + 「↑」上移改前后序）、板凳一列（点击上阵）、顶部标题显示「出战 n/squadCap」。命中区推进 `_squadHots`：

```typescript
    private _drawSquadPanel() {
        const g = this._squadGfx;
        g.clear();
        this._squadHots.length = 0;
        for (const l of this._squadLabels) l.node.active = false;
        let li = 0;
        const label = (s: string, x: number, y: number, size = 24) => {
            const lb = this._squadLabel(li++);
            lb.node.active = true; lb.string = s; lb.fontSize = size;
            lb.node.setPosition(x, y, 0);
        };

        // 半透明底板
        g.fillColor = new Color(20, 24, 30, 230);
        g.rect(-this._halfW, -this._halfH, this._halfW * 2, this._halfH * 2);
        g.fill();

        const deployed = this._squad.deployedList();
        label(`出战阵容  ${deployed.length}/${this._squad.squadCap}（点板凳上阵 / 点出战下阵 / ↑调前后）`, 0, 560, 26);

        const rowH = 96, top = 420, x0 = -300, rowW = 600;
        const pushRow = (name: string, y: number, tag: string, onRow: () => void, upBtn?: () => void) => {
            g.fillColor = new Color(48, 58, 72, 255);
            g.roundRect(x0, y - rowH / 2, rowW, rowH - 12, 10); g.fill();
            label(`${tag}  ${name}`, x0 + 20, y, 24);
            this._squadHots.push({ rect: { x: x0, y: y - rowH / 2, w: rowW - 96, h: rowH - 12 }, act: onRow });
            if (upBtn) {
                g.fillColor = new Color(80, 120, 160, 255);
                g.roundRect(x0 + rowW - 84, y - rowH / 2, 72, rowH - 12, 10); g.fill();
                label('↑', x0 + rowW - 56, y, 30);
                this._squadHots.push({ rect: { x: x0 + rowW - 84, y: y - rowH / 2, w: 72, h: rowH - 12 }, act: upBtn });
            }
        };

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

        // 关闭按钮
        g.fillColor = new Color(120, 60, 60, 255);
        g.roundRect(-90, -560, 180, 70, 12); g.fill();
        label('关闭', 0, -525, 26);
        this._squadHots.push({ rect: { x: -90, y: -560, w: 180, h: 70 }, act: () => this._hideSquadPanel() });
    }

    private _onSquadTap(e: EventTouch) {
        const p = this._squadRoot.getComponent(UITransform)!.convertToNodeSpaceAR(
            new Vec3(e.getUILocation().x, e.getUILocation().y, 0));
        for (const h of this._squadHots) {
            if (p.x >= h.rect.x && p.x <= h.rect.x + h.rect.w && p.y >= h.rect.y && p.y <= h.rect.y + h.rect.h) {
                h.act();
                return;
            }
        }
    }
```

（`Color`/`Vec3`/`EventTouch`/`UITransform`/`Node`/`Label`/`Graphics` 若未 import 需并入 `cc` 导入；面板标签一律用上一步的 `_squadLabel(i)` 工厂，勿用 `_makeLabel`。）

- [ ] **Step 6: 操作 → SquadModel → 存盘 → 刷新**

同区新增三个操作方法：改模型、存盘、重画面板、并重开战斗刷新出战单位（复用穿脱装备的战斗重开路径，结算页打开时不打断）：

```typescript
    private _squadDeploy(cls: SoldierClass) {
        if (this._squad.deploy(cls as any)) this._afterSquadChange();
    }
    private _squadUndeploy(cls: SoldierClass) {
        if (this._squad.undeploy(cls as any)) this._afterSquadChange();
    }
    private _squadMove(cls: SoldierClass, toIndex: number) {
        if (this._squad.move(cls as any, toIndex)) this._afterSquadChange();
    }
    private _afterSquadChange() {
        void saveSquad(this._squad);
        this._drawSquadPanel();
        if (this._gameStarted && !this._settlementOpen()) this._startBattle();
    }
```

（`_settlementOpen()`/`_gameStarted` 是 BattleEntry 现有成员，见 `_handleInventoryChanged` 用法。）

- [ ] **Step 7: 人工验证（Cocos 预览，列入待办）**

因面板依赖 cc 渲染，自动测试不覆盖。人工在 Cocos 预览确认：点「英雄」开面板；板凳角色上阵（满员后板凳点击无效）；出战角色下阵（剩 1 人时点击无效）；↑ 调前后顺序；关闭后战斗按新阵容出兵；重进游戏阵容保持（存档生效）。记入 `ai/memory/项目状态.md` 待办的「Cocos 预览手测」。

- [ ] **Step 8: Commit**

```bash
git add assets/scripts/BattleEntry.ts
git commit -m "feat(squad): 上阵面板（选人/下阵/调前后序/存盘刷新）挂英雄热区

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: pacing-sim 参数化 + 多人平衡重调

让 `pacing-sim` 按出战组合模拟，把配置默认组合翻成 `tank+dps`，逐关重调怪物 hp 直到默认组合三台阶复绿，抽查替代组合可玩。

**Files:**
- Modify: `tools/pacing-sim.ts`（参数化 winRate + 默认组合基线）
- Modify: `tools/seed-battle-xlsx.ts`（`roster` 改 `tank,dps`；逐关调 `LEVELS_ROWS` 的 hp 覆盖）
- Regenerate: `tools/config-xlsx/battle.xlsx`、`assets/scripts/config/battle.config.generated.ts`

**Interfaces:**
- Consumes: `BattleManager(..., roster)`（Task 3）；`BattleConfig.stats`。
- Produces: `sim:pacing` 对默认组合 `tank+dps` 输出「全部达标」。

- [ ] **Step 1: pacing-sim 参数化 winRate**

`tools/pacing-sim.ts` 顶部 import 加类型：

```typescript
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { BattleConfig, SoldierClass, CombatStats } from '../assets/scripts/config/BattleConfig';
```

`winRate`（当前 26-41 行）改为按 roster 给每个出战角色套装备档，构造多角色 effectiveStats + 传 roster：

```typescript
const DEFAULT_ROSTER: SoldierClass[] = ['tank', 'dps'];

function winRate(levelIndex: number, tier: number, roster: SoldierClass[] = DEFAULT_ROSTER): number {
    let wins = 0;
    for (let run = 0; run < RUNS; run++) {
        const gear = LOADOUTS[tier];
        const eff: Record<string, CombatStats> = {};
        for (const cls of roster) {
            const base = BattleConfig.stats[cls];
            eff[cls] = { ...base, hp: base.hp + gear.hp, atk: base.atk + gear.atk };
        }
        const mgr = new BattleManager(470, 836, levelIndex, eff, roster);
        for (let i = 0; i < MAX_TICKS && mgr.phase !== 'won' && mgr.phase !== 'lost'; i++) {
            mgr.tick(0.05);
            mgr.drainEvents();
        }
        if (mgr.phase === 'won') wins++;
    }
    return wins / RUNS;
}
```

（`GATES` 循环里的 `winRate(gate.level, gate.failTier)` / `winRate(gate.level, gate.passTier)` 调用不用改——用默认 `DEFAULT_ROSTER`。文件头注释补一句「基线组合＝tank+dps」。）

- [ ] **Step 2: 配置默认组合翻成 tank+dps**

`tools/seed-battle-xlsx.ts` 的 MISC_ROWS `roster` 行（Task 1 后为 `['roster', 'dps']`）改：

```typescript
    ['roster', 'tank,dps'],
```

- [ ] **Step 3: 重生配置 + 先跑一次看缺口**

Run:
```bash
npm run seed:battle && npm run config && npm run sim:pacing
```
Expected: 大概率**未达标**——tank+dps 两单位吞吐/血量约翻倍，低档位本应卡关的门槛现在会通过（`应卡关` 行变 ✗），部分 `应通过` 行过易。记录每条 ✗ 的关号与档位。

- [ ] **Step 4: 逐关重调怪物 hp（迭代）**

按 Step 3 输出，改 `tools/seed-battle-xlsx.ts` 的 `LEVELS_ROWS`（每行末尾第 9 列即 hp 覆盖，`''` 表示用类型基础血）。调法：
- **`应卡关` 行是 ✗**（低档位不该过却过了）→ 提高该关怪物 hp 覆盖（该关所有非 boss 行按比例上调，boss 关连 boss 一起）。
- **`应通过` 行是 ✗**（目标档位过不了）→ 说明调过头，回调该关 hp。
- 起步启发式：双人吞吐≈单人 ×2，台阶关（4/7/10）hp 覆盖先整体 ×1.6~×2.0 试，再按胜率微调。
- 保持台阶结构：1~3 关裸装可过、4 关卡裸装、7 关卡 t1、10 关卡 t2（GATES 表语义不变）。

每轮改完重生 + 重跑：
```bash
npm run seed:battle && npm run config && npm run sim:pacing
```
重复直到输出「全部达标」。

- [ ] **Step 5: 抽查替代组合不崩坏**

在 `tools/pacing-sim.ts` 末尾（`process.exit` 之前）临时加抽查，跑完删掉或留作注释：

```typescript
for (const alt of [['dps', 'healer'], ['tank', 'healer']] as SoldierClass[][]) {
    const r0 = winRate(0, 0, alt);
    const r9 = winRate(9, 3, alt);
    console.log(`  [抽查] ${alt.join('+')}：第1关@裸装 ${(r0 * 100).toFixed(0)}% / 第10关@7~9段 ${(r9 * 100).toFixed(0)}%`);
}
```

Run: `npm run sim:pacing`
Expected: 替代组合第 1 关裸装可过（≥60%），第 10 关满装不至于 0%（可玩，不要求达标阈值）。若某替代组合第 1 关就 0%，说明该组合完全不可行——记入设计日志「取舍」而非强调平衡。跑完把这段抽查删除（或注释保留）。

- [ ] **Step 6: 最终回归**

Run:
```bash
npm run seed:battle && npm run config && npm run test:combat && npm run test:squad && npm run sim:pacing
```
Expected: 全绿 + `sim:pacing`「全部达标」。

- [ ] **Step 7: Commit**

```bash
git add tools/pacing-sim.ts tools/seed-battle-xlsx.ts tools/config-xlsx/battle.xlsx assets/scripts/config/battle.config.generated.ts
git commit -m "feat(squad): pacing-sim 按组合参数化 + 默认 tank+dps 逐关重调平衡

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾（实现全部 Task 后，按开发收尾.md）

- [ ] 刷新 `ai/memory/项目状态.md`「最近进展」+「已完成」+「待办」（上阵已落地、Cocos 手测项、替代组合平衡取舍）。
- [ ] `ai/memory/设计日志.md`：把「玩法定位决策」的上阵方向条从"规划中"更新为已实现，补最终 squadCap/默认组合/重调结论。
- [ ] `ai/memory/代码地图.md`：新增 `squad/` 模块（SquadModel/SquadPersistence 职责）+ BattleEntry 上阵面板。
- [ ] 提交收尾。

## 自检对照（spec → task 覆盖）

- spec ① SquadModel 纯逻辑 → Task 2 ✓
- spec ② 持久化（PlayerData.squad）→ Task 4 ✓
- spec ③ squadCap 配置 → Task 1 ✓
- spec ④ 战斗接线（BattleManager roster 入参 + BattleEntry）→ Task 3 + Task 4 ✓
- spec ⑤ 上阵 UI（NavHeroesHot）→ Task 5 ✓
- spec ⑥ 平衡重调（pacing-sim 参数化 + 逐关调 + roster 翻 tank,dps）→ Task 6 ✓
- spec §① 提示（roster 从 dps 改回多人默认）→ Task 6 Step 2 ✓
