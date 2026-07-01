// offline.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/offline.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/offline.xlsx');

const GLOBAL_HEADER = ['key', 'value'];
const GLOBAL_ROWS: (string | number)[][] = [
    ['maxHours', 8],
    ['efficiency', 0.7],
    ['maxBattles', 240],
];

const LEVELS_HEADER = ['levelIndex', 'avgClearSeconds', 'winRate', 'goldPerWin', 'expPerWin'];
const LEVELS_ROWS: (string | number)[][] = [
    [0, 45, 1, 8, 5],
    [1, 55, 0.95, 12, 8],
];

const wb = XLSX.utils.book_new();

function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}

addSheet('Global', GLOBAL_HEADER, GLOBAL_ROWS);
addSheet('Levels', LEVELS_HEADER, LEVELS_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Global(${GLOBAL_ROWS.length}) Levels(${LEVELS_ROWS.length})`);
