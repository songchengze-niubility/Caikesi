// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/config-xlsx/chest.xlsx，然后跑：npm run config
// 源文件：tools/config-xlsx/chest.xlsx
// 生成时间：2026-07-12T04:41:25.567Z

/* eslint-disable */
// @ts-nocheck
export const generatedChestConfig = {
    "groups": {
        "default": {
            "mobChance": 0.03,
            "finalChance": 0.35,
            "mobWeightGroup": "mob_default",
            "finalWeightGroup": "final_default"
        },
        "c1_early": {
            "mobChance": 0.03,
            "finalChance": 0.35,
            "mobWeightGroup": "mob_default",
            "finalWeightGroup": "final_default"
        },
        "c1_mid": {
            "mobChance": 0.03,
            "finalChance": 0.35,
            "mobWeightGroup": "mob_default",
            "finalWeightGroup": "final_default"
        },
        "c1_late": {
            "mobChance": 0.03,
            "finalChance": 0.35,
            "mobWeightGroup": "mob_default",
            "finalWeightGroup": "final_default"
        },
        "c1_boss": {
            "mobChance": 0.03,
            "finalChance": 1,
            "mobWeightGroup": "mob_default",
            "finalWeightGroup": "final_boss"
        }
    },
    "typeWeights": {
        "mob_default": {
            "normal": 95,
            "boss": 5,
            "chapter": 0
        },
        "final_default": {
            "normal": 65,
            "boss": 35,
            "chapter": 0
        },
        "final_boss": {
            "normal": 20,
            "boss": 60,
            "chapter": 20
        }
    },
    "rewards": {
        "normal": {
            "equipmentRolls": 1,
            "forgeStoneMin": 2,
            "forgeStoneMax": 4,
            "gemCount": 0,
            "gemLevelMin": 1,
            "gemLevelMax": 1,
            "scrollMin": 0,
            "scrollMax": 0
        },
        "boss": {
            "equipmentRolls": 2,
            "forgeStoneMin": 4,
            "forgeStoneMax": 8,
            "gemCount": 2,
            "gemLevelMin": 1,
            "gemLevelMax": 2,
            "scrollMin": 1,
            "scrollMax": 1
        },
        "chapter": {
            "equipmentRolls": 3,
            "forgeStoneMin": 8,
            "forgeStoneMax": 12,
            "gemCount": 3,
            "gemLevelMin": 2,
            "gemLevelMax": 3,
            "scrollMin": 1,
            "scrollMax": 2
        }
    }
};
