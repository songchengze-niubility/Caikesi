// 难度导出（第④步，模拟标定版）：对每关用真实 BattleManager 实跑标定 enemyScale——
// 纯解析换算（战力比）在"血厚攻缓"的新成长结构下会выст怪血涨速超过玩家输出涨速，
// 故直接以对局结果为准：二分搜索"达标面板恰好全胜的最大缩放 kPass"与
// （台阶关）"入场面板必败的最小缩放 kFail"，普通关取 difficultyNormal×0.8×kPass（舒适余量），
// 台阶关取 difficultyGate×√(kFail×kPass)（几何中点，两端都留余量）。
// 确定性：标定期间用种子化 LCG 顶替 Math.random（finally 恢复），derive 结果可复现，balance:check 不破。

import { BattleManager } from '../../assets/scripts/combat/BattleManager';
import { BattleConfig, type CombatStats, type SoldierClass } from '../../assets/scripts/config/BattleConfig';
import type { BalanceConfigShape } from '../../assets/scripts/config/BalanceConfig';
import { GATE_LEVELS, type ProgressPoint } from './progress';

// 旧 pacing 档位（历史常量，仅供报告展示的四档平铺）
export interface PacingLoadout { name: string; hp: number; atk: number }
export interface DifficultyResult { enemyScales: number[]; pacingLoadouts: PacingLoadout[] }

const CAL_RUNS = 3;        // 每个探测点的种子局数（种子固定 → winAt 是 k 的确定性阶跃函数）
const MAX_TICKS = 24000;   // 与 pacing-sim 同口径（0.05s/tick，20 分钟上限）
const K_LO = 0.3, K_HI = 30;
const BISECT_STEPS = 9;    // log 域二分，分辨率约 ±3%

function lcg(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

function simulate(levelIndex: number, panels: readonly CombatStats[], k: number, seed: number): boolean {
    const roster = BattleConfig.roster as SoldierClass[];
    const level = BattleConfig.levels[levelIndex] as { enemyScale?: number };
    const origScale = level.enemyScale;
    const origRandom = Math.random;
    try {
        level.enemyScale = k;
        Math.random = lcg(seed);
        const eff: Record<string, CombatStats> = {};
        roster.forEach((cls, i) => { eff[cls] = { ...panels[i] }; });
        const mgr = new BattleManager(470, 836, levelIndex, eff, roster);
        for (let i = 0; i < MAX_TICKS && mgr.phase !== 'won' && mgr.phase !== 'lost'; i++) {
            mgr.tick(0.05);
            mgr.drainEvents();
        }
        return mgr.phase === 'won';
    } finally {
        level.enemyScale = origScale;
        Math.random = origRandom;
    }
}

function allWin(levelIndex: number, panels: readonly CombatStats[], k: number): boolean {
    for (let r = 0; r < CAL_RUNS; r++) {
        if (!simulate(levelIndex, panels, k, levelIndex * 7919 + r * 104729 + 17)) return false;
    }
    return true;
}

function anyWin(levelIndex: number, panels: readonly CombatStats[], k: number): boolean {
    for (let r = 0; r < CAL_RUNS; r++) {
        if (simulate(levelIndex, panels, k, levelIndex * 7919 + r * 104729 + 17)) return true;
    }
    return false;
}

// 达标面板恰好全胜的最大缩放（log 域二分）
function maxPassScale(levelIndex: number, panels: readonly CombatStats[]): number {
    if (!allWin(levelIndex, panels, K_LO)) throw new Error(`difficulty：L${levelIndex + 1} 达标面板在 k=${K_LO} 都赢不了（检查面板/关卡）`);
    let lo = Math.log(K_LO), hi = Math.log(K_HI);
    for (let i = 0; i < BISECT_STEPS; i++) {
        const mid = (lo + hi) / 2;
        if (allWin(levelIndex, panels, Math.exp(mid))) lo = mid;
        else hi = mid;
    }
    return Math.exp(lo);
}

// 入场面板必败（0 胜）的最小缩放
function minFailScale(levelIndex: number, panels: readonly CombatStats[]): number {
    if (anyWin(levelIndex, panels, K_HI)) throw new Error(`difficulty：L${levelIndex + 1} 入场面板在 k=${K_HI} 还能赢（检查面板/关卡）`);
    let lo = Math.log(K_LO), hi = Math.log(K_HI);
    for (let i = 0; i < BISECT_STEPS; i++) {
        const mid = (lo + hi) / 2;
        if (anyWin(levelIndex, panels, Math.exp(mid))) lo = mid;
        else hi = mid;
    }
    return Math.exp(hi);
}

export function deriveDifficulty(
    cfg: BalanceConfigShape,
    curve: ProgressPoint[],
    panels: { entry: CombatStats[][]; ready: CombatStats[][] },
): DifficultyResult {
    const a = cfg.anchors;
    const enemyScales = curve.map(p => {
        const n = p.level;
        const kPass = maxPassScale(n, panels.ready[n]);
        let scale: number;
        if (GATE_LEVELS.includes(n)) {
            const kFail = minFailScale(n, panels.entry[n]);
            const diff = n === 9 ? (a.difficultyBoss ?? 1) : (a.difficultyGate ?? 1);
            if (kFail >= kPass) {
                // 入场/达标差距不足以形成卡点带——退回保守值并警告（调 farmRunsPerGate/份额可拉开）
                console.warn(`⚠ difficulty：L${n + 1} 卡点带为空（kFail ${kFail.toFixed(2)} ≥ kPass ${kPass.toFixed(2)}），退回 0.95×kPass`);
                scale = diff * kPass * 0.95;
            } else {
                // 只钳上界（达标必须打得过）；下界不钳——模型入场面板系统性高估真实玩家
                // （宝石 Boss 专属后前期为零、掉落随机），台阶卡点的存在性由 sim:progress 的
                // "卡关额外局数 ∈ [3,12]"实测带保证，不靠模型内的入场必败检查
                scale = Math.min(kPass * 0.9, diff * Math.sqrt(kFail * kPass));
            }
        } else {
            scale = (a.difficultyNormal ?? 1) * 0.8 * kPass;
        }
        return Math.round(scale * 100) / 100;
    });

    // 四档平铺（诊断/展示）：roster 平均 Δhp/Δatk
    const roster = BattleConfig.roster as SoldierClass[];
    const flat = (ps: CombatStats[]) => {
        let dHp = 0, dAtk = 0;
        ps.forEach((p, i) => {
            const base = BattleConfig.stats[roster[i]];
            dHp += p.hp - base.hp;
            dAtk += p.atk - base.atk;
        });
        return { hp: Math.round(dHp / ps.length), atk: Math.round(dAtk / ps.length) };
    };
    const tierNames = ['过L4档', '过L7档', '毕业档'];
    const pacingLoadouts: PacingLoadout[] = [
        { name: '裸装', hp: 0, atk: 0 },
        ...GATE_LEVELS.map((g, i) => ({ name: tierNames[i], ...flat(panels.ready[g]) })),
    ];
    return { enemyScales, pacingLoadouts };
}
