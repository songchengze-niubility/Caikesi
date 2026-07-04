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
    // 台阶关（第4/7/10 = levelIndex 3/6/9）胜率下调，体现卡点
    [0, 45,  1,    8,  5],
    [1, 50,  0.95, 10, 7],
    [2, 60,  0.9,  13, 9],
    [3, 75,  0.85, 17, 12],
    [4, 80,  0.9,  22, 15],
    [5, 90,  0.88, 28, 20],
    [6, 100, 0.75, 36, 26],
    [7, 105, 0.82, 47, 33],
    [8, 115, 0.8,  60, 43],
    [9, 120, 0.6,  78, 56],
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
