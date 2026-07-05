// InlayConfig 纯计算单测（tsx 运行）。
import * as assert from 'node:assert/strict';
import { socketCounts, gemStatKey, gemStatValue, gemMaxLevel, gemTypes, rollInscription } from '../assets/scripts/inlay/InlayConfig';

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

test('gemStatValue：baseValue × level，等级钳到 maxLevel', () => {
    assert.equal(gemStatValue('atk', 1), 30);
    assert.equal(gemStatValue('atk', 3), 90);
    assert.equal(gemStatValue('atk', 999), 30 * gemMaxLevel('atk'));   // 超上限钳到 maxLevel
    assert.equal(gemStatValue('atk', 0), 30);                          // 低于1按1
});

test('gemTypes：列出全部 5 个类型', () => {
    assert.equal(gemTypes().length, 5);
    assert.ok(gemTypes().indexOf('atk') >= 0);
});

test('rollInscription：产出池内某条、value 落在该 stat 的 [min,max]', () => {
    // rng 固定返回 0 → 取池第一行、value=valueMin（atk: [10,40] → stat=atk, value=10）
    const insc = rollInscription(() => 0);
    assert.equal(insc.stat, 'atk');
    assert.equal(insc.value, 10);
});

test('rollInscription：rng 接近 1 时取末行、value 接近 valueMax', () => {
    const insc = rollInscription(() => 0.999999);
    assert.equal(insc.stat, 'dmgReduce');   // 池末行
    assert.ok(insc.value <= 0.05 && insc.value >= 0.01, `dmgReduce value=${insc.value} 应在 [0.01,0.05]`);
});

console.log(`\nInlayConfig：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
