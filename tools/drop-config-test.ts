// 掉落配置测试（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';
import { getDropGroup, rollDropItems } from '../assets/scripts/config/DropConfig';
import { QUALITIES, SLOTS } from '../assets/scripts/inventory/EquipDefs';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

function rngSeq(values: number[]): () => number {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
}

test('第一章 10 关按台阶分段指向掉落组', () => {
    assert.equal(BattleConfig.levels.length, 10);
    assert.equal(BattleConfig.levels[0].dropGroup, 'c1_early');
    assert.equal(BattleConfig.levels[2].dropGroup, 'c1_early');
    assert.equal(BattleConfig.levels[3].dropGroup, 'c1_mid');
    assert.equal(BattleConfig.levels[5].dropGroup, 'c1_mid');
    assert.equal(BattleConfig.levels[6].dropGroup, 'c1_late');
    assert.equal(BattleConfig.levels[8].dropGroup, 'c1_late');
    assert.equal(BattleConfig.levels[9].dropGroup, 'c1_boss');
    assert.equal(getDropGroup('c1_early').itemCount, 1);
});

test('第 10 关最后一波包含 Boss 怪', () => {
    const finalWave = BattleConfig.levels[9].waves[BattleConfig.levels[9].waves.length - 1];
    assert.ok(finalWave.spawns.some(s => s.type === 'boss_butcher'), '末波缺少 boss_butcher');
    assert.ok(BattleConfig.enemyTypes.boss_butcher, 'enemyTypes 缺少 boss_butcher');
});

test('dropGroup 覆盖完整品质/部位权重', () => {
    for (const id of ['c1_early', 'c1_mid', 'c1_late', 'c1_boss']) {
        const g = getDropGroup(id);
        for (const q of QUALITIES) assert.ok(g.qualityWeights[q] !== undefined, `${id} 缺少品质权重 ${q}`);
        for (const s of SLOTS) assert.ok(g.slotWeights[s] !== undefined, `${id} 缺少部位权重 ${s}`);
    }
});

test('rollDropItems 按配置生成带属性装备', () => {
    const items = rollDropItems('c1_early', () => 0);
    assert.equal(items.length, 1);
    assert.equal(items[0].slot, 'weapon');
    assert.equal(items[0].quality, 'common');
    assert.ok(items[0].stats && Object.keys(items[0].stats).length > 0, '掉落装备缺少 stats');
});

test('高随机值可命中高品质尾段权重', () => {
    const items = rollDropItems('c1_mid', rngSeq([0, 0.995, 0, 0, 0, 0]));
    assert.equal(items[0].quality, 'legend');
});

test('掉落等级落在各 dropGroup 区间内', () => {
    const ranges: Array<[string, number, number]> = [
        ['c1_early', 1, 5],
        ['c1_mid', 4, 9],
        ['c1_late', 8, 14],
        ['c1_boss', 12, 18],
    ];
    for (const [id, min, max] of ranges) {
        for (let i = 0; i < 30; i++) {
            for (const item of rollDropItems(id, Math.random)) {
                assert.ok(item.level !== undefined && item.level >= min && item.level <= max,
                    `${id} 掉落等级应在 [${min},${max}]，得到 ${item.level}`);
            }
        }
    }
});

test('rollDropItems：level 区间边界（rng=0 取最低，rng 接近 1 取最高）', () => {
    const low = rollDropItems('c1_early', () => 0);
    assert.equal(low[0].level, 1);
    const high = rollDropItems('c1_early', () => 0.999999);
    assert.equal(high[0].level, 5);
});

test('Boss 掉落组一次掉两件', () => {
    const items = rollDropItems('c1_boss', Math.random);
    assert.equal(items.length, 2);
});

test('qualityBonus：蓝+权重放大后高品质占比上升（同 rng 序列对比统计）', () => {
    const mkRng = () => { let s = 42; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; };
    const count = (bonus: number) => {
        const rng = mkRng();
        let high = 0;
        for (let i = 0; i < 200; i++) {
            for (const it of rollDropItems('c1_early', rng, bonus)) {
                if (it.quality === 'rare' || it.quality === 'epic' || it.quality === 'legend') high++;
            }
        }
        return high;
    };
    const base = count(0), boosted = count(10);
    assert.ok(boosted > base, `boosted=${boosted} 应 > base=${base}`);
});

test('qualityBonus=0：与不传参数逐位一致（默认行为不变）', () => {
    const mkRng = (seed: number) => { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; };
    const a = rollDropItems('c1_early', mkRng(7));
    const b = rollDropItems('c1_early', mkRng(7), 0);
    assert.deepEqual(a.map(i => [i.slot, i.quality, i.level]), b.map(i => [i.slot, i.quality, i.level]));
});

console.log(`\n掉落配置测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
