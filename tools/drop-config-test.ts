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

console.log(`\n掉落配置测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
