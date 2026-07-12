// balance-model 单测（tsx 运行）：真源结构 / 战力口径 / 份额反解 / 经济反解 / derive 幂等。
import assert from 'node:assert/strict';
import { BalanceConfig } from '../assets/scripts/config/BalanceConfig';
import { BattleConfig, type CombatStats } from '../assets/scripts/config/BattleConfig';
import { powerOf, type PowerCtx } from './balance-model/power';
import { solveShares } from './balance-model/solve';
import { solveEconomy } from './balance-model/economy';
import { computeDerived } from './balance-model/derive';
import { buildProgressCurve } from './balance-model/progress';

const CTX: PowerCtx = {
    enemyAtk: BalanceConfig.anchors.ctxEnemyAtk,
    enemyDef: BalanceConfig.anchors.ctxEnemyDef,
    minDamageRate: BattleConfig.combat.minDamageRate,
};

function mkPanel(p: Partial<CombatStats> = {}): CombatStats {
    return { ...BattleConfig.stats.dps, hp: 500, atk: 100, def: 10, ...p };
}

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

test('BalanceConfig：Shares 六模块合计 = 1（白板5/等级20/装备50/宝石17/铭文8/技能0）', () => {
    const s = BalanceConfig.shares;
    assert.equal(s.base, 0.05);
    assert.equal(s.level, 0.20);
    assert.equal(s.equip, 0.50);
    assert.equal(s.gem, 0.17);
    assert.equal(s.inscription, 0.08);
    assert.equal(s.skill, 0);
    const sum = s.base + s.level + s.equip + s.gem + s.inscription + s.skill;
    assert.ok(Math.abs(sum - 1) < 1e-9, `份额合计应为 1，实际 ${sum}`);
});

test('BalanceConfig：Anchors 关键锚点齐全（中度节奏/毕业快照/经济）', () => {
    const a = BalanceConfig.anchors;
    for (const k of ['farmRunsPerGate', 'totalRuns', 'gradCharLevel', 'gradEquipLevel', 'gradQualityRank',
        'craftCostRuns', 'sellReturnRate', 'gemLevelRatio', 'inscRollFloor', 'qualityStep',
        'ctxEnemyAtk', 'ctxEnemyDef']) {
        assert.ok(typeof a[k] === 'number' && Number.isFinite(a[k]), `缺少锚点 ${k}`);
    }
    assert.equal(a.totalRuns, 32);
    assert.equal(a.gradCharLevel, 12);
});

test('BalanceConfig：Caps 覆盖全部二级属性上限', () => {
    const c = BalanceConfig.caps;
    for (const k of ['critRate', 'critDmg', 'attackSpeed', 'moveSpeedPct', 'skillHaste', 'dodgeRate',
        'blockRate', 'blockRatio', 'dmgReduce', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus',
        'aoeDmgBonus', 'dmgBonus', 'hpPct', 'atkPct', 'defPct']) {
        assert.ok(typeof c[k] === 'number' && c[k] > 0 && c[k] <= 2, `缺少/非法上限 ${k}`);
    }
});

test('BalanceConfig：Overrides 为数组（允许为空）', () => {
    assert.ok(Array.isArray(BalanceConfig.overrides));
});

test('powerOf：18 维逐维 +10% 战力不降（对战力有意义的维度严格上升）', () => {
    const base = mkPanel({
        critRate: 0.1, critDmg: 0.5, attackSpeed: 1.2, dodgeRate: 0.05, blockRate: 0.1, blockRatio: 0.3,
        dmgBonus: 0.05, dmgReduce: 0.05, moveSpeed: 300,
        skillHaste: 0.1, basicDmgBonus: 0.05, skillDmgBonus: 0.05, singleDmgBonus: 0.05, aoeDmgBonus: 0.05,
    });
    const p0 = powerOf(base, CTX);
    assert.ok(p0 > 0 && Number.isFinite(p0));
    const keys = Object.keys(base) as (keyof CombatStats)[];
    for (const k of keys) {
        if (k === 'range' || k === 'moveSpeed') continue;   // 功能维度不进战力折算
        const bumped = { ...base, [k]: base[k] * 1.1 };
        const p1 = powerOf(bumped, CTX);
        assert.ok(p1 >= p0 - 1e-9, `${k} +10% 战力不应下降（${p0} → ${p1}）`);
        assert.ok(p1 > p0, `${k} +10% 战力应严格上升（${p0} → ${p1}）`);
    }
});

test('powerOf：几何均值口径——攻血同比放大 k 倍 → 战力 ≈ ×k', () => {
    const base = mkPanel();
    const doubled = mkPanel({ hp: 1000, atk: 200 });
    const ratio = powerOf(doubled, CTX) / powerOf(base, CTX);
    assert.ok(ratio > 1.8 && ratio < 2.2, `攻血翻倍战力应约 ×2，实际 ×${ratio.toFixed(3)}`);
});

