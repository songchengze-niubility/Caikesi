// craft.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/craft.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/craft.xlsx');

// 3 档，材料需求对齐现有材料稀有度：打造石处处产、宝石碎片需 boss 箱、铭文粉尘需章节箱。
const TIERS_HEADER = ['tierId', 'label', 'levelMin', 'levelMax', 'costForgeStone', 'costGemShard', 'costRuneDust'];
const TIERS_ROWS: (string | number)[][] = [
    ['tier_1', '初阶', 1, 10, 10, 0, 0],
    ['tier_2', '中阶', 11, 20, 20, 3, 0],
    ['tier_3', '高阶', 21, 30, 30, 6, 2],
];

// 档位越高，权重越往史诗/传说偏。
const QUALITY_WEIGHTS_HEADER = ['tierId', 'quality', 'weight'];
const QUALITY_WEIGHTS_ROWS: (string | number)[][] = [
    ['tier_1', 'common', 60],
    ['tier_1', 'fine', 30],
    ['tier_1', 'rare', 9],
    ['tier_1', 'epic', 1],
    ['tier_1', 'legend', 0],
    ['tier_2', 'common', 20],
    ['tier_2', 'fine', 40],
    ['tier_2', 'rare', 30],
    ['tier_2', 'epic', 9],
    ['tier_2', 'legend', 1],
    ['tier_3', 'common', 0],
    ['tier_3', 'fine', 10],
    ['tier_3', 'rare', 35],
    ['tier_3', 'epic', 40],
    ['tier_3', 'legend', 15],
];

const wb = XLSX.utils.book_new();

function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}

addSheet('Tiers', TIERS_HEADER, TIERS_ROWS);
addSheet('QualityWeights', QUALITY_WEIGHTS_HEADER, QUALITY_WEIGHTS_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Tiers(${TIERS_ROWS.length}) QualityWeights(${QUALITY_WEIGHTS_ROWS.length})`);
