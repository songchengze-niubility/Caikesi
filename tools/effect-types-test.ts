// Effect 编码解析测试（纯逻辑，tsx 运行）。
import assert from 'node:assert/strict';
import { parseEffectList, parseStatMods, parseDelivery } from '../assets/scripts/config/EffectTypes';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }
const noErr = (msg: string) => { throw new Error('不应报错: ' + msg); };

test('parseEffectList：混合列表', () => {
    const list = parseEffectList('damage:1.5|applyBuff:poison:2|heal:0.8', noErr);
    assert.deepEqual(list, [
        { kind: 'damage', mult: 1.5 },
        { kind: 'applyBuff', buffId: 'poison', stacks: 2 },
        { kind: 'heal', mult: 0.8 },
    ]);
});

test('parseEffectList：applyBuff 默认层数 1；空串给空数组', () => {
    assert.deepEqual(parseEffectList('applyBuff:poison', noErr), [{ kind: 'applyBuff', buffId: 'poison', stacks: 1 }]);
    assert.deepEqual(parseEffectList('', noErr), []);
    assert.deepEqual(parseEffectList('  ', noErr), []);
});

test('parseEffectList：未知 kind / 非法数字要报错', () => {
    let errs: string[] = [];
    parseEffectList('explode:3', m => errs.push(m));
    assert.equal(errs.length, 1);
    errs = [];
    parseEffectList('damage:abc', m => errs.push(m));
    assert.equal(errs.length, 1);
});

test('parseStatMods：平铺与百分比', () => {
    assert.deepEqual(parseStatMods('atk:+5|atk%:0.25|def:-3', noErr), [
        { key: 'atk', flat: 5, pct: 0 },
        { key: 'atk', flat: 0, pct: 0.25 },
        { key: 'def', flat: -3, pct: 0 },
    ]);
});

test('parseStatMods：hp 与未知键报错', () => {
    let errs: string[] = [];
    parseStatMods('hp:+100', m => errs.push(m));
    assert.equal(errs.length, 1);
    errs = [];
    parseStatMods('mana:+5', m => errs.push(m));
    assert.equal(errs.length, 1);
});

test('parseDelivery：四种编码与默认值', () => {
    assert.equal(parseDelivery('', noErr), null);
    assert.equal(parseDelivery('  ', noErr), null);
    assert.deepEqual(parseDelivery('line:900', noErr), { kind: 'line', speed: 900, pierce: 0 });
    assert.deepEqual(parseDelivery('line:900:2', noErr), { kind: 'line', speed: 900, pierce: 2 });
    assert.deepEqual(parseDelivery('arc:700:1400', noErr), { kind: 'arc', speed: 700, gravity: 1400 });
    assert.deepEqual(parseDelivery('zone:150:4:1', noErr), { kind: 'zone', radius: 150, duration: 4, period: 1 });
});

test('parseDelivery：未知种类 / 非法参数报错', () => {
    let errs: string[] = [];
    parseDelivery('beam:100', m => errs.push(m));
    assert.equal(errs.length, 1);
    errs = [];
    parseDelivery('zone:0:4:1', m => errs.push(m));   // radius 必须 > 0
    assert.ok(errs.length >= 1);
    errs = [];
    parseDelivery('line:abc', m => errs.push(m));
    assert.ok(errs.length >= 1);
});

let failed = 0;
for (const t of tests) {
    try { t.run(); console.log(`  ✓ ${t.name}`); }
    catch (e) { failed++; console.error(`  ✗ ${t.name}`); console.error(e); }
}
console.log(`\nEffect 编码测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
