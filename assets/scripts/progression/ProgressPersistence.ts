// 关卡进度持久化：把 ProgressModel 接到共享 PlayerData 存档。

import { loadPlayerData, savePlayerData } from '../core/data/PlayerDataStore';
import { ProgressModel } from './ProgressModel';

export async function loadProgress(model: ProgressModel): Promise<void> {
    const data = await loadPlayerData();
    model.deserialize(data.progress);
}

export async function saveProgress(model: ProgressModel): Promise<void> {
    const data = await loadPlayerData();
    data.progress = model.serialize();
    await savePlayerData();
}
