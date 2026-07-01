// 装备存储系统单测（纯逻辑，tsx 运行）。assets 下的 Model/Defs 不依赖 cc，故可直接 import。
import * as assert from 'node:assert/strict';
import { randomItem, SLOTS, QUALITIES, makeId, CHARACTERS, createEquipItem } from '../assets/scripts/inventory/EquipDefs';
import type { EquipItem, EquipSlot, Quality } from '../assets/scripts/inventory/EquipDefs';
import { InventoryModel, sellPriceOf } from '../assets/scripts/inventory/InventoryModel';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

function fixedItem(id: string, quality: Quality, slot: EquipSlot = 'weapon', name = id, locked?: boolean): EquipItem {
    return { id, slot, name, quality, stats: { atk: 1 }, locked };
}

test('randomItem 产出合法 slot/quality/name', () => {
    for (let i = 0; i < 50; i++) {
        const it = randomItem();
        assert.ok(SLOTS.includes(it.slot), 'slot 非法: ' + it.slot);
        assert.ok(QUALITIES.includes(it.quality), 'quality 非法: ' + it.quality);
        assert.ok(typeof it.name === 'string' && it.name.length > 0, 'name 为空');
        assert.ok(it.stats && Object.keys(it.stats).length > 0, 'stats 为空');
    }
});

test('makeId 连续调用唯一', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(makeId());
    assert.equal(ids.size, 1000);
});

test('新建模型：背包/仓库空，每个角色 5 装备栏均 null', () => {
    const m = new InventoryModel();
    assert.equal(m.backpack.length, 0);
    assert.equal(m.warehouse.length, 0);
    for (const c of CHARACTERS) for (const s of SLOTS) assert.equal(m.equipped[c][s], null);
});

test('dropRandom 进背包；背包满则失败', () => {
    const m = new InventoryModel(2, 2); // 小上限便于测满
    const first = m.dropRandom();
    assert.equal(first.ok, true);
    assert.ok(first.item && first.item.stats && Object.keys(first.item.stats).length > 0, '掉落结果未返回装备属性');
    assert.equal(m.dropRandom().ok, true);
    assert.equal(m.backpack.length, 2);
    const r = m.dropRandom();
    assert.equal(r.ok, false);
    assert.equal(r.reason, '背包已满');
    assert.equal(m.backpack.length, 2);
});

test('dropRandomToWarehouse 进仓库；仓库满则失败', () => {
    const m = new InventoryModel(1, 1);
    const r = m.dropRandomToWarehouse();
    assert.equal(r.ok, true);
    assert.equal(m.warehouse.length, 1);
    assert.equal(m.warehouse[0].id, r.item!.id);
    assert.ok(r.item?.stats && Object.keys(r.item.stats).length > 0, '仓库掉落缺少 stats');
    const full = m.dropRandomToWarehouse();
    assert.equal(full.ok, false);
    assert.equal(full.reason, '仓库已满');
});

