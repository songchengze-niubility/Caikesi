// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/config-xlsx/battle.xlsx，然后跑：npm run config
// 源文件：tools/config-xlsx/battle.xlsx
// 生成时间：2026-07-05T04:46:32.809Z

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
            "hp": 500,
            "atk": 155,
            "def": 2,
            "range": 90,
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
        },
        "boss_butcher": {
            "name": "屠夫领主",
            "speed": 40,
            "radius": 60,
            "attackInterval": 1.5,
            "color": [
                150,
                40,
                40
            ],
            "stats": {
                "hp": 15100,
                "atk": 55,
                "def": 20,
                "range": 0,
                "attackSpeed": 0.8,
                "critRate": 0.05,
                "critDmg": 0.5,
                "dodgeRate": 0,
                "blockRate": 0,
                "blockRatio": 0,
                "dmgBonus": 0,
                "dmgReduce": 0.3
            }
        }
    },
    "levels": [
        {
            "name": "第1关 · 试炼",
            "waveGap": 2,
            "dropGroup": "c1_early",
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
            "name": "第2关 · 前哨",
            "waveGap": 2,
            "dropGroup": "c1_early",
            "waves": [
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 10,
                            "interval": 0.6
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
                            "count": 4,
                            "interval": 1
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
                        },
                        {
                            "type": "runner",
                            "count": 3,
                            "interval": 1
                        }
                    ]
                }
            ]
        },
        {
            "name": "第3关 · 溃堤",
            "waveGap": 1.9,
            "dropGroup": "c1_early",
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
                            "hp": 150
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
                            "count": 3,
                            "interval": 1.5
                        },
                        {
                            "type": "zombie",
                            "count": 10,
                            "interval": 0.4
                        },
                        {
                            "type": "runner",
                            "count": 4,
                            "interval": 0.8
                        }
                    ]
                }
            ]
        },
        {
            "name": "第4关 · 铁壁",
            "waveGap": 1.8,
            "dropGroup": "c1_mid",
            "waves": [
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 10,
                            "interval": 0.5,
                            "hp": 330
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 4,
                            "interval": 1.3,
                            "hp": 790
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 3,
                            "interval": 1.4,
                            "hp": 790
                        },
                        {
                            "type": "runner",
                            "count": 6,
                            "interval": 0.8,
                            "hp": 155
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 4,
                            "interval": 1.2,
                            "hp": 1010
                        },
                        {
                            "type": "zombie",
                            "count": 8,
                            "interval": 0.4,
                            "hp": 330
                        }
                    ]
                }
            ]
        },
        {
            "name": "第5关 · 缓坡",
            "waveGap": 1.8,
            "dropGroup": "c1_mid",
            "waves": [
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 14,
                            "interval": 0.45,
                            "hp": 300
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "runner",
                            "count": 10,
                            "interval": 0.5,
                            "hp": 180
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 3,
                            "interval": 1.4,
                            "hp": 920
                        },
                        {
                            "type": "zombie",
                            "count": 10,
                            "interval": 0.4,
                            "hp": 300
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 2,
                            "interval": 1.5,
                            "hp": 920
                        },
                        {
                            "type": "runner",
                            "count": 10,
                            "interval": 0.5,
                            "hp": 180
                        }
                    ]
                }
            ]
        },
        {
            "name": "第6关 · 夹击",
            "waveGap": 1.8,
            "dropGroup": "c1_mid",
            "waves": [
                {
                    "spawns": [
                        {
                            "type": "runner",
                            "count": 12,
                            "interval": 0.4,
                            "hp": 155
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 14,
                            "interval": 0.4,
                            "hp": 275
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 4,
                            "interval": 1.3,
                            "hp": 780
                        },
                        {
                            "type": "runner",
                            "count": 6,
                            "interval": 0.7,
                            "hp": 155
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 3,
                            "interval": 1.4,
                            "hp": 780
                        },
                        {
                            "type": "zombie",
                            "count": 12,
                            "interval": 0.4,
                            "hp": 275
                        }
                    ]
                }
            ]
        },
        {
            "name": "第7关 · 壁垒",
            "waveGap": 1.6,
            "dropGroup": "c1_late",
            "waves": [
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 12,
                            "interval": 0.4,
                            "hp": 770
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 4,
                            "interval": 1.2,
                            "hp": 2168
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "runner",
                            "count": 12,
                            "interval": 0.4,
                            "hp": 426
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 4,
                            "interval": 1.2,
                            "hp": 2168
                        },
                        {
                            "type": "zombie",
                            "count": 10,
                            "interval": 0.4,
                            "hp": 770
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 2,
                            "interval": 1.4,
                            "hp": 2168
                        },
                        {
                            "type": "runner",
                            "count": 6,
                            "interval": 0.6,
                            "hp": 426
                        }
                    ]
                }
            ]
        },
        {
            "name": "第8关 · 风暴",
            "waveGap": 1.6,
            "dropGroup": "c1_late",
            "waves": [
                {
                    "spawns": [
                        {
                            "type": "runner",
                            "count": 14,
                            "interval": 0.35,
                            "hp": 200
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 16,
                            "interval": 0.35,
                            "hp": 360
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 4,
                            "interval": 1.2,
                            "hp": 1010
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 12,
                            "interval": 0.4,
                            "hp": 360
                        },
                        {
                            "type": "runner",
                            "count": 8,
                            "interval": 0.5,
                            "hp": 200
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 3,
                            "interval": 1.3,
                            "hp": 1010
                        },
                        {
                            "type": "runner",
                            "count": 6,
                            "interval": 0.6,
                            "hp": 200
                        }
                    ]
                }
            ]
        },
        {
            "name": "第9关 · 黑潮",
            "waveGap": 1.6,
            "dropGroup": "c1_late",
            "waves": [
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 14,
                            "interval": 0.35,
                            "hp": 420
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 4,
                            "interval": 1.2,
                            "hp": 1140
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "runner",
                            "count": 14,
                            "interval": 0.35,
                            "hp": 230
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 4,
                            "interval": 1.2,
                            "hp": 1140
                        },
                        {
                            "type": "zombie",
                            "count": 10,
                            "interval": 0.4,
                            "hp": 420
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 2,
                            "interval": 1.4,
                            "hp": 1140
                        },
                        {
                            "type": "runner",
                            "count": 8,
                            "interval": 0.5,
                            "hp": 230
                        }
                    ]
                }
            ]
        },
        {
            "name": "第10关 · 屠夫领主",
            "waveGap": 1.8,
            "dropGroup": "c1_boss",
            "waves": [
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 14,
                            "interval": 0.35,
                            "hp": 805
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "runner",
                            "count": 12,
                            "interval": 0.4,
                            "hp": 405
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "brute",
                            "count": 4,
                            "interval": 1.2,
                            "hp": 2015
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "zombie",
                            "count": 12,
                            "interval": 0.4,
                            "hp": 805
                        },
                        {
                            "type": "runner",
                            "count": 8,
                            "interval": 0.5,
                            "hp": 405
                        }
                    ]
                },
                {
                    "spawns": [
                        {
                            "type": "boss_butcher",
                            "count": 1,
                            "interval": 1,
                            "hp": 36000
                        },
                        {
                            "type": "runner",
                            "count": 6,
                            "interval": 0.8,
                            "hp": 405
                        }
                    ]
                }
            ]
        }
    ],
    "startLevel": 0,
    "squadCap": 2,
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
            "attackType": "melee",
            "fireInterval": 0.33,
            "moveSpeed": 300,
            "advanceLimit": 80,
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
        "dps"
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
