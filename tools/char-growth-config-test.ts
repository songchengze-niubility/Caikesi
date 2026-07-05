// CharGrowthConfig 纯计算单测（tsx 运行）。
import * as assert from 'node:assert/strict';
import { charLevelCoef, expToNext, clampCharLevel } from '../assets/scripts/growth/CharGrowthConfig';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('charLevelCoef：1级=1.0（无加成）', () => {
    assert.equal(charLevelCoef(1), 1.0);
});

test('charLevelCoef：等级越高系数越大（statGrowthPerLevel=0.05 时 10级=1.45）', () => {
    const c10 = charLevelCoef(10);
    assert.ok(Math.abs(c10 - 1.45) < 1e-9, `期望约 1.45，得到 ${c10}`);
});

test('charLevelCoef：非整数/小于1按1处理', () => {
    assert.equal(charLevelCoef(0), 1.0);
    assert.equal(charLevelCoef(-5), 1.0);
});

test('expToNext：随等级几何增长（后一级门槛更高）', () => {
    const e1 = expToNext(1);
    const e5 = expToNext(5);
    assert.ok(e5 > e1, `expToNext(5)=${e5} 应大于 expToNext(1)=${e1}`);
});

test('clampCharLevel：钳制在 1~maxLevel', () => {
    assert.equal(clampCharLevel(0), 1);
    assert.equal(clampCharLevel(-3), 1);
    assert.equal(clampCharLevel(9999), 30);
    assert.equal(clampCharLevel(15), 15);
});

console.log(`\nCharGrowthConfig：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
