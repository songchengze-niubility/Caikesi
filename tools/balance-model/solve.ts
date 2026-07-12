// 份额反解（balance-model 第 3 层）：解 SolveVars 使毕业快照满足——
//  ① 总量条件：teamPower(快照) = teamPower(纯白板) ÷ share_base；
//  ② 比率条件：四条成长线的去一法贡献比 = level:equip:gem:insc 份额比。
// 去一法贡献 Δ_m = P_full − P_without_m（把该线 k 置 0 重建快照）。
// 阻尼定点迭代（0.5 幂），≤MAX_ITERS 内份额偏差 ≤2pp 且总量偏差 ≤5% 收敛，否则抛错。

import type { BalanceConfigShape } from '../../assets/scripts/config/BalanceConfig';
import { teamPower, type PowerCtx } from './power';
import { buildSnapshot, type SnapshotCounts, type SolveVars } from './snapshot';

export interface SolveResult {
    k: SolveVars;
    sharesActual: Record<'base' | 'level' | 'equip' | 'gem' | 'inscription', number>;
    powerFull: number;
    powerBase: number;
    iterations: number;
}

const MAX_ITERS = 100;
const SHARE_TOL = 0.02;    // 份额偏差 ≤2pp
const TOTAL_TOL = 0.05;    // 总量偏差 ≤5%
const DAMPING = 0.5;

const ZERO: SolveVars = { kLevel: 0, kEquip: 0, kGem: 0, kInsc: 0 };
type GrowthKey = 'kLevel' | 'kEquip' | 'kGem' | 'kInsc';
const GROWTH_KEYS: GrowthKey[] = ['kLevel', 'kEquip', 'kGem', 'kInsc'];
const SHARE_OF: Record<GrowthKey, 'level' | 'equip' | 'gem' | 'inscription'> = {
    kLevel: 'level', kEquip: 'equip', kGem: 'gem', kInsc: 'inscription',
};

export function solveShares(cfg: BalanceConfigShape, counts: SnapshotCounts, ctx: PowerCtx): SolveResult {
    const anchors = cfg.anchors;
    const powerBase = teamPower(buildSnapshot(ZERO, counts, anchors), ctx);
    const powerTarget = powerBase / cfg.shares.base;

    const k: SolveVars = { kLevel: 1, kEquip: 1, kGem: 1, kInsc: 1 };
    let iterations = 0;
    for (let iter = 1; iter <= MAX_ITERS; iter++) {
        iterations = iter;
        const pFull = teamPower(buildSnapshot(k, counts, anchors), ctx);

        // 去一法贡献
        const deltas = {} as Record<GrowthKey, number>;
        let deltaSum = 0;
        for (const gk of GROWTH_KEYS) {
            const without = { ...k, [gk]: 0 };
            const p = teamPower(buildSnapshot(without, counts, anchors), ctx);
            deltas[gk] = Math.max(1e-6, pFull - p);
            deltaSum += deltas[gk];
        }

        // 收敛判定：比率 + 总量
        const growthShareTarget = cfg.shares.level + cfg.shares.equip + cfg.shares.gem + cfg.shares.inscription;
        let converged = Math.abs(pFull / powerTarget - 1) <= TOTAL_TOL;
        for (const gk of GROWTH_KEYS) {
            const target = cfg.shares[SHARE_OF[gk]] / growthShareTarget;
            const actual = deltas[gk] / deltaSum;
            if (Math.abs(actual - target) > SHARE_TOL) converged = false;
        }
        if (converged) {
            const sharesActual = {
                base: powerBase / pFull,
                level: (deltas.kLevel / deltaSum) * (1 - powerBase / pFull),
                equip: (deltas.kEquip / deltaSum) * (1 - powerBase / pFull),
                gem: (deltas.kGem / deltaSum) * (1 - powerBase / pFull),
                inscription: (deltas.kInsc / deltaSum) * (1 - powerBase / pFull),
            };
            return { k: { ...k }, sharesActual, powerFull: pFull, powerBase, iterations };
        }

        // 阻尼修正：先对齐比率，再对齐总量
        for (const gk of GROWTH_KEYS) {
            const target = cfg.shares[SHARE_OF[gk]] / growthShareTarget;
            const actual = deltas[gk] / deltaSum;
            k[gk] *= Math.pow(target / actual, DAMPING);
        }
        const totalErr = powerTarget / teamPower(buildSnapshot(k, counts, anchors), ctx);
        for (const gk of GROWTH_KEYS) k[gk] *= Math.pow(totalErr, DAMPING);
    }
    throw new Error(`solveShares：${MAX_ITERS} 轮未收敛（检查份额目标/锚点是否矛盾）`);
}
