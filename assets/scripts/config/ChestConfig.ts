// 宝箱掉落配置。
// ★★★ 数值由 Excel 管理 ★★★
//    源文件：tools/config-xlsx/chest.xlsx
//    改数值流程：编辑 Excel → 跑 `npm run config` → 生成 chest.config.generated.ts

import { generatedChestConfig } from './chest.config.generated';
import type { ChestType } from '../chest/ChestModel';

export interface ChestDropGroupConfig {
    mobChance: number;
    finalChance: number;
    mobWeightGroup: string;
    finalWeightGroup: string;
}

export interface ChestConfigShape {
    groups: Record<string, ChestDropGroupConfig>;
    typeWeights: Record<string, Record<ChestType, number>>;
}

export const ChestConfig = generatedChestConfig as ChestConfigShape;
