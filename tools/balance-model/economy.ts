// 经济反解（balance-model 第 4 层）：快照=期望口径。
// 从现行关卡/宝箱结构推每局期望收入 → 毕业宝石/铭文数量（喂给 solve 的快照）、
// 合成定价（craftCostRuns 局的石头收入）、出售返石、expBase（顺推+回刷自然到毕业等级）。
// 结构（掉率/权重/Rewards 区间）保持现表，只反解"价格与起点"——改结构请调 chest/battle 表本身。

import { BattleConfig } from '../../assets/scripts/config/BattleConfig';
import { ChestConfig } from '../../assets/scripts/config/ChestConfig';
import { InlayConfig } from '../../assets/scripts/inlay/InlayConfig';
import type { BalanceConfigShape } from '../../assets/scripts/config/BalanceConfig';
import type { SnapshotCounts } from './snapshot';
import { SLOTS, QUALITIES, type Quality } from '../../assets/scripts/inventory/EquipDefs';
import type { ChestType } from '../../assets/scripts/chest/ChestModel';

export interface EconomyResult {
    counts: SnapshotCounts;                      // 毕业宝石/铭文期望（快照输入）
    chestsPerRun: number;
    stonesPerRun: number;
    expPerRun: number;
    craftTierCosts: Record<'tier_1' | 'tier_2' | 'tier_3', number>;
    sellForgeStone: Record<Quality, number>;
    expBase: number;
    report: { gemsExpected: number; scrollsExpected: number; totalExpToGrad: number };
}

const CHEST_TYPES: ChestType[] = ['normal', 'boss', 'chapter'];

// 权重组 → 各箱型概率
function typeProbs(group: string): Record<ChestType, number> {
    const w = ChestConfig.typeWeights[group] ?? { normal: 1, boss: 0, chapter: 0 };
    const total = CHEST_TYPES.reduce((acc, t) => acc + Math.max(0, w[t] ?? 0), 0) || 1;
    const out = {} as Record<ChestType, number>;
    for (const t of CHEST_TYPES) out[t] = Math.max(0, w[t] ?? 0) / total;
    return out;
}

