// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/config-xlsx/craft.xlsx，然后跑：npm run config
// 源文件：tools/config-xlsx/craft.xlsx
// 生成时间：2026-07-04T14:14:54.122Z

/* eslint-disable */
// @ts-nocheck
export const generatedCraftConfig = {
    "tiers": {
        "tier_1": {
            "label": "初阶",
            "levelMin": 1,
            "levelMax": 10,
            "cost": {
                "forge_stone": 10
            },
            "qualityWeights": {
                "common": 60,
                "fine": 30,
                "rare": 9,
                "epic": 1,
                "legend": 0
            }
        },
        "tier_2": {
            "label": "中阶",
            "levelMin": 11,
            "levelMax": 20,
            "cost": {
                "forge_stone": 20,
                "gem_shard": 3
            },
            "qualityWeights": {
                "common": 20,
                "fine": 40,
                "rare": 30,
                "epic": 9,
                "legend": 1
            }
        },
        "tier_3": {
            "label": "高阶",
            "levelMin": 21,
            "levelMax": 30,
            "cost": {
                "forge_stone": 30,
                "gem_shard": 6,
                "rune_dust": 2
            },
            "qualityWeights": {
                "common": 0,
                "fine": 10,
                "rare": 35,
                "epic": 40,
                "legend": 15
            }
        }
    }
};
