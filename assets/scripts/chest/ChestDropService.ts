import { BattleConfig } from '../config/BattleConfig';
import { ChestConfig } from '../config/ChestConfig';
import { CHEST_TYPES, createChestItem, type ChestType } from './ChestModel';
import { createSeededRng, pickWeighted, rollChance } from '../core/Random';
import { emptyRewardBundle, type RewardBundle } from '../services/RewardTypes';

export type ChestDropSource = 'monster' | 'stageFinal';

export interface ChestDropInput {
    levelIndex: number;
    dropGroup: string;
    source: ChestDropSource;
    seed: string | number;
    createdAt: number;
}

function clampLevelIndex(index: number): number {
    if (!Number.isFinite(index)) return BattleConfig.startLevel;
    return Math.max(0, Math.min(Math.floor(index), BattleConfig.levels.length - 1));
}

function chestGroup(dropGroup: string) {
    return ChestConfig.groups[dropGroup] ?? ChestConfig.groups.default;
}

function typeWeights(group: string): Record<ChestType, number> {
    return ChestConfig.typeWeights[group] ?? ChestConfig.typeWeights.default ?? { normal: 1, boss: 0, chapter: 0 };
}

export function rollChestDrop(input: ChestDropInput): RewardBundle {
    const reward = emptyRewardBundle();
    const group = chestGroup(input.dropGroup);
    if (!group) return reward;

    const chance = input.source === 'stageFinal' ? group.finalChance : group.mobChance;
    const weightGroup = input.source === 'stageFinal' ? group.finalWeightGroup : group.mobWeightGroup;
    const rng = createSeededRng(`${input.seed}|chest-drop|${input.source}|${input.levelIndex}|${input.dropGroup}`);
    if (!rollChance(chance, rng)) return reward;

    const levelIndex = clampLevelIndex(input.levelIndex);
    const type = pickWeighted(CHEST_TYPES, typeWeights(weightGroup), rng);
    reward.chests.push(createChestItem({
        type,
        sourceLevelIndex: levelIndex,
        sourceDropGroup: input.dropGroup,
        seed: `${input.seed}|${input.source}|${type}`,
        createdAt: input.createdAt,
    }));
    return reward;
}
