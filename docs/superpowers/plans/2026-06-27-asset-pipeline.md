# 美术/UI 资源管线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭一套 AI 友好的美术资源管线：代码用逻辑键要资源，缺图自动回退色块；Codex 丢图+登记即可，校验脚本保证不漏文件。

**Architecture:** 纯逻辑层（ArtManifest 对照表 + 路径助手 + 泛型 ArtRegistry 加载/缓存/回退 + FrameClock 帧数学）不依赖 cc、可 tsx 单测；薄 cc 胶水（CocosArtLoader、FrameAnim 播放器、Background/BattleEntry 接入）手动预览验证。校验脚本 `check-art` 对照 ArtManifest 查磁盘文件。

**Tech Stack:** TypeScript、Cocos Creator 3.8.8、tsx（纯逻辑单测，沿用 `tools/` 风格）、node zlib（生成占位 PNG）。

## Global Constraints

- 平台微信小游戏；现处色块占位期。
- 逻辑/渲染分离：`art/ArtManifest.ts`、`art/ArtRegistry.ts`、`art/FrameClock.ts` **不得 import `cc`**（要能被 tsx 单测）；cc 只出现在 `CocosArtLoader.ts`、`FrameAnim.ts` 及渲染接入处。
- 代码只认逻辑键，不写资源路径；路径只在 `ArtManifest`。
- 任何资源缺失 → 回退色块，**永不抛异常、不阻塞玩法**。
- 资源加载集中在进场前 `preload`，不在战斗每帧加载。
- 不碰 `combat/` 逻辑层；不改战斗数值。
- 测试/工具脚本放 `tools/`（`assets/` 会被 Cocos 编译）。
- 资源放 `assets/resources/art/` 下（`resources.load` 要求）；序列帧文件名 `<dir>/idle_<i>.png`，i 从 0。
- 非目标：Spine、音频、BMFont、分包。

---

### Task 1: ArtManifest 对照表 + 路径助手

**Files:**
- Create: `assets/scripts/art/ArtManifest.ts`
- Test: `tools/art-test.ts`
- Modify: `package.json`（加 `test:art` 脚本）

**Interfaces:**
- Produces: `ArtEntry`（联合类型），`ArtManifest: Record<string, ArtEntry>`，`entryFiles(entry: ArtEntry): string[]`（返回相对 resources/、不含扩展名的资源路径列表）。

- [ ] **Step 1: 写失败测试** — 创建 `tools/art-test.ts`

```ts
// 资源管线纯逻辑单测（tsx）。art 下的 Manifest/Registry/FrameClock 不依赖 cc，可直接 import。
import * as assert from 'node:assert/strict';
import { entryFiles, ArtEntry } from '../assets/scripts/art/ArtManifest';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('entryFiles：sprite 返回单路径', () => {
    const e: ArtEntry = { type: 'sprite', path: 'art/bg/main' };
    assert.deepEqual(entryFiles(e), ['art/bg/main']);
});

test('entryFiles：frames 返回编号帧路径', () => {
    const e: ArtEntry = { type: 'frames', dir: 'art/char/tank/idle', frames: 3, fps: 6, loop: true };
    assert.deepEqual(entryFiles(e), ['art/char/tank/idle/idle_0', 'art/char/tank/idle/idle_1', 'art/char/tank/idle/idle_2']);
});

console.log(`\n资源管线测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 运行确认失败**

Run: `npx tsx tools/art-test.ts`
Expected: FAIL —— 找不到模块 `../assets/scripts/art/ArtManifest`。

- [ ] **Step 3: 实现 ArtManifest** — 创建 `assets/scripts/art/ArtManifest.ts`

