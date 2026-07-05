import { BattleConfig } from '../config/BattleConfig';
import { DropConfig, rollDropItems } from '../config/DropConfig';
import { hashSeed, createSeededRng } from '../core/Random';
import { emptyRewardBundle, gemMaterialId, type MaterialId, type RewardBundle } from '../services/RewardTypes';
import { gemTypes, gemMaxLevel } from '../inlay/InlayConfig';
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
    gemRolls?: { count: number; levelMin: number; levelMax: number };
    scrollRolls?: { min: number; max: number };
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
        gemRolls: { count: 1, levelMin: 1, levelMax: 1 },
    },
    boss: {
        equipmentRolls: 2,
        materials: [{ id: 'forge_stone', min: 4, max: 8 }],
        gemRolls: { count: 1, levelMin: 1, levelMax: 2 },
        scrollRolls: { min: 1, max: 1 },
    },
    chapter: {
        equipmentRolls: 3,
        materials: [{ id: 'forge_stone', min: 8, max: 12 }],
        gemRolls: { count: 2, levelMin: 2, levelMax: 3 },
        scrollRolls: { min: 1, max: 2 },
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
    // 老存档兼容：宝箱身上的掉落组可能已在表里改名/删除，按来源关卡的现行掉落组兜底
    const dropGroup = DropConfig.groups[chest.sourceDropGroup]
        ? chest.sourceDropGroup
        : BattleConfig.levels[levelIndex].dropGroup;
    const materialLevelBonus = Math.floor(levelIndex / 2);
    const reward = emptyRewardBundle();

    for (let i = 0; i < profile.equipmentRolls; i++) {
        const rng = createSeededRng(`${chest.seed}|open|${chest.type}|${i}`);
        const items = rollDropItems(dropGroup, rng);
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
    // 宝石：随机类型 + 档位缩放等级
    if (profile.gemRolls) {
        const types = gemTypes();
        for (let i = 0; i < profile.gemRolls.count; i++) {
            const rng = createSeededRng(`${chest.seed}|gem|${chest.type}|${i}`);
            const type = types[Math.min(types.length - 1, Math.floor(rng() * types.length))];
            const lvRaw = rollInt(profile.gemRolls.levelMin, profile.gemRolls.levelMax, rng);
            const level = Math.max(1, Math.min(gemMaxLevel(type), lvRaw));
            addMaterial(reward, gemMaterialId(type, level), 1);
        }
    }
    // 卷轴
    if (profile.scrollRolls) {
        const rng = createSeededRng(`${chest.seed}|scroll|${chest.type}`);
        addMaterial(reward, 'rune_scroll', rollInt(profile.scrollRolls.min, profile.scrollRolls.max, rng));
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
