// 资源管线纯逻辑单测（tsx）。art 下的 Manifest/Registry/FrameClock 不依赖 cc，可直接 import。
import * as assert from 'node:assert/strict';
import { ArtManifest, entryFiles, ArtEntry } from '../assets/scripts/art/ArtManifest';
import { frameAt, frameBlendAt } from '../assets/scripts/art/FrameClock';
import { ArtRegistry } from '../assets/scripts/art/ArtRegistry';

let pass = 0, fail = 0;
const tests: { name: string; fn: () => void | Promise<void> }[] = [];
function test(name: string, fn: () => void | Promise<void>) {
    tests.push({ name, fn });
}

test('entryFiles：sprite 返回单路径', () => {
    const e: ArtEntry = { type: 'sprite', path: 'art/bg/main' };
    assert.deepEqual(entryFiles(e), ['art/bg/main']);
});

test('entryFiles：frames 返回编号帧路径', () => {
    const e: ArtEntry = { type: 'frames', dir: 'art/char/tank/idle', frames: 3, fps: 6, loop: true };
    assert.deepEqual(entryFiles(e), ['art/char/tank/idle/idle_0', 'art/char/tank/idle/idle_1', 'art/char/tank/idle/idle_2']);
});

test('entryFiles: frames can use custom prefix', () => {
    const e: ArtEntry = { type: 'frames', dir: 'art/char/dps/attack_01', prefix: 'attack_01', frames: 3, fps: 12, loop: false };
    assert.deepEqual(entryFiles(e), ['art/char/dps/attack_01/attack_01_0', 'art/char/dps/attack_01/attack_01_1', 'art/char/dps/attack_01/attack_01_2']);
});

test('frameAt：loop 循环回绕', () => {
    assert.equal(frameAt(0, 6, 4, true), 0);
    assert.equal(frameAt(0.5, 6, 4, true), 3);   // floor(0.5*6)=3
    assert.equal(frameAt(1.0, 6, 4, true), 2);   // floor(6)=6, 6%4=2
});

test('frameAt: pingpong loop mirrors instead of jumping to frame 0', () => {
    assert.equal(frameAt(0, 1, 4, true, true), 0);
    assert.equal(frameAt(1, 1, 4, true, true), 1);
    assert.equal(frameAt(2, 1, 4, true, true), 2);
    assert.equal(frameAt(3, 1, 4, true, true), 3);
    assert.equal(frameAt(4, 1, 4, true, true), 2);
    assert.equal(frameAt(5, 1, 4, true, true), 1);
    assert.equal(frameAt(6, 1, 4, true, true), 0);
});

test('frameBlendAt: blends toward next frame near the frame boundary', () => {
    const before = frameBlendAt(0.4, 1, 4, true, false, 0.5);
    assert.deepEqual(before, { from: 0, to: 1, alpha: 0 });
    const during = frameBlendAt(0.75, 1, 4, true, false, 0.5);
    assert.equal(during.from, 0);
    assert.equal(during.to, 1);
    assert.ok(during.alpha > 0 && during.alpha < 1);
});

test('frameAt：不循环则停在末帧', () => {
    assert.equal(frameAt(10, 6, 4, false), 3);   // 钳到 count-1
});

test('frameAt：count<=0 安全返回 0', () => {
    assert.equal(frameAt(1, 6, 0, true), 0);
});

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
    assert.equal(r.pingpong, false);
    assert.equal(r.blend, 0);
});

test('ArtRegistry：getFrames 透传身体基准 bodyH/anchorX/footY', async () => {
    const { reg } = fakeReg();
    await reg.preload(['char/dps/attack']);
    const r = reg.getFrames('char/dps/attack')!;
    const entry = ArtManifest['char/dps/attack'];
    assert.ok(entry.type === 'frames');
    assert.equal(r.bodyH, entry.bodyH);
    assert.equal(r.anchorX, entry.anchorX);
    assert.equal(r.footY, entry.footY);
    // 指标必须是 0-1 归一化
    for (const v of [r.bodyH, r.anchorX, r.footY]) {
        if (v != null) assert.ok(v > 0 && v <= 1, `指标越界: ${v}`);
    }
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

(async () => {
    for (const t of tests) {
        try { await t.fn(); pass++; console.log('  ✓ ' + t.name); }
        catch (e) { fail++; console.error('  ✗ ' + t.name + ' — ' + (e as Error).message); }
    }
    console.log(`\n资源管线测试：${pass} 通过，${fail} 失败`);
    process.exit(fail ? 1 : 0);
})();
