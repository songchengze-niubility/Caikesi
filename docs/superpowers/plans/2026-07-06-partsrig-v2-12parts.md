# 部件规范 v2（12 件骨架）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 8 件标准骨架升级为 12 件（肘关节 ×2 + 袍摆前后片），用新拆解图 `dps_parts_sheet_12.png` 从零组装校准并重出 DragonBones 工程 + 重写四动作关键帧。

**Architecture:** 纯数据/纯函数三层不变（PartsRigConfig 数据表 → PartsRigSampler 采样 → 预览/导出工具消费）。素材链：slice_sheet 切件 → assemble_parts12 校准出 parts_meta → export_dragonbones 自动绑骨。动作真源 = AI 写关键帧 JSON → `rig:import` 校验回写 generated ts → 新增 `rig:dump` 导出 `actions.json` 供 DB 导出脚本消费（单一真源，防 TS 与 JSON 漂移）。

**Tech Stack:** TypeScript（tsx 单测/工具）、Python + PIL（图像管线）、DragonBones Pro 5.5 JSON 格式。

**Spec:** `docs/superpowers/specs/2026-07-06-partsrig-v2-12parts-design.md`

## Global Constraints

- 12 件件表/锚点/父子链/层级以 spec 第 1 节为准；`weapon` 父级 = `armFrontLower`；腿挂 `root`。
- `RIG_MAX_PART_OFFSET = 14` 不变；idle/run 所有部件 |x|、|y| ≤ 14。
- 组装校准**不继承** `assemble_parts8.py` 的 CONFIG 数值（重头标定）；parts8 脚本与产物、旧 8 骨 DB 工程只留档不删。
- 新素材：`docs/visual/staging/characters/dps_parts_sheet_12.png`（已到位）。已知两处组装要点：鞋尖画反（`flip` 镜像）、躯干袖桩/袍摆前片腰带作为重叠余量（大臂盖袖桩、躯干压前片腰带）。
- 提交：中文 commit message，结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 逻辑与渲染分离边界不动：本计划不碰 BattleManager/BattleEntry/ArtManifest（Cocos 接入后置）。

---

### Task 1: PartsRigConfig v2（12 件类型/父子链/色块绑定表）+ 测试断言升级（RED）

**Files:**
- Modify: `assets/scripts/art/PartsRigConfig.ts`
- Modify: `tools/parts-rig-test.ts`

**Interfaces:**
- Produces: `RigPartId`（12 值联合）、`RIG_PART_IDS`、`RIG_PARENTS`、`PartsRigBind`（12 件色块表）——Task 2 的关键帧 JSON、Task 3 的 dump、Task 7 的预览都消费这些名字。
- 本任务结束时 `npm run test:partsrig` **预期失败**（generated ts 还是 8 件动作），Task 2 使其转绿——两任务连续执行，中间不合并。

- [ ] **Step 1: 改写 PartsRigConfig.ts 的类型与表**

`RigPartId`/`RIG_PART_IDS`/`RIG_PARENTS`/`PartsRigBind` 全部替换为：