```ts
// 美术对照表：逻辑键 → 资源描述。这是「需要哪些美术、放哪」的唯一权威。
// 纯数据，不依赖 cc。Codex 加美术时在 ArtManifest 里登记一行。
// 路径相对 assets/resources/，不含扩展名（Cocos resources.load 约定）。

export type ArtEntry =
    | { type: 'sprite'; path: string }                                              // 单张静态图
    | { type: 'frames'; dir: string; frames: number; fps: number; loop: boolean };  // 序列帧（dir/idle_0.png…）

export const ArtManifest: Record<string, ArtEntry> = {
    'bg/main':          { type: 'sprite', path: 'art/bg/main' },
    'char/tank/idle':   { type: 'frames', dir: 'art/char/tank/idle',   frames: 4, fps: 6, loop: true },
    'char/dps/idle':    { type: 'frames', dir: 'art/char/dps/idle',    frames: 4, fps: 6, loop: true },
    'char/healer/idle': { type: 'frames', dir: 'art/char/healer/idle', frames: 4, fps: 6, loop: true },
};

// 该条目涉及的全部资源路径（相对 resources/，不含扩展名）。check-art 和 ArtRegistry 共用。
export function entryFiles(entry: ArtEntry): string[] {
    if (entry.type === 'sprite') return [entry.path];
    const out: string[] = [];
    for (let i = 0; i < entry.frames; i++) out.push(`${entry.dir}/idle_${i}`);
    return out;
}
```

- [ ] **Step 4: 加 npm 脚本** — 修改 `package.json` 的 `scripts`，追加：

```json
    "test:art": "tsx tools/art-test.ts"
```

- [ ] **Step 5: 运行确认通过**

Run: `npm run test:art`
Expected: PASS —— `2 通过，0 失败`。

- [ ] **Step 6: 提交**

```bash
git add assets/scripts/art/ArtManifest.ts tools/art-test.ts package.json
git commit -m "feat(art): ArtManifest 对照表 + entryFiles 路径助手 + 单测骨架"
```

---

### Task 2: FrameClock 帧数学（纯函数）

**Files:**
- Create: `assets/scripts/art/FrameClock.ts`
- Test: `tools/art-test.ts`（追加）

**Interfaces:**
- Produces: `frameAt(elapsed: number, fps: number, count: number, loop: boolean): number` —— 给定累计时间，返回当前帧下标。

- [ ] **Step 1: 写失败测试** — 在 `tools/art-test.ts` 顶部 import 后追加，并在汇总行之前

```ts
import { frameAt } from '../assets/scripts/art/FrameClock';

test('frameAt：loop 循环回绕', () => {
    assert.equal(frameAt(0, 6, 4, true), 0);
    assert.equal(frameAt(0.5, 6, 4, true), 3);   // floor(0.5*6)=3
    assert.equal(frameAt(1.0, 6, 4, true), 2);   // floor(6)=6, 6%4=2
});

test('frameAt：不循环则停在末帧', () => {
    assert.equal(frameAt(10, 6, 4, false), 3);   // 钳到 count-1
});

test('frameAt：count<=0 安全返回 0', () => {
    assert.equal(frameAt(1, 6, 0, true), 0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:art`
Expected: FAIL —— 找不到模块 `FrameClock`。

- [ ] **Step 3: 实现** — 创建 `assets/scripts/art/FrameClock.ts`

```ts
// 序列帧的帧下标计算（纯函数，不依赖 cc）。供 FrameAnim 与单测共用。
export function frameAt(elapsed: number, fps: number, count: number, loop: boolean): number {
    if (count <= 0) return 0;
    const i = Math.floor(elapsed * fps);
    if (loop) return ((i % count) + count) % count;
    return Math.min(i, count - 1);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:art`
Expected: PASS —— `5 通过，0 失败`。

- [ ] **Step 5: 提交**

```bash
git add assets/scripts/art/FrameClock.ts tools/art-test.ts
git commit -m "feat(art): FrameClock.frameAt 帧数学（纯函数）"
```

---

### Task 3: ArtRegistry 加载/缓存/回退（泛型，可注入 loader）

**Files:**
- Create: `assets/scripts/art/ArtRegistry.ts`
- Test: `tools/art-test.ts`（追加）

