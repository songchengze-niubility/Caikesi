// 数据服务层（DataService）—— 这就是"预留后端"的接缝
// 玩法代码只通过 DataService 读写存档，不关心数据存在哪。
// 现在：用本地存储（LocalDataSource）。
// 以后接后端：新写一个 RemoteDataSource 实现同一个接口，
//             只把文件最下面那一行换成 new RemoteDataSource()，玩法代码一行不用改。
// 注意：接口故意设计成"异步"（Promise），因为网络请求天生异步，现在就异步以后才不用返工。

import { sys } from 'cc';
import type { InventorySave } from '../../inventory/InventoryModel';
import type { ProgressSave } from '../../progression/ProgressModel';

// 玩家存档的数据结构（数据模型）。以后加背包、关卡进度等就往这里加字段。
export interface PlayerData {
    gold: number;          // 金币
    power: number;         // 战力
    lastSaveTime: number;  // 上次存档的时间戳（毫秒）——离线收益靠它计算
    inventory?: InventorySave;  // 装备存储（背包/仓库/装备栏）；老存档缺它，由默认值兜底
    progress?: ProgressSave;    // 关卡进度（当前关/最高解锁）；老存档缺它，由默认值兜底
}

function defaultData(): PlayerData {
    return { gold: 0, power: 0, lastSaveTime: Date.now() };
}

// 数据源接口：本地和远程都要实现这两个方法
export interface IDataSource {
    load(): Promise<PlayerData>;
    save(data: PlayerData): Promise<void>;
}

// 本地数据源（现在用）。微信小游戏里 sys.localStorage 会自动用微信的本地存储。
class LocalDataSource implements IDataSource {
    private static KEY = 'idle_save_v1';

    async load(): Promise<PlayerData> {
        const raw = sys.localStorage.getItem(LocalDataSource.KEY);
        if (!raw) return defaultData();
        try {
            // 用默认值兜底，避免以后加了新字段时老存档缺字段报错
            return { ...defaultData(), ...JSON.parse(raw) };
        } catch {
            return defaultData();
        }
    }

    async save(data: PlayerData): Promise<void> {
        sys.localStorage.setItem(LocalDataSource.KEY, JSON.stringify(data));
    }
}

// ↓↓↓ 将来接后端，只换这一行：new RemoteDataSource() ↓↓↓
export const DataService: IDataSource = new LocalDataSource();
