// 角色成长纯计算：等级系数（镜像 EquipConfig.levelCoefficient）+ 经验曲线 + 等级钳制。
// 不依赖 cc，可 tsx 单测。数值来自 battle.xlsx/Misc 的 charGrowth.* 四个标量。

import { BattleConfig } from '../config/BattleConfig';

export function charLevelCoef(level: number): number {
    const growth = BattleConfig.charGrowth?.statGrowthPerLevel ?? 0;
    const clamped = Math.max(1, Math.floor(level));
    return 1 + (clamped - 1) * growth;
}

// 经验曲线：分段几何（2026-07-11）。升到 lv 级那一步的增长率：
// lv≥expSeg3Start 用 expSeg3Growth；否则 lv≥expSeg2Start 用 expSeg2Growth；否则 expGrowthPerLevel。
// 未配置分段旋钮时退化为单段 base×g^(level-1)，与旧公式逐位等价（老表兼容）。
export function expToNext(level: number): number {
    const cfg = BattleConfig.charGrowth;
    const base = cfg?.expBase ?? 50;
    const g1 = cfg?.expGrowthPerLevel ?? 1.15;
    const clamped = Math.max(1, Math.floor(level));
    const s2 = cfg?.expSeg2Start;
    if (!s2 || !cfg?.expSeg2Growth) return Math.round(base * Math.pow(g1, clamped - 1));
    const g2 = cfg.expSeg2Growth;
    const s3 = cfg.expSeg3Start && cfg.expSeg3Growth ? cfg.expSeg3Start : Infinity;
    const g3 = cfg.expSeg3Growth ?? g2;
    // 总步数 clamped-1（升到 2..clamped 各一步）；按段拆步数
    const n1 = Math.max(0, Math.min(clamped, s2 - 1) - 1);
    const n3 = s3 === Infinity ? 0 : Math.max(0, clamped - s3 + 1);
    const n2 = Math.max(0, (clamped - 1) - n1 - n3);
    return Math.round(base * Math.pow(g1, n1) * Math.pow(g2, n2) * Math.pow(g3, n3));
}

export function clampCharLevel(level: number): number {
    const max = BattleConfig.charGrowth?.maxLevel ?? 30;
    return Math.max(1, Math.min(max, Math.floor(level)));
}