**Interfaces:**
- Consumes: `ArtManifest`, `entryFiles`（Task 1）。
- Produces: `type Loader<T> = (path: string) => Promise<T | null>`；`class ArtRegistry<T>`，构造 `new ArtRegistry<T>(loader)`，方法 `preload(keys: string[]): Promise<void>`、`getSprite(key): T | null`、`getFrames(key): { frames: T[]; fps: number; loop: boolean } | null`、`missingKeys(): string[]`。**不 import cc**（泛型 T 代替 SpriteFrame）。

- [ ] **Step 1: 写失败测试** — 追加

```ts
import { ArtRegistry } from '../assets/scripts/art/ArtRegistry';

// 假 loader：把 path 当资源本身返回；fakeMissing 集合里的返回 null（模拟缺图）
function fakeReg(missingPaths: string[] = []) {
    const miss = new Set(missingPaths);
    let calls = 0;
    const reg = new ArtRegistry<string>(async (p) => { calls++; return miss.has(p) ? null : `asset:${p}`; });
    return { reg, calls: () => calls };
}

test('ArtRegistry：preload 后 getSprite 命中', async () => {
    const { reg } = fakeReg();
    await reg.preload(['bg/main']);
    assert.equal(reg.getSprite('bg/main'), 'asset:art/bg/main');
});

test('ArtRegistry：getFrames 返回全部帧 + fps/loop', async () => {
    const { reg } = fakeReg();
    await reg.preload(['char/tank/idle']);
    const r = reg.getFrames('char/tank/idle')!;
    assert.equal(r.frames.length, 4);
    assert.equal(r.fps, 6);
    assert.equal(r.loop, true);
});

test('ArtRegistry：未登记键 → null 且记入 missing', async () => {
    const { reg } = fakeReg();
    await reg.preload(['没这个键']);
    assert.equal(reg.getSprite('没这个键'), null);
    assert.ok(reg.missingKeys().includes('没这个键'));
});

test('ArtRegistry：序列帧任一帧缺 → 整体 null', async () => {
    const { reg } = fakeReg(['art/char/dps/idle/idle_2']);
    await reg.preload(['char/dps/idle']);
    assert.equal(reg.getFrames('char/dps/idle'), null);
    assert.ok(reg.missingKeys().includes('char/dps/idle'));
});

test('ArtRegistry：缓存——同路径只 load 一次', async () => {
    const { reg, calls } = fakeReg();
    await reg.preload(['char/tank/idle']);
    await reg.preload(['char/tank/idle']);
    assert.equal(calls(), 4);   // 4 帧各一次，第二次 preload 全命中缓存
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:art`
Expected: FAIL —— 找不到模块 `ArtRegistry`。

- [ ] **Step 3: 实现** — 创建 `assets/scripts/art/ArtRegistry.ts`

```ts
// 资源加载/缓存/回退（泛型，不依赖 cc）。
// 加载逻辑由注入的 loader 决定（真实用 Cocos resources.load，测试用假 loader）。
// 解析不到的键 → 返回 null（不抛），并记入 missing 供调试。

import { ArtManifest, entryFiles } from './ArtManifest';

export type Loader<T> = (path: string) => Promise<T | null>;

export class ArtRegistry<T> {
    private cache = new Map<string, T | null>();   // 资源路径 → 资源（null=确认缺失）
    private missing = new Set<string>();           // 缺失的逻辑键

    constructor(private loader: Loader<T>) {}

    // 进场前批量预载这些逻辑键涉及的全部文件
    async preload(keys: string[]): Promise<void> {
        for (const key of keys) {
            const entry = ArtManifest[key];
            if (!entry) { this.missing.add(key); continue; }
            for (const p of entryFiles(entry)) await this.loadPath(p, key);
        }
    }

    private async loadPath(path: string, key: string): Promise<void> {
        if (this.cache.has(path)) return;
        const asset = await this.loader(path);
        this.cache.set(path, asset);
        if (asset == null) this.missing.add(key);
    }

    getSprite(key: string): T | null {
        const entry = ArtManifest[key];
        if (!entry || entry.type !== 'sprite') { this.missing.add(key); return null; }
        return this.cache.get(entry.path) ?? null;
    }

    getFrames(key: string): { frames: T[]; fps: number; loop: boolean } | null {
        const entry = ArtManifest[key];
        if (!entry || entry.type !== 'frames') { this.missing.add(key); return null; }
        const frames: T[] = [];
        for (const p of entryFiles(entry)) {
            const a = this.cache.get(p);
            if (a == null) { this.missing.add(key); return null; }   // 任一帧缺 → 整体回退
            frames.push(a);
        }
        return { frames, fps: entry.fps, loop: entry.loop };
    }

    missingKeys(): string[] { return [...this.missing]; }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:art`