```ts
export type RigPartId =
    | 'hairBack'      // 马尾（扎发点）
    | 'head'          // 头+前发（脖颈）
    | 'torso'         // 上身衣袍：领口/双肩口/腰带，腰带以下收口（髋部为旋转锚）
    | 'robeFront'     // 袍摆前片（腰带前缘）
    | 'robeBack'      // 袍摆后片（腰带后缘）
    | 'armFrontUpper' // 持械大臂+宽袖（肩口）
    | 'armFrontLower' // 持械小臂+拳（肘，袖口内）
    | 'armBackUpper'  // 后大臂+宽袖（肩口）
    | 'armBackLower'  // 后小臂+手（肘，袖口内）
    | 'legFront'      // 前小腿+鞋（裤脚口）
    | 'legBack'       // 后小腿+鞋（裤脚口）
    | 'weapon';       // 武器（握把）

export const RIG_PART_IDS: RigPartId[] = [
    'hairBack', 'head', 'torso', 'robeFront', 'robeBack',
    'armFrontUpper', 'armFrontLower', 'armBackUpper', 'armBackLower',
    'legFront', 'legBack', 'weapon',
];

export const RIG_PARENTS: Record<RigPartId, RigPartId | 'root'> = {
    torso: 'root',
    head: 'torso',
    hairBack: 'head',
    robeFront: 'torso',
    robeBack: 'torso',
    armFrontUpper: 'torso',
    armFrontLower: 'armFrontUpper',
    armBackUpper: 'torso',
    armBackLower: 'armBackUpper',
    legFront: 'root',   // 腿挂 root：脚踩地，不随上身前倾/呼吸弹跳漂移
    legBack: 'root',
    weapon: 'armFrontLower',
};

// 色块 demo 布局（真图绑定由组装 meta 换算，此表只服务无图调试）
// 层级(z 后→前)：hairBack armBackUpper armBackLower robeBack legBack legFront robeFront torso head armFrontUpper armFrontLower weapon
export const PartsRigBind: Record<RigPartId, RigBindDef> = {
    hairBack:      { x: -18, y: 102, z: 1,  rot: 22, draw: 'down', w: 14, h: 50, color: '#33363c' },
    armBackUpper:  { x: -5,  y: 65,  z: 2,  draw: 'down',   w: 9,  h: 14, color: '#d8d2c0' },
    armBackLower:  { x: -5,  y: 51,  z: 3,  draw: 'down',   w: 8,  h: 13, color: '#cfc9b6' },
    robeBack:      { x: -6,  y: 46,  z: 4,  draw: 'down',   w: 16, h: 26, color: '#8a9a7c' },
    legBack:       { x: -8,  y: 22,  z: 5,  draw: 'down',   w: 10, h: 22, color: '#8f9c7f' },
    legFront:      { x: 10,  y: 22,  z: 6,  draw: 'down',   w: 10, h: 22, color: '#9dab8b' },
    robeFront:     { x: 6,   y: 46,  z: 7,  draw: 'down',   w: 16, h: 26, color: '#a3b191' },
    torso:         { x: 0,   y: 44,  z: 8,  draw: 'up',     w: 30, h: 30, color: '#96a58c' },
    head:          { x: 3,   y: 66,  z: 9,  draw: 'circle', w: 40, h: 40, color: '#e8d9c3' },
    armFrontUpper: { x: 11,  y: 65,  z: 10, draw: 'down',   w: 9,  h: 14, color: '#e2dcc8' },
    armFrontLower: { x: 12,  y: 51,  z: 11, draw: 'down',   w: 8,  h: 13, color: '#d9d3bf' },
    weapon:        { x: 17,  y: 40,  z: 12, draw: 'fwd',    w: 46, h: 6,  color: '#7f958f' },
};
```

其余（`RigTrack`/`RigPartAnim`/`RigActionDef`/`RigBindDef`/`RIG_MAX_PART_OFFSET`/generated 转发）不动。文件头注释改为「标准部件规范 v2（2026-07-06）：12 件…设计见 docs/superpowers/specs/2026-07-06-partsrig-v2-12parts-design.md」。

- [ ] **Step 2: 升级测试断言**

`tools/parts-rig-test.ts` 改三处、加一处（其余测试件名无关，自动覆盖 12 件）：

```ts
// ① 原「attack 大臂主摆」测试整体替换为（肘部鞭甩链）：
test('动作中段确实在动：attack 大臂 >45°，大臂+小臂+武器合计峰值 >100°（鞭甩链）', () => {
    const def = PartsRigActions.attack;
    let maxUpper = 0, maxChain = 0;
    for (let i = 0; i <= 20; i++) {
        const s = sampleAction(def, def.duration * i / 20);
        maxUpper = Math.max(maxUpper, Math.abs(s.parts.armFrontUpper.rot));
        maxChain = Math.max(maxChain, Math.abs(
            s.parts.armFrontUpper.rot + s.parts.armFrontLower.rot + s.parts.weapon.rot));
    }
    assert.ok(maxUpper > 45, `attack 大臂最大转角仅 ${maxUpper}°`);
    assert.ok(maxChain > 100, `attack 鞭甩链合计峰值仅 ${maxChain}°`);
});

// ② 新增：袍摆反相测试（紧跟「run 双腿交替」测试之后）：
test('run 袍摆前后片反相：front(t)≈back(t+T/2) 且确实在摆（峰值>5°）', () => {
    const def = PartsRigActions.run;
    let peak = 0;
    for (const t of [0, 0.1, 0.2, 0.3, 0.4]) {
        const a = sampleAction(def, def.duration * t).parts.robeFront.rot;
        const b = sampleAction(def, def.duration * (t + 0.5)).parts.robeBack.rot;
        assert.ok(Math.abs(a - b) < 3, `t=${t} 袍摆相位不对：front=${a.toFixed(1)} back(t+半周期)=${b.toFixed(1)}`);
        peak = Math.max(peak, Math.abs(a));
    }
    assert.ok(peak > 5, `袍摆峰值仅 ${peak}°，等于没摆`);
});

// ③ 「未定义通道返回恒等」测试里 weapon 断言不动（idle 里 weapon 仍只动 rot）；
//    legFront 在 idle 里保持完全恒等的断言不动（v2 的 idle 依旧不动腿）。
// ④ 「肘部归位」由现有「attack 结束归位：全部件回恒等」自动覆盖 12 件，无需新写。
```

