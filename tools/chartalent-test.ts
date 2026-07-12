// 角色天赋（chartalent）纯逻辑单测（tsx 运行）：Config 查询 + Model 投点/洗点/自愈 + Stats 聚合 + 战斗注入。
import * as assert from 'node:assert/strict';
import { charTalentNodes, charTalentNodeById, charTalentPassiveAt, charTalentTreeCapacity } from '../assets/scripts/chartalent/CharTalentConfig';
import { nodeLevelOf, spentPoints, availablePoints, learnNode, resetChar, sanitizeCharTalents, type CharTalentSave } from '../assets/scripts/chartalent/CharTalentModel';
import { charTalentAggregate, emptyCharTalentAggregate } from '../assets/scripts/chartalent/CharTalentStats';
import { buildEffectiveStatsMap } from '../assets/scripts/combat/EffectiveStats';
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('配置载入：三职业各 13 节点、容量 128', () => {
    for (const cls of ['tank', 'dps', 'healer']) {
        assert.equal(charTalentNodes(cls).length, 13);
        assert.equal(charTalentTreeCapacity(cls), 128);
    }
    assert.equal(charTalentNodeById('ct_tank_hp')!.levelReq, 1);
    assert.equal(charTalentNodeById('ct_dps_shadow')!.levelReq, 70);
});

test('被动查询：每级一条、id 带级别后缀、越级 undefined', () => {
    const l3 = charTalentPassiveAt('ct_tank_thorns', 3)!;
    assert.equal(l3.id, 'ct_tank_thorns_l3');
    assert.equal(l3.trigger, 'onHurt');
    assert.equal(charTalentPassiveAt('ct_tank_thorns', 6), undefined);
    assert.equal(charTalentPassiveAt('ct_tank_hp', 1), undefined);   // stat 节点无被动
});

test('availablePoints：点数 = 等级-1 - 已投；Lv.1 为 0', () => {
    const save: CharTalentSave = {};
    assert.equal(availablePoints(save, 'tank', 1), 0);
    assert.equal(availablePoints(save, 'tank', 100), 99);
    save['tank'] = { ct_tank_hp: 3, ct_tank_def: 2 };
    assert.equal(spentPoints(save, 'tank'), 5);
    assert.equal(availablePoints(save, 'tank', 10), 4);
});

test('learnNode：达门槛有点数 → 升 1 级', () => {
    const save: CharTalentSave = {};
    const r = learnNode(save, 'tank', 'ct_tank_hp', 2);   // Lv.2 → 1 点
    assert.ok(r.ok);
    assert.equal(r.newLevel, 1);
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_hp'), 1);
    assert.equal(availablePoints(save, 'tank', 2), 0);
});

test('learnNode：等级未达门槛 → 拒绝', () => {
    const save: CharTalentSave = {};
    const r = learnNode(save, 'tank', 'ct_tank_thorns', 9);   // 反震需 Lv.10
    assert.equal(r.ok, false);
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_thorns'), 0);
});

test('learnNode：无剩余点数 → 拒绝', () => {
    const save: CharTalentSave = { tank: { ct_tank_hp: 1 } };
    const r = learnNode(save, 'tank', 'ct_tank_def', 2);   // 1 点已花光
    assert.equal(r.ok, false);
});

test('learnNode：点满 / 未知节点 / 职业不匹配 → 拒绝', () => {
    const save: CharTalentSave = { tank: { ct_tank_thorns: 5 } };
    assert.equal(learnNode(save, 'tank', 'ct_tank_thorns', 100).ok, false);   // 已满 5 级
    assert.equal(learnNode(save, 'tank', 'no_such_node', 100).ok, false);
    assert.equal(learnNode(save, 'tank', 'ct_dps_atk', 100).ok, false);       // dps 节点点不进 tank
});