Expected: PASS —— `10 通过，0 失败`。

- [ ] **Step 5: 提交**

```bash
git add assets/scripts/art/ArtRegistry.ts tools/art-test.ts
git commit -m "feat(art): ArtRegistry 加载/缓存/回退（泛型 + 注入 loader）"
```

---

### Task 4: check-art 校验脚本

**Files:**
- Create: `tools/check-art.ts`
- Modify: `package.json`（加 `check:art` 脚本）

**Interfaces:**
- Consumes: `ArtManifest`, `entryFiles`（Task 1）。
- Produces: 命令 `npm run check:art` —— 遍历 ArtManifest，逐条确认 `assets/resources/<path>.png` 存在，缺则列出并退出码 1。

- [ ] **Step 1: 实现脚本** — 创建 `tools/check-art.ts`

```ts
// 美术完整性校验：对照 ArtManifest，逐条查 assets/resources/<path>.png 是否存在。
// Codex 提交美术后跑一次（npm run check:art），立刻知道有没有漏文件。
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArtManifest, entryFiles } from '../assets/scripts/art/ArtManifest';

const RES = resolve(__dirname, '../assets/resources');
const missing: string[] = [];
for (const [key, entry] of Object.entries(ArtManifest)) {
    for (const p of entryFiles(entry)) {
        if (!existsSync(resolve(RES, p + '.png'))) missing.push(`${key} → resources/${p}.png`);
    }
}
if (missing.length) {
    console.error(`❌ 缺 ${missing.length} 个美术文件：`);
    for (const m of missing) console.error('  - ' + m);
    process.exit(1);
}
console.log(`✓ 美术齐全：${Object.keys(ArtManifest).length} 个逻辑键，全部文件就位`);
```

- [ ] **Step 2: 加 npm 脚本** — `package.json` 的 `scripts` 追加：

```json
    "check:art": "tsx tools/check-art.ts"
```

- [ ] **Step 3: 运行确认它报缺（此时还没有图）**

Run: `npm run check:art`
Expected: FAIL（退出码 1）—— 列出 `bg/main`、3 个 `char/*/idle` 共 13 个缺失 png。这证明校验生效。

- [ ] **Step 4: 提交**

```bash
git add tools/check-art.ts package.json
git commit -m "feat(art): check-art 资源完整性校验脚本"
```

---

### Task 5: 占位 PNG 生成器 + 生成样板资源

**Files:**
- Create: `tools/make-placeholder-art.ts`
- Create（生成产物）: `assets/resources/art/bg/main.png`、`assets/resources/art/char/{tank,dps,healer}/idle/idle_0..3.png`
- Modify: `package.json`（加 `art:placeholder` 脚本）

**Interfaces:**
- 命令 `npm run art:placeholder` 生成所有 ArtManifest 登记的 png（纯色块，序列帧逐帧变亮以便肉眼看出在动）。

- [ ] **Step 1: 实现生成器** — 创建 `tools/make-placeholder-art.ts`

