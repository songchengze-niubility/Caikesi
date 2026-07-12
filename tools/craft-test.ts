// 合成服务单测（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { craftEquipment } from '../assets/scripts/craft/CraftService';
import { getCraftTier } from '../assets/scripts/config/CraftConfig';
import type { MaterialSave } from '../assets/scripts/services/RewardTypes';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('craftEquipment：材料充足时扣除材料并产出档位区间内的装备（成本读配置，随 balance:derive 变）', () => {
    const tier = getCraftTier('tier_1');
    const cost = tier.cost.forge_stone!;
    const materials: MaterialSave = { forge_stone: cost };
    const result = craftEquipment(materials, 'tier_1', 'weapon', () => 0.5);
    assert.equal(result.ok, true);
    assert.ok(result.item);
    assert.equal(result.item!.slot, 'weapon');
    assert.ok(
        result.item!.level! >= tier.levelMin && result.item!.level! <= tier.levelMax,
        `等级应落在档位区间内，得到 ${result.item!.level}`,
    );
    assert.equal(result.remainingMaterials!.forge_stone, 0);
    assert.equal(materials.forge_stone, cost, '不应就地修改传入的 materials');
});

test('craftEquipment：材料不足时拒绝且不返回 remainingMaterials', () => {
    const short = getCraftTier('tier_1').cost.forge_stone! - 1;
    const materials: MaterialSave = { forge_stone: short };
    const result = craftEquipment(materials, 'tier_1', 'weapon', () => 0.5);
    assert.equal(result.ok, false);
    assert.equal(result.reason, '材料不足');
    assert.equal(result.remainingMaterials, undefined);
    assert.equal(materials.forge_stone, short);
});

test('craftEquipment：高档位打造石不足时拒绝', () => {
    const materials: MaterialSave = { forge_stone: getCraftTier('tier_2').cost.forge_stone! - 1 };
    const result = craftEquipment(materials, 'tier_2', 'helmet', () => 0.5);
    assert.equal(result.ok, false);
    assert.equal(result.reason, '材料不足');
});

test('craftEquipment：非法部位/档位返回失败而非抛异常', () => {
    const materials: MaterialSave = { forge_stone: 999 };
    const badSlot = craftEquipment(materials, 'tier_1', 'invalid-slot' as any, () => 0.5);
    assert.equal(badSlot.ok, false);
    const badTier = craftEquipment(materials, 'no-such-tier', 'weapon', () => 0.5);
    assert.equal(badTier.ok, false);
});

test('craftEquipment：高档位平均品质高于低档位（抽样趋势，非精确断言）', () => {
    const materials: MaterialSave = { forge_stone: 9999 };
    const qualityRank: Record<string, number> = { common: 0, fine: 1, rare: 2, epic: 3, legend: 4 };
    let sumTier1 = 0;
    let sumTier3 = 0;
    const rounds = 200;
    for (let i = 0; i < rounds; i++) {
        const r1 = craftEquipment(materials, 'tier_1', 'weapon', Math.random);
        const r3 = craftEquipment(materials, 'tier_3', 'weapon', Math.random);
        sumTier1 += qualityRank[r1.item!.quality];
        sumTier3 += qualityRank[r3.item!.quality];
    }
    assert.ok(
        sumTier3 / rounds > sumTier1 / rounds,
        `高档位平均品质应更高（tier1=${sumTier1 / rounds} tier3=${sumTier3 / rounds}）`,
    );
});

console.log(`\n合成服务测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
