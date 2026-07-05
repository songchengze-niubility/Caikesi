// 角色成长纯计算：等级系数（镜像 EquipConfig.levelCoefficient）+ 经验曲线 + 等级钳制。
// 不依赖 cc，可 tsx 单测。数值来自 battle.xlsx/Misc 的 charGrowth.* 四个标量。

import { BattleConfig } from '../config/BattleConfig';

export function charLevelCoef(level: number): number {
    const growth = BattleConfig.charGrowth?.statGrowthPerLevel ?? 0;
    const clamped = Math.max(1, Math.floor(level));
    return 1 + (clamped - 1) * growth;
}

export function expToNext(level: number): number {
    const cfg = BattleConfig.charGrowth;
    const base = cfg?.expBase ?? 50;
    const growth = cfg?.expGrowthPerLevel ?? 1.15;
    const clamped = Math.max(1, Math.floor(level));
    return Math.round(base * Math.pow(growth, clamped - 1));
}

export function clampCharLevel(level: number): number {
    const max = BattleConfig.charGrowth?.maxLevel ?? 30;
    return Math.max(1, Math.min(max, Math.floor(level)));
}