```ts
// 生成占位 PNG（纯色块），让资源管线能端到端跑通；真图后续由 Codex 替换。
// 序列帧逐帧改变亮度，导入预览时能看出动画在循环。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ArtManifest, entryFiles } from '../assets/scripts/art/ArtManifest';

const RES = resolve(__dirname, '../assets/resources');

// —— 最小 PNG 编码（RGBA，无压缩优化，够用）——
const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td), 0);
    return Buffer.concat([len, td, crc]);
}
function solidPng(w: number, h: number, r: number, g: number, b: number): Buffer {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
    const raw = Buffer.alloc(h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
        const row = y * (1 + w * 4); raw[row] = 0; // filter 0
        for (let x = 0; x < w; x++) { const o = row + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255; }
    }
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function write(pathNoExt: string, png: Buffer) {
    const full = resolve(RES, pathNoExt + '.png'); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, png);
}

// 每个逻辑键一个基色
const BASE: Record<string, [number, number, number]> = {
    'bg/main': [120, 160, 210],
    'char/tank/idle': [70, 170, 200], 'char/dps/idle': [255, 150, 60], 'char/healer/idle': [90, 220, 120],
};
let count = 0;
for (const [key, entry] of Object.entries(ArtManifest)) {
    const [r, g, b] = BASE[key] ?? [200, 200, 200];
    const files = entryFiles(entry);
    files.forEach((p, i) => {
        const k = files.length > 1 ? 0.7 + 0.3 * (i / (files.length - 1)) : 1; // 逐帧变亮
        write(p, solidPng(64, 64, Math.round(r * k), Math.round(g * k), Math.round(b * k)));
        count++;
    });
}
console.log(`✓ 生成 ${count} 张占位 PNG 到 assets/resources/art/`);
```

- [ ] **Step 2: 加 npm 脚本** — `package.json` 的 `scripts` 追加：

```json
    "art:placeholder": "tsx tools/make-placeholder-art.ts"
```

- [ ] **Step 3: 生成 + 确认 check 通过**

Run: `npm run art:placeholder && npm run check:art`
Expected: 先打印生成 13 张 PNG，再 `✓ 美术齐全：4 个逻辑键，全部文件就位`（退出码 0）。

- [ ] **Step 4: 提交**

```bash
git add tools/make-placeholder-art.ts package.json assets/resources/art
git commit -m "feat(art): 占位 PNG 生成器 + 样板资源（背景 + 3 角色待机帧）"
```

> 注：本步提交的是 png；它们的 `.meta` 由下一步你开 Cocos 编辑器导入后再补提交。

---

### Task 6: Cocos 加载器 + 序列帧播放器（cc 胶水）

**Files:**
- Create: `assets/scripts/art/CocosArtLoader.ts`
- Create: `assets/scripts/art/FrameAnim.ts`

**Interfaces:**
- Consumes: `ArtRegistry`/`Loader`（Task 3）、`frameAt`（Task 2）。
- Produces: `createArtRegistry(): ArtRegistry<SpriteFrame>`；`class FrameAnimPlayer`，构造 `new FrameAnimPlayer(sprite: Sprite, frames: SpriteFrame[], fps: number, loop: boolean)`，方法 `update(dt: number): void`。

> cc 耦合，tsx 跑不了。验证：模型单测仍 10/10；文件语法/类型自检；真正显示在 Task 7/8 的预览里验。

- [ ] **Step 1: 实现 CocosArtLoader** — 创建 `assets/scripts/art/CocosArtLoader.ts`

```ts
// 用 Cocos resources.load 实现真实加载器，产出 ArtRegistry<SpriteFrame>。
// 注意：从 resources 下的图取 SpriteFrame，子资源路径是 "<图路径>/spriteFrame"。
import { resources, SpriteFrame } from 'cc';
import { ArtRegistry } from './ArtRegistry';

function loadSpriteFrame(path: string): Promise<SpriteFrame | null> {
    return new Promise(res => {
        resources.load(path + '/spriteFrame', SpriteFrame, (err, sf) => res(err ? null : (sf as SpriteFrame)));
    });
}

export function createArtRegistry(): ArtRegistry<SpriteFrame> {
    return new ArtRegistry<SpriteFrame>(loadSpriteFrame);
}
```

- [ ] **Step 2: 实现 FrameAnim** — 创建 `assets/scripts/art/FrameAnim.ts`

