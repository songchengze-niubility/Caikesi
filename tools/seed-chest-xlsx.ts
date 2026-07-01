// chest.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/chest.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/chest.xlsx');

const GROUPS_HEADER = ['group', 'mobChance', 'finalChance', 'mobWeightGroup', 'finalWeightGroup'];
const GROUPS_ROWS: (string | number)[][] = [
    ['default', 0.03, 0.35, 'mob_default', 'final_default'],
    ['level_1', 0.03, 0.35, 'mob_default', 'final_default'],
    ['level_2', 0.03, 0.35, 'mob_default', 'final_default'],
];

const TYPE_WEIGHTS_HEADER = ['group', 'type', 'weight'];
const TYPE_WEIGHTS_ROWS: (string | number)[][] = [
    ['mob_default', 'normal', 95],
    ['mob_default', 'boss', 5],
    ['mob_default', 'chapter', 0],
    ['final_default', 'normal', 65],
    ['final_default', 'boss', 35],
    ['final_default', 'chapter', 0],
];

const wb = XLSX.utils.book_new();

function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}

addSheet('Groups', GROUPS_HEADER, GROUPS_ROWS);
addSheet('TypeWeights', TYPE_WEIGHTS_HEADER, TYPE_WEIGHTS_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Groups(${GROUPS_ROWS.length}) TypeWeights(${TYPE_WEIGHTS_ROWS.length})`);
