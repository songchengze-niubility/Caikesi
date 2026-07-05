// 出战小队持久化：把 SquadModel 接到共享 PlayerData 存档。
// squadCap 在反序列化时注入，非法/缺失存档由 SquadModel.deserialize 自愈。

import { loadPlayerData, savePlayerData } from '../core/data/PlayerDataStore';
import { BattleConfig } from '../config/BattleConfig';
import { SquadModel } from './SquadModel';

export async function loadSquad(): Promise<SquadModel> {
    const data = await loadPlayerData();
    return SquadModel.deserialize(data.squad, BattleConfig.squadCap);
}

export async function saveSquad(model: SquadModel): Promise<void> {
    const data = await loadPlayerData();
    data.squad = model.serialize();
    await savePlayerData();
}
