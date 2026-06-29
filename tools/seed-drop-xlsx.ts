// drop.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/drop.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/drop.xlsx');

const DROP_GROUPS_HEADER = ['group', 'itemCount', 'qualityGroup', 'slotGroup'];
const DROP_GROUPS_ROWS: (string | number)[][] = [
    ['level_1', 1, 'level_1', 'any'],
    ['level_2', 1, 'level_2', 'any'],
];

const QUALITY_WEIGHTS_HEADER = ['group', 'quality', 'weight'];
const QUALITY_WEIGHTS_ROWS: (string | number)[][] = [
    ['level_1', 'common', 65],
    ['level_1', 'fine', 25],
    ['level_1', 'rare', 9],
    ['level_1', 'epic', 1],
    ['level_1', 'legend', 0],
    ['level_2', 'common', 50],
    ['level_2', 'fine', 30],
    ['level_2', 'rare', 15],
    ['level_2', 'epic', 4],
    ['level_2', 'legend', 1],
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
