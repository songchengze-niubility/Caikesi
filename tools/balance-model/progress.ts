// 玩家战力进度曲线 P(n)（第④步）：把"中度锚点"显式化成推进模型——
// 顺推 L1→L10，台阶关（下标 3/6/9）前各回刷 farmRunsPerGate 局；
// 对每关入场（entry，未回刷）与达标（ready，回刷后）两个进度点，按累计局数
// 推期望状态（装备品质/等级/覆盖度线性推进、宝石铭文按每局期望累计封顶、等级按累计经验过曲线），
// 拼面板算 teamPower。全部基于 TPL/Anchors/economy 期望，不读 derive 输出（防反馈回路）。

import type { BalanceConfigShape } from '../../assets/scripts/config/BalanceConfig';
import { teamPower, type PowerCtx } from './power';
import { buildPanels, type ProgressState, type SolveVars } from './snapshot';
import type { EconomyResult } from './economy';

export const GATE_LEVELS = [3, 6, 9];   // 台阶关下标（L4/L7/L10）

export interface ProgressPoint {
    level: number;        // 关卡下标 0..9
    entryRuns: number;    // 顺推到本关时的累计局数（未含本关回刷）
    readyRuns: number;    // 回刷后（台阶关 +farmRunsPerGate；普通关同 entry）
    entryPower: number;
    readyPower: number;
    entryState: ProgressState;
    readyState: ProgressState;
}

// 累计经验 → 等级（首段几何；第一章毕业 ≤30 级，无需分段）
function levelAt(totalExp: number, expBase: number, growth = 1.15): number {
    let lv = 1, cum = 0;
    while (lv < 100) {
        const need = Math.round(expBase * Math.pow(growth, lv - 1));
        if (cum + need > totalExp) break;
        cum += need;
        lv++;
    }
    return lv;
}

function stateAt(runs: number, cfg: BalanceConfigShape, econ: EconomyResult, ratios: { gemsPerRun: number; inscPerRun: number }, fullRuns: number): ProgressState {
    const a = cfg.anchors;
    const t = Math.max(0, Math.min(1, runs / fullRuns));
    return {
        qualityRank: a.gradQualityRank * t,
        equipLevel: 1 + (a.gradEquipLevel - 1) * t,
        equipCoverage: Math.min(1, runs / 4),   // 前几局快速凑齐五件套（掉落+宝箱 ≈1.3 件/局）
        counts: {
            gems: Math.min(econ.counts.gems, ratios.gemsPerRun * runs),
            gemAvgLevel: econ.counts.gemAvgLevel,
            inscriptions: Math.min(econ.counts.inscriptions, ratios.inscPerRun * runs),
        },
        charLevel: levelAt(econ.expPerRun * runs, econ.expBase),
    };
}

export function buildProgressCurve(cfg: BalanceConfigShape, k: SolveVars, econ: EconomyResult, ctx: PowerCtx): ProgressPoint[] {
    const farm = cfg.anchors.farmRunsPerGate;
    // 达标终点局数（顺推 9 + 三个台阶回刷）——作为品质/等级线性推进的分母
    const fullRuns = 9 + GATE_LEVELS.length * farm;
    const ratios = {
        gemsPerRun: econ.report.gemsExpected / cfg.anchors.totalRuns,
        inscPerRun: (econ.report.scrollsExpected * 0.6) / cfg.anchors.totalRuns,
    };
    const points: ProgressPoint[] = [];
    for (let n = 0; n < 10; n++) {
        const gatesBelow = GATE_LEVELS.filter(g => g < n).length;
        const entryRuns = n + gatesBelow * farm;
        const readyRuns = entryRuns + (GATE_LEVELS.includes(n) ? farm : 0);
        const entryState = stateAt(entryRuns, cfg, econ, ratios, fullRuns);
        const readyState = stateAt(readyRuns, cfg, econ, ratios, fullRuns);
        points.push({
            level: n,
            entryRuns,
            readyRuns,
            entryPower: teamPower(buildPanels(entryState, k), ctx),
            readyPower: teamPower(buildPanels(readyState, k), ctx),
            entryState,
            readyState,
        });
    }
    return points;
}
