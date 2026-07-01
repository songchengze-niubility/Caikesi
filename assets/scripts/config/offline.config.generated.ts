// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/config-xlsx/offline.xlsx，然后跑：npm run config
// 源文件：tools/config-xlsx/offline.xlsx
// 生成时间：2026-07-01T13:05:46.560Z

/* eslint-disable */
// @ts-nocheck
export const generatedOfflineConfig = {
    "global": {
        "maxHours": 8,
        "efficiency": 0.7,
        "maxBattles": 240
    },
    "levels": [
        {
            "avgClearSeconds": 45,
            "winRate": 1,
            "goldPerWin": 8,
            "expPerWin": 5,
            "chestChance": 1,
            "chestGroup": "early"
        },
        {
            "avgClearSeconds": 55,
            "winRate": 0.95,
            "goldPerWin": 12,
            "expPerWin": 8,
            "chestChance": 0.85,
            "chestGroup": "early"
        }
    ],
    "chestWeights": {
        "default": {
            "normal": 1,
            "boss": 0,
            "chapter": 0
        },
        "early": {
            "normal": 85,
            "boss": 15,
            "chapter": 0
        }
    }
};
