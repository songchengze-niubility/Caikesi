// 心法（talent）纯逻辑单测（tsx 运行）：Config 成本/查询 + Model 点节点。
import * as assert from 'node:assert/strict';
import { talentNodeById, talentLevelCost, firstClearPages, talentNodes } from '../assets/scripts/talent/TalentConfig';
import { learnNode, nodeLevel, prereqMet, type TalentSave } from '../assets/scripts/talent/TalentModel';
import { talentAggregate, emptyTalentAggregate } from '../assets/scripts/talent/TalentStats';
import { calculateOfflineReward } from '../assets/scripts/offline/OfflineCombatService';
import type { MaterialSave } from '../assets/scripts/services/RewardTypes';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

// 点满一个节点的辅助：直接写档（测试专用，不走扣费）
function maxOut(save: TalentSave, ...ids: string[]) {
    for (const id of ids) save[id] = talentNodeById(id)!.maxLevel;
}

test('配置载入：24 节点，trunk_1 无前置', () => {
    assert.equal(talentNodes().length, 24);
    assert.deepEqual(talentNodeById('trunk_1')!.prereq, []);
});

test('talentLevelCost：金币等比、残页只在 0→1 级收', () => {
    const trunk1 = talentNodeById('trunk_1')!;   // goldBase=100, growth=1.5
    assert.equal(talentLevelCost(trunk1, 1).gold, 100);
    assert.equal(talentLevelCost(trunk1, 2).gold, 150);
    assert.equal(talentLevelCost(trunk1, 3).gold, 225);
    assert.equal(talentLevelCost(trunk1, 1).pages, 0);
    const squad3 = talentNodeById('func_squad3')!;   // pageCost=4
    assert.equal(talentLevelCost(squad3, 1).pages, 4);
});

test('firstClearPages：普通关 1、末关 4、越界 0', () => {
    assert.equal(firstClearPages(0), 1);
    assert.equal(firstClearPages(9), 4);
    assert.equal(firstClearPages(99), 0);
});

test('learnNode：金币够→扣费升 1 级', () => {
    const save: TalentSave = {};
    const wallet = { gold: 100 };
    const r = learnNode(save, 'trunk_1', wallet, {});
    assert.ok(r.ok);
    assert.equal(wallet.gold, 0);
    assert.equal(r.spentGold, 100);
    assert.equal(nodeLevel(save, 'trunk_1'), 1);
});

test('learnNode：金币不足→失败不改', () => {
    const save: TalentSave = {};
    const wallet = { gold: 99 };
    const r = learnNode(save, 'trunk_1', wallet, {});
    assert.equal(r.ok, false);
    assert.equal(wallet.gold, 99);
    assert.equal(nodeLevel(save, 'trunk_1'), 0);
});

test('learnNode：前置未点满→失败', () => {
    const save: TalentSave = { trunk_1: 3 };   // maxLevel=5，未满
    const r = learnNode(save, 'trunk_2', { gold: 99999 }, {});
    assert.equal(r.ok, false);
    assert.ok(!prereqMet(talentNodeById('trunk_2')!, save));
});

test('learnNode：点满后拒绝再点', () => {
    const save: TalentSave = { trunk_1: 5 };
    const r = learnNode(save, 'trunk_1', { gold: 99999 }, {});
    assert.equal(r.ok, false);
});

test('learnNode：大节点残页不足→失败不改；足够→扣页解锁', () => {
    const save: TalentSave = {};
    maxOut(save, 'trunk_1', 'trunk_2', 'combat_atk', 'combat_hp', 'combat_crit', 'combat_def', 'combat_haste', 'combat_dmg', 'combat_basic');
    const mats: MaterialSave = { talent_page: 1 };   // combat_master 需 2 页
    const r1 = learnNode(save, 'combat_master', { gold: 99999 }, mats);
    assert.equal(r1.ok, false);
    assert.equal(mats.talent_page, 1);
    mats.talent_page = 2;
    const wallet = { gold: 99999 };
    const r2 = learnNode(save, 'combat_master', wallet, mats);
    assert.ok(r2.ok);
    assert.equal(mats.talent_page, 0);
    assert.equal(r2.spentPages, 2);
    assert.equal(nodeLevel(save, 'combat_master'), 1);
});

