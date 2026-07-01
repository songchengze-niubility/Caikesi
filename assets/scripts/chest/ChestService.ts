import { BattleConfig } from '../config/BattleConfig';
import { rollDropItems } from '../config/DropConfig';
import { hashSeed, createSeededRng } from '../core/Random';
import { emptyRewardBundle, type RewardBundle } from '../services/RewardTypes';
import type { ChestItem, ChestType } from './ChestModel';

export interface OpenChestResult {
    ok: boolean;
    reason?: string;
    chest?: ChestItem;
    reward?: RewardBundle;
}

interface ChestRewardProfile {
    equipmentRolls: number;
    goldBase: number;
    expBase: number;
}

const CHEST_REWARD_PROFILE: Record<ChestType, ChestRewardProfile> = {
    normal: { equipmentRolls: 1, goldBase: 6, expBase: 4 },
    boss: { equipmentRolls: 2, goldBase: 18, expBase: 10 },
    chapter: { equipmentRolls: 3, goldBase: 36, expBase: 20 },
};

function clampLevelIndex(index: number): number {
    if (!Number.isFinite(index)) return BattleConfig.startLevel;
    return Math.max(0, Math.min(Math.floor(index), BattleConfig.levels.length - 1));
}

function deterministicEquipId(chest: ChestItem, index: number): string {
    return `eq_ch_${hashSeed(`${chest.id}|${chest.seed}|${index}`).toString(36)}`;
}

export function openChest(chest: ChestItem): OpenChestResult {
    if (!chest) return { ok: false, reason: '宝箱不存在' };
    const profile = CHEST_REWARD_PROFILE[chest.type];
    if (!profile) return { ok: false, reason: '宝箱类型非法' };
    if (!chest.sourceDropGroup) return { ok: false, reason: '宝箱缺少掉落组' };

    const levelIndex = clampLevelIndex(chest.sourceLevelIndex);
    const levelFactor = levelIndex + 1;
    const reward = emptyRewardBundle();
    reward.gold = profile.goldBase * levelFactor;
    reward.exp = profile.expBase * levelFactor;

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

    return { ok: true, chest: { ...chest }, reward };
}

export function chestTypeLabel(type: ChestType): string {
    switch (type) {
        case 'boss': return 'Boss宝箱';
        case 'chapter': return '章节宝箱';
        default: return '普通宝箱';
    }
}
