// 关卡进度测试（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { ProgressModel } from '../assets/scripts/progression/ProgressModel';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('默认进度从第 0 关开始，只解锁第 0 关', () => {
    const p = new ProgressModel(3);
    assert.equal(p.currentLevel, 0);
    assert.equal(p.maxUnlockedLevel, 0);
});

test('通关当前关会解锁下一关但不自动切关', () => {
    const p = new ProgressModel(3);
    const r = p.completeLevel(0);
    assert.deepEqual(r, { completedLevel: 0, nextLevel: 1, hasNext: true, unlockedNext: true });
    assert.equal(p.currentLevel, 0);
    assert.equal(p.maxUnlockedLevel, 1);
});

test('继续下一关只允许进入已解锁关卡', () => {
    const p = new ProgressModel(3);
    assert.equal(p.selectLevel(1), false);
    p.completeLevel(0);
    assert.equal(p.selectNextAfter(0), true);
    assert.equal(p.currentLevel, 1);
});

test('最后一关通关不会越界', () => {
    const p = new ProgressModel(2);
    p.deserialize({ currentLevel: 1, maxUnlockedLevel: 1 });
    const r = p.completeLevel(1);
    assert.deepEqual(r, { completedLevel: 1, nextLevel: 1, hasNext: false, unlockedNext: false });
    assert.equal(p.selectNextAfter(1), false);
});

test('读老存档/异常存档会兜底和钳制', () => {
    const p = new ProgressModel(2);
    p.deserialize(undefined);
    assert.deepEqual(p.serialize(), { currentLevel: 0, maxUnlockedLevel: 0 });
    p.deserialize({ currentLevel: 9, maxUnlockedLevel: 9 });
    assert.deepEqual(p.serialize(), { currentLevel: 1, maxUnlockedLevel: 1 });
    p.deserialize({ currentLevel: 1 });
    assert.deepEqual(p.serialize(), { currentLevel: 1, maxUnlockedLevel: 1 });
});

console.log(`\n关卡进度测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
