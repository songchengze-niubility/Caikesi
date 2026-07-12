import { BattleConfig } from '../config/BattleConfig';
import { OfflineConfig, type OfflineLevelConfig } from '../config/OfflineConfig';
import { rollChestDrop } from '../chest/ChestDropService';
import { createSeededRng, rollChance } from '../core/Random';
import { emptyRewardBundle, type RewardBundle } from '../services/RewardTypes';

export interface OfflineTalentEcon {
    gold: number;          // 金币获取加成（心法经济支）
    exp: number;           // 经验获取加成
    offlineRate: number;   // 离线收益整体加成（大节点「入定」）
    offlineCapSeconds: number;   // 离线时长上限追加（秒）
}

export interface OfflineRewardInput {
    lastOnlineAt: number;
    now: number;
    levelIndex: number;
    seed: string | number;
    talentEcon?: OfflineTalentEcon;   // 缺省 = 无加成（旧行为）
}

export interface OfflineRewardPreview extends RewardBundle {
    seconds: number;
    battles: number;
    wins: number;
    levelIndex: number;
}

export interface OfflineClaimResult extends OfflineRewardPreview {
    claimed: boolean;
    chestOverflow: number;
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
    };
}

function maxOfflineSeconds(): number {
    return Math.max(0, OfflineConfig.global.maxHours) * 3600;
}

function calcSeconds(lastOnlineAt: number, now: number, extraCapSeconds = 0): number {
    const raw = Math.floor((now - lastOnlineAt) / 1000);
    return Math.max(0, Math.min(raw, maxOfflineSeconds() + Math.max(0, extraCapSeconds)));
}

function levelMonsterCount(levelIndex: number): number {
    const level = BattleConfig.levels[levelIndex];
    let total = 0;
    for (const wave of level.waves) {
        for (const spawn of wave.spawns) total += Math.max(0, Math.floor(spawn.count));
    }
    return total;
}

export function calculateOfflineReward(input: OfflineRewardInput): OfflineRewardPreview {
    const levelIndex = clampLevelIndex(input.levelIndex);
    const level = BattleConfig.levels[levelIndex];
    const cfg = offlineLevelConfig(levelIndex);
    const econ = input.talentEcon ?? { gold: 0, exp: 0, offlineRate: 0, offlineCapSeconds: 0 };
    const seconds = calcSeconds(input.lastOnlineAt, input.now, econ.offlineCapSeconds);
    const avgClearSeconds = Math.max(1, cfg.avgClearSeconds);
    const efficiency = Math.max(0, OfflineConfig.global.efficiency);
    const rawBattles = Math.floor(seconds / avgClearSeconds);
    const maxBattles = Math.max(0, Math.floor(OfflineConfig.global.maxBattles));
    const battles = Math.min(Math.floor(rawBattles * efficiency), maxBattles);
    const rng = createSeededRng(`${input.seed}|offline|${levelIndex}|${input.lastOnlineAt}|${input.now}`);
    const monsterCount = levelMonsterCount(levelIndex);

    const reward = emptyRewardBundle() as OfflineRewardPreview;
    reward.seconds = seconds;
    reward.battles = battles;
    reward.wins = 0;
    reward.levelIndex = levelIndex;

    for (let i = 0; i < battles; i++) {
        if (!rollChance(cfg.winRate, rng)) continue;
        reward.wins++;
        reward.gold += Math.floor(cfg.goldPerWin * (1 + econ.gold) * (1 + econ.offlineRate));
        reward.exp += Math.floor(cfg.expPerWin * (1 + econ.exp) * (1 + econ.offlineRate));

        for (let kill = 0; kill < monsterCount; kill++) {
            const chestReward = rollChestDrop({
                levelIndex,
                dropGroup: level.dropGroup,
                source: 'monster',
                seed: `${input.seed}|offline|${levelIndex}|${i}|monster|${kill}`,
                createdAt: input.now,
            });
            reward.chests.push(...chestReward.chests);
        }
        const finalReward = rollChestDrop({
            levelIndex,
            dropGroup: level.dropGroup,
            source: 'stageFinal',
            seed: `${input.seed}|offline|${levelIndex}|${i}|stageFinal`,
            createdAt: input.now,
        });
        reward.chests.push(...finalReward.chests);
    }

    return reward;
}
