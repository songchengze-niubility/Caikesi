// 合成配置。
// ★★★ 数值由 Excel 管理 ★★★
//    源文件：tools/config-xlsx/craft.xlsx
//    改数值流程：编辑 Excel → 跑 `npm run config` → 生成 craft.config.generated.ts
//    本文件只保留 TypeScript 类型定义与纯计算辅助。

import { generatedCraftConfig } from './craft.config.generated';
import type { MaterialId, MaterialSave } from '../services/RewardTypes';
import { QUALITIES } from '../inventory/EquipDefs';
import type { Quality } from '../inventory/EquipDefs';

export interface CraftTierConfig {
    label: string;
    levelMin: number;
    levelMax: number;
    cost: Partial<Record<MaterialId, number>>;
    qualityWeights: Record<Quality, number>;
}

export interface CraftConfigShape {
    tiers: Record<string, CraftTierConfig>;
}

export const CraftConfig = generatedCraftConfig as CraftConfigShape;

export function getCraftTier(tierId: string): CraftTierConfig {
    const tier = CraftConfig.tiers[tierId];
    if (tier) return tier;
    throw new Error(`craft tier "${tierId}" 不存在，请检查 craft.xlsx 的 Tiers.tierId`);
}

// 按 levelMin 升序，供 UI 按档位从低到高排列按钮。
export function craftTierIds(): string[] {
    return Object.keys(CraftConfig.tiers).sort((a, b) => CraftConfig.tiers[a].levelMin - CraftConfig.tiers[b].levelMin);
}

export function canAffordCraftTier(materials: MaterialSave, tierId: string): boolean {
    const tier = getCraftTier(tierId);
    for (const materialId of Object.keys(tier.cost) as MaterialId[]) {
        if ((materials[materialId] ?? 0) < (tier.cost[materialId] ?? 0)) return false;
    }
    return true;
}

export function rollCraftLevel(tierId: string, rng: () => number = Math.random): number {
    const tier = getCraftTier(tierId);
    const min = Math.floor(tier.levelMin);
    const max = Math.floor(tier.levelMax);
    return min + Math.floor(rng() * (max - min + 1));
}

function pickWeighted<T extends string>(keys: readonly T[], weights: Record<T, number>, rng: () => number): T {
    let total = 0;
    for (const k of keys) total += Math.max(0, weights[k] ?? 0);
    if (total <= 0) return keys[0];
    let roll = rng() * total;
    for (const k of keys) {
        const weight = Math.max(0, weights[k] ?? 0);
        if (weight <= 0) continue;
        if (roll < weight) return k;
        roll -= weight;
    }
    return keys[keys.length - 1];
}

export function pickCraftQuality(tierId: string, rng: () => number = Math.random): Quality {
    const tier = getCraftTier(tierId);
    return pickWeighted(QUALITIES, tier.qualityWeights, rng);
}
