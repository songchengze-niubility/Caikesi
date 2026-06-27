// 装备持久化：把 InventoryModel 接到 DataService（唯一存档接缝）。
// 缓存一次 PlayerData，避免每次 save 都 load-改-存的整块往返。

import { DataService, PlayerData } from '../core/data/DataService';
import { InventoryModel } from './InventoryModel';

let _cache: PlayerData | null = null;

// 启动时调用一次：从存档恢复背包/仓库/装备栏
export async function loadInventory(model: InventoryModel): Promise<void> {
    _cache = await DataService.load();
    model.deserialize(_cache.inventory);
}

// 任何成功操作后调用：把当前模型写回存档
export async function saveInventory(model: InventoryModel): Promise<void> {
    if (!_cache) _cache = await DataService.load();
    _cache.inventory = model.serialize();
    await DataService.save(_cache);
}
