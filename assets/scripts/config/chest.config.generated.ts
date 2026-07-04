// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/config-xlsx/chest.xlsx，然后跑：npm run config
// 源文件：tools/config-xlsx/chest.xlsx
// 生成时间：2026-07-04T14:33:27.979Z

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
    }
};
