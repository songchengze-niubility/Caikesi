// 角色成长持久化：把 CharacterGrowthModel 接到共享 PlayerData 存档。

import { loadPlayerData, savePlayerData } from '../core/data/PlayerDataStore';
import { CharacterGrowthModel } from './CharacterGrowthModel';

export async function loadGrowth(): Promise<CharacterGrowthModel> {
    const data = await loadPlayerData();
    return CharacterGrowthModel.deserialize(data.charGrowth);
}

export async function saveGrowth(model: CharacterGrowthModel): Promise<void> {
    const data = await loadPlayerData();
    data.charGrowth = model.serialize();
    await savePlayerData();
}
