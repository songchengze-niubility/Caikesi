import { BattleConfig } from '../config/BattleConfig';
import { rollDropItems } from '../config/DropConfig';
import { createSeededRng, hashSeed, type Rng } from '../core/Random';
import { emptyRewardBundle, type RewardBundle, type RewardSource } from '../services/RewardTypes';

export interface StageRewardInput {
    levelIndex: number;
    source: RewardSource;
    seed: string | number;
    rng?: Rng;
    qualityBonus?: number;   // 心法掉落支：蓝+品质权重放大（缺省 0 = 旧行为）
}

function clampLevelIndex(index: number): number {
    if (!Number.isFinite(index)) return BattleConfig.startLevel;
    return Math.max(0, Math.min(Math.floor(index), BattleConfig.levels.length - 1));
}

export function generateStageReward(input: StageRewardInput): RewardBundle {
    const levelIndex = clampLevelIndex(input.levelIndex);
    const level = BattleConfig.levels[levelIndex];
    const rng = input.rng ?? createSeededRng(`${input.seed}|${levelIndex}|${input.source}`);
    const reward = emptyRewardBundle();
    reward.equipments = rollDropItems(level.dropGroup, rng, input.qualityBonus ?? 0).map((item, i) => ({
        ...item,
        id: `eq_${hashSeed(`${input.seed}|${levelIndex}|${input.source}|${i}`).toString(36)}`,
    }));
    return reward;
}
