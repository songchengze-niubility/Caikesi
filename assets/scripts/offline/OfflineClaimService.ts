import { BattleConfig } from '../config/BattleConfig';
import { ChestInventoryModel } from '../chest/ChestModel';
import { loadPlayerData, savePlayerData } from '../core/data/PlayerDataStore';
import { calculateOfflineReward, type OfflineClaimResult, type OfflineRewardInput } from './OfflineCombatService';
import { CharacterGrowthModel } from '../growth/CharacterGrowthModel';
import { SquadModel } from '../squad/SquadModel';
import { talentAggregate } from '../talent/TalentStats';

export async function claimOfflineReward(input: Partial<OfflineRewardInput> = {}): Promise<OfflineClaimResult> {
    const data = await loadPlayerData();
    const now = input.now ?? Date.now();
    const levelIndex = input.levelIndex ?? data.progress?.currentLevel ?? BattleConfig.startLevel;
    const lastOnlineAt = input.lastOnlineAt ?? data.lastSaveTime ?? now;
    const seed = input.seed ?? `${lastOnlineAt}|${now}|${levelIndex}`;
    const agg = talentAggregate(data.talents);
    const reward = calculateOfflineReward({
        lastOnlineAt, now, levelIndex, seed,
        talentEcon: { gold: agg.econ.gold, exp: agg.econ.exp, offlineRate: agg.econ.offlineRate, offlineCapSeconds: agg.unlocks.offlineCap },
    });

    data.gold = (data.gold ?? 0) + reward.gold;
    if (reward.exp > 0) {
        const squad = SquadModel.deserialize(data.squad, BattleConfig.squadCap);
        const growth = CharacterGrowthModel.deserialize(data.charGrowth);
        for (const cls of squad.deployedList()) growth.gainExp(cls, reward.exp);
        data.charGrowth = growth.serialize();
    }
    const chests = new ChestInventoryModel();
    chests.deserializeChests(data.chests);
    const stored = chests.addChests(reward.chests);
    data.chests = chests.serializeChests();
    data.lastSaveTime = now;
    await savePlayerData(false);
    return { ...reward, chests: stored.added, chestOverflow: stored.failed, claimed: true };
}
