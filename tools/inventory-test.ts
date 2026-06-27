// 装备存储系统单测（纯逻辑，tsx 运行）。assets 下的 Model/Defs 不依赖 cc，故可直接 import。
import * as assert from 'node:assert/strict';
import { randomItem, SLOTS, QUALITIES, makeId } from '../assets/scripts/inventory/EquipDefs';
import { InventoryModel } from '../assets/scripts/inventory/InventoryModel';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('randomItem 产出合法 slot/quality/name', () => {
    for (let i = 0; i < 50; i++) {
        const it = randomItem();
        assert.ok(SLOTS.includes(it.slot), 'slot 非法: ' + it.slot);
        assert.ok(QUALITIES.includes(it.quality), 'quality 非法: ' + it.quality);
        assert.ok(typeof it.name === 'string' && it.name.length > 0, 'name 为空');
    }
});

test('makeId 连续调用唯一', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(makeId());
    assert.equal(ids.size, 1000);
});

test('新建模型：背包/仓库空，5 装备栏均 null', () => {
    const m = new InventoryModel();
    assert.equal(m.backpack.length, 0);
    assert.equal(m.warehouse.length, 0);
    for (const s of SLOTS) assert.equal(m.equipped[s], null);
});

test('dropRandom 进背包；背包满则失败', () => {
    const m = new InventoryModel(2, 2); // 小上限便于测满
    assert.equal(m.dropRandom().ok, true);
    assert.equal(m.dropRandom().ok, true);
    assert.equal(m.backpack.length, 2);
    const r = m.dropRandom();
    assert.equal(r.ok, false);
    assert.equal(r.reason, '背包已满');
    assert.equal(m.backpack.length, 2);
});

test('toWarehouse：背包→仓库；id 不存在/仓库满则失败', () => {
    const m = new InventoryModel(5, 1);
    m.dropRandom();
    const id = m.backpack[0].id;
    assert.equal(m.toWarehouse(id).ok, true);
    assert.equal(m.backpack.length, 0);
    assert.equal(m.warehouse.length, 1);
    assert.equal(m.toWarehouse('不存在').ok, false);
    m.dropRandom();
    const r = m.toWarehouse(m.backpack[0].id); // 仓库满
    assert.equal(r.ok, false);
    assert.equal(r.reason, '仓库已满');
});

test('toBackpack：仓库→背包；背包满则失败', () => {
    const m = new InventoryModel(1, 5);
    m.dropRandom();
    const id = m.backpack[0].id;
    m.toWarehouse(id);              // 背包空、仓库 1
    assert.equal(m.toBackpack(id).ok, true);
    assert.equal(m.backpack.length, 1);
    m.warehouse.push({ id: 'x', slot: 'weapon', name: '测试', quality: 'common' });
    const r = m.toBackpack('x');   // 背包满
    assert.equal(r.ok, false);
    assert.equal(r.reason, '背包已满');
});

test('equip：背包→对应部位；同部位旧装备退回背包', () => {
    const m = new InventoryModel(5, 5);
    const a: any = { id: 'a', slot: 'weapon', name: '剑A', quality: 'common' };
    const b: any = { id: 'b', slot: 'weapon', name: '剑B', quality: 'rare' };
    m.backpack.push(a, b);
    assert.equal(m.equip('a').ok, true);
    assert.equal(m.equipped.weapon!.id, 'a');
    assert.equal(m.backpack.length, 1);          // 只剩 b
    assert.equal(m.equip('b').ok, true);         // 换装：b 上，a 退回
    assert.equal(m.equipped.weapon!.id, 'b');
    assert.deepEqual(m.backpack.map(i => i.id), ['a']);
    assert.equal(m.equip('不存在').ok, false);
});

test('equip：背包满时换装仍成功（净背包数不增）', () => {
    const m = new InventoryModel(2, 5);
    const a: any = { id: 'a', slot: 'helmet', name: '盔A', quality: 'common' };
    const b: any = { id: 'b', slot: 'helmet', name: '盔B', quality: 'epic' };
    m.backpack.push(a, b);                        // 背包满(2/2)
    m.equip('a');                                // a 上, 背包剩 [b] (1/2)
    assert.equal(m.equip('b').ok, true);         // b 上, a 退回 → [a] (1/2)
    assert.equal(m.equipped.helmet!.id, 'b');
    assert.deepEqual(m.backpack.map(i => i.id), ['a']);
});

test('unequip：装备栏→背包；空栏/背包满则失败', () => {
    const m = new InventoryModel(1, 5);
    const a: any = { id: 'a', slot: 'shoes', name: '靴', quality: 'fine' };
    m.backpack.push(a);
    m.equip('a');                                // 背包空，shoes=a
    assert.equal(m.unequip('shoes').ok, true);
    assert.deepEqual(m.backpack.map(i => i.id), ['a']);
    assert.equal(m.unequip('shoes').reason, '该装备栏为空');
    const b: any = { id: 'b', slot: 'chest', name: '甲', quality: 'common' };
    m.equipped.chest = b;                        // 直接塞一件已装备
    const r = m.unequip('chest');               // 背包满(1/1)
    assert.equal(r.ok, false);
    assert.equal(r.reason, '背包已满');
});

console.log(`\n装备测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
