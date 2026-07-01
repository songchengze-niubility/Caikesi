// 离线战斗收益配置。
// ★★★ 数值由 Excel 管理 ★★★
//    源文件：tools/config-xlsx/offline.xlsx
//    改数值流程：编辑 Excel → 跑 `npm run config` → 生成 offline.config.generated.ts

import { generatedOfflineConfig } from './offline.config.generated';
import type { ChestType } from '../chest/ChestModel';

export interface OfflineLevelConfig {
    avgClearSeconds: number;
    winRate: number;
    goldPerWin: number;
    expPerWin: number;
    chestChance: number;
    chestGroup: string;
}

export interface OfflineConfigShape {
    global: {
        maxHours: number;
        efficiency: number;
        maxBattles: number;
    };
    levels: OfflineLevelConfig[];
    chestWeights: Record<string, Record<ChestType, number>>;
}

export const OfflineConfig = generatedOfflineConfig as OfflineConfigShape;
