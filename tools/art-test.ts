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
