// InlayModel 单测（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { socketGem, unsocketGem, applyInscription, ensureInlaySlots } from '../assets/scripts/inlay/InlayModel';
import { gemMaterialId } from '../assets/scripts/services/RewardTypes';
import type { EquipItem } from '../assets/scripts/inventory/EquipDefs';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

function legendItem(): EquipItem {
    // legend：gemSockets=3, inscriptionSlots=2
    return ensureInlaySlots({ id: 'x', slot: 'weapon', name: '测试剑', quality: 'legend' });
}

test('ensureInlaySlots：按品质补齐孔位长度（legend=3孔/2位）', () => {
    const it = legendItem();
    assert.equal(it.gemSockets!.length, 3);
    assert.equal(it.inscriptions!.length, 2);
    assert.ok(it.gemSockets!.every(s => s === null));
});

test('ensureInlaySlots：幂等 + 保留已有格', () => {
    const it = legendItem();
    it.gemSockets![0] = { type: 'atk', level: 2 };
    const again = ensureInlaySlots(it);
    assert.equal(again.gemSockets!.length, 3);
    assert.deepEqual(again.gemSockets![0], { type: 'atk', level: 2 });
});

test('ensureInlaySlots：common 无铭文位（inscriptionSlots=0）', () => {
    const it = ensureInlaySlots({ id: 'c', slot: 'helmet', name: '帽', quality: 'common' });
    assert.equal(it.gemSockets!.length, 1);
    assert.equal(it.inscriptions!.length, 0);
});

test('socketGem：材料够→扣材料、写入孔位', () => {
    const it = legendItem();
    const mats = { [gemMaterialId('atk', 2)]: 1 };
    const r = socketGem(it, 0, 'atk', 2, mats);
    assert.ok(r.ok);
    assert.deepEqual(it.gemSockets![0], { type: 'atk', level: 2 });
    assert.equal(mats[gemMaterialId('atk', 2)], 0);
});

test('socketGem：材料不足→失败不改', () => {
    const it = legendItem();
    const mats = {};
    const r = socketGem(it, 0, 'atk', 2, mats);
    assert.equal(r.ok, false);
    assert.equal(it.gemSockets![0], null);
});

test('socketGem：占用孔位→旧宝石退回材料、装入新宝石', () => {
    const it = legendItem();
    it.gemSockets![0] = { type: 'hp', level: 1 };
    const mats = { [gemMaterialId('atk', 3)]: 1 };
    const r = socketGem(it, 0, 'atk', 3, mats);
    assert.ok(r.ok);
    assert.deepEqual(it.gemSockets![0], { type: 'atk', level: 3 });
    assert.equal(mats[gemMaterialId('hp', 1)], 1);   // 旧 hp 宝石退回
    assert.equal(mats[gemMaterialId('atk', 3)], 0);  // 新 atk 宝石扣掉
});

test('socketGem：非法孔位→失败', () => {
    const it = legendItem();
    const r = socketGem(it, 9, 'atk', 1, { [gemMaterialId('atk', 1)]: 1 });
    assert.equal(r.ok, false);
});

test('unsocketGem：宝石退回材料、孔位清空', () => {
    const it = legendItem();
    it.gemSockets![1] = { type: 'def', level: 2 };
    const mats: Record<string, number> = {};
    const r = unsocketGem(it, 1, mats);
    assert.ok(r.ok);
    assert.equal(it.gemSockets![1], null);
    assert.equal(mats[gemMaterialId('def', 2)], 1);
});

test('unsocketGem：空孔→失败', () => {
    const it = legendItem();
    const r = unsocketGem(it, 0, {});
    assert.equal(r.ok, false);
});

test('applyInscription：有卷轴→扣卷轴、写入随机效果', () => {
    const it = legendItem();
    const mats = { rune_scroll: 1 };
    const r = applyInscription(it, 0, mats, () => 0);
    assert.ok(r.ok);
    assert.ok(it.inscriptions![0]);
    assert.equal(mats.rune_scroll, 0);
});

test('applyInscription：无卷轴→失败不改', () => {
    const it = legendItem();
    const r = applyInscription(it, 0, {}, () => 0);
    assert.equal(r.ok, false);
    assert.equal(it.inscriptions![0], null);
});

test('applyInscription：覆盖重抽（已有效果被替换）', () => {
    const it = legendItem();
    it.inscriptions![0] = { stat: 'hp', value: 999 };
    const r = applyInscription(it, 0, { rune_scroll: 1 }, () => 0);
    assert.ok(r.ok);
    assert.notEqual(it.inscriptions![0]!.value, 999);   // 被重抽覆盖
});

console.log(`\nInlayModel：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
