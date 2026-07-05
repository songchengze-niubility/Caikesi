// CharacterGrowthModel 単テスト（純ロジック、tsx 実行）。
import * as assert from 'node:assert/strict';
import { CharacterGrowthModel } from '../assets/scripts/growth/CharacterGrowthModel';
import { expToNext } from '../assets/scripts/growth/CharGrowthConfig';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('新建：全角色默认 Lv.1/exp.0', () => {
    const m = new CharacterGrowthModel();
    assert.equal(m.levelOf('tank'), 1);
    assert.equal(m.expOf('tank'), 0);
});

test('gainExp：不够升级时只累加经验', () => {
    const m = new CharacterGrowthModel();
    const need = expToNext(1);
    const leveledUp = m.gainExp('dps', Math.floor(need / 2));
    assert.equal(leveledUp, false);
    assert.equal(m.levelOf('dps'), 1);
    assert.equal(m.expOf('dps'), Math.floor(need / 2));
});

test('gainExp：刚好/超过门槛时升级并保留余量', () => {
    const m = new CharacterGrowthModel();
    const need = expToNext(1);
    const leveledUp = m.gainExp('dps', need + 10);
    assert.equal(leveledUp, true);
    assert.equal(m.levelOf('dps'), 2);
    assert.equal(m.expOf('dps'), 10);
});

test('gainExp：一次性经验可连续跨多级', () => {
    const m = new CharacterGrowthModel();
    const big = expToNext(1) + expToNext(2) + expToNext(3) + 5;
    m.gainExp('tank', big);
    assert.equal(m.levelOf('tank'), 4);
    assert.equal(m.expOf('tank'), 5);
});

test('gainExp：不同角色互不影响', () => {
    const m = new CharacterGrowthModel();
    m.gainExp('tank', expToNext(1) + 1);
    assert.equal(m.levelOf('tank'), 2);
    assert.equal(m.levelOf('dps'), 1);
});

test('gainExp：满级后经验不再累加溢出', () => {
    const m = new CharacterGrowthModel();
    m.gainExp('healer', 10_000_000);
    const lv = m.levelOf('healer');
    assert.ok(lv >= 1, '应达到某个封顶等级');
    const exp1 = m.expOf('healer');
    m.gainExp('healer', 999);
    assert.equal(m.levelOf('healer'), lv, '满级后等级不再变化');
    assert.equal(m.expOf('healer'), exp1, '满级后经验不再累加');
});

test('serialize/deserialize 往返一致', () => {
    const m = new CharacterGrowthModel();
    m.gainExp('dps', expToNext(1) + 3);
    const back = CharacterGrowthModel.deserialize(m.serialize());
    assert.equal(back.levelOf('dps'), m.levelOf('dps'));
    assert.equal(back.expOf('dps'), m.expOf('dps'));
});

test('deserialize：缺失/未知 id 自愈为 Lv.1，负值归零', () => {
    const m = CharacterGrowthModel.deserialize({
        tank: { level: -5, exp: -10 },
        bogus: { level: 99, exp: 50 },
    } as any);
    assert.equal(m.levelOf('tank'), 1);
    assert.equal(m.expOf('tank'), 0);
    assert.equal(m.levelOf('dps'), 1);   // 缺失 id 补默认
});

console.log(`\nCharacterGrowthModel：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
