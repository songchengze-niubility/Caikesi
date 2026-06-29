// equip.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/equip.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/equip.xlsx');

const QUALITIES_HEADER = ['quality', 'label', 'multiplier', 'rollMin', 'rollMax', 'extraStats'];
const QUALITIES_ROWS: (string | number)[][] = [
    ['common', '普通', 1.00, 0.90, 1.10, 0],
    ['fine', '优秀', 1.35, 0.88, 1.12, 0],
    ['rare', '精良', 1.80, 0.86, 1.14, 1],
    ['epic', '史诗', 2.40, 0.84, 1.16, 2],
    ['legend', '传说', 3.20, 0.82, 1.18, 3],
];

// value 是该部位的基础加成；实际掉落 = value × 品质倍率 × 随机 roll。
const SLOT_BONUSES_HEADER = ['slot', 'stat', 'value'];
const SLOT_BONUSES_ROWS: (string | number)[][] = [
    ['weapon', 'atk', 12],
    ['weapon', 'critRate', 0.02],
    ['helmet', 'hp', 40],
    ['helmet', 'def', 2],
    ['chest', 'hp', 60],
    ['chest', 'def', 4],
    ['chest', 'dmgReduce', 0.02],
    ['pants', 'hp', 45],
    ['pants', 'dodgeRate', 0.015],
    ['shoes', 'range', 20],
    ['shoes', 'attackSpeed', 0.08],
];

// 高品质装备额外抽取的词条池；实际加成同样吃品质倍率和随机 roll。
const AFFIXES_HEADER = ['stat', 'value'];
const AFFIXES_ROWS: (string | number)[][] = [
    ['hp', 28],
    ['atk', 5],
    ['def', 1.5],
    ['range', 10],
    ['attackSpeed', 0.03],
    ['critRate', 0.012],
    ['critDmg', 0.04],
    ['dodgeRate', 0.01],
    ['blockRate', 0.012],
    ['dmgBonus', 0.012],
    ['dmgReduce', 0.01],
];

const wb = XLSX.utils.book_new();

function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}

addSheet('Qualities', QUALITIES_HEADER, QUALITIES_ROWS);
addSheet('SlotBonuses', SLOT_BONUSES_HEADER, SLOT_BONUSES_ROWS);
addSheet('Affixes', AFFIXES_HEADER, AFFIXES_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Qualities(${QUALITIES_ROWS.length}) SlotBonuses(${SLOT_BONUSES_ROWS.length}) Affixes(${AFFIXES_ROWS.length})`);