```ts
// 代码驱动序列帧播放器：按 fps 定时切 Sprite 的 spriteFrame。不依赖编辑器 AnimationClip。
import { Sprite, SpriteFrame } from 'cc';
import { frameAt } from './FrameClock';

export class FrameAnimPlayer {
    private elapsed = 0;
    constructor(
        private sprite: Sprite,
        private frames: SpriteFrame[],
        private fps: number,
        private loop: boolean,
    ) {
        if (frames.length) sprite.spriteFrame = frames[0];
    }
    update(dt: number): void {
        if (this.frames.length <= 1) return;
        this.elapsed += dt;
        this.sprite.spriteFrame = this.frames[frameAt(this.elapsed, this.fps, this.frames.length, this.loop)];
    }
}
```

- [ ] **Step 3: 回归 + 语法自检**

Run: `npm run test:art`
Expected: PASS（10/10，未受影响）。并目视确认两文件 import 路径正确、无语法错。

- [ ] **Step 4: 提交**

```bash
git add assets/scripts/art/CocosArtLoader.ts assets/scripts/art/FrameAnim.ts
git commit -m "feat(art): Cocos 加载器 + 序列帧播放器（cc 胶水）"
```

---

### Task 7: 背景接入（静态图，缺则原渐变）

**Files:**
- Modify: `assets/scripts/BattleEntry.ts`（onLoad 里建 registry、preload、把 bg 交给 Sprite 或保留 Graphics）
- Modify: `assets/scripts/combat/Background.ts`（支持「有 SpriteFrame 则不画渐变」）

**Interfaces:**
- Consumes: `createArtRegistry`（Task 6）、`ArtRegistry`、`SpriteFrame`。

> cc 耦合，预览验证。**先读** `BattleEntry.ts` 和 `Background.ts` 全文再改。

- [ ] **Step 1: Background 支持外部 Sprite** — 修改 `Background.ts`

在 `Background` 类加一个开关：当被告知"已有真实背景图"时，`update`/绘制跳过渐变重画。具体：给类加字段 `private _useSprite = false;` 和方法 `setUsingSprite(v: boolean) { this._useSprite = v; }`；在其每帧绘制入口最前面加 `if (this._useSprite) return;`（保留云/滚动逻辑被跳过，因为真背景图自带表现）。

- [ ] **Step 2: BattleEntry 建 registry 并接背景** — 修改 `BattleEntry.ts`

import 区加：
```ts
import { Sprite, SpriteFrame } from 'cc';
import { createArtRegistry } from './art/CocosArtLoader';
import { ArtRegistry } from './art/ArtRegistry';
```
类字段加：
```ts
    private _art: ArtRegistry<SpriteFrame> = null!;
```
`onLoad()` 里，在建好 `bgNode` 之后、`_startBattle()` 之前插入：
```ts
        // —— 美术资源：预载 → 有图用 Sprite，无图回退色块 ——
        this._art = createArtRegistry();
        void this._art.preload(['bg/main', 'char/tank/idle', 'char/dps/idle', 'char/healer/idle']).then(() => {
            const bgSf = this._art.getSprite('bg/main');
            if (bgSf) {
                const sp = bgNode.addComponent(Sprite);
                sp.spriteFrame = bgSf;
                bgNode.getComponent(UITransform)!.setContentSize(this._halfW * 2, this._halfH * 2);
                this._bg.setUsingSprite(true);   // 停掉渐变重画
            }
        });
```

- [ ] **Step 3: 预览验证**

放图已在 Task 5；**先开 Cocos 编辑器导入** `assets/resources/art/` 下的 png（生成 .meta），提交 .meta。然后预览：
- 背景应变成纯色块占位图（`bg/main` 的蓝灰色），不再是渐变。
- 临时把 `ArtManifest` 的 `bg/main` 改名（模拟缺图）→ 预览回到原渐变背景、控制台无报错 → 验证回退。验证后改回。

Expected: 有图显示真图、缺图回退渐变、均不报错。

- [ ] **Step 4: 提交**

