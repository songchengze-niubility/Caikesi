import { BattleConfig } from '../config/BattleConfig';
import { ChestInventoryModel } from '../chest/ChestModel';
import { loadPlayerData, savePlayerData } from '../core/data/PlayerDataStore';
import { calculateOfflineReward, type OfflineClaimResult, type OfflineRewardInput } from './OfflineCombatService';

export async function claimOfflineReward(input: Partial<OfflineRewardInput> = {}): Promise<OfflineClaimResult> {
    const data = await loadPlayerData();
    const now = input.now ?? Date.now();
    const levelIndex = input.levelIndex ?? data.progress?.currentLevel ?? BattleConfig.startLevel;
    const lastOnlineAt = input.lastOnlineAt ?? data.lastSaveTime ?? now;
    const seed = input.seed ?? `${lastOnlineAt}|${now}|${levelIndex}`;
    const reward = calculateOfflineReward({ lastOnlineAt, now, levelIndex, seed });

    data.gold = (data.gold ?? 0) + reward.gold;
    data.exp = (data.exp ?? 0) + reward.exp;
    const chests = new ChestInventoryModel();
    chests.deserializeChests(data.chests);
    const stored = chests.addChests(reward.chests);
    data.chests = chests.serializeChests();
    data.lastSaveTime = now;
    await savePlayerData(false);
    return { ...reward, chests: stored.added, chestOverflow: stored.failed, claimed: true };
}
