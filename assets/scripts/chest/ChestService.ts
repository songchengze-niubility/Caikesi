import { BattleConfig } from '../config/BattleConfig';
import { rollDropItems } from '../config/DropConfig';
import { hashSeed, createSeededRng } from '../core/Random';
import { emptyRewardBundle, type MaterialId, type RewardBundle } from '../services/RewardTypes';
import type { ChestItem, ChestType } from './ChestModel';

export interface OpenChestResult {
    ok: boolean;
    reason?: string;
    chest?: ChestItem;
    reward?: RewardBundle;
}

interface ChestRewardProfile {
    equipmentRolls: number;
    materials: MaterialRoll[];
}

interface MaterialRoll {
    id: MaterialId;
    min: number;
    max: number;
}

const CHEST_REWARD_PROFILE: Record<ChestType, ChestRewardProfile> = {
    normal: {
        equipmentRolls: 1,
        materials: [{ id: 'forge_stone', min: 2, max: 4 }],
    },
    boss: {
        equipmentRolls: 2,
        materials: [
            { id: 'forge_stone', min: 4, max: 8 },
            { id: 'gem_shard', min: 1, max: 3 },
        ],
    },
    chapter: {
        equipmentRolls: 3,
        materials: [
            { id: 'forge_stone', min: 8, max: 12 },
            { id: 'gem_shard', min: 3, max: 5 },
            { id: 'rune_dust', min: 1, max: 2 },
        ],
    },
};

function clampLevelIndex(index: number): number {
    if (!Number.isFinite(index)) return BattleConfig.startLevel;
    return Math.max(0, Math.min(Math.floor(index), BattleConfig.levels.length - 1));
}

function deterministicEquipId(chest: ChestItem, index: number): string {
    return `eq_ch_${hashSeed(`${chest.id}|${chest.seed}|${index}`).toString(36)}`;
}

function rollInt(min: number, max: number, rng: () => number): number {
    const low = Math.max(0, Math.floor(min));
    const high = Math.max(low, Math.floor(max));
    return low + Math.floor(rng() * (high - low + 1));
}

function addMaterial(reward: RewardBundle, id: MaterialId, count: number): void {
    if (count <= 0) return;
    const existing = reward.materials.find(item => item.id === id);
    if (existing) existing.count += count;
    else reward.materials.push({ id, count });
}

export function openChest(chest: ChestItem): OpenChestResult {
    if (!chest) return { ok: false, reason: '宝箱不存在' };
    const profile = CHEST_REWARD_PROFILE[chest.type];
    if (!profile) return { ok: false, reason: '宝箱类型非法' };
    if (!chest.sourceDropGroup) return { ok: false, reason: '宝箱缺少掉落组' };

    const levelIndex = clampLevelIndex(chest.sourceLevelIndex);
    const materialLevelBonus = Math.floor(levelIndex / 2);
    const reward = emptyRewardBundle();

    for (let i = 0; i < profile.equipmentRolls; i++) {
        const rng = createSeededRng(`${chest.seed}|open|${chest.type}|${i}`);
        const items = rollDropItems(chest.sourceDropGroup, rng);
        for (const item of items) {
            reward.equipments.push({
                ...item,
                id: deterministicEquipId(chest, reward.equipments.length),
            });
        }
    }
    for (const roll of profile.materials) {
        const rng = createSeededRng(`${chest.seed}|material|${chest.type}|${roll.id}|${levelIndex}`);
        addMaterial(reward, roll.id, rollInt(roll.min, roll.max, rng) + materialLevelBonus);
    }

    return { ok: true, chest: { ...chest }, reward };
}

export function chestTypeLabel(type: ChestType): string {
    switch (type) {
        case 'boss': return 'Boss宝箱';
        case 'chapter': return '章节宝箱';
        default: return '普通宝箱';
    }
}