```bash
git add assets/scripts/BattleEntry.ts assets/scripts/combat/Background.ts
git commit -m "feat(art): 背景接入资源管线（有图用 Sprite，缺则原渐变）"
```

---

### Task 8: 角色序列帧接入 + 缺失键调试浮层

**Files:**
- Modify: `assets/scripts/BattleEntry.ts`（小队渲染处：有帧则 Sprite+FrameAnim，无则色块；加缺失键浮层）

**Interfaces:**
- Consumes: `FrameAnimPlayer`（Task 6）、`this._art`（Task 7）。

> cc 耦合，预览验证。先读 `BattleEntry.ts` 当前小队渲染（`_render` 里画士兵的段落）。

- [ ] **Step 1: 角色 Sprite 节点 + 播放器** — 修改 `BattleEntry.ts`

类字段加：
```ts
    private _solSprite: Partial<Record<SoldierClass, { node: Node; anim: FrameAnimPlayer }>> = {};
```
import 区加 `import { FrameAnimPlayer } from './art/FrameAnim';`。

在 Task 7 的 `preload().then(...)` 回调里（拿到背景之后）追加：为每个职业尝试建序列帧 Sprite：
```ts
            for (const cls of BattleConfig.roster) {
                const fr = this._art.getFrames(`char/${cls}/idle`);
                if (!fr) continue;                       // 无帧 → 保留色块
                const n = new Node('Sol_' + cls); n.layer = this.node.layer;
                const ut = n.addComponent(UITransform);
                const size = BattleConfig.classes[cls].size; ut.setContentSize(size, size);
                const sp = n.addComponent(Sprite);
                this.node.addChild(n);
                this._solSprite[cls] = { node: n, anim: new FrameAnimPlayer(sp, fr.frames, fr.fps, fr.loop) };
            }
```

- [ ] **Step 2: 渲染时定位 Sprite + 驱动动画 + 色块仅在无图时画**

在 `_render()` 画士兵的循环里，最前面加：若该职业有 Sprite，则把 Sprite 节点移到士兵位置并跳过色块方块（保留血条）：
```ts
        const art = this._solSprite[sol.cls];
        if (art) {
            art.node.active = true;
            art.node.setPosition(sol.x, sol.y, 0);
        }
```
并把原来"画方块"的两行包在 `if (!art) { ... }` 里（血条照画）。在 `update(dt)` 末尾加驱动：
```ts
        for (const k in this._solSprite) this._solSprite[k as SoldierClass]!.anim.update(Math.min(dt, 0.05));
```

- [ ] **Step 3: 缺失键调试浮层** — `BattleEntry`

加一个一次性 Label，在 preload 完成后列出 `this._art.missingKeys()`：
```ts
            const miss = this._art.missingKeys();
            if (miss.length) this._makeLabel('缺图: ' + miss.join(', '), 0, -this._halfH + 110, 18);
```
（`_makeLabel` 已存在。）

- [ ] **Step 4: 预览验证**

确保 Task 5 的角色帧已被编辑器导入（.meta 已提交）。预览：
- 3 个角色显示为各自颜色的方块图，且**逐帧变亮在循环**（动画在动）。
- 删掉某职业的帧目录（或改 manifest 名）→ 该角色回退色块方块、浮层列出缺失键、不报错。验证后还原。

Expected: 有帧显示动画、缺帧回退色块 + 浮层提示、不报错。

- [ ] **Step 5: 提交**

```bash
git add assets/scripts/BattleEntry.ts
git commit -m "feat(art): 角色序列帧接入 + 缺失键调试浮层"
```

---

### Task 9: 给 Codex 的操作约定 skill

**Files:**
- Create: `ai/skills/美术资源管线.md`
- Modify: `ai/README.md`（技能索引加一行）

- [ ] **Step 1: 写 skill** — 创建 `ai/skills/美术资源管线.md`

