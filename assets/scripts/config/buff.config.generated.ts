// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/config-xlsx/buff.xlsx，然后跑：npm run config
// 源文件：tools/config-xlsx/buff.xlsx
// 生成时间：2026-07-11T07:07:05.201Z

/* eslint-disable */
// @ts-nocheck
export const generatedBuffConfig = {
    "buffs": [
        {
            "id": "poison",
            "name": "中毒",
            "duration": 6,
            "maxStacks": 3,
            "stackRule": "add",
            "period": 1,
            "periodicEffect": {
                "kind": "damage",
                "mult": 0.15
            },
            "statMods": [
                {
                    "key": "def",
                    "flat": -2,
                    "pct": 0
                }
            ],
            "flags": [],
            "dispelTag": "debuff"
        },
        {
            "id": "battle_cry",
            "name": "战吼",
            "duration": 5,
            "maxStacks": 1,
            "stackRule": "refresh",
            "period": 0,
            "periodicEffect": null,
            "statMods": [
                {
                    "key": "atk",
                    "flat": 0,
                    "pct": 0.25
                }
            ],
            "flags": [],
            "dispelTag": "buff"
        },
        {
            "id": "stone_skin",
            "name": "石肤",
            "duration": 8,
            "maxStacks": 1,
            "stackRule": "refresh",
            "period": 0,
            "periodicEffect": null,
            "statMods": [
                {
                    "key": "def",
                    "flat": 6,
                    "pct": 0
                },
                {
                    "key": "dmgReduce",
                    "flat": 0.1,
                    "pct": 0
                }
            ],
            "flags": [],
            "dispelTag": "buff"
        },
        {
            "id": "stun",
            "name": "眩晕",
            "duration": 1.5,
            "maxStacks": 1,
            "stackRule": "refresh",
            "period": 0,
            "periodicEffect": null,
            "statMods": [],
            "flags": [
                "stun"
            ],
            "dispelTag": "debuff"
        },
        {
            "id": "taunt_shout",
            "name": "挑衅",
            "duration": 3,
            "maxStacks": 1,
            "stackRule": "refresh",
            "period": 0,
            "periodicEffect": null,
            "statMods": [],
            "flags": [
                "taunt"
            ],
            "dispelTag": "buff"
        },
        {
            "id": "silence_seal",
            "name": "沉默",
            "duration": 3,
            "maxStacks": 1,
            "stackRule": "refresh",
            "period": 0,
            "periodicEffect": null,
            "statMods": [],
            "flags": [
                "silence"
            ],
            "dispelTag": "debuff"
        },
        {
            "id": "frost",
            "name": "冰缓",
            "duration": 3,
            "maxStacks": 1,
            "stackRule": "refresh",
            "period": 0,
            "periodicEffect": null,
            "statMods": [
                {
                    "key": "moveSpeed",
                    "flat": 0,
                    "pct": -0.3
                }
            ],
            "flags": [],
            "dispelTag": "debuff"
        },
        {
            "id": "war_banner",
            "name": "战旗",
            "duration": -1,
            "maxStacks": 1,
            "stackRule": "refresh",
            "period": 0,
            "periodicEffect": null,
            "statMods": [
                {
                    "key": "atk",
                    "flat": 0,
                    "pct": 0.05
                }
            ],
            "flags": [],
            "dispelTag": ""
        }
    ]
};
