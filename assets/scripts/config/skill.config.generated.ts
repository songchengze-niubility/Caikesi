// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/config-xlsx/skill.xlsx，然后跑：npm run config
// 源文件：tools/config-xlsx/skill.xlsx
// 生成时间：2026-07-11T07:10:07.269Z

/* eslint-disable */
// @ts-nocheck
export const generatedSkillConfig = {
    "skills": [
        {
            "id": "whirlwind",
            "name": "旋风斩",
            "cls": "dps",
            "trigger": "attackCount",
            "triggerValue": 10,
            "target": "aoe",
            "radius": 220,
            "maxTargets": 0,
            "effects": [
                {
                    "kind": "damage",
                    "mult": 0.8
                }
            ],
            "delivery": null
        },
        {
            "id": "lethal_strike",
            "name": "致命一击",
            "cls": "dps",
            "trigger": "attackCount",
            "triggerValue": 15,
            "target": "single",
            "radius": 0,
            "maxTargets": 0,
            "effects": [
                {
                    "kind": "damage",
                    "mult": 3.5
                }
            ],
            "delivery": null
        }
    ],
    "passives": [
        {
            "id": "tank_stoneskin",
            "name": "坚壁",
            "cls": "tank",
            "trigger": "onHurt",
            "chance": 0.15,
            "targetMode": "self",
            "effects": [
                {
                    "kind": "applyBuff",
                    "buffId": "stone_skin",
                    "stacks": 1
                }
            ]
        },
        {
            "id": "healer_banner",
            "name": "战旗光环",
            "cls": "healer",
            "trigger": "always",
            "chance": 1,
            "targetMode": "team",
            "effects": [
                {
                    "kind": "applyBuff",
                    "buffId": "war_banner",
                    "stacks": 1
                }
            ]
        }
    ]
};
