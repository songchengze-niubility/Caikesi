// chest.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/chest.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/chest.xlsx');

const GROUPS_HEADER = ['group', 'mobChance', 'finalChance', 'mobWeightGroup', 'finalWeightGroup'];
const GROUPS_ROWS: (string | number)[][] = [
    ['default',  0.03, 0.35, 'mob_default', 'final_default'],
    ['c1_early', 0.03, 0.35, 'mob_default', 'final_default'],
    ['c1_mid',   0.03, 0.35, 'mob_default', 'final_default'],
    ['c1_late',  0.03, 0.35, 'mob_default', 'final_default'],
    // Boss 关：关底必掉宝箱，走独立权重组（首个章节宝箱产出点）
    ['c1_boss',  0.03, 1.0,  'mob_default', 'final_boss'],
];

const TYPE_WEIGHTS_HEADER = ['group', 'type', 'weight'];
const TYPE_WEIGHTS_ROWS: (string | number)[][] = [
    ['mob_default', 'normal', 95],
    ['mob_default', 'boss', 5],
    ['mob_default', 'chapter', 0],
    ['final_default', 'normal', 65],
    ['final_default', 'boss', 35],
    ['final_default', 'chapter', 0],
    ['final_boss', 'normal', 20],
    ['final_boss', 'boss', 60],
    ['final_boss', 'chapter', 20],
];

// 开箱内容档案（2026-07-11 表化，取代 ChestService.CHEST_REWARD_PROFILE 硬编码；现值原样搬运）。
// forgeStone 实际落袋 = roll[min,max] + floor(来源关卡/2)（关卡加成在 ChestService）；
// gemCount=0 / scrollMax=0 = 该箱型不产出该材料。数值占位，子计划 B 按经济流速反解。
const REWARDS_HEADER = ['chestType', 'equipmentRolls', 'forgeStoneMin', 'forgeStoneMax', 'gemCount', 'gemLevelMin', 'gemLevelMax', 'scrollMin', 'scrollMax'];
// 2026-07-12 宝石砍档（用户拍板）：普通箱不掉宝石，宝石成 Boss/章节箱专属惊喜——
// 毕业期望从 56.8 颗（远超全队 20 孔）降到孔位量级，掉宝更有仪式感。
const REWARDS_ROWS: (string | number)[][] = [
    ['normal',  1, 2, 4,  0, 1, 1, 0, 0],
    ['boss',    2, 4, 8,  2, 1, 2, 1, 1],
    ['chapter', 3, 8, 12, 3, 2, 3, 1, 2],
];

const wb = XLSX.utils.book_new();

function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}

addSheet('Groups', GROUPS_HEADER, GROUPS_ROWS);
addSheet('TypeWeights', TYPE_WEIGHTS_HEADER, TYPE_WEIGHTS_ROWS);
addSheet('Rewards', REWARDS_HEADER, REWARDS_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Groups(${GROUPS_ROWS.length}) TypeWeights(${TYPE_WEIGHTS_ROWS.length}) Rewards(${REWARDS_ROWS.length})`);