- [ ] **Step 3: 跑测试确认 RED**

Run: `npm run test:partsrig`
Expected: FAIL——generated ts 还是 8 件（`armFront` 等已不在 `RigPartId` 里，tsc/断言报错均可接受）。

- [ ] **Step 4: 提交**

```bash
git add assets/scripts/art/PartsRigConfig.ts tools/parts-rig-test.ts
git commit -m "feat(art): 部件规范 v2——12 件骨架类型/父子链/色块表 + 测试断言升级（RED，动作数据下个提交转绿）"
```

---

### Task 2: 四动作关键帧重写（12 骨）→ rig:import 回写（GREEN）

**Files:**
- Create: `temp/partsrig-demo/actions-v2.json`（rig:import 输入格式：`{idle,run,attack,death}` 顶层四键）
- Regenerate: `assets/scripts/art/parts.actions.generated.ts`（经 `npm run rig:import`，勿手改）

**Interfaces:**
- Consumes: Task 1 的 `RigPartId` 12 件名。
- Produces: `PartsRigActions`（12 骨四动作），Task 3 dump / Task 7 预览消费。

- [ ] **Step 1: 写 actions-v2.json**

完整初稿如下（设计意图：run 袍摆前后反相+手臂反腿相、attack 蓄力屈肘→直臂鞭甩三段、idle 呼吸微漾、death 沿用倒地淡出；后续手感微调在 DB 里做，这版先过断言+预览可看）：