test('solveShares：默认配置可收敛，往返份额与 5/20/50/17/8 偏差 ≤2pp、总量偏差 ≤5%', () => {
    const counts = { gems: 9, gemAvgLevel: 2, inscriptions: 4.5 };
    const r = solveShares(BalanceConfig, counts, CTX);
    assert.ok(r.iterations <= 100, `应在 100 轮内收敛，实际 ${r.iterations}`);
    assert.ok(Math.abs(r.powerFull / (r.powerBase / BalanceConfig.shares.base) - 1) <= 0.05,
        `总量偏差应 ≤5%，实际 ${(r.powerFull / (r.powerBase / 0.05) - 1) * 100}%`);
    const growthSum = 0.95;
    for (const [mod, target] of [['level', 0.20], ['equip', 0.50], ['gem', 0.17], ['inscription', 0.08]] as const) {
        const actualRatio = r.sharesActual[mod] / (1 - r.sharesActual.base);
        assert.ok(Math.abs(actualRatio - target / growthSum) <= 0.02,
            `${mod} 份额比偏差应 ≤2pp：目标 ${(target / growthSum).toFixed(3)}，实际 ${actualRatio.toFixed(3)}`);
    }
    for (const key of ['kLevel', 'kEquip', 'kGem', 'kInsc'] as const) {
        assert.ok(r.k[key] > 0 && Number.isFinite(r.k[key]), `${key} 应为正有限数，实际 ${r.k[key]}`);
    }
    console.log(`    [solve] k=${JSON.stringify(Object.fromEntries(Object.entries(r.k).map(([a, b]) => [a, +(b as number).toFixed(3)])))} iters=${r.iterations} P=${r.powerFull.toFixed(0)}(target ${(r.powerBase / 0.05).toFixed(0)})`);
});

test('solveEconomy：合成价往返 ≈ craftCostRuns 局石头收入（±1 局）', () => {
    const e = solveEconomy(BalanceConfig);
    assert.ok(e.stonesPerRun > 0, `每局石头期望应 >0，实际 ${e.stonesPerRun}`);
    const runs = e.craftTierCosts.tier_1 / e.stonesPerRun;
    assert.ok(Math.abs(runs - BalanceConfig.anchors.craftCostRuns) <= 1,
        `tier_1 定价应 ≈${BalanceConfig.anchors.craftCostRuns} 局收入，实际 ${runs.toFixed(2)} 局`);
    assert.ok(e.craftTierCosts.tier_2 > e.craftTierCosts.tier_1 && e.craftTierCosts.tier_3 > e.craftTierCosts.tier_2);
});

test('solveEconomy：经验往返——expBase 代回首段几何，总经验落在毕业等级 ±1 级', () => {
    const e = solveEconomy(BalanceConfig);
    const g1 = 1.15;
    let cum = 0, lv = 1;
    const total = e.expPerRun * BalanceConfig.anchors.totalRuns;
    while (lv < 100) {
        const need = Math.round(e.expBase * Math.pow(g1, lv - 1));
        if (cum + need > total) break;
        cum += need; lv++;
    }
    const grad = BalanceConfig.anchors.gradCharLevel;
    assert.ok(Math.abs(lv - grad) <= 1, `总经验应到 Lv${grad}±1，实际 Lv${lv}`);
});

test('solveEconomy：快照数量来自期望且按孔位封顶（宝石 ≤2人×5件×孔数）', () => {
    const e = solveEconomy(BalanceConfig);
    assert.ok(e.counts.gems > 0 && Number.isFinite(e.counts.gems));
    assert.ok(e.counts.gems <= 20 + 1e-9, `宝石快照应封顶孔位（≈20），实际 ${e.counts.gems}`);
    assert.ok(e.counts.inscriptions > 0 && e.counts.inscriptions <= 10 + 1e-9);
    assert.ok(e.counts.gemAvgLevel >= 1 && e.counts.gemAvgLevel <= 3, `宝石均值等级 ${e.counts.gemAvgLevel}`);
    console.log(`    [economy] chests/局=${e.chestsPerRun.toFixed(2)} stones/局=${e.stonesPerRun.toFixed(1)} 毕业宝石=${e.report.gemsExpected.toFixed(1)} 卷轴=${e.report.scrollsExpected.toFixed(1)} tier1=${e.craftTierCosts.tier_1} expBase=${e.expBase} 返石=${JSON.stringify(e.sellForgeStone)}`);
});

test('buildProgressCurve：P(n) 单调不减，毕业点与 solve 总量一致（±15%）', () => {
    const econ = solveEconomy(BalanceConfig);
    const solved = solveShares(BalanceConfig, econ.counts, CTX);
    const curve = buildProgressCurve(BalanceConfig, solved.k, econ, CTX);
    assert.equal(curve.length, 10);
    let prev = 0;
    for (const p of curve) {
        assert.ok(p.entryPower >= prev - 1e-6, `L${p.level + 1} entry 应单调不减`);
        assert.ok(p.readyPower >= p.entryPower - 1e-6, `L${p.level + 1} ready ≥ entry`);
        prev = p.entryPower;
    }
    const gradPower = curve[9].readyPower;
    assert.ok(Math.abs(gradPower / solved.powerFull - 1) <= 0.15,
        `毕业点战力应 ≈ solve 总量（±15%）：${gradPower.toFixed(0)} vs ${solved.powerFull.toFixed(0)}`);
    console.log(`    [progress] entry P: ${curve.map(p => p.entryPower.toFixed(0)).join(' ')}`);
});

test('computeDerived：幂等（两次求解结果深相等）且 Caps 校验通过', () => {
    const a = computeDerived();
    const b = computeDerived();
    assert.deepEqual(a, b, '两次 derive 应逐位一致（确定性求解）');
    assert.ok(a.battle.statGrowthPerLevel > 0 && a.battle.expBase > 0);
    assert.ok(a.equip.primaryScale > 0 && a.inlay.gemPrimaryScale > 0 && a.inlay.inscPrimaryScale > 0);
    assert.ok(a.craft.tierCosts.tier_1 > 0);
    console.log(`    [derive] statGrowth=${a.battle.statGrowthPerLevel} expBase=${a.battle.expBase} equip×${a.equip.primaryScale} gem×${a.inlay.gemPrimaryScale} insc×${a.inlay.inscPrimaryScale} tier1=${a.craft.tierCosts.tier_1}`);
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
console.log(`\nbalance-model 测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