test('resetChar：清空投点、点数回满、其他职业不受影响', () => {
    const save: CharTalentSave = { tank: { ct_tank_hp: 3 }, dps: { ct_dps_atk: 2 } };
    resetChar(save, 'tank');
    assert.equal(spentPoints(save, 'tank'), 0);
    assert.equal(availablePoints(save, 'tank', 10), 9);
    assert.equal(nodeLevelOf(save, 'dps', 'ct_dps_atk'), 2);
});

test('sanitize：未知节点丢弃、级数钳制、负值归零', () => {
    const raw = { tank: { ct_tank_hp: 99, ghost: 3, ct_tank_def: -2 }, junk: 5 };
    const save = sanitizeCharTalents(raw, () => 100);
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_hp'), 12);   // 钳到 maxLevel
    assert.equal(nodeLevelOf(save, 'tank', 'ghost'), 0);
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_def'), 0);
});

test('sanitize：投点总数超发 → 按配置顺序截断到预算', () => {
    const raw = { tank: { ct_tank_hp: 5, ct_tank_def: 5 } };
    const save = sanitizeCharTalents(raw, () => 8);   // Lv.8 预算 7 点
    assert.equal(spentPoints(save, 'tank'), 7);
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_hp'), 5);   // 配置序在前，保留全额
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_def'), 2);  // 截断
});

test('aggregate：stat 节点按级数求和、未投为空', () => {
    assert.deepEqual(charTalentAggregate({}, 'tank'), emptyCharTalentAggregate());
    const save: CharTalentSave = { tank: { ct_tank_hp: 3, ct_tank_hpflat: 2 } };
    const agg = charTalentAggregate(save, 'tank');
    assert.ok(Math.abs((agg.stats.hpPct ?? 0) - 0.03) < 1e-9);
    assert.equal(agg.stats.hp, 60);
    assert.equal(agg.passives.length, 0);
});

test('aggregate：passive 节点只取当前级那条 def', () => {
    const save: CharTalentSave = { dps: { ct_dps_combo: 3, ct_dps_shadow: 1 } };
    const agg = charTalentAggregate(save, 'dps');
    assert.equal(agg.passives.length, 2);
    const ids = agg.passives.map(p => p.id).sort();
    assert.deepEqual(ids, ['ct_dps_combo_l3', 'ct_dps_shadow_l1']);
});

test('EffectiveStats：perClassStats 只作用对应职业、与全局 extraStats 叠加', () => {
    const base = buildEffectiveStatsMap(undefined, {});
    const map = buildEffectiveStatsMap(undefined, {}, { atk: 10 }, { tank: { hp: 100 } });
    assert.equal(map.tank!.hp, base.tank!.hp + 100);
    assert.equal(map.tank!.atk, base.tank!.atk + 10);
    assert.equal(map.dps!.hp, base.dps!.hp);          // perClass 不外溢
    assert.equal(map.dps!.atk, base.dps!.atk + 10);   // 全局仍生效
});

test('BattleManager：extraPassives 追加到对应士兵、always 被动开战即上永久 Buff', () => {
    const alwaysDef = {
        id: 'ct_tank_bulwark_l3', name: '坚韧', cls: 'tank',
        trigger: 'always' as const, chance: 1, targetMode: 'self' as const,
        effects: [{ kind: 'applyBuff' as const, buffId: 'ct_bulwark', stacks: 3 }],
    };
    const mgr = new BattleManager(470, 836, 0, {}, ['tank', 'dps'], { tank: [alwaysDef] });
    const tank = mgr.soldiers.find(s => s.key === 'tank')!;
    const dps = mgr.soldiers.find(s => s.key === 'dps')!;
    assert.ok(tank.passives.some(p => p.id === 'ct_tank_bulwark_l3'));
    assert.ok(!dps.passives.some(p => p.id === 'ct_tank_bulwark_l3'));
    const buff = tank.buffs.find(b => b.id === 'ct_bulwark');
    assert.ok(buff && buff.stacks === 3);
    assert.ok(tank.stats.dmgReduce > BattleConfig.stats.tank.dmgReduce);   // 3 层 ×0.01 生效
});

console.log(`\nchartalent: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
