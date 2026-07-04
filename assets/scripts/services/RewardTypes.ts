import type { EquipItem } from '../inventory/EquipDefs';
import type { ChestItem } from '../chest/ChestModel';

export type RewardSource = 'Monster' | 'StageClear' | 'Boss' | 'Offline';

export type MaterialId = 'forge_stone' | 'gem_shard' | 'rune_dust';

export interface MaterialItem {
    id: MaterialId;
    count: number;
}

export type MaterialSave = Partial<Record<MaterialId, number>>;

export const MATERIAL_LABEL: Record<MaterialId, string> = {
    forge_stone: '打造石',
    gem_shard: '宝石碎片',
    rune_dust: '铭文粉尘',
};

export interface RewardBundle {
    gold: number;
    exp: number;
    equipments: EquipItem[];
    chests: ChestItem[];
    materials: MaterialItem[];
}

export function emptyRewardBundle(): RewardBundle {
    return { gold: 0, exp: 0, equipments: [], chests: [], materials: [] };
}
