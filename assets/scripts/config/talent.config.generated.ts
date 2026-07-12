// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/config-xlsx/talent.xlsx，然后跑：npm run config
// 源文件：tools/config-xlsx/talent.xlsx
// 生成时间：2026-07-12T10:19:08.251Z

/* eslint-disable */
// @ts-nocheck
export const generatedTalentConfig = {
    "nodes": [
        {
            "id": "trunk_1",
            "label": "吐纳",
            "branch": "trunk",
            "tier": 1,
            "prereq": [],
            "maxLevel": 5,
            "effectKind": "stat",
            "effectKey": "hpPct",
            "valuePerLevel": 0.01,
            "goldBase": 100,
            "goldGrowth": 1.5,
            "pageCost": 0
        },
        {
            "id": "trunk_2",
            "label": "凝神",
            "branch": "trunk",
            "tier": 2,
            "prereq": [
                "trunk_1"
            ],
            "maxLevel": 5,
            "effectKind": "stat",
            "effectKey": "atkPct",
            "valuePerLevel": 0.01,
            "goldBase": 150,
            "goldGrowth": 1.5,
            "pageCost": 0
        },
        {
            "id": "trunk_3",
            "label": "固本",
            "branch": "trunk",
            "tier": 3,
            "prereq": [
                "trunk_2"
            ],
            "maxLevel": 5,
            "effectKind": "stat",
            "effectKey": "defPct",
            "valuePerLevel": 0.01,
            "goldBase": 220,
            "goldGrowth": 1.5,
            "pageCost": 0
        },
        {
            "id": "trunk_4",
            "label": "周天",
            "branch": "trunk",
            "tier": 4,
            "prereq": [
                "trunk_3"
            ],
            "maxLevel": 5,
            "effectKind": "stat",
            "effectKey": "dmgBonus",
            "valuePerLevel": 0.01,
            "goldBase": 330,
            "goldGrowth": 1.5,
            "pageCost": 0
        },
        {
            "id": "combat_atk",
            "label": "剑势",
            "branch": "combat",
            "tier": 1,
            "prereq": [
                "trunk_2"
            ],
            "maxLevel": 5,
            "effectKind": "stat",
            "effectKey": "atkPct",
            "valuePerLevel": 0.02,
            "goldBase": 200,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "combat_hp",
            "label": "铁骨",
            "branch": "combat",
            "tier": 2,
            "prereq": [
                "trunk_2"
            ],
            "maxLevel": 5,
            "effectKind": "stat",
            "effectKey": "hpPct",
            "valuePerLevel": 0.02,
            "goldBase": 200,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "combat_crit",
            "label": "锋芒",
            "branch": "combat",
            "tier": 3,
            "prereq": [
                "combat_atk"
            ],
            "maxLevel": 5,
            "effectKind": "stat",
            "effectKey": "critRate",
            "valuePerLevel": 0.01,
            "goldBase": 300,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "combat_def",
            "label": "云甲",
            "branch": "combat",
            "tier": 4,
            "prereq": [
                "combat_hp"
            ],
            "maxLevel": 5,
            "effectKind": "stat",
            "effectKey": "defPct",
            "valuePerLevel": 0.02,
            "goldBase": 300,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "combat_haste",
            "label": "疾风",
            "branch": "combat",
            "tier": 5,
            "prereq": [
                "combat_crit"
            ],
            "maxLevel": 5,
            "effectKind": "stat",
            "effectKey": "skillHaste",
            "valuePerLevel": 0.02,
            "goldBase": 450,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "combat_dmg",
            "label": "破军",
            "branch": "combat",
            "tier": 6,
            "prereq": [
                "combat_crit"
            ],
            "maxLevel": 5,
            "effectKind": "stat",
            "effectKey": "dmgBonus",
            "valuePerLevel": 0.015,
            "goldBase": 450,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "combat_basic",
            "label": "淬刃",
            "branch": "combat",
            "tier": 7,
            "prereq": [
                "combat_dmg"
            ],
            "maxLevel": 5,
            "effectKind": "stat",
            "effectKey": "basicDmgBonus",
            "valuePerLevel": 0.02,
            "goldBase": 600,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "combat_master",
            "label": "心法大成",
            "branch": "combat",
            "tier": 8,
            "prereq": [
                "combat_basic",
                "combat_haste",
                "combat_def"
            ],
            "maxLevel": 1,
            "effectKind": "stat",
            "effectKey": "dmgBonus",
            "valuePerLevel": 0.05,
            "goldBase": 2000,
            "goldGrowth": 1,
            "pageCost": 2
        },
        {
            "id": "econ_gold",
            "label": "生财",
            "branch": "economy",
            "tier": 1,
            "prereq": [
                "trunk_3"
            ],
            "maxLevel": 5,
            "effectKind": "econ",
            "effectKey": "gold",
            "valuePerLevel": 0.03,
            "goldBase": 250,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "econ_exp",
            "label": "悟性",
            "branch": "economy",
            "tier": 2,
            "prereq": [
                "trunk_3"
            ],
            "maxLevel": 5,
            "effectKind": "econ",
            "effectKey": "exp",
            "valuePerLevel": 0.03,
            "goldBase": 250,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "econ_gold2",
            "label": "聚宝",
            "branch": "economy",
            "tier": 3,
            "prereq": [
                "econ_gold"
            ],
            "maxLevel": 5,
            "effectKind": "econ",
            "effectKey": "gold",
            "valuePerLevel": 0.03,
            "goldBase": 400,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "econ_exp2",
            "label": "闻道",
            "branch": "economy",
            "tier": 4,
            "prereq": [
                "econ_exp"
            ],
            "maxLevel": 5,
            "effectKind": "econ",
            "effectKey": "exp",
            "valuePerLevel": 0.03,
            "goldBase": 400,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "econ_offline",
            "label": "入定",
            "branch": "economy",
            "tier": 5,
            "prereq": [
                "econ_gold2"
            ],
            "maxLevel": 1,
            "effectKind": "econ",
            "effectKey": "offlineRate",
            "valuePerLevel": 0.25,
            "goldBase": 1500,
            "goldGrowth": 1,
            "pageCost": 2
        },
        {
            "id": "econ_autosell",
            "label": "拂尘",
            "branch": "economy",
            "tier": 6,
            "prereq": [
                "econ_exp2"
            ],
            "maxLevel": 1,
            "effectKind": "unlock",
            "effectKey": "autoSell",
            "valuePerLevel": 1,
            "goldBase": 1500,
            "goldGrowth": 1,
            "pageCost": 2
        },
        {
            "id": "drop_quality",
            "label": "慧眼",
            "branch": "drop",
            "tier": 1,
            "prereq": [
                "trunk_4"
            ],
            "maxLevel": 5,
            "effectKind": "drop",
            "effectKey": "equipQuality",
            "valuePerLevel": 0.03,
            "goldBase": 300,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "drop_quality2",
            "label": "鉴宝",
            "branch": "drop",
            "tier": 2,
            "prereq": [
                "drop_quality"
            ],
            "maxLevel": 5,
            "effectKind": "drop",
            "effectKey": "equipQuality",
            "valuePerLevel": 0.03,
            "goldBase": 450,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "drop_quality3",
            "label": "寻珍",
            "branch": "drop",
            "tier": 3,
            "prereq": [
                "drop_quality2"
            ],
            "maxLevel": 5,
            "effectKind": "drop",
            "effectKey": "equipQuality",
            "valuePerLevel": 0.04,
            "goldBase": 700,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "drop_quality4",
            "label": "探骊",
            "branch": "drop",
            "tier": 4,
            "prereq": [
                "drop_quality3"
            ],
            "maxLevel": 5,
            "effectKind": "drop",
            "effectKey": "equipQuality",
            "valuePerLevel": 0.04,
            "goldBase": 1000,
            "goldGrowth": 1.6,
            "pageCost": 0
        },
        {
            "id": "drop_chest",
            "label": "乾坤袋",
            "branch": "drop",
            "tier": 5,
            "prereq": [
                "drop_quality2"
            ],
            "maxLevel": 1,
            "effectKind": "unlock",
            "effectKey": "chestCapacity",
            "valuePerLevel": 20,
            "goldBase": 1800,
            "goldGrowth": 1,
            "pageCost": 2
        },
        {
            "id": "func_squad3",
            "label": "三才阵",
            "branch": "trunk",
            "tier": 6,
            "prereq": [
                "combat_master",
                "econ_autosell",
                "drop_chest"
            ],
            "maxLevel": 1,
            "effectKind": "unlock",
            "effectKey": "squadSlot3",
            "valuePerLevel": 1,
            "goldBase": 5000,
            "goldGrowth": 1,
            "pageCost": 4
        }
    ],
    "firstClearPages": [
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        4
    ]
};
