// equip.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/equip.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { derivedValues } from './balance-model/derived.values.generated';
import { TPL } from './balance-model/templates';

const OUT = resolve(__dirname, 'config-xlsx/equip.xlsx');

// 框架接管：一级平铺（hp/atk/def/moveSpeed 及其百分比）× primaryScale（balance:derive 反解装备 50% 份额）。
// 暴击/伤害类等二级词条保持手填值（概率型数值不随战力盘子线性放大）。
const K = derivedValues.equip.primaryScale;
const PRIMARY = new Set(['hp', 'atk', 'def', 'moveSpeed']);
const PRIMARY_PCT = new Set(['hpPct', 'atkPct', 'defPct', 'moveSpeedPct']);
function scaled(stat: string, value: number): number {
    if (PRIMARY.has(stat)) return Math.round(value * K);
    if (PRIMARY_PCT.has(stat)) return Number((value * K).toFixed(4));
    return value;
}

const QUALITIES_HEADER = ['quality', 'label', 'multiplier', 'rollMin', 'rollMax', 'extraStats'];
const QUALITIES_ROWS: (string | number)[][] = [
    ['common', '普通', 1.00, 0.90, 1.10, 0],
    ['fine', '优秀', 1.35, 0.88, 1.12, 0],
    ['rare', '精良', 1.80, 0.86, 1.14, 1],
    ['epic', '史诗', 2.40, 0.84, 1.16, 2],
    ['legend', '传说', 3.20, 0.82, 1.18, 3],
];

// value 是该部位的基础加成；实际掉落 = value × 品质倍率 × 随机 roll。
// 形状（部位/词条池的相对比例）在 tools/balance-model/templates.ts 单一真源；此处只做缩放落表。
const SLOT_BONUSES_HEADER = ['slot', 'stat', 'value'];
const SLOT_BONUSES_ROWS: (string | number)[][] = TPL.slotBonuses.map(r => [...r]);

// 高品质装备额外抽取的词条池；实际加成同样吃品质倍率和随机 roll。
const AFFIXES_HEADER = ['stat', 'value'];
const AFFIXES_ROWS: (string | number)[][] = TPL.affixes.map(r => [...r]);

// 装备等级 → 属性系数：levelCoefficient = 1 + (level-1) × growthPerLevel。
const LEVEL_SCALING_HEADER = ['key', 'value'];
const LEVEL_SCALING_ROWS: (string | number)[][] = [
    ['growthPerLevel', 0.03],
    ['maxLevel', 30],
];

const wb = XLSX.utils.book_new();

function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}

// 一级平铺经框架缩放后落表（手填值 × primaryScale；二级词条原样）
const SLOT_BONUSES_SCALED = SLOT_BONUSES_ROWS.map(([slot, stat, value]) => [slot, stat, scaled(stat as string, value as number)]);
const AFFIXES_SCALED = AFFIXES_ROWS.map(([stat, value]) => [stat, scaled(stat as string, value as number)]);

addSheet('Qualities', QUALITIES_HEADER, QUALITIES_ROWS);
addSheet('SlotBonuses', SLOT_BONUSES_HEADER, SLOT_BONUSES_SCALED);
addSheet('Affixes', AFFIXES_HEADER, AFFIXES_SCALED);
addSheet('LevelScaling', LEVEL_SCALING_HEADER, LEVEL_SCALING_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Qualities(${QUALITIES_ROWS.length}) SlotBonuses(${SLOT_BONUSES_ROWS.length}) Affixes(${AFFIXES_ROWS.length}) LevelScaling(${LEVEL_SCALING_ROWS.length})`);
