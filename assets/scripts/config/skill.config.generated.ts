// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/config-xlsx/skill.xlsx，然后跑：npm run config
// 源文件：tools/config-xlsx/skill.xlsx
// 生成时间：2026-07-05T02:35:28.854Z

/* eslint-disable */
// @ts-nocheck
export const generatedSkillConfig = {
    "skills": [
        {
            "id": "whirlwind",
            "name": "旋风斩",
            "cls": "dps",
            "trigger": "attackCount",
            "triggerValue": 8,
            "target": "aoe",
            "radius": 220,
            "maxTargets": 0,
            "dmgMult": 1.2
        },
        {
            "id": "ground_smash",
            "name": "裂地击",
            "cls": "dps",
            "trigger": "timer",
            "triggerValue": 7,
            "target": "nearest",
            "radius": 0,
            "maxTargets": 3,
            "dmgMult": 1.8
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
            "dmgMult": 4
        }
    ]
};
