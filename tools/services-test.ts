import assert from 'node:assert/strict';
import { createSeededRng } from '../assets/scripts/core/Random';
import { generateStageReward } from '../assets/scripts/loot/LootService';
import { calculateOfflineReward } from '../assets/scripts/offline/OfflineCombatService';
import { ChestInventoryModel, createChestItem } from '../assets/scripts/chest/ChestModel';
import { ChestConfig, type ChestDropGroupConfig } from '../assets/scripts/config/ChestConfig';
import { OfflineConfig } from '../assets/scripts/config/OfflineConfig';
import { rollChestDrop } from '../assets/scripts/chest/ChestDropService';
import { openChest } from '../assets/scripts/chest/ChestService';
import { InventoryModel } from '../assets/scripts/inventory/InventoryModel';
import { InventoryService } from '../assets/scripts/inventory/InventoryService';
import { EquipmentService } from '../assets/scripts/inventory/EquipmentService';
import { createEquipItem } from '../assets/scripts/inventory/EquipDefs';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

test('Random(seed) 多次运行结果一致', () => {
    const a = createSeededRng('same-seed');
    const b = createSeededRng('same-seed');
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('generateStageReward：同 seed 掉落结果一致', () => {
    const a = generateStageReward({ levelIndex: 0, source: 'StageClear', seed: 'reward-seed' });
    const b = generateStageReward({ levelIndex: 0, source: 'StageClear', seed: 'reward-seed' });
    assert.deepEqual(a, b);
    assert.equal(a.gold, 0);
    assert.equal(a.exp, 0);
    assert.equal(a.chests.length, 0);
    assert.ok(a.equipments.length > 0);
});

test('ChestInventoryModel：add/serialize/deserialize 往返', () => {
    const model = new ChestInventoryModel();
    const chest = createChestItem({
        type: 'normal',
        sourceLevelIndex: 0,
        sourceDropGroup: 'c1_early',
        seed: 'chest-seed',
        createdAt: 123456,
    });
    assert.equal(model.addChest(chest).ok, true);
    const save = model.serializeChests();
    const next = new ChestInventoryModel();
    next.deserializeChests(save);
    assert.deepEqual(next.serializeChests(), save);
});

test('ChestInventoryModel：库存满了后新增宝箱失败，反序列化也会按上限裁掉', () => {
    const model = new ChestInventoryModel(1);
    const first = createChestItem({
        type: 'normal',
        sourceLevelIndex: 0,
        sourceDropGroup: 'c1_early',
        seed: 'first',
        createdAt: 1000,
    });
    const second = createChestItem({
        type: 'boss',
        sourceLevelIndex: 0,
        sourceDropGroup: 'c1_early',
        seed: 'second',
        createdAt: 1001,
    });
    assert.equal(model.addChest(first).ok, true);
    const full = model.addChest(second);
    assert.equal(full.ok, false);
    assert.equal(full.reason, '宝箱库存已满');

    const next = new ChestInventoryModel(1);
    next.deserializeChests([first, second]);
    assert.equal(next.chests.length, 1);
    assert.equal(next.chests[0].id, first.id);
});

test('ChestService：同 seed 开箱结果一致，只产出装备/材料，不给金币经验', () => {
    const chest = createChestItem({
        type: 'normal',
        sourceLevelIndex: 0,
        sourceDropGroup: 'c1_early',
        seed: 'open-seed',
        createdAt: 1000,
    });
    const a = openChest(chest);
    const b = openChest(chest);
    assert.equal(a.ok, true);
    assert.deepEqual(a.reward, b.reward);
    assert.equal(a.reward!.gold, 0);
    assert.equal(a.reward!.exp, 0);
    assert.ok(a.reward!.equipments.length > 0);
    assert.ok(a.reward!.materials.length > 0);
    assert.ok(a.reward!.materials.every(item => item.count > 0));
});

test('ChestService：高阶宝箱奖励更多，宝箱可移除', () => {
    const normal = createChestItem({
        type: 'normal',
        sourceLevelIndex: 1,
        sourceDropGroup: 'c1_mid',
        seed: 'normal',
        createdAt: 1000,
    });
    const boss = createChestItem({
        type: 'boss',
        sourceLevelIndex: 1,
        sourceDropGroup: 'c1_mid',
        seed: 'boss',
        createdAt: 1000,
    });
    const normalReward = openChest(normal).reward!;
    const bossReward = openChest(boss).reward!;
    assert.equal(normalReward.gold, 0);
    assert.equal(bossReward.gold, 0);
    assert.equal(normalReward.exp, 0);
    assert.equal(bossReward.exp, 0);
    assert.ok(bossReward.equipments.length > normalReward.equipments.length);
    assert.ok(bossReward.materials.reduce((sum, item) => sum + item.count, 0) > normalReward.materials.reduce((sum, item) => sum + item.count, 0));

    const model = new ChestInventoryModel();
    model.addChest(normal);
    assert.equal(model.removeChest(normal.id).ok, true);
    assert.equal(model.chests.length, 0);
});

test('ChestService：宝箱掉落组已不存在时按来源关卡现行掉落组兜底', () => {
    const chest = createChestItem({
        type: 'normal',
        sourceLevelIndex: 0,
        sourceDropGroup: 'gone_group',
        seed: 'legacy-chest',
        createdAt: 1000,
    });
    const res = openChest(chest);
    assert.equal(res.ok, true);
    assert.ok(res.reward!.equipments.length > 0);
});

test('ChestDropService：同 seed 的小怪/关底掉落结果一致', () => {
    const mob = rollChestDrop({ levelIndex: 0, dropGroup: 'c1_early', source: 'monster', seed: 'same-mob', createdAt: 1000 });
    const mobAgain = rollChestDrop({ levelIndex: 0, dropGroup: 'c1_early', source: 'monster', seed: 'same-mob', createdAt: 1000 });
    const final = rollChestDrop({ levelIndex: 0, dropGroup: 'c1_early', source: 'stageFinal', seed: 'same-final', createdAt: 1000 });
    const finalAgain = rollChestDrop({ levelIndex: 0, dropGroup: 'c1_early', source: 'stageFinal', seed: 'same-final', createdAt: 1000 });
    assert.deepEqual(mob, mobAgain);
    assert.deepEqual(final, finalAgain);
});

test('ChestDropService：概率和类型权重影响结果', () => {
    const oldGroup = ChestConfig.groups.test_chest;
    const oldMobWeights = ChestConfig.typeWeights.test_mob_only;
    const oldFinalWeights = ChestConfig.typeWeights.test_final_only;
    const oldZero = ChestConfig.groups.test_zero;
    try {
        ChestConfig.groups.test_chest = {
            mobChance: 1,
            finalChance: 1,
            mobWeightGroup: 'test_mob_only',
            finalWeightGroup: 'test_final_only',
        };
        ChestConfig.typeWeights.test_mob_only = { normal: 1, boss: 0, chapter: 0 };
        ChestConfig.typeWeights.test_final_only = { normal: 0, boss: 1, chapter: 0 };
        ChestConfig.groups.test_zero = {
            mobChance: 0,
            finalChance: 0,
            mobWeightGroup: 'test_mob_only',
            finalWeightGroup: 'test_final_only',
        };

        const mob = rollChestDrop({ levelIndex: 0, dropGroup: 'test_chest', source: 'monster', seed: 'x', createdAt: 1 });
        const final = rollChestDrop({ levelIndex: 0, dropGroup: 'test_chest', source: 'stageFinal', seed: 'x', createdAt: 1 });
        const zero = rollChestDrop({ levelIndex: 0, dropGroup: 'test_zero', source: 'monster', seed: 'x', createdAt: 1 });
        assert.equal(mob.chests[0]?.type, 'normal');
        assert.equal(final.chests[0]?.type, 'boss');
        assert.equal(zero.chests.length, 0);
    } finally {
        if (oldGroup) ChestConfig.groups.test_chest = oldGroup;
        else delete ChestConfig.groups.test_chest;
        if (oldMobWeights) ChestConfig.typeWeights.test_mob_only = oldMobWeights;
        else delete ChestConfig.typeWeights.test_mob_only;
        if (oldFinalWeights) ChestConfig.typeWeights.test_final_only = oldFinalWeights;
        else delete ChestConfig.typeWeights.test_final_only;
        if (oldZero) ChestConfig.groups.test_zero = oldZero;
        else delete ChestConfig.groups.test_zero;
    }
});

test('Offline：同 seed 模拟结果一致，且不直接掉装备', () => {
    const input = { lastOnlineAt: 0, now: 60 * 60 * 1000, levelIndex: 0, seed: 'offline-seed' };
    const a = calculateOfflineReward(input);
    const b = calculateOfflineReward(input);
    assert.deepEqual(a, b);
    assert.ok(a.gold > 0);
    assert.ok(a.exp > 0);
    assert.ok(a.chests.length > 0);
    assert.equal(a.equipments.length, 0);
});

test('Offline：宝箱由 chest.xlsx 规则产生，不再读 offline 宝箱概率', () => {
    assert.equal(Object.prototype.hasOwnProperty.call(OfflineConfig, 'chestWeights'), false);
    const oldGroup: ChestDropGroupConfig = ChestConfig.groups.c1_early;
    const oldMobWeights = ChestConfig.typeWeights.test_offline_mob;
    const oldFinalWeights = ChestConfig.typeWeights.test_offline_final;
    try {
        ChestConfig.typeWeights.test_offline_mob = { normal: 1, boss: 0, chapter: 0 };
        ChestConfig.typeWeights.test_offline_final = { normal: 0, boss: 1, chapter: 0 };
        ChestConfig.groups.c1_early = {
            mobChance: 0,
            finalChance: 0,
            mobWeightGroup: 'test_offline_mob',
            finalWeightGroup: 'test_offline_final',
        };
        const zero = calculateOfflineReward({ lastOnlineAt: 0, now: 60 * 60 * 1000, levelIndex: 0, seed: 'offline-chest-rules' });
        assert.equal(zero.chests.length, 0);

        ChestConfig.groups.c1_early = {
            mobChance: 1,
            finalChance: 1,
            mobWeightGroup: 'test_offline_mob',
            finalWeightGroup: 'test_offline_final',
        };
        const full = calculateOfflineReward({ lastOnlineAt: 0, now: 60 * 60 * 1000, levelIndex: 0, seed: 'offline-chest-rules' });
        assert.ok(full.chests.length > zero.chests.length);
        assert.equal(full.equipments.length, 0);
        assert.ok(full.chests.some(chest => chest.type === 'boss'));
    } finally {
        ChestConfig.groups.c1_early = oldGroup;
        if (oldMobWeights) ChestConfig.typeWeights.test_offline_mob = oldMobWeights;
        else delete ChestConfig.typeWeights.test_offline_mob;
        if (oldFinalWeights) ChestConfig.typeWeights.test_offline_final = oldFinalWeights;
        else delete ChestConfig.typeWeights.test_offline_final;
    }
});

test('Offline：12 小时按 8 小时上限结算', () => {
    const eight = calculateOfflineReward({ lastOnlineAt: 0, now: 8 * 60 * 60 * 1000, levelIndex: 0, seed: 'cap' });
    const twelve = calculateOfflineReward({ lastOnlineAt: 0, now: 12 * 60 * 60 * 1000, levelIndex: 0, seed: 'cap' });
    assert.equal(twelve.seconds, eight.seconds);
    assert.equal(twelve.battles, eight.battles);
});

test('Offline：关卡/效率配置会影响收益', () => {
    const level0 = calculateOfflineReward({ lastOnlineAt: 0, now: 60 * 60 * 1000, levelIndex: 0, seed: 'eff' });
    const level1 = calculateOfflineReward({ lastOnlineAt: 0, now: 60 * 60 * 1000, levelIndex: 1, seed: 'eff' });
    assert.notEqual(level0.gold, level1.gold);
});

test('InventoryService / EquipmentService：包装现有穿戴和对比', () => {
    const model = new InventoryModel(10, 10);
    const inv = new InventoryService(model);
    const eq = new EquipmentService(model);
    const item = createEquipItem('weapon', 'rare', createSeededRng('weapon'));
    const added = inv.addEquipment(item);
    assert.equal(added.ok, true);
    assert.equal(eq.equip('dps', added.item!.id).ok, true);
    const nextItem = createEquipItem('weapon', 'legend', createSeededRng('weapon-2'));
    inv.addEquipment(nextItem);
    const compare = eq.compare('dps', nextItem.id);
    assert.ok(compare);
    assert.equal(compare!.current?.id, added.item!.id);
    assert.ok(Object.keys(compare!.delta).length > 0);
});

let failed = 0;
for (const t of tests) {
    try {
        t.run();
        console.log(`  ✓ ${t.name}`);
    } catch (e) {
        failed++;
        console.error(`  ✗ ${t.name}`);
        console.error(e);
    }
}

console.log(`\n服务层测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