test('addItemToBackpack/addItemToWarehouse 接收配置掉落且保留属性', () => {
    const m = new InventoryModel(1, 1);
    const item = createEquipItem('weapon', 'rare', () => 0.25);
    const toBag = m.addItemToBackpack(item);
    assert.equal(toBag.ok, true);
    assert.equal(m.backpack[0].id, item.id);
    assert.ok(m.backpack[0].stats && Object.keys(m.backpack[0].stats).length > 0, '背包配置掉落缺少 stats');
    assert.equal(m.addItemToBackpack(createEquipItem('helmet', 'common')).reason, '背包已满');

    const toWarehouse = m.addItemToWarehouse(createEquipItem('helmet', 'fine', () => 0.25));
    assert.equal(toWarehouse.ok, true);
    assert.equal(m.warehouse.length, 1);
    assert.ok(m.warehouse[0].stats && Object.keys(m.warehouse[0].stats).length > 0, '仓库配置掉落缺少 stats');
    assert.equal(m.addItemToWarehouse(createEquipItem('chest', 'common')).reason, '仓库已满');
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

test('equip(角色)：背包→该角色对应部位；同部位旧装备退回背包', () => {
    const m = new InventoryModel(5, 5);
    const a: any = { id: 'a', slot: 'weapon', name: '剑A', quality: 'common' };
    const b: any = { id: 'b', slot: 'weapon', name: '剑B', quality: 'rare' };
    m.backpack.push(a, b);
    assert.equal(m.equip('a', 'tank').ok, true);
    assert.equal(m.equipped.tank.weapon!.id, 'a');
    assert.equal(m.backpack.length, 1);          // 只剩 b
    assert.equal(m.equip('b', 'tank').ok, true); // 换装：b 上，a 退回
    assert.equal(m.equipped.tank.weapon!.id, 'b');
    assert.deepEqual(m.backpack.map(i => i.id), ['a']);
    assert.equal(m.equip('不存在', 'tank').ok, false);
    assert.equal(m.equip('a', 'badchar' as any).ok, false);  // 非法角色
});

test('equip：不同角色装备栏互相独立', () => {
    const m = new InventoryModel(5, 5);
    const a: any = { id: 'a', slot: 'weapon', name: '剑A', quality: 'common' };
    const b: any = { id: 'b', slot: 'weapon', name: '剑B', quality: 'rare' };
    m.backpack.push(a, b);
    m.equip('a', 'tank');
    m.equip('b', 'dps');
    assert.equal(m.equipped.tank.weapon!.id, 'a');
    assert.equal(m.equipped.dps.weapon!.id, 'b');
    assert.equal(m.equipped.healer.weapon, null);
});

test('equipFromWarehouse：仓库→装备栏；旧装备退回仓库', () => {
    const m = new InventoryModel(5, 5);
    const a: any = { id: 'a', slot: 'weapon', name: '仓库剑A', quality: 'common', stats: { atk: 1 } };
    const b: any = { id: 'b', slot: 'weapon', name: '仓库剑B', quality: 'rare', stats: { atk: 3 } };
    m.warehouse.push(a, b);
    assert.equal(m.equipFromWarehouse('a', 'tank').ok, true);
    assert.equal(m.equipped.tank.weapon!.id, 'a');
    assert.deepEqual(m.warehouse.map(i => i.id), ['b']);
    assert.equal(m.equipFromWarehouse('b', 'tank').ok, true);
    assert.equal(m.equipped.tank.weapon!.id, 'b');
    assert.deepEqual(m.warehouse.map(i => i.id), ['a']);
});

test('equip：背包满时换装仍成功（净背包数不增）', () => {
    const m = new InventoryModel(2, 5);
    const a: any = { id: 'a', slot: 'helmet', name: '盔A', quality: 'common' };
    const b: any = { id: 'b', slot: 'helmet', name: '盔B', quality: 'epic' };
    m.backpack.push(a, b);                        // 背包满(2/2)
    m.equip('a', 'tank');                        // a 上, 背包剩 [b] (1/2)
    assert.equal(m.equip('b', 'tank').ok, true); // b 上, a 退回 → [a] (1/2)
    assert.equal(m.equipped.tank.helmet!.id, 'b');
    assert.deepEqual(m.backpack.map(i => i.id), ['a']);
});

test('unequip(角色)：装备栏→背包；空栏/背包满则失败', () => {
    const m = new InventoryModel(1, 5);
    const a: any = { id: 'a', slot: 'shoes', name: '靴', quality: 'fine' };
    m.backpack.push(a);
    m.equip('a', 'tank');                        // 背包空，tank.shoes=a
    assert.equal(m.unequip('tank', 'shoes').ok, true);
    assert.deepEqual(m.backpack.map(i => i.id), ['a']);
    assert.equal(m.unequip('tank', 'shoes').reason, '该装备栏为空');
    const b: any = { id: 'b', slot: 'chest', name: '甲', quality: 'common' };
    m.equipped.dps.chest = b;                    // 直接塞一件已装备到 dps
    const r = m.unequip('dps', 'chest');        // 背包满(1/1)
    assert.equal(r.ok, false);
    assert.equal(r.reason, '背包已满');
});

test('unequipToWarehouse：装备栏→仓库；仓库满则失败', () => {
    const m = new InventoryModel(5, 1);
    const a: any = { id: 'a', slot: 'helmet', name: '盔', quality: 'fine', stats: { hp: 10 } };
    m.equipped.tank.helmet = a;
    assert.equal(m.unequipToWarehouse('tank', 'helmet').ok, true);
    assert.equal(m.equipped.tank.helmet, null);
    assert.deepEqual(m.warehouse.map(i => i.id), ['a']);
    const b: any = { id: 'b', slot: 'chest', name: '甲', quality: 'common' };
    m.equipped.tank.chest = b;
    const r = m.unequipToWarehouse('tank', 'chest');
    assert.equal(r.ok, false);
    assert.equal(r.reason, '仓库已满');
    assert.equal(m.equipped.tank.chest!.id, 'b');
});

test('serialize/deserialize 往返一致 + 深拷贝', () => {
    const m = new InventoryModel(5, 5);
    m.dropRandom();
    m.equip(m.backpack[0].id, 'dps');
    m.dropRandom();
    const save = m.serialize();
    const m2 = new InventoryModel(5, 5);
    m2.deserialize(save);
    assert.deepEqual(m2.serialize(), save);
    // 深拷贝：改 m2 不影响 save
    m2.backpack.push({ id: 'z', slot: 'weapon', name: 'x', quality: 'common' });
    assert.notEqual(m2.backpack.length, save.backpack.length);
    const equippedSlot = SLOTS.find(s => !!m2.equipped.dps[s]?.stats);
    if (equippedSlot && m2.equipped.dps[equippedSlot]?.stats && save.equipped.dps[equippedSlot]?.stats) {
        m2.equipped.dps[equippedSlot]!.stats!.hp = 999;
        assert.notEqual(m2.equipped.dps[equippedSlot]!.stats!.hp, save.equipped.dps[equippedSlot]!.stats!.hp);
    }
});

test('锁定状态可持久化；老存档缺 locked 按未锁处理', () => {
    const m = new InventoryModel(5, 5);
    m.backpack.push(fixedItem('locked-bag', 'rare', 'weapon', '锁剑', true));
    m.equipped.dps.helmet = fixedItem('locked-eq', 'fine', 'helmet', '锁盔', true);

    const save = m.serialize();
    const m2 = new InventoryModel(5, 5);
    m2.deserialize(save);
    assert.equal(m2.backpack[0].locked, true);
    assert.equal(m2.equipped.dps.helmet?.locked, true);

    m2.deserialize({ backpack: [{ id: 'old', slot: 'weapon', name: '旧剑', quality: 'common' }] as any });
    assert.equal(m2.backpack[0].locked, undefined);
    assert.equal(m2.sellItem('old').ok, true);
});

test('toggleLocked/setLocked 支持背包、仓库和已穿装备', () => {
    const m = new InventoryModel(5, 5);
    m.backpack.push(fixedItem('bag', 'common'));
    m.warehouse.push(fixedItem('wh', 'fine', 'helmet'));
    m.equipped.tank.chest = fixedItem('eq', 'rare', 'chest');

    assert.equal(m.toggleLocked('bag').ok, true);
    assert.equal(m.backpack[0].locked, true);
    assert.equal(m.setLocked('wh', true).ok, true);
    assert.equal(m.warehouse[0].locked, true);
    assert.equal(m.toggleLocked('eq').ok, true);
    assert.equal(m.equipped.tank.chest?.locked, true);
    assert.equal(m.toggleLocked('不存在').ok, false);
});

test('sellItem：出售背包/仓库装备给金币，锁定和已穿装备不可卖', () => {
    const m = new InventoryModel(5, 5);
    const bag = fixedItem('bag', 'common');
    const wh = fixedItem('wh', 'fine', 'helmet');
    const locked = fixedItem('lock', 'rare', 'chest', '锁甲', true);
    const equipped = fixedItem('eq', 'epic', 'pants');
    m.backpack.push(bag, locked);
    m.warehouse.push(wh);
    m.equipped.dps.pants = equipped;

    const rb = m.sellItem('bag');
    assert.equal(rb.ok, true);
    assert.equal(rb.gold, sellPriceOf(bag));
    assert.deepEqual(m.backpack.map(i => i.id), ['lock']);

    const rw = m.sellItem('wh');
    assert.equal(rw.ok, true);
    assert.equal(rw.gold, sellPriceOf(wh));
    assert.equal(m.warehouse.length, 0);

    assert.equal(m.sellItem('lock').ok, false);
    assert.equal(m.sellItem('lock').reason, '锁定装备不能出售');
    assert.equal(m.sellItem('eq').ok, false);
    assert.equal(m.sellItem('eq').reason, '已穿装备不能出售');
});

test('sellBatch：批量出售白绿，跳过锁定并不碰已穿装备', () => {
    const m = new InventoryModel(10, 10);
    const a = fixedItem('bag-common', 'common');
    const b = fixedItem('bag-fine', 'fine', 'helmet');
    const c = fixedItem('bag-rare', 'rare', 'chest');
    const d = fixedItem('bag-locked', 'common', 'shoes', '锁鞋', true);
    const e = fixedItem('wh-fine', 'fine', 'pants');
    const f = fixedItem('wh-epic', 'epic', 'weapon');
    m.backpack.push(a, b, c, d);
    m.warehouse.push(e, f);
    m.equipped.tank.weapon = fixedItem('eq-common', 'common');

    const r = m.sellBatch('fine');
    assert.equal(r.ok, true);
    assert.deepEqual(r.sold!.map(i => i.id).sort(), ['bag-common', 'bag-fine', 'wh-fine']);
    assert.equal(r.gold, sellPriceOf(a) + sellPriceOf(b) + sellPriceOf(e));
    assert.deepEqual(m.backpack.map(i => i.id), ['bag-rare', 'bag-locked']);
    assert.deepEqual(m.warehouse.map(i => i.id), ['wh-epic']);
    assert.equal(m.equipped.tank.weapon?.id, 'eq-common');
});

test('sortZone：可按品质、部位、名称整理指定区域', () => {
    const m = new InventoryModel(10, 10);
    m.backpack.push(
        fixedItem('fine-shoes', 'fine', 'shoes', 'C'),
        fixedItem('legend-weapon', 'legend', 'weapon', 'B'),
        fixedItem('common-helmet', 'common', 'helmet', 'A'),
    );

    assert.equal(m.sortZone('quality', 'backpack').ok, true);
    assert.deepEqual(m.backpack.map(i => i.id), ['legend-weapon', 'fine-shoes', 'common-helmet']);
    assert.equal(m.sortZone('slot', 'backpack').ok, true);
    assert.deepEqual(m.backpack.map(i => i.id), ['legend-weapon', 'common-helmet', 'fine-shoes']);
    assert.equal(m.sortZone('name', 'backpack').ok, true);
    assert.deepEqual(m.backpack.map(i => i.id), ['common-helmet', 'legend-weapon', 'fine-shoes']);
});

test('deserialize：undefined / 缺字段 → 空兜底', () => {
    const m = new InventoryModel();
    m.deserialize(undefined);
    assert.equal(m.backpack.length, 0);
    assert.equal(m.warehouse.length, 0);
    for (const c of CHARACTERS) for (const s of SLOTS) assert.equal(m.equipped[c][s], null);
    m.deserialize({ backpack: [{ id: 'a', slot: 'weapon', name: 'n', quality: 'common' }] });
    assert.equal(m.backpack.length, 1);
    assert.equal(m.warehouse.length, 0);          // 缺 warehouse 兜底为空
    assert.equal(m.equipped.tank.weapon, null);   // 缺 equipped 兜底为 null（每角色每栏）
});

test('deserialize：老存档装备缺 stats 时自动补属性', () => {
    const m = new InventoryModel();
    m.deserialize({
        backpack: [{ id: 'old-h', slot: 'helmet', name: '头巾', quality: 'rare' }],
        warehouse: [{ id: 'old-w', slot: 'weapon', name: '巨斧', quality: 'fine' }],
        equipped: {
            tank: {
                weapon: null,
                helmet: { id: 'old-e', slot: 'helmet', name: '铁盔', quality: 'common' },
                chest: null,
                pants: null,
                shoes: null,
            },
            dps: Object.fromEntries(SLOTS.map(s => [s, null])) as any,
            healer: Object.fromEntries(SLOTS.map(s => [s, null])) as any,
        },
    });
    assert.ok(m.backpack[0].stats && Object.keys(m.backpack[0].stats).length > 0, '背包旧装备未补 stats');
    assert.ok(m.warehouse[0].stats && Object.keys(m.warehouse[0].stats).length > 0, '仓库旧装备未补 stats');
    assert.ok(m.equipped.tank.helmet?.stats && Object.keys(m.equipped.tank.helmet.stats).length > 0, '已穿旧装备未补 stats');
});

console.log(`\n装备测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