test('learnNode：未知节点/未知存档键容忍', () => {
    const r = learnNode({}, 'no_such_node', { gold: 99999 }, {});
    assert.equal(r.ok, false);
    assert.equal(nodeLevel({ ghost_node: 3 }, 'ghost_node'), 3);   // 读不崩（配置删除后残留）
});

test('talentAggregate：空档全零', () => {
    const agg = talentAggregate(undefined);
    assert.deepEqual(agg, emptyTalentAggregate());
    assert.equal(agg.unlocks.squadSlot3, false);
});

test('talentAggregate：四类效果聚合（stat 同键叠加/econ/drop/unlock）', () => {
    const save: TalentSave = {
        trunk_2: 2,        // stat atkPct 0.01×2
        combat_atk: 3,     // stat atkPct 0.02×3 → 合计 0.08
        econ_exp: 2,       // econ exp 0.03×2
        drop_quality: 1,   // drop equipQuality 0.03
        drop_chest: 1,     // unlock chestCapacity 20
        func_squad3: 1,    // unlock squadSlot3
        econ_autosell: 1,  // unlock autoSell
        econ_offline: 1,   // econ offlineRate 0.25
    };
    const agg = talentAggregate(save);
    assert.ok(Math.abs((agg.stats.atkPct ?? 0) - 0.08) < 1e-9);
    assert.ok(Math.abs(agg.econ.exp - 0.06) < 1e-9);
    assert.ok(Math.abs(agg.econ.offlineRate - 0.25) < 1e-9);
    assert.ok(Math.abs(agg.drop.equipQuality - 0.03) < 1e-9);
    assert.equal(agg.unlocks.chestCapacity, 20);
    assert.equal(agg.unlocks.squadSlot3, true);
    assert.equal(agg.unlocks.autoSell, true);
});

test('talentAggregate：未知 nodeId 忽略不崩', () => {
    const agg = talentAggregate({ ghost_node: 5 });
    assert.deepEqual(agg, emptyTalentAggregate());
});

test('离线 talentEcon：金币/经验按 (1+econ)×(1+offlineRate) 放大，不传=旧行为', () => {
    const base = { lastOnlineAt: 1_000_000_000_000, now: 1_000_000_000_000 + 3600_000, levelIndex: 0, seed: 'talent-offline-t' };
    const plain = calculateOfflineReward(base);
    const boosted = calculateOfflineReward({ ...base, talentEcon: { gold: 0.06, exp: 0, offlineRate: 0.25, offlineCapSeconds: 0 } });
    assert.equal(plain.wins, boosted.wins);   // 同 seed 胜负序列一致（econ 不进 rng seed 串）
    if (plain.wins > 0) {
        assert.ok(boosted.gold > plain.gold, `boosted.gold=${boosted.gold} 应 > plain.gold=${plain.gold}`);
        // offlineRate 同时放大 exp（econ.exp=0 也放大）
        assert.ok(boosted.exp > plain.exp || plain.exp === 0);
    }
});

test('离线 offlineCapSeconds：时长上限外的时间因加成变现', () => {
    // 离线远超 maxHours，cap 增加 7200 秒应多变现 7200 秒
    const base = { lastOnlineAt: 0, now: 360_000_000_000, levelIndex: 0, seed: 'talent-offline-cap' };
    const plain = calculateOfflineReward(base);
    const capped = calculateOfflineReward({ ...base, talentEcon: { gold: 0, exp: 0, offlineRate: 0, offlineCapSeconds: 7200 } });
    assert.equal(capped.seconds, plain.seconds + 7200);
});

console.log(`\ntalent: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
