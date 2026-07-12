import { BattleConfig } from '../config/BattleConfig';
import { ChestConfig, type ChestRewardConfig } from '../config/ChestConfig';
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

// 开箱内容档案 2026-07-11 已表化：chest.xlsx/Rewards → ChestConfig.rewards（原 CHEST_REWARD_PROFILE 硬编码已删）。
// rng 的 seed 串保持旧字面（|material|<type>|forge_stone|<lv> 等），同 seed 开箱结果与表化前逐位一致。

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

export function openChest(chest: ChestItem, qualityBonus = 0): OpenChestResult {
    if (!chest) return { ok: false, reason: '宝箱不存在' };
    const profile: ChestRewardConfig | undefined = ChestConfig.rewards[chest.type];
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
        const items = rollDropItems(dropGroup, rng, qualityBonus);
        for (const item of items) {
            reward.equipments.push({
                ...item,
                id: deterministicEquipId(chest, reward.equipments.length),
            });
        }
    }
    {
        const rng = createSeededRng(`${chest.seed}|material|${chest.type}|forge_stone|${levelIndex}`);
        addMaterial(reward, 'forge_stone', rollInt(profile.forgeStoneMin, profile.forgeStoneMax, rng) + materialLevelBonus);
    }
    // 宝石：随机类型 + 档位缩放等级（gemCount=0 时自然不产出）
    const types = gemTypes();
    for (let i = 0; i < profile.gemCount; i++) {
        const rng = createSeededRng(`${chest.seed}|gem|${chest.type}|${i}`);
        const type = types[Math.min(types.length - 1, Math.floor(rng() * types.length))];
        const lvRaw = rollInt(profile.gemLevelMin, profile.gemLevelMax, rng);
        const level = Math.max(1, Math.min(gemMaxLevel(type), lvRaw));
        addMaterial(reward, gemMaterialId(type, level), 1);
    }
    // 卷轴（scrollMax=0 时 rollInt 恒 0 → addMaterial 跳过，与旧"无 scrollRolls 字段"等价）
    {
        const rng = createSeededRng(`${chest.seed}|scroll|${chest.type}`);
        addMaterial(reward, 'rune_scroll', rollInt(profile.scrollMin, profile.scrollMax, rng));
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
