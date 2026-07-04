// 装备数值配置。
// ★★★ 数值由 Excel 管理 ★★★
//    源文件：tools/config-xlsx/equip.xlsx
//    改数值流程：编辑 Excel → 跑 `npm run config` → 生成 equip.config.generated.ts
//    本文件只保留 TypeScript 类型定义与纯计算辅助。

import { generatedEquipConfig } from './equip.config.generated';
import type { EquipSlot, EquipStats, EquipStatKey, Quality } from '../inventory/EquipDefs';

export interface EquipQualityConfig {
    label: string;
    multiplier: number;
    rollMin: number;
    rollMax: number;
    extraStats: number;
}

export interface EquipAffixConfig {
    stat: EquipStatKey;
    value: number;
}

export interface EquipLevelScalingConfig {
    growthPerLevel: number;
    maxLevel: number;
}

export interface EquipConfigShape {
    qualities: Record<Quality, EquipQualityConfig>;
    slotBonuses: Record<EquipSlot, EquipStats>;
    affixes: EquipAffixConfig[];
    levelScaling: EquipLevelScalingConfig;
}

export const EquipConfig = generatedEquipConfig as EquipConfigShape;

const INTEGER_STATS: EquipStatKey[] = ['hp', 'atk', 'def', 'range'];

function roundStat(key: EquipStatKey, value: number): number {
    if (INTEGER_STATS.indexOf(key) >= 0) return Math.round(value);
    return Number(value.toFixed(4));
}

function rollBetween(min: number, max: number, rng: () => number): number {
    return min + (max - min) * rng();
}

function addStat(out: EquipStats, key: EquipStatKey, value: number) {
    out[key] = roundStat(key, (out[key] ?? 0) + value);
}

export function levelCoefficient(level: number): number {
    const growth = EquipConfig.levelScaling?.growthPerLevel ?? 0;
    const clamped = Math.max(1, Math.floor(level));
    return 1 + (clamped - 1) * growth;
}

export function clampEquipLevel(level: number): number {
    const max = EquipConfig.levelScaling?.maxLevel ?? 30;
    return Math.max(1, Math.min(max, Math.floor(level)));
}

export function calcEquipItemStats(
    slot: EquipSlot,
    quality: Quality,
    rng: () => number = Math.random,
    level = 1,
): EquipStats {
    const base = EquipConfig.slotBonuses[slot] ?? {};
    const q = EquipConfig.qualities[quality];
    const mul = q?.multiplier ?? 1;
    const rollMin = q?.rollMin ?? 1;
    const rollMax = q?.rollMax ?? 1;
    const lvlCoef = levelCoefficient(level);
    const out: EquipStats = {};
    for (const k of Object.keys(base) as EquipStatKey[]) {
        const v = base[k] ?? 0;
        addStat(out, k, v * mul * lvlCoef * rollBetween(rollMin, rollMax, rng));
    }
    const pool = (EquipConfig.affixes ?? []).filter(a => base[a.stat] === undefined);
    const used: Partial<Record<EquipStatKey, boolean>> = {};
    const count = Math.min(Math.floor(q?.extraStats ?? 0), pool.length);
    for (let i = 0; i < count; i++) {
        let pick = Math.floor(rng() * pool.length);
        for (let guard = 0; guard < pool.length && used[pool[pick].stat]; guard++) {
            pick = (pick + 1) % pool.length;
        }
        const affix = pool[pick];
        used[affix.stat] = true;
        addStat(out, affix.stat, affix.value * mul * lvlCoef * rollBetween(rollMin, rollMax, rng));
    }
    return out;
}
