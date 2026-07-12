// CharGrowthConfig 纯计算单测（tsx 运行）。
import * as assert from 'node:assert/strict';
import { charLevelCoef, expToNext, clampCharLevel } from '../assets/scripts/growth/CharGrowthConfig';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('charLevelCoef：1级=1.0（无加成）', () => {
    assert.equal(charLevelCoef(1), 1.0);
});

test('charLevelCoef：等级越高系数越大（每级增量读配置，随 balance:derive 变）', () => {
    const growth = BattleConfig.charGrowth.statGrowthPerLevel;
    assert.ok(growth > 0, 'statGrowthPerLevel 应为正');
    const c10 = charLevelCoef(10);
    assert.ok(Math.abs(c10 - (1 + 9 * growth)) < 1e-9, `期望 ${1 + 9 * growth}，得到 ${c10}`);
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

test('clampCharLevel：钳制在 1~maxLevel（2026-07-11 上限提到 100）', () => {
    assert.equal(clampCharLevel(0), 1);
    assert.equal(clampCharLevel(-3), 1);
    assert.equal(clampCharLevel(100), 100);
    assert.equal(clampCharLevel(9999), 100);
    assert.equal(clampCharLevel(15), 15);
});

test('expToNext：三段几何——段边界单调、后段增速放缓、Lv100 有限（2026-07-11）', () => {
    const cfg = (BattleConfig.charGrowth ?? {}) as unknown as Record<string, number>;
    assert.equal(cfg.expSeg2Start, 31, 'Misc 应配 expSeg2Start=31');
    assert.equal(cfg.expSeg3Start, 61, 'Misc 应配 expSeg3Start=61');
    // 段内比率：升到 31 级那步用 seg2Growth，升到 61 级那步用 seg3Growth
    assert.ok(Math.abs(expToNext(31) / expToNext(30) - cfg.expSeg2Growth) < 0.01, '31 级步进应按 seg2Growth');
    assert.ok(Math.abs(expToNext(61) / expToNext(60) - cfg.expSeg3Growth) < 0.01, '61 级步进应按 seg3Growth');
    // 单调递增 + 上限有限（纯 ×1.15 到 100 级是天文数字/级，分段后应远小于它）
    let prev = 0;
    for (let lv = 1; lv <= 100; lv++) { const e = expToNext(lv); assert.ok(e > prev, `Lv${lv} 应单调递增`); prev = e; }
    const expBase = BattleConfig.charGrowth.expBase;   // 起点值随 balance:derive 变，读配置
    assert.ok(expToNext(100) < expBase * Math.pow(1.15, 99) / 100, 'Lv100 门槛应远小于纯几何');
    // 首段（1~30）与旧公式逐位等价
    assert.equal(expToNext(12), Math.round(expBase * Math.pow(1.15, 11)), '首段维持旧公式');
});

console.log(`\nCharGrowthConfig：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
