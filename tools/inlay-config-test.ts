// InlayConfig 纯计算单测（tsx 运行）。
import * as assert from 'node:assert/strict';
import { InlayConfig, socketCounts, gemStatKey, gemStatValue, gemMaxLevel, gemTypes, rollInscription } from '../assets/scripts/inlay/InlayConfig';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('socketCounts：按品质返回两组孔数（占位 legend=3/2）', () => {
    assert.deepEqual(socketCounts('legend'), { gemSockets: 3, inscriptionSlots: 2 });
    assert.deepEqual(socketCounts('common'), { gemSockets: 1, inscriptionSlots: 0 });
});

test('gemStatKey：宝石类型映射到战斗属性（crit→critRate, dmg→dmgBonus）', () => {
    assert.equal(gemStatKey('atk'), 'atk');
    assert.equal(gemStatKey('crit'), 'critRate');
    assert.equal(gemStatKey('dmg'), 'dmgBonus');
});

test('gemStatValue：等比价值 baseValue × levelRatio^(lv-1)，1~6 级钳制（2026-07-11 spec 5.3）', () => {
    const ratio = InlayConfig.gems.atk.levelRatio ?? 1;
    assert.ok(ratio > 1, `Gems 表应有 levelRatio 列（占位 1.6），实际 ${ratio}`);
    assert.equal(gemMaxLevel('atk'), 6, '宝石上限应为 6 级');
    const base = InlayConfig.gems.atk.baseValue;   // 基值随 balance:derive 变，读配置断言
    assert.ok(base > 0);
    assert.equal(gemStatValue('atk', 1), base, '1 级 = baseValue');
    assert.ok(Math.abs(gemStatValue('atk', 2) - base * ratio) < 1e-6, '2 级 = 1 级 ×ratio');
    assert.ok(Math.abs(gemStatValue('atk', 6) - base * Math.pow(ratio, 5)) < 1e-4, '6 级 = 1 级 ×ratio^5');
    assert.equal(gemStatValue('atk', 999), gemStatValue('atk', 6), '超上限钳到 maxLevel');
    assert.equal(gemStatValue('atk', 0), base, '低于 1 按 1');
});

test('gemTypes：列出全部 5 个类型', () => {
    assert.equal(gemTypes().length, 5);
    assert.ok(gemTypes().indexOf('atk') >= 0);
});

test('rollInscription：产出池内某条、value 落在该 stat 的 [min,max]', () => {
    // rng 固定返回 0 → 取池第一行、value=valueMin（区间值随 balance:derive 变，读配置断言）
    const first = InlayConfig.inscriptions[0];
    const insc = rollInscription(() => 0);
    assert.equal(insc.stat, first.stat);
    assert.equal(insc.value, first.valueMin);
});

test('rollInscription：rng 接近 1 时取末行、value 接近 valueMax', () => {
    // 池会随属性扩展变长（2026-07-11 由 7 行扩到 14 行），断言动态对齐末行而非写死 stat
    const last = InlayConfig.inscriptions[InlayConfig.inscriptions.length - 1];
    const insc = rollInscription(() => 0.999999);
    assert.equal(insc.stat, last.stat);   // 池末行
    assert.ok(insc.value <= last.valueMax && insc.value >= last.valueMin,
        `${insc.stat} value=${insc.value} 应在 [${last.valueMin},${last.valueMax}]`);
});

console.log(`\nInlayConfig：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
