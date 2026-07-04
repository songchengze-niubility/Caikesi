// 材料合成装备（纯逻辑，不依赖 cc）。
// 玩家选部位 + 档位，材料够就一定产出一件装备；等级/品质在档位配置范围内随机。
// 失败（材料不足/参数非法）不修改传入的 materials，调用方决定何时把 remainingMaterials 落盘。

import { createEquipItem, SLOTS } from '../inventory/EquipDefs';
import type { EquipItem, EquipSlot } from '../inventory/EquipDefs';
import { canAffordCraftTier, getCraftTier, pickCraftQuality, rollCraftLevel } from '../config/CraftConfig';
import type { MaterialSave } from '../services/RewardTypes';

export interface CraftResult {
    ok: boolean;
    reason?: string;
    item?: EquipItem;
    remainingMaterials?: MaterialSave;
}

export function craftEquipment(
    materials: MaterialSave,
    tierId: string,
    slot: EquipSlot,
    rng: () => number = Math.random,
): CraftResult {
    if (!SLOTS.includes(slot)) return { ok: false, reason: '部位非法' };

    let tier;
    try {
        tier = getCraftTier(tierId);
    } catch {
        return { ok: false, reason: '合成档位不存在' };
    }

    if (!canAffordCraftTier(materials, tierId)) return { ok: false, reason: '材料不足' };

    const remainingMaterials: MaterialSave = { ...materials };
    for (const materialId of Object.keys(tier.cost) as (keyof MaterialSave)[]) {
        const need = tier.cost[materialId] ?? 0;
        remainingMaterials[materialId] = (remainingMaterials[materialId] ?? 0) - need;
    }

    const level = rollCraftLevel(tierId, rng);
    const quality = pickCraftQuality(tierId, rng);
    const item = createEquipItem(slot, quality, rng, level);

    return { ok: true, item, remainingMaterials };
}