```json
{
  "idle": {
    "duration": 1.2, "loop": true,
    "parts": {
      "torso":         { "scaleY": { "times": [0, 0.5, 1], "values": [1, 1.018, 1], "ease": "sine" } },
      "head":          { "y": { "times": [0, 0.55, 1], "values": [0, 2, 0], "ease": "sine" } },
      "hairBack":      { "rot": { "times": [0, 0.6, 1], "values": [-2, 2.5, -2], "ease": "sine" } },
      "robeFront":     { "rot": { "times": [0, 0.5, 1], "values": [0, 1.5, 0], "ease": "sine" } },
      "robeBack":      { "rot": { "times": [0, 0.6, 1], "values": [0, -2, 0], "ease": "sine" } },
      "armFrontUpper": { "rot": { "times": [0, 0.5, 1], "values": [0, 2, 0], "ease": "sine" } },
      "armFrontLower": { "rot": { "times": [0, 0.55, 1], "values": [0, 1.5, 0], "ease": "sine" } },
      "armBackUpper":  { "rot": { "times": [0, 0.5, 1], "values": [0, -2, 0], "ease": "sine" } },
      "armBackLower":  { "rot": { "times": [0, 0.55, 1], "values": [0, -1.5, 0], "ease": "sine" } },
      "weapon":        { "rot": { "times": [0, 0.5, 1], "values": [0, -1.5, 0], "ease": "sine" } }
    }
  },
  "run": {
    "duration": 0.5, "loop": true,
    "parts": {
      "torso":         { "rot": { "times": [0, 1], "values": [8, 8] },
                         "y":   { "times": [0, 0.25, 0.5, 0.75, 1], "values": [0, 4, 0, 4, 0], "ease": "sine" } },
      "head":          { "y": { "times": [0, 0.25, 0.5, 0.75, 1], "values": [0, -2, 0, -2, 0], "ease": "sine" } },
      "hairBack":      { "rot": { "times": [0, 0.5, 1], "values": [-14, 6, -14], "ease": "sine" } },
      "legFront":      { "rot": { "times": [0, 0.25, 0.5, 0.75, 1], "values": [22, 0, -22, 0, 22], "ease": "sine" } },
      "legBack":       { "rot": { "times": [0, 0.25, 0.5, 0.75, 1], "values": [-22, 0, 22, 0, -22], "ease": "sine" } },
      "robeFront":     { "rot": { "times": [0, 0.25, 0.5, 0.75, 1], "values": [9, 0, -9, 0, 9], "ease": "sine" } },
      "robeBack":      { "rot": { "times": [0, 0.25, 0.5, 0.75, 1], "values": [-9, 0, 9, 0, -9], "ease": "sine" } },
      "armFrontUpper": { "rot": { "times": [0, 0.25, 0.5, 0.75, 1], "values": [-16, 0, 16, 0, -16], "ease": "sine" } },
      "armFrontLower": { "rot": { "times": [0, 0.25, 0.5, 0.75, 1], "values": [-8, 0, 8, 0, -8], "ease": "sine" } },
      "armBackUpper":  { "rot": { "times": [0, 0.25, 0.5, 0.75, 1], "values": [16, 0, -16, 0, 16], "ease": "sine" } },
      "armBackLower":  { "rot": { "times": [0, 0.25, 0.5, 0.75, 1], "values": [8, 0, -8, 0, 8], "ease": "sine" } }
    }
  },
  "attack": {
    "duration": 0.35, "loop": false,
    "parts": {
      "armFrontUpper": { "rot": { "times": [0, 0.35, 0.6, 0.85, 1], "values": [0, -55, 70, 5, 0], "ease": "quadOut" } },
      "armFrontLower": { "rot": { "times": [0, 0.4, 0.65, 0.9, 1], "values": [0, -30, 45, 3, 0], "ease": "quadOut" } },
      "weapon":        { "rot": { "times": [0, 0.42, 0.66, 0.9, 1], "values": [0, -18, 28, 2, 0], "ease": "quadOut" } },
      "torso":         { "x": { "times": [0, 0.35, 0.6, 1], "values": [0, -4, 12, 0], "ease": "quadOut" },
                         "rot": { "times": [0, 0.35, 0.6, 1], "values": [0, -3, 6, 0], "ease": "quadOut" } },
      "robeFront":     { "rot": { "times": [0, 0.45, 0.7, 1], "values": [0, 5, -7, 0], "ease": "sine" } },
      "robeBack":      { "rot": { "times": [0, 0.45, 0.7, 1], "values": [0, -6, 8, 0], "ease": "sine" } },
      "hairBack":      { "rot": { "times": [0, 0.4, 0.7, 1], "values": [0, 8, -10, 0], "ease": "sine" } },
      "head":          { "rot": { "times": [0, 0.35, 0.6, 1], "values": [0, -2, 3, 0], "ease": "sine" } }
    }
  },
  "death": {
    "duration": 0.6, "loop": false,
    "parts": {},
    "root": {
      "rot":     { "times": [0, 0.5, 0.8, 1], "values": [0, 70, 88, 85], "ease": "quadOut" },
      "opacity": { "times": [0, 0.6, 1], "values": [1, 1, 0.4] }
    }
  }
}
```

- [ ] **Step 2: 回写 generated ts**

Run: `npx tsx tools/parts-rig-import.ts temp/partsrig-demo/actions-v2.json`
Expected: `[rig:import] 已回写 parts.actions.generated.ts`（校验器会拦未知部件名/轨道非法——若报错说明 JSON 与 Task 1 件名不一致，修 JSON）。

- [ ] **Step 3: 跑测试确认 GREEN**

Run: `npm run test:partsrig`
Expected: 全部通过（≥11 项：原 10 项 + 新袍摆反相），`PartsRig 测试：N 通过，0 失败`。

- [ ] **Step 4: 提交**

```bash
git add temp/partsrig-demo/actions-v2.json assets/scripts/art/parts.actions.generated.ts
git commit -m "feat(art): 12 骨四动作关键帧初稿——run 袍摆反相/attack 肘部鞭甩三段，test:partsrig 全绿"
```

（若 `temp/` 在 .gitignore 内则只提交 generated ts，actions-v2.json 留工作区。）

---

### Task 3: rig:dump 脚本（TS 动作 → actions.json 单一真源）+ export_dragonbones v2 适配

**Files:**
- Create: `tools/parts-rig-dump.ts`
- Modify: `package.json`（scripts 加一行）
- Modify: `tools/sprite-pipeline/export_dragonbones.py`（Z_ORDER/PARTS 目录）

**Interfaces:**
- Consumes: `PartsRigActions`、`RIG_PARENTS`（Task 1/2）。
- Produces: `temp/partsrig-demo/actions.json`，结构 `{ "actions": {...四动作...}, "parents": {...RIG_PARENTS...} }`——`export_dragonbones.py` 现有读取代码原样消费。

