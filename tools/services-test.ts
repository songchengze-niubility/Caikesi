import assert from 'node:assert/strict';
import { createSeededRng } from '../assets/scripts/core/Random';
import { generateStageReward } from '../assets/scripts/loot/LootService';
import { calculateOfflineReward } from '../assets/scripts/offline/OfflineCombatService';
import { ChestInventoryModel, createChestItem } from '../assets/scripts/chest/ChestModel';
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
        sourceDropGroup: 'level_1',
        seed: 'chest-seed',
        createdAt: 123456,
    });
    assert.equal(model.addChest(chest).ok, true);
    const save = model.serializeChests();
    const next = new ChestInventoryModel();
    next.deserializeChests(save);
    assert.deepEqual(next.serializeChests(), save);
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