```markdown
---
name: 美术资源管线
description: AI 驱动的美术/UI 资源交付：目录约定、ArtManifest 登记、编辑器导入、校验、缺图回退
when: 加/换美术资源、改 ArtManifest/ArtRegistry、接序列帧动画、给 Codex 派美术任务时
---

# 技能 · 美术资源管线

代码用**逻辑键**要资源，缺图自动回退色块。换美术 = 丢图 + 登记，不碰玩法代码。

## 加一份美术（Codex 照做）
1. 把图按目录约定放进 `assets/resources/art/...`：
   - 静态：`art/<分类>/<名>.png`（如 `art/bg/main.png`）。
   - 序列帧：`art/<分类>/<名>/idle_0.png … idle_{N-1}.png`（编号从 0 连续）。
2. 在 `assets/scripts/art/ArtManifest.ts` 登记逻辑键：
   - 静态：`'bg/main': { type: 'sprite', path: 'art/bg/main' }`
   - 序列帧：`'char/tank/idle': { type: 'frames', dir: 'art/char/tank/idle', frames: 4, fps: 6, loop: true }`
3. `npm run check:art` 确认文件齐全（缺文件会列出来）。
4. `git commit`（图 + ArtManifest）。

## 人工一步（必须）
- 开一次 Cocos 编辑器，等它自动导入新图（生成 `.meta`），把 `.meta` 一起提交。
  Cocos 规定资源须经编辑器导入获得 uuid，此步不可省。

## 不变量
- **路径只在 ArtManifest**；代码（渲染层）只用逻辑键，缺图回退色块、不报错。
- 资源放 `assets/resources/art/` 下才能按路径加载。
- 加载集中在进场 `preload`，不在战斗每帧（性能约束）。
- `ArtManifest`/`ArtRegistry`/`FrameClock` 不依赖 cc（可单测）；cc 只在 `CocosArtLoader`/`FrameAnim`/渲染接入。
- 路径权威=ArtManifest（被 check-art 校验）；操作权威=本文件。

## 自检
- `npm run test:art`（纯逻辑）+ `npm run check:art`（文件齐全）。
- 游戏内"缺图"浮层列出还在用色块的键。
```

- [ ] **Step 2: README 索引加一行** — `ai/README.md` 技能表加：

```
| `skills/美术资源管线.md` | 加/换美术、改 ArtManifest、派 Codex 美术任务时 | 目录约定、登记、编辑器导入、校验、缺图回退 |
```

- [ ] **Step 3: 提交**

```bash
git add ai/skills/美术资源管线.md ai/README.md
git commit -m "docs(art): 美术资源管线 skill（给 Codex 的操作约定）+ 索引"
```

---

## 收尾（实现完成后）

按 `ai/skills/开发收尾.md`：
- `项目状态.md`：最近进展 + 已完成加「美术资源管线」；待办标注"其余实体（怪/子弹/UI）按模板迁移"。
- `代码地图.md`：加 `art/` 区（Manifest/Registry/FrameClock/CocosArtLoader/FrameAnim 各一行）+ `resources/art/` + check-art。
- `设计日志.md`：追加「美术资源管线（逻辑键+回退，AI 驱动）」决策。
- 性能自检：Task 7/8 动了渲染层 → 对照性能基线看 DrawCall（Sprite 合批）。

## 自检（已核对）

- **Spec 覆盖**：逻辑键+回退(T3)、目录约定(T5/skill)、ArtManifest(T1)、ArtRegistry preload/get/missing(T3)、FrameAnim(T2/T6)、check-art(T4)、背景静态参考(T7)、角色序列帧参考(T8)、调试浮层(T8)、Codex 工作流 skill(T9)、占位图端到端(T5) —— 全覆盖。
- **类型一致**：`ArtEntry`/`entryFiles`/`ArtRegistry<T>`/`Loader<T>`/`frameAt`/`FrameAnimPlayer`/`createArtRegistry` 跨任务一致。
- **无 placeholder**：每步含完整代码/命令/预期。
- **可测/手动边界**：T1-5 tsx 可测；T6-8 cc 预览手动验（已在各步写明导入与回退验证）。
