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
    ['dps',    90,  28, 2,  90,  1.3, 0.25, 1.0, 0.05, 0.0,  0.0, 0.10, 0.0],
    ['healer', 120, 0,  4,  0,   1.0, 0.0,  0.5, 0.10, 0.0,  0.0, 0.0,  0.0],
];

// —— EnemyTypes sheet：怪物图鉴（type 作行 key；color 用 "r,g,b" 字符串；stats 拍平到同表）——
const ENEMY_HEADER = ['type', 'name', 'speed', 'radius', 'attackInterval', 'color',
    'hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce'];
const ENEMY_ROWS: (string | number)[][] = [
    ['zombie', '丧尸',   90,  28, 0.8, '230,70,70',  120, 18, 4,  0, 1.0, 0.05, 0.5, 0.05, 0.0, 0.0, 0.0, 0.0],
    ['runner', '疾行者', 175, 22, 0.6, '240,150,60', 70,  14, 2,  0, 1.4, 0.05, 0.5, 0.15, 0.0, 0.0, 0.0, 0.0],
    ['brute',  '重装',   55,  40, 1.2, '170,80,200', 360, 30, 12, 0, 0.8, 0.05, 0.5, 0.0,  0.0, 0.0, 0.0, 0.15],
    // 第一章 Boss：纯数值型大体型（约普通重装 12.5 倍血、高减免），无技能机制
    ['boss_butcher', '屠夫领主', 40, 60, 1.5, '150,40,40', 4500, 55, 20, 0, 0.8, 0.05, 0.5, 0.0, 0.0, 0.0, 0.0, 0.30],
];

// —— Classes sheet：职业行为（class 作行 key；attackType 是字符串枚举）——
const CLASSES_HEADER = ['class', 'attackType', 'fireInterval', 'moveSpeed', 'advanceLimit', 'healPerSec', 'size'];
const CLASSES_ROWS: (string | number)[][] = [
    ['tank',   'melee',  0.5,  300, 80, 0,  74],
    ['dps',    'melee',  0.33, 300, 80, 0,  52],
    ['healer', 'heal',   0,    0,   0,  16, 52],
];

