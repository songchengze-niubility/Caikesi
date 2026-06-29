// 装备持久化：把 InventoryModel 接到共享 PlayerData 存档。

import { loadPlayerData, savePlayerData } from '../core/data/PlayerDataStore';
import { InventoryModel } from './InventoryModel';

// 启动时调用一次：从存档恢复背包/仓库/装备栏
export async function loadInventory(model: InventoryModel): Promise<void> {
    const data = await loadPlayerData();
    model.deserialize(data.inventory);
}

// 任何成功操作后调用：把当前模型写回存档
export async function saveInventory(model: InventoryModel): Promise<void> {
    const data = await loadPlayerData();
    data.inventory = model.serialize();
    await savePlayerData();
}