export function solveEconomy(cfg: BalanceConfigShape): EconomyResult {
    const a = cfg.anchors;
    const levels = BattleConfig.levels;

    // —— 每局期望：怪数 / 经验 / 宝箱（按箱型拆）——
    let mobsPerRun = 0;
    let expPerRun = 0;
    const chestsByType: Record<ChestType, number> = { normal: 0, boss: 0, chapter: 0 };
    for (let li = 0; li < levels.length; li++) {
        const level = levels[li];
        let mobs = 0;
        for (const wave of level.waves) {
            for (const spawn of wave.spawns) {
                mobs += spawn.count;
                expPerRun += spawn.count * (BattleConfig.enemyTypes[spawn.type]?.exp ?? 0) / levels.length;
            }
        }
        mobsPerRun += mobs / levels.length;
        const group = ChestConfig.groups[level.dropGroup] ?? ChestConfig.groups['default'];
        const mobProbs = typeProbs(group.mobWeightGroup);
        const finalProbs = typeProbs(group.finalWeightGroup);
        for (const t of CHEST_TYPES) {
            chestsByType[t] += ((mobs - 1) * group.mobChance * mobProbs[t] + group.finalChance * finalProbs[t]) / levels.length;
        }
    }
    const chestsPerRun = CHEST_TYPES.reduce((acc, t) => acc + chestsByType[t], 0);

    // —— 材料期望（Rewards 区间中值 + 关卡加成均值 floor(levelIndex/2)≈2）——
    const levelBonusAvg = levels.reduce((acc, _l, i) => acc + Math.floor(i / 2), 0) / levels.length;
    let stonesPerRun = 0, gemsPerRun = 0, scrollsPerRun = 0, gemLevelWeighted = 0;
    for (const t of CHEST_TYPES) {
        const r = ChestConfig.rewards[t];
        stonesPerRun += chestsByType[t] * ((r.forgeStoneMin + r.forgeStoneMax) / 2 + levelBonusAvg);
        gemsPerRun += chestsByType[t] * r.gemCount;
        gemLevelWeighted += chestsByType[t] * r.gemCount * (r.gemLevelMin + r.gemLevelMax) / 2;
        scrollsPerRun += chestsByType[t] * (r.scrollMin + r.scrollMax) / 2;
    }
    const totalRuns = a.totalRuns;
    const gemsExpected = gemsPerRun * totalRuns;
    const scrollsExpected = scrollsPerRun * totalRuns;
    const gemAvgLevel = gemsPerRun > 0 ? gemLevelWeighted / gemsPerRun : 1;
    // 快照数量按"孔位插满"封顶：超出的宝石/铭文是背包库存不算战力
    // （毕业品质档的孔数按相邻品质线性插值 × 5 件 × roster 人数）
    const rank = Math.max(0, Math.min(QUALITIES.length - 1, a.gradQualityRank));
    const lo = QUALITIES[Math.floor(rank)], hi = QUALITIES[Math.min(QUALITIES.length - 1, Math.floor(rank) + 1)];
    const t = rank - Math.floor(rank);
    const socketsPerItem = (InlayConfig.socketCounts[lo].gemSockets) * (1 - t) + (InlayConfig.socketCounts[hi].gemSockets) * t;
    const inscSlotsPerItem = (InlayConfig.socketCounts[lo].inscriptionSlots) * (1 - t) + (InlayConfig.socketCounts[hi].inscriptionSlots) * t;
    const rosterSize = BattleConfig.roster.length;
    const gemCapacity = socketsPerItem * SLOTS.length * rosterSize;
    const inscCapacity = inscSlotsPerItem * SLOTS.length * rosterSize;
    // 毕业铭文生效条数 ≈ 卷轴期望的 60%（余量是洗歪/重抽，spec §5 的追求空间），同样封顶孔位
    const counts: SnapshotCounts = {
        gems: Math.min(gemsExpected, gemCapacity),
        gemAvgLevel,
        inscriptions: Math.min(scrollsExpected * 0.6, inscCapacity),
    };

    // —— 合成定价：tier1 = craftCostRuns 局石头收入；tier2/3 外推（×2.5/×5，provisional）——
    const tier1 = Math.max(1, Math.round(a.craftCostRuns * stonesPerRun));
    const craftTierCosts = { tier_1: tier1, tier_2: Math.round(tier1 * 2.5), tier_3: tier1 * 5 };

    // —— 出售返石：fine 档 = tier1×回收率，品质半倍/倍数阶梯 ——
    const fineReturn = Math.max(1, Math.round(tier1 * a.sellReturnRate));
    const sellForgeStone: Record<Quality, number> = {
        common: Math.max(1, Math.round(fineReturn / 2)),
        fine: fineReturn,
        rare: fineReturn * 2,
        epic: fineReturn * 4,
        legend: fineReturn * 8,
    };

    // —— expBase：totalRuns 局总经验 ≈ Lv1→gradCharLevel 累计门槛（首段几何 ×g1）——
    const g1 = BattleConfig.charGrowth?.expGrowthPerLevel ?? 1.15;
    const gradLevel = Math.max(2, Math.round(a.gradCharLevel));
    let geomSum = 0;
    for (let lv = 1; lv < gradLevel; lv++) geomSum += Math.pow(g1, lv - 1);
    const totalExpToGrad = expPerRun * totalRuns;
    const expBase = Math.max(1, Math.round(totalExpToGrad / geomSum));

    return {
        counts, chestsPerRun, stonesPerRun, expPerRun,
        craftTierCosts, sellForgeStone, expBase,
        report: { gemsExpected, scrollsExpected, totalExpToGrad },
    };
}
