// battle.xlsx 种子脚本（一次性）—— 用当前 BattleConfig 数值生成初始 Excel。
// 用途：本次管线搭建时用，跑 `npx tsx tools/seed-battle-xlsx.ts` 生成 tools/config-xlsx/battle.xlsx。
// 之后策划在 Excel 里直接编辑该 xlsx；这个脚本只在「从零重建 xlsx」时才再跑（极少）。
//
// 数值来源：assets/scripts/config/BattleConfig.ts（2026-06-27 快照），逐字段核对一致。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/battle.xlsx');

// —— Stats sheet：角色属性表（class 作行 key，12 个数值属性）——
const STATS_HEADER = ['class', 'hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce'];
const STATS_ROWS: (string | number)[][] = [
    ['tank',   360, 14, 10, 90,  1.0, 0.05, 0.5, 0.0,  0.30, 0.5, 0.0,  0.10],
    ['dps',    90,  28, 2,  320, 1.3, 0.25, 1.0, 0.05, 0.0,  0.0, 0.10, 0.0],
    ['healer', 120, 0,  4,  0,   1.0, 0.0,  0.5, 0.10, 0.0,  0.0, 0.0,  0.0],
];

// —— EnemyTypes sheet：怪物图鉴（type 作行 key；color 用 "r,g,b" 字符串；stats 拍平到同表）——
const ENEMY_HEADER = ['type', 'name', 'speed', 'radius', 'attackInterval', 'color',
    'hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce'];
const ENEMY_ROWS: (string | number)[][] = [
    ['zombie', '丧尸',   90,  28, 0.8, '230,70,70',  120, 18, 4,  0, 1.0, 0.05, 0.5, 0.05, 0.0, 0.0, 0.0, 0.0],
    ['runner', '疾行者', 175, 22, 0.6, '240,150,60', 70,  14, 2,  0, 1.4, 0.05, 0.5, 0.15, 0.0, 0.0, 0.0, 0.0],
    ['brute',  '重装',   55,  40, 1.2, '170,80,200', 360, 30, 12, 0, 0.8, 0.05, 0.5, 0.0,  0.0, 0.0, 0.0, 0.15],
];

// —— Classes sheet：职业行为（class 作行 key；attackType 是字符串枚举）——
const CLASSES_HEADER = ['class', 'attackType', 'fireInterval', 'moveSpeed', 'advanceLimit', 'healPerSec', 'size'];
const CLASSES_ROWS: (string | number)[][] = [
    ['tank',   'melee',  0.5,  300, 80, 0,  74],
    ['dps',    'ranged', 0.33, 0,   0,  0,  52],
    ['healer', 'heal',   0,    0,   0,  16, 52],
];

// —— Levels sheet：关卡，拍平到 spawn-group 粒度 ——
// 列：levelIndex, levelName, waveGap, waveIndex, type, count, interval, hp(可选,空=不覆盖)
const LEVELS_HEADER = ['levelIndex', 'levelName', 'waveGap', 'waveIndex', 'type', 'count', 'interval', 'hp'];
const LEVELS_ROWS: (string | number)[][] = [
    // 第1关
    [0, '第1关 · 试炼', 2.0, 0, 'zombie', 6,  0.7,  ''],
    [0, '第1关 · 试炼', 2.0, 1, 'zombie', 8,  0.5,  ''],
    [0, '第1关 · 试炼', 2.0, 1, 'runner', 3,  1.2,  ''],
    [0, '第1关 · 试炼', 2.0, 2, 'brute',  2,  1.6,  ''],
    [0, '第1关 · 试炼', 2.0, 2, 'zombie', 8,  0.45, ''],
    // 第2关
    [1, '第2关 · 猛攻', 1.8, 0, 'runner', 8,  0.45, ''],
    [1, '第2关 · 猛攻', 1.8, 1, 'zombie', 12, 0.4,  180],
    [1, '第2关 · 猛攻', 1.8, 1, 'runner', 4,  1.0,  ''],
    [1, '第2关 · 猛攻', 1.8, 2, 'brute',  4,  1.3,  460],
    [1, '第2关 · 猛攻', 1.8, 3, 'brute',  3,  1.5,  460],
    [1, '第2关 · 猛攻', 1.8, 3, 'runner', 8,  0.4,  ''],
    [1, '第2关 · 猛攻', 1.8, 3, 'zombie', 10, 0.4,  ''],
];

// —— Misc sheet：散落标量/键值（点分 key）——
const MISC_HEADER = ['key', 'value'];
const MISC_ROWS: (string | number)[][] = [
    ['startLevel', 0],
    ['combat.minDamageRate', 0.1],
    ['layout.frontMargin', 360],
    ['layout.spacing', 110],
    ['bullet.speed', 1100],
    ['bullet.radius', 8],
    ['formation.contactGap', 150],
];

// —— Scene sheet：场景背景参数（点分 key；颜色用 "r,g,b"）——
const SCENE_HEADER = ['key', 'value'];
const SCENE_ROWS: (string | number)[][] = [
    ['horizonY', 40],
    ['skyTop', '95,160,235'],
    ['skyBottom', '180,215,250'],
    ['groundTop', '120,185,95'],
    ['groundBottom', '70,120,55'],
    ['cloud.count', 5],
    ['cloud.color', '255,255,255'],
    ['cloud.speed', 16],
    ['hill.color', '80,140,110'],
    ['hill.speed', 22],
    ['groundScroll', 90],
];

// —— 组装 workbook ——
const wb = XLSX.utils.book_new();

function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const aoa = [header, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, name);
}

addSheet('Stats', STATS_HEADER, STATS_ROWS);
addSheet('EnemyTypes', ENEMY_HEADER, ENEMY_ROWS);
addSheet('Classes', CLASSES_HEADER, CLASSES_ROWS);
addSheet('Levels', LEVELS_HEADER, LEVELS_ROWS);
addSheet('Misc', MISC_HEADER, MISC_ROWS);
addSheet('Scene', SCENE_HEADER, SCENE_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
// bookType xlsx；cellDates 不需要（无日期列）
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Stats(${STATS_ROWS.length}) EnemyTypes(${ENEMY_ROWS.length}) Classes(${CLASSES_ROWS.length}) Levels(${LEVELS_ROWS.length}) Misc(${MISC_ROWS.length}) Scene(${SCENE_ROWS.length})`);