- [ ] **Step 1: 写 dump 脚本**

```ts
// tools/parts-rig-dump.ts
// 把 generated ts 的动作 + 父子链导出成 actions.json，供 export_dragonbones.py 消费。
// 用法：npm run rig:dump —— TS 侧是唯一动作真源，防手维护 JSON 漂移。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RIG_PARENTS } from '../assets/scripts/art/PartsRigConfig';
import { PartsRigActions } from '../assets/scripts/art/parts.actions.generated';

const out = path.resolve(__dirname, '..', 'temp', 'partsrig-demo', 'actions.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ actions: PartsRigActions, parents: RIG_PARENTS }, null, 2), 'utf8');
console.log(`[rig:dump] 已写出 ${out}`);
```

package.json scripts 加：`"rig:dump": "tsx tools/parts-rig-dump.ts",`（紧邻现有 `rig:import`）。

- [ ] **Step 2: 跑 dump 并核对**

Run: `npm run rig:dump`，然后打开 `temp/partsrig-demo/actions.json` 抽查。
Expected: `actions` 含四动作 12 件轨道，`parents.weapon === "armFrontLower"`。

- [ ] **Step 3: export_dragonbones.py 适配 v2**

改两处常量（其余逻辑吃 actions.json 的 parents，自动成链）：

```python
PARTS = BASE / 'parts12_final'
Z_ORDER = ['hairBack', 'armBackUpper', 'armBackLower', 'robeBack', 'legBack',
           'legFront', 'robeFront', 'torso', 'head', 'armFrontUpper', 'armFrontLower', 'weapon']
```

文件头注释补一行「v2：12 件（spec 2026-07-06），旧 8 骨工程留档 dragonbones-v1-8bones/」。此时不跑（parts12_final 尚不存在，Task 6 跑）。

- [ ] **Step 4: 提交**

```bash
git add tools/parts-rig-dump.ts package.json tools/sprite-pipeline/export_dragonbones.py
git commit -m "feat(art): rig:dump 单一动作真源导出 + export_dragonbones 升 12 件骨架"
```

---

### Task 4: 新拆解图切件（parts12）

**Files:**
- Create(产物): `temp/partsrig-demo/parts12/piece_*.png` + `pieces_catalog.png`

**Interfaces:**
- Produces: 12 个切件 PNG + 目录图；Task 5 的 CONFIG 靠目录图人工映射 `piece_N → 部件名`。

- [ ] **Step 1: 跑切件**

Run: `py -3 tools/sprite-pipeline/slice_sheet.py --src docs/visual/staging/characters/dps_parts_sheet_12.png --out temp/partsrig-demo/parts12`
Expected: 输出 12 个 `piece_*.png`（若多于 12：小碎片调大 `--min-area` 重跑；若少于 12：有部件粘连，查 `pieces_catalog.png` 并调小 `--bg-tolerance` 重跑）。

- [ ] **Step 2: 查目录图做件名映射**

Read `temp/partsrig-demo/parts12/pieces_catalog.png`，逐件确认内容并记下 `piece_N → {head, hairBack, torso, robeFront, robeBack, armFrontUpper(袖锥×2 里持械侧), armFrontLower(握拳那只), armBackUpper, armBackLower(张手那只), legFront, legBack, weapon}` 映射表（写进 Task 5 CONFIG 的注释里）。两只袖锥/两条腿外观接近：大臂以画面相对位置区分（右上第一个=持械侧），腿任选一只做前腿。
Expected: 12 件全部指认成功且与 spec 件表一一对应；发现合并/缺件则回 Step 1 调参，仍失败升级给用户重抽图。

- [ ] **Step 3: 提交**

```bash
git add temp/partsrig-demo/parts12
git commit -m "chore(art): dps 十二件拆解图切件产物"
```

（`temp/` 若被 .gitignore 忽略则跳过本提交，切件产物属可再生中间品。）

---

### Task 5: assemble_parts12.py 从零校准（组装 + parts_meta）

**Files:**
- Create: `tools/sprite-pipeline/assemble_parts12.py`
- Create(产物): `temp/partsrig-demo/parts12_final/{12件}.png + parts_meta.json + assemble_check.png`

**Interfaces:**
- Consumes: Task 4 的 `parts12/piece_*.png` 与件名映射。
- Produces: `parts_meta.json`——每件 `{bbox:[x0,y0,x1,y1], pivot:[cx,cy]}` + `_foot.pivot`（脚底基准），Task 6 绑骨、Task 7 预览消费（格式与 v1 完全一致）。

