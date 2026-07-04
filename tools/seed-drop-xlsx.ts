// drop.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/drop.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/drop.xlsx');

const DROP_GROUPS_HEADER = ['group', 'itemCount', 'qualityGroup', 'slotGroup', 'levelMin', 'levelMax'];
const DROP_GROUPS_ROWS: (string | number)[][] = [
    // 第一章按台阶分段：1~3 / 4~6 / 7~9 / 10(Boss)；等级区间相邻重叠保证成长平滑
    ['c1_early', 1, 'c1_early', 'any', 1, 5],
    ['c1_mid',   1, 'c1_mid',   'any', 4, 9],
    ['c1_late',  1, 'c1_late',  'any', 8, 14],
    ['c1_boss',  2, 'c1_boss',  'any', 12, 18],
];

const QUALITY_WEIGHTS_HEADER = ['group', 'quality', 'weight'];
const QUALITY_WEIGHTS_ROWS: (string | number)[][] = [
    ['c1_early', 'common', 65],
    ['c1_early', 'fine', 25],
    ['c1_early', 'rare', 9],
    ['c1_early', 'epic', 1],
    ['c1_early', 'legend', 0],
    ['c1_mid', 'common', 50],
    ['c1_mid', 'fine', 30],
    ['c1_mid', 'rare', 15],
    ['c1_mid', 'epic', 4],
    ['c1_mid', 'legend', 1],
    ['c1_late', 'common', 35],
    ['c1_late', 'fine', 35],
    ['c1_late', 'rare', 22],
    ['c1_late', 'epic', 7],
    ['c1_late', 'legend', 1],
    ['c1_boss', 'common', 15],
    ['c1_boss', 'fine', 30],
    ['c1_boss', 'rare', 35],
    ['c1_boss', 'epic', 17],
    ['c1_boss', 'legend', 3],
];

const SLOT_WEIGHTS_HEADER = ['group', 'slot', 'weight'];
const SLOT_WEIGHTS_ROWS: (string | number)[][] = [
    ['any', 'weapon', 1],
    ['any', 'helmet', 1],
    ['any', 'chest', 1],
    ['any', 'pants', 1],
    ['any', 'shoes', 1],
];

const wb = XLSX.utils.book_new();

function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}

addSheet('DropGroups', DROP_GROUPS_HEADER, DROP_GROUPS_ROWS);
addSheet('QualityWeights', QUALITY_WEIGHTS_HEADER, QUALITY_WEIGHTS_ROWS);
addSheet('SlotWeights', SLOT_WEIGHTS_HEADER, SLOT_WEIGHTS_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: DropGroups(${DROP_GROUPS_ROWS.length}) QualityWeights(${QUALITY_WEIGHTS_ROWS.length}) SlotWeights(${SLOT_WEIGHTS_ROWS.length})`);