// —— Levels sheet：关卡，拍平到 spawn-group 粒度 ——
// 列：levelIndex, levelName, waveGap, dropGroup, waveIndex, type, count, interval, hp(可选,空=不覆盖)
const LEVELS_HEADER = ['levelIndex', 'levelName', 'waveGap', 'dropGroup', 'waveIndex', 'type', 'count', 'interval', 'hp'];
const LEVELS_ROWS: (string | number)[][] = [
    // 第一章 10 关，台阶卡点在第 4/7/10 关（levelIndex 3/6/9）。
    // 行内注释是每关总血量占位强度（相对第 1 关 3570 的倍数），调参锚点非承诺值。
    // 第1关 · 试炼 —— 3570（×1.0 基准）
    [0, '第1关 · 试炼', 2.0, 'c1_early', 0, 'zombie', 6,  0.7,  ''],
    [0, '第1关 · 试炼', 2.0, 'c1_early', 1, 'zombie', 8,  0.5,  ''],
    [0, '第1关 · 试炼', 2.0, 'c1_early', 1, 'runner', 3,  1.2,  ''],
    [0, '第1关 · 试炼', 2.0, 'c1_early', 2, 'brute',  2,  1.6,  ''],
    [0, '第1关 · 试炼', 2.0, 'c1_early', 2, 'zombie', 8,  0.45, ''],
    // 第2关 · 前哨 —— ≈4330（×1.2）
    [1, '第2关 · 前哨', 2.0, 'c1_early', 0, 'zombie', 10, 0.6,  ''],
    [1, '第2关 · 前哨', 2.0, 'c1_early', 1, 'zombie', 8,  0.5,  ''],
    [1, '第2关 · 前哨', 2.0, 'c1_early', 1, 'runner', 4,  1.0,  ''],
    [1, '第2关 · 前哨', 2.0, 'c1_early', 2, 'brute',  2,  1.6,  ''],
    [1, '第2关 · 前哨', 2.0, 'c1_early', 2, 'zombie', 8,  0.45, ''],
    [1, '第2关 · 前哨', 2.0, 'c1_early', 2, 'runner', 3,  1.0,  ''],
    // 第3关 · 溃堤 —— ≈5200（×1.46）
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 0, 'runner', 8,  0.45, ''],
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 1, 'zombie', 12, 0.4,  150],
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 1, 'runner', 4,  1.0,  ''],
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 2, 'brute',  3,  1.5,  ''],
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 2, 'zombie', 10, 0.4,  ''],
    [2, '第3关 · 溃堤', 1.9, 'c1_early', 2, 'runner', 4,  0.8,  ''],
    // 第4关 · 铁壁 —— ≈7480（×2.1，台阶一：重装比例突增，检查 1~3 段装备）
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 0, 'zombie', 10, 0.5,  150],
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 1, 'brute',  4,  1.3,  ''],
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 2, 'brute',  3,  1.4,  ''],
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 2, 'runner', 6,  0.8,  ''],
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 3, 'brute',  4,  1.2,  460],
    [3, '第4关 · 铁壁', 1.8, 'c1_mid', 3, 'zombie', 8,  0.4,  150],
    // 第5关 · 缓坡 —— ≈7700（×2.16）
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 0, 'zombie', 14, 0.45, 150],
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 1, 'runner', 10, 0.5,  90],
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 2, 'brute',  3,  1.4,  460],
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 2, 'zombie', 10, 0.4,  150],
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 3, 'brute',  2,  1.5,  460],
    [4, '第5关 · 缓坡', 1.8, 'c1_mid', 3, 'runner', 10, 0.5,  90],
    // 第6关 · 夹击 —— ≈9000（×2.52）
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 0, 'runner', 12, 0.4,  90],
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 1, 'zombie', 14, 0.4,  160],
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 2, 'brute',  4,  1.3,  460],
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 2, 'runner', 6,  0.7,  90],
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 3, 'brute',  3,  1.4,  460],
    [5, '第6关 · 夹击', 1.8, 'c1_mid', 3, 'zombie', 12, 0.4,  160],
    // 第7关 · 壁垒 —— ≈11980（×3.36，台阶二：检查 4~6 段装备 + 合成）
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 0, 'zombie', 12, 0.4,  200],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 1, 'brute',  4,  1.2,  560],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 2, 'runner', 12, 0.4,  110],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 3, 'brute',  4,  1.2,  560],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 3, 'zombie', 10, 0.4,  200],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 4, 'brute',  2,  1.4,  560],
    [6, '第7关 · 壁垒', 1.6, 'c1_late', 4, 'runner', 6,  0.6,  110],
    // 第8关 · 风暴 —— ≈12600（×3.53）
    [7, '第8关 · 风暴', 1.6, 'c1_late', 0, 'runner', 14, 0.35, 110],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 1, 'zombie', 16, 0.35, 200],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 2, 'brute',  4,  1.2,  560],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 3, 'zombie', 12, 0.4,  200],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 3, 'runner', 8,  0.5,  110],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 4, 'brute',  3,  1.3,  560],
    [7, '第8关 · 风暴', 1.6, 'c1_late', 4, 'runner', 6,  0.6,  110],
    // 第9关 · 黑潮 —— ≈13920（×3.9）
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 0, 'zombie', 14, 0.35, 220],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 1, 'brute',  4,  1.2,  600],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 2, 'runner', 14, 0.35, 120],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 3, 'brute',  4,  1.2,  600],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 3, 'zombie', 10, 0.4,  220],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 4, 'brute',  2,  1.4,  600],
    [8, '第9关 · 黑潮', 1.6, 'c1_late', 4, 'runner', 8,  0.5,  120],
    // 第10关 · 屠夫领主 —— ≈16260（×4.55，台阶三：4 普通波 + Boss 波）
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 0, 'zombie', 14, 0.35, 240],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 1, 'runner', 12, 0.4,  120],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 2, 'brute',  4,  1.2,  600],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 3, 'zombie', 12, 0.4,  240],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 3, 'runner', 8,  0.5,  120],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 4, 'boss_butcher', 1, 1.0, ''],
    [9, '第10关 · 屠夫领主', 1.8, 'c1_boss', 4, 'runner', 6,  0.8,  120],
];

// —— Misc sheet：散落标量/键值（点分 key）——
const MISC_HEADER = ['key', 'value'];
const MISC_ROWS: (string | number)[][] = [
    ['startLevel', 0],
    ['roster', 'dps'],
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
