import { BattleConfig } from '../config/BattleConfig';
import { OfflineConfig, type OfflineLevelConfig } from '../config/OfflineConfig';
import { CHEST_TYPES, createChestItem, type ChestItem, type ChestType } from '../chest/ChestModel';
import { createSeededRng, clamp01, pickWeighted, rollChance } from '../core/Random';
import { emptyRewardBundle, type RewardBundle } from '../services/RewardTypes';

export interface OfflineRewardInput {
    lastOnlineAt: number;
    now: number;
    levelIndex: number;
    seed: string | number;
}

export interface OfflineRewardPreview extends RewardBundle {
    seconds: number;
    battles: number;
    wins: number;
    levelIndex: number;
}

export interface OfflineClaimResult extends OfflineRewardPreview {
    claimed: boolean;
}

function clampLevelIndex(index: number): number {
    if (!Number.isFinite(index)) return BattleConfig.startLevel;
    return Math.max(0, Math.min(Math.floor(index), BattleConfig.levels.length - 1));
}

function offlineLevelConfig(levelIndex: number): OfflineLevelConfig {
    return OfflineConfig.levels[levelIndex] ?? OfflineConfig.levels[OfflineConfig.levels.length - 1] ?? {
        avgClearSeconds: 60,
        winRate: 1,
        goldPerWin: 0,
        expPerWin: 0,
        chestChance: 0,
        chestGroup: 'default',
    };
}

function maxOfflineSeconds(): number {
    return Math.max(0, OfflineConfig.global.maxHours) * 3600;
}

function calcSeconds(lastOnlineAt: number, now: number): number {
    const raw = Math.floor((now - lastOnlineAt) / 1000);
    return Math.max(0, Math.min(raw, maxOfflineSeconds()));
}

function pickChestType(group: string, rng: () => number): ChestType {
    const weights = OfflineConfig.chestWeights[group] ?? OfflineConfig.chestWeights.default ?? { normal: 1, boss: 0, chapter: 0 };
    return pickWeighted(CHEST_TYPES, weights, rng);
}

export function calculateOfflineReward(input: OfflineRewardInput): OfflineRewardPreview {
    const levelIndex = clampLevelIndex(input.levelIndex);
    const level = BattleConfig.levels[levelIndex];
    const cfg = offlineLevelConfig(levelIndex);
    const seconds = calcSeconds(input.lastOnlineAt, input.now);
    const avgClearSeconds = Math.max(1, cfg.avgClearSeconds);
    const maxBattles = Math.max(0, Math.floor(OfflineConfig.global.maxBattles));
    const battles = Math.min(Math.floor(seconds / avgClearSeconds), maxBattles);
    const efficiency = Math.max(0, OfflineConfig.global.efficiency);
    const rng = createSeededRng(`${input.seed}|offline|${levelIndex}|${input.lastOnlineAt}|${input.now}`);

    const reward = emptyRewardBundle() as OfflineRewardPreview;
    reward.seconds = seconds;
    reward.battles = battles;
    reward.wins = 0;
    reward.levelIndex = levelIndex;

    for (let i = 0; i < battles; i++) {
        if (!rollChance(cfg.winRate, rng)) continue;
        reward.wins++;
        reward.gold += Math.floor(cfg.goldPerWin * efficiency);
        reward.exp += Math.floor(cfg.expPerWin * efficiency);
        if (rollChance(clamp01(cfg.chestChance) * Math.min(1, efficiency), rng)) {
            const chestSeed = `${input.seed}|offline|${levelIndex}|${i}|${reward.wins}`;
            const type = pickChestType(cfg.chestGroup, rng);
            reward.chests.push(createChestItem({
                type,
                sourceLevelIndex: levelIndex,
                sourceDropGroup: level.dropGroup,
                seed: chestSeed,
                createdAt: input.now,
            }));
        }
    }

    return reward;
}

export async function claimOfflineReward(input: Partial<OfflineRewardInput> = {}): Promise<OfflineClaimResult> {
    const { loadPlayerData, savePlayerData } = await import('../core/data/PlayerDataStore');
    const data = await loadPlayerData();
    const now = input.now ?? Date.now();
    const levelIndex = input.levelIndex ?? data.progress?.currentLevel ?? BattleConfig.startLevel;
    const lastOnlineAt = input.lastOnlineAt ?? data.lastSaveTime ?? now;
    const seed = input.seed ?? `${lastOnlineAt}|${now}|${levelIndex}`;
    const reward = calculateOfflineReward({ lastOnlineAt, now, levelIndex, seed });

    data.gold = (data.gold ?? 0) + reward.gold;
    data.exp = (data.exp ?? 0) + reward.exp;
    data.chests = [...(data.chests ?? []), ...reward.chests.map(chest => ({ ...chest }))];
    data.lastSaveTime = now;
    await savePlayerData(false);
    return { ...reward, claimed: true };
}
