// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/config-xlsx/battle.xlsx，然后跑：npm run config
// 源文件：tools/config-xlsx/battle.xlsx
// 生成时间：2026-06-27T04:58:46.035Z

/* eslint-disable */
// @ts-nocheck
export const generatedBattleConfig = {
    "stats": {
        "tank": {
            "hp": 360,
            "atk": 14,
            "def": 10,
            "range": 90,
            "attackSpeed": 1,
            "critRate": 0.05,
            "critDmg": 0.5,
            "dodgeRate": 0,
            "blockRate": 0.3,
            "blockRatio": 0.5,
            "dmgBonus": 0,
            "dmgReduce": 0.1
        },
        "dps": {
            "hp": 90,
            "atk": 28,
            "def": 2,
            "range": 320,
            "attackSpeed": 1.3,
            "critRate": 0.25,
            "critDmg": 1,
            "dodgeRate": 0.05,
            "blockRate": 0,
            "blockRatio": 0,
            "dmgBonus": 0.1,
            "dmgReduce": 0
        },
        "healer": {
            "hp": 120,
            "atk": 0,
            "def": 4,
            "range": 0,
            "attackSpeed": 1,
            "critRate": 0,
            "critDmg": 0.5,
            "dodgeRate": 0.1,
            "blockRate": 0,
            "blockRatio": 0,
            "dmgBonus": 0,
            "dmgReduce": 0
        }
    },
    "enemyTypes": {
        "zombie": {
            "name": "丧尸",
            "speed": 90,
            "radius": 28,
            "attackInterval": 0.8,
            "color": [
                230,
                70,
                70
            ],
            "stats": {
                "hp": 120,
                "atk": 18,
                "def": 4,
                "range": 0,
                "attackSpeed": 1,
                "critRate": 0.05,
                "critDmg": 0.5,
                "dodgeRate": 0.05,
                "blockRate": 0,
                "blockRatio": 0,
                "dmgBonus": 0,
                "dmgReduce": 0
            }
        },
        "runner": {
            "name": "疾行者",
            "speed": 175,
            "radius": 22,
            "attackInterval": 0.6,
            "color": [
                240,
                150,
                60
            ],
            "stats": {
                "hp": 70,
                "atk": 14,
                "def": 2,
                "range": 0,
                "attackSpeed": 1.4,
                "critRate": 0.05,
                "critDmg": 0.5,
                "dodgeRate": 0.15,
                "blockRate": 0,
                "blockRatio": 0,
                "dmgBonus": 0,
                "dmgReduce": 0
            }
        },
        "brute": {
            "name": "重装",
            "speed": 55,
            "radius": 40,
            "attackInterval": 1.2,
            "color": [
                170,
                80,
                200
            ],
            "stats": {
                "hp": 360,
                "atk": 30,
                "def": 12,
                "range": 0,
                "attackSpeed": 0.8,
                "critRate": 0.05,
                "critDmg": 0.5,
                "dodgeRate": 0,
                "blockRate": 0,
                "blockRatio": 0,
                "dmgBonus": 0,
                "dmgReduce": 0.15
            }
        }
    },
    "levels": [
        {
            "name": "第1关 · 试炼",
            "waveGap": 2,
            "waves": [
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 6,
                            "interval": 0.7
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 8,
                            "interval": 0.5
                        },
                        {
                            "type": "runner",
                            "count": 3,
                            "interval": 1.2
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 2,
                            "interval": 1.6
                        },
                        {
                            "type": "zombie",
                            "count": 8,
                            "interval": 0.45
                        }
                    ]
                }
            ]
        },
        {
            "name": "第2关 · 猛攻",
            "waveGap": 1.8,
            "waves": [
                {
                    "spawns": [
                        {
                            "type": "runner",
                            "count": 8,
                            "interval": 0.45
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 12,
                            "interval": 0.4,
                            "hp": 180
                        },
                        {
                            "type": "runner",
                            "count": 4,
                            "interval": 1
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 4,
                            "interval": 1.3,
                            "hp": 460
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 3,
                            "interval": 1.5,
                            "hp": 460
                        },
                        {
                            "type": "runner",
                            "count": 8,
                            "interval": 0.4
                        },
                        {
                            "type": "zombie",
                            "count": 10,
                            "interval": 0.4
                        }
                    ]
                }
            ]
        }
    ],
    "startLevel": 0,
    "combat": {
        "minDamageRate": 0.1
    },
    "classes": {
        "tank": {
            "attackType": "melee",
            "fireInterval": 0.5,
            "moveSpeed": 300,
            "advanceLimit": 80,
            "healPerSec": 0,
            "size": 74
        },
        "dps": {
            "attackType": "ranged",
            "fireInterval": 0.33,
            "moveSpeed": 0,
            "advanceLimit": 0,
            "healPerSec": 0,
            "size": 52
        },
        "healer": {
            "attackType": "heal",
            "fireInterval": 0,
            "moveSpeed": 0,
            "advanceLimit": 0,
            "healPerSec": 16,
            "size": 52
        }
    },
    "roster": [
        "tank",
        "dps",
        "healer"
    ],
    "layout": {
        "frontMargin": 360,
        "spacing": 110
    },
    "bullet": {
        "speed": 1100,
        "radius": 8
    },
    "formation": {
        "contactGap": 150
    },
    "scene": {
        "horizonY": 40,
        "skyTop": [
            95,
            160,
            235
        ],
        "skyBottom": [
            180,
            215,
            250
        ],
        "groundTop": [
            120,
            185,
            95
        ],
        "groundBottom": [
            70,
            120,
            55
        ],
        "cloud": {
            "count": 5,
            "color": [
                255,
                255,
                255
            ],
            "speed": 16
        },
        "hill": {
            "color": [
                80,
                140,
                110
            ],
            "speed": 22
        },
        "groundScroll": 90
    }
};