- [ ] **Step 1: 写组装脚本**

复用 `assemble_parts8.py` 的**代码结构**（画布/翻转/缩放/旋转/裁剪/meta/对照图逻辑逐行同构），CONFIG 数值**从零标定**。初版脚本：

```python
# PartsRig 十二件组装校准（标准部件规范 v2）：拆解图切件 → 对位到角色坐标系。
# 用法：py -3 tools/sprite-pipeline/assemble_parts12.py ；校准=改 CONFIG 重跑。
# 输出：parts12_final/<part>.png + parts_meta.json + assemble_check.png（左=组装 右=参考图）
import json
from pathlib import Path

from PIL import Image

SRC = Path(r'F:\Cgame\temp\partsrig-demo\parts12')
OUT = Path(r'F:\Cgame\temp\partsrig-demo\parts12_final')
REFERENCE = Path(r'F:\Cgame\temp\sprite-keyframes\pipeline\style-test4\character_transparent.png')
TOP_PAD = 90
CANVAS = (1166, 1116 + TOP_PAD)
FOOT = (491, 1108 + TOP_PAD)

# ⚠ file 映射按 Task 4 Step 2 的目录图指认结果填；pivot_local/scale/char 为初始估计，
#   对照 assemble_check.png 迭代（锚点语义见 spec 件表；char 坐标沿用 v1 角色坐标系）。
CONFIG = {
    'torso':         { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (523, 726), 'rot': 0 },  # 锚=髋（旋转轴），领口落 ~(523,470)
    'head':          { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (523, 470), 'rot': 0 },  # 锚=脖颈
    'hairBack':      { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (314, 124), 'rot': 0 },  # 锚=扎发点
    'robeFront':     { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (545, 705), 'rot': 0 },  # 锚=腰带前缘，下缘落 ~1010
    'robeBack':      { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (500, 700), 'rot': 0 },  # 锚=腰带后缘，比前片略长
    'armFrontUpper': { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (600, 490), 'rot': 0 },  # 锚=肩口（沿 v1 armFront 肩点）
    'armFrontLower': { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (655, 600), 'rot': 0 },  # 锚=肘（袖口内），拳落 ~(757,690)
    'armBackUpper':  { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (448, 492), 'rot': 0 },
    'armBackLower':  { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (438, 600), 'rot': 0 },
    'legFront':      { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (590, 901), 'rot': 0, 'flip': True },  # 鞋尖原画朝左，镜像
    'legBack':       { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (420, 901), 'rot': 0, 'flip': True },
    'weapon':        { 'file': 'piece_?.png', 'pivot_local': (0, 0), 'scale': 1.0, 'char': (757, 702), 'rot': -6 }, # 锚=握把
}
Z_ORDER = ['hairBack', 'armBackUpper', 'armBackLower', 'robeBack', 'legBack',
           'legFront', 'robeFront', 'torso', 'head', 'armFrontUpper', 'armFrontLower', 'weapon']
# 注意 char 坐标不含 TOP_PAD，写 meta 时统一加

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    canvas = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
    meta = {}
    for part in Z_ORDER:
        c = CONFIG[part]
        im = Image.open(SRC / c['file']).convert('RGBA')
        pivot_x = c['pivot_local'][0]
        if c.get('flip'):
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
            pivot_x = im.width - pivot_x
        w, h = round(im.width * c['scale']), round(im.height * c['scale'])
        im = im.resize((w, h), Image.LANCZOS)
        px, py = pivot_x * c['scale'], c['pivot_local'][1] * c['scale']
        if c['rot']:
            big = Image.new('RGBA', (w * 3, h * 3), (0, 0, 0, 0))
            big.alpha_composite(im, (w, h))
            big = big.rotate(-c['rot'], center=(w + px, h + py), resample=Image.BICUBIC)
            im = big
            px, py = w + px, h + py
        bbox = im.getbbox()
        trimmed = im.crop(bbox)
        trimmed.save(OUT / f'{part}.png')
        cx, cy = c['char'][0], c['char'][1] + TOP_PAD
        ox = cx - (px - bbox[0])
        oy = cy - (py - bbox[1])
        meta[part] = {'bbox': [round(ox), round(oy), round(ox + trimmed.width), round(oy + trimmed.height)],
                      'pivot': [cx, cy]}
        canvas.alpha_composite(trimmed, (round(ox), round(oy)))
    meta['_foot'] = {'pivot': list(FOOT)}
    (OUT / 'parts_meta.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')

    ref = Image.open(REFERENCE).convert('RGBA')
    sheet = Image.new('RGB', (CANVAS[0] * 2, CANVAS[1]), (236, 229, 211))
    tmp = Image.new('RGBA', CANVAS, (236, 229, 211, 255)); tmp.alpha_composite(canvas)
    sheet.paste(tmp.convert('RGB'), (0, 0))
    tmp = Image.new('RGBA', CANVAS, (236, 229, 211, 255)); tmp.alpha_composite(ref, (0, TOP_PAD))
    sheet.paste(tmp.convert('RGB'), (CANVAS[0], 0))
    sheet.save(OUT / 'assemble_check.png')
    print('[assemble12] 完成 → assemble_check.png（左=组装 右=参考图）')


main()
```

