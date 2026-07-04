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

test('关卡表通过 dropGroup 指向掉落配置', () => {
    assert.equal(BattleConfig.levels[0].dropGroup, 'level_1');
    assert.equal(BattleConfig.levels[1].dropGroup, 'level_2');
    assert.equal(getDropGroup(BattleConfig.levels[0].dropGroup).itemCount, 1);
});

test('dropGroup 覆盖完整品质/部位权重', () => {
    const g = getDropGroup('level_1');
    for (const q of QUALITIES) assert.ok(g.qualityWeights[q] !== undefined, `缺少品质权重 ${q}`);
    for (const s of SLOTS) assert.ok(g.slotWeights[s] !== undefined, `缺少部位权重 ${s}`);
});

test('rollDropItems 按配置生成带属性装备', () => {
    const items = rollDropItems('level_1', () => 0);
    assert.equal(items.length, 1);
    assert.equal(items[0].slot, 'weapon');
    assert.equal(items[0].quality, 'common');
    assert.ok(items[0].stats && Object.keys(items[0].stats).length > 0, '掉落装备缺少 stats');
});

test('高随机值可命中高品质尾段权重', () => {
    const items = rollDropItems('level_2', rngSeq([0, 0.995, 0, 0, 0, 0]));
    assert.equal(items[0].quality, 'legend');
});

test('rollDropItems 产出的装备等级落在 dropGroup 的区间内', () => {
    for (let i = 0; i < 30; i++) {
        const items = rollDropItems('level_2', Math.random);
        for (const item of items) {
            assert.ok(item.level !== undefined && item.level >= 6 && item.level <= 15,
                `level_2 掉落等级应在 [6,15]，得到 ${item.level}`);
        }
    }
});

test('rollDropItems：level 区间边界（rng=0 取最低，rng 接近 1 取最高）', () => {
    const low = rollDropItems('level_1', () => 0);
    assert.equal(low[0].level, 1);
    const high = rollDropItems('level_1', () => 0.999999);
    assert.equal(high[0].level, 10);
});

console.log(`\n掉落配置测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
