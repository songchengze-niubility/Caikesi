import { loadPlayerData, savePlayerData } from '../core/data/PlayerDataStore';
import { ChestInventoryModel } from './ChestModel';

export async function loadChests(model: ChestInventoryModel): Promise<void> {
    const data = await loadPlayerData();
    model.deserializeChests(data.chests);
}

export async function saveChests(model: ChestInventoryModel): Promise<void> {
    const data = await loadPlayerData();
    data.chests = model.serializeChests();
    await savePlayerData();
}