先把 `file` 按映射表填实、`pivot_local` 按各件图内目测锚点填实（打开各 piece 看坐标或用 pieces_catalog 网格读数），再进 Step 2 迭代。

- [ ] **Step 2: 校准迭代（视觉自查环）**

Run: `py -3 tools/sprite-pipeline/assemble_parts12.py`，Read `assemble_check.png`，对照右侧参考图逐件核：
1. 整体剪影与参考图重合（头/躯干/袍摆/腿/剑位置比例）；
2. **断缝遮挡**：大臂盖住躯干袖桩、袖口盖住小臂肘端圆头、躯干腰带压住 robeFront 腰带、袍摆下缘盖住腿件裤脚口、脖颈进领口；
3. 鞋尖朝右（flip 生效）；武器握进拳中（rot 微调）；
4. 层级正确（腿在两片袍摆之间、weapon 最前）。
不满足处改 CONFIG（scale/char/pivot_local/rot）重跑，直到逐项过。
Expected: 最终 `assemble_check.png` 左右两图剪影基本重合、无露馅断缝。

- [ ] **Step 3: 展示给用户过目**

把 `assemble_check.png` 给用户看一眼再进绑骨（真素材验收原则；用户不满意回 Step 2）。

- [ ] **Step 4: 提交**

```bash
git add tools/sprite-pipeline/assemble_parts12.py
git commit -m "feat(art): 十二件组装校准脚本落地——新拆解图从零标定，断缝遮挡自查通过"
```

---

### Task 6: DragonBones 工程重出（12 骨，旧工程留档）

**Files:**
- Rename: `temp/partsrig-demo/dragonbones/` → `temp/partsrig-demo/dragonbones-v1-8bones/`（留档）
- Create(产物): `temp/partsrig-demo/dragonbones/{dps_ske.json, dps_tex.json, dps_tex.png}`

**Interfaces:**
- Consumes: Task 3 的 `actions.json` + Task 5 的 `parts12_final/parts_meta.json`。
- Produces: 12 骨 DB 工程，用户在 DragonBones Pro 里审。

- [ ] **Step 1: 留档旧工程**

```powershell
Rename-Item F:\Cgame\temp\partsrig-demo\dragonbones dragonbones-v1-8bones
```

- [ ] **Step 2: 刷新 actions.json 并导出**

Run: `npm run rig:dump`，然后 `py -3 tools/sprite-pipeline/export_dragonbones.py`
Expected: `[dragonbones] 导出完成`；`dps_ske.json` 中 `bone` 数组 13 个（root+12），`weapon` 的 `parent` 为 `armFrontLower`，`animation` 4 个。

- [ ] **Step 3: 结构自检**

Read `temp/partsrig-demo/dragonbones/dps_ske.json`（抽查 bone/slot/skin 三段）+ Read `dps_tex.png` 确认 12 件贴图齐全无裁切。
Expected: slot 顺序 = Z_ORDER（后→前）；每件 skin 有 display。

- [ ] **Step 4: 提交 + 通知用户在 DB 审**

```bash
git add tools/sprite-pipeline/export_dragonbones.py
git commit -m "feat(art): 12 骨 DragonBones 工程重出——肘链/袍摆入骨，旧 8 骨工程留档"
```

告知用户：DragonBones Pro（`D:\Program Files\Egret\DragonBonesPro`）→ 文件 → 导入 → `temp/partsrig-demo/dragonbones/dps_ske.json`，先审 attack 鞭甩、再审 run 袍摆。

---

