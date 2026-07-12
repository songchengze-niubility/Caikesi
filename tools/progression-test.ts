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
    assert.deepEqual(r, { completedLevel: 0, nextLevel: 1, hasNext: true, unlockedNext: true, firstClear: true });
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
    assert.deepEqual(r, { completedLevel: 1, nextLevel: 1, hasNext: false, unlockedNext: false, firstClear: true });
    assert.equal(p.selectNextAfter(1), false);
});

test('读老存档/异常存档会兜底和钳制', () => {
    const p = new ProgressModel(2);
    p.deserialize(undefined);
    assert.deepEqual(p.serialize(), { currentLevel: 0, maxUnlockedLevel: 0, maxClearedLevel: -1 });
    p.deserialize({ currentLevel: 9, maxUnlockedLevel: 9 });
    assert.deepEqual(p.serialize(), { currentLevel: 1, maxUnlockedLevel: 1, maxClearedLevel: 0 });
    p.deserialize({ currentLevel: 1 });
    assert.deepEqual(p.serialize(), { currentLevel: 1, maxUnlockedLevel: 1, maxClearedLevel: 0 });
});

test('firstClear：首通 true、重打 false', () => {
    const m = new ProgressModel(10, 0);
    const r1 = m.completeLevel(0);
    assert.equal(r1.firstClear, true);
    const r2 = m.completeLevel(0);
    assert.equal(r2.firstClear, false);
});

test('firstClear：末关也能判首通（maxUnlocked 推导不出的场景）', () => {
    const m = new ProgressModel(3, 0);
    m.completeLevel(0); m.completeLevel(1);
    const first = m.completeLevel(2);   // 末关
    assert.equal(first.firstClear, true);
    const again = m.completeLevel(2);
    assert.equal(again.firstClear, false);
});

test('firstClear：老档缺 maxClearedLevel → 解锁之下视为已通', () => {
    const m = new ProgressModel(10, 0);
    m.deserialize({ currentLevel: 4, maxUnlockedLevel: 5 });   // 老档：无 maxClearedLevel
    assert.equal(m.completeLevel(3).firstClear, false);   // 4(=maxUnlocked-1) 及以下视为已通
    assert.equal(m.completeLevel(5).firstClear, true);    // 新推进的关正常判首通
});

test('firstClear：序列化往返保留', () => {
    const m = new ProgressModel(10, 0);
    m.completeLevel(0);
    const m2 = new ProgressModel(10, 0);
    m2.deserialize(m.serialize());
    assert.equal(m2.completeLevel(0).firstClear, false);
});

console.log(`\n关卡进度测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
