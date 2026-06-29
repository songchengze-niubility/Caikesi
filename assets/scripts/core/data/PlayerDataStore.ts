// PlayerData 共享缓存。
// 多个子系统（装备、关卡进度）都会写同一份 PlayerData，必须共用缓存，避免彼此用旧快照覆盖。

import { DataService, PlayerData } from './DataService';

let _cache: PlayerData | null = null;

export async function loadPlayerData(): Promise<PlayerData> {
    if (!_cache) _cache = await DataService.load();
    return _cache;
}

export async function savePlayerData(): Promise<void> {
    if (!_cache) _cache = await DataService.load();
    await DataService.save(_cache);
}

export function clearPlayerDataCacheForTest(): void {
    _cache = null;
}