### Task 7: 预览页适配 + 烘焙

**Files:**
- Modify: `tools/parts-rig-preview.ts:25`（`partsDirName = 'parts12_final'`，注释同步「十二件标准版」）
- Create(产物): `temp/partsrig-demo/preview.html`

**Interfaces:**
- Consumes: Task 2 动作 + Task 5 的 parts_meta（换算逻辑件名无关，改目录名即可）。

- [ ] **Step 1: 改目录常量并烘焙**

Run: `npx tsx tools/parts-rig-preview.ts`
Expected: 生成 `temp/partsrig-demo/preview.html`，含色块行（12 件新绑定表）+ 真图行（parts12_final）。

- [ ] **Step 2: 自查预览**

打开 preview.html（或截图检查）：四动作循环无跳变、run 袍摆前后翻飞、attack 肘部鞭甩、断缝不露馅、120px 下动作可读。
Expected: 四项全过；不过则回 Task 2 调关键帧或 Task 5 调校准（改完重跑 `npm run test:partsrig` + `rig:dump` + 预览）。

- [ ] **Step 3: 提交**

```bash
git add tools/parts-rig-preview.ts
git commit -m "feat(art): 预览页切换十二件真图行"
```

---

### Task 8: 文档与记忆收尾

**Files:**
- Modify: `ai/memory/视觉风格.md`（八件提示词模板节 → 十二件 v2）
- Modify: `ai/memory/代码地图.md`（PartsRigConfig 职责行、assemble_parts12 行、parts8/旧工程标注留档、rig:dump 行）
- Modify: `ai/memory/项目状态.md`（「最近进展」刷新：v2 落地、下一步=用户 DB 审）
- Modify: `ai/memory/设计日志.md`（追加：8→12 件的动机与取舍——肘链+袍摆而非膝、生成 12 件而非程序切、重头校准）

- [ ] **Step 1: 视觉风格.md 模板 v2**

「八件拆解图提示词模板（标准部件规范 v1…）」整节替换为「十二件拆解图提示词模板（标准部件规范 v2，2026-07-06）」，正文用实际交给用户的十二件提示词 + 负向约束 + 挑图关键（正好 12 件互不合并；肘端圆头/袖口开口；袍摆两片独立、腰带处收口；件数多易合并需多抽）。v1 模板剪进「版本记录」一行说明或删除（版本记录加一行 2026-07-06 条目）。

- [ ] **Step 2: 其余三处记忆按 `ai/skills/开发收尾.md` 走一遍**

代码地图：`PartsRigConfig.ts` 行的「8 件」改「12 件（v2）」；`assemble_parts8.py` 行改注「v1 留档」，加 `assemble_parts12.py` 行；`export_dragonbones.py` 行补 12 骨与 `rig:dump`。项目状态：最近进展顶部加 v2 条目（含接力点：用户 DB 审→Cocos 接入决策）。设计日志：追加 2026-07-06 条目（动机=attack/run 双僵硬；关键判断=长袍角色膝关节无效、袍摆才是 run 生动来源；素材走重生成、校准重头做）。

- [ ] **Step 3: 提交**

```bash
git add ai/memory docs/superpowers
git commit -m "docs(art): 部件规范 v2 收尾——十二件提示词模板/代码地图/项目状态/设计日志同步"
```

---

## Self-Review 记录

1. **Spec coverage**：spec §1 件表→Task 1/5/6；§2 提示词模板→Task 8（素材已由用户交付）；§3 管线（slice 不改/assemble12/export/Config/动作/测试/预览）→Task 4/5/3+6/1/2/1/7；§4 验收→Task 6 Step 4 + Task 7 Step 2；实施顺序§步骤 2「代码侧先行」→Task 1-3 全部不依赖新素材，可先行。无缺口。
2. **Placeholder scan**：Task 5 CONFIG 的 `piece_?.png`/`pivot_local:(0,0)` 是**校准流程的输入位**（依赖 Task 4 运行时的目录图指认，计划期不可知），Step 1 末尾已给出填实指令与 Step 2 迭代环，非悬空 TBD。其余无占位。
3. **Type consistency**：12 件件名在 Task 1（类型）/Task 2（JSON 键）/Task 3+5+6（Z_ORDER）/Task 7（换算件名无关）拼写一致（camelCase：armFrontUpper 等）；`parts_meta.json` 结构与 v1 逐字段一致（bbox/pivot/_foot），下游 export/preview 无需改读取代码。
