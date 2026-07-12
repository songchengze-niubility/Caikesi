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

// 开箱内容档案（2026-07-11 表化，取代 ChestService 硬编码）：装备 roll 次数 / 打造石区间 / 宝石数量与等级档 / 卷轴区间。
// 0 数量 / 0 区间 = 该箱型不产出该材料（rollInt 出 0 后 addMaterial 跳过，行为与旧"字段缺省"等价）。
export interface ChestRewardConfig {
    equipmentRolls: number;
    forgeStoneMin: number;
    forgeStoneMax: number;
    gemCount: number;
    gemLevelMin: number;
    gemLevelMax: number;
    scrollMin: number;
    scrollMax: number;
}

export interface ChestConfigShape {
    groups: Record<string, ChestDropGroupConfig>;
    typeWeights: Record<string, Record<ChestType, number>>;
    rewards: Record<ChestType, ChestRewardConfig>;
}

export const ChestConfig = generatedChestConfig as ChestConfigShape;
