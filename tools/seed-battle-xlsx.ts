// battle.xlsx 种子脚本（一次性）—— 用当前 BattleConfig 数值生成初始 Excel。
// 用途：本次管线搭建时用，跑 `npx tsx tools/seed-battle-xlsx.ts` 生成 tools/config-xlsx/battle.xlsx。
// 之后策划在 Excel 里直接编辑该 xlsx；这个脚本只在「从零重建 xlsx」时才再跑（极少）。
//
// 数值来源：assets/scripts/config/BattleConfig.ts（2026-06-27 快照），逐字段核对一致。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
// 框架派生值（balance.xlsx → npm run balance:derive）；本 seed 只在 charGrowth 两列引用
import { derivedValues } from './balance-model/derived.values.generated';

const OUT = resolve(__dirname, 'config-xlsx/battle.xlsx');

// —— Stats sheet：角色属性表（class 作行 key，18 个数值属性）——
// 2026-07-11 属性系统扩展：末 5 列（skillHaste/basicDmgBonus/skillDmgBonus/singleDmgBonus/aoeDmgBonus）
// 起手全 0（行为等价），绝对数值由养成框架子计划 B 反解。
const STATS_HEADER = ['class', 'hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce', 'moveSpeed',
    'skillHaste', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus', 'aoeDmgBonus'];
const STATS_ROWS: (string | number)[][] = [
    // moveSpeed 2026-07-11 从 Classes 表迁入统一属性表：tank/dps 沿用原值 300（近战冲锋行为等价）；
    // healer 原为 0（钉站位），补 220 仅供全队行军取最慢值用，战斗中 heal 原型仍钉站位。
    ['tank',   360, 14, 10, 90,  1.0, 0.05, 0.5, 0.0,  0.30, 0.5, 0.0,  0.10, 300, 0, 0, 0, 0, 0],
    // dps 基础面板 2026-07-04 ×5.5：旧值(hp90/atk28)裸装连第1关都过不了（1v1 丧尸都是五五开）；
    // 装备 hp/atk 平铺值在 equip.xlsx 同倍放大，保持装备相对价值不变
    ['dps',    500, 155, 2,  90,  1.3, 0.25, 1.0, 0.05, 0.0,  0.0, 0.10, 0.0,  300, 0, 0, 0, 0, 0],
    ['healer', 120, 0,  4,  0,   1.0, 0.0,  0.5, 0.10, 0.0,  0.0, 0.0,  0.0,  220, 0, 0, 0, 0, 0],
];

// —— EnemyTypes sheet：怪物图鉴（type 作行 key；color 用 "r,g,b" 字符串；stats 拍平到同表）——
const ENEMY_HEADER = ['type', 'name', 'radius', 'attackInterval', 'color',
    'hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce', 'moveSpeed',
    'skillHaste', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus', 'aoeDmgBonus', 'exp'];
const ENEMY_ROWS: (string | number)[][] = [
    // moveSpeed（原顶层 speed 列）2026-07-11 迁入 stats 组，数值原样搬运；
    // 2026-07-11 属性系统扩展加 5 列全 0（exp 保持末列）
    ['zombie', '丧尸',   28, 0.8, '230,70,70',  120, 18, 4,  0, 1.0, 0.05, 0.5, 0.05, 0.0, 0.0, 0.0, 0.0,  90,  0, 0, 0, 0, 0, 5],
    ['runner', '疾行者', 22, 0.6, '240,150,60', 70,  14, 2,  0, 1.4, 0.05, 0.5, 0.15, 0.0, 0.0, 0.0, 0.0,  175, 0, 0, 0, 0, 0, 4],
    ['brute',  '重装',   40, 1.2, '170,80,200', 360, 30, 12, 0, 0.8, 0.05, 0.5, 0.0,  0.0, 0.0, 0.0, 0.15, 55,  0, 0, 0, 0, 0, 10],
    // 第一章 Boss：纯数值型大体型（高血高攻高减免），无技能机制；血量经 sim:pacing 校准（t2 卡关 / t3 可过）
    ['boss_butcher', '屠夫领主', 60, 1.5, '150,40,40', 15100, 55, 20, 0, 0.8, 0.05, 0.5, 0.0, 0.0, 0.0, 0.0, 0.30, 40, 0, 0, 0, 0, 0, 200],
];

// —— Classes sheet：职业行为（class 作行 key；attackType 是字符串枚举）——
const CLASSES_HEADER = ['class', 'attackType', 'fireInterval', 'advanceLimit', 'healPerSec', 'size'];
const CLASSES_ROWS: (string | number)[][] = [
    // moveSpeed 2026-07-11 迁入 Stats 统一属性表
    ['tank',   'melee',  0.5,  80, 0,  74],
    ['dps',    'melee',  0.33, 80, 0,  52],
    ['healer', 'heal',   0,    0,  16, 52],
];

// —— Levels sheet：关卡，拍平到 spawn-group 粒度 ——
// 列：levelIndex, levelName, distance, dropGroup, waveIndex, type, count, interval, hp(可选,空=不覆盖)
// distance = 清完该波后行军到下一刷怪点的距离（像素），同一波各行必须一致；末波该值无效（2026-07-11 取代 waveGap）
// enemyScale（2026-07-12 难度导出列）：本关全部怪 hp/atk 统一缩放，同关一致；由 addSheet 前按 levelIndex 追加
const LEVELS_HEADER = ['levelIndex', 'levelName', 'distance', 'dropGroup', 'waveIndex', 'type', 'count', 'interval', 'hp', 'enemyScale'];
const LEVELS_ROWS: (string | number)[][] = [
    // 第一章 10 关，台阶卡点在第 4/7/10 关（levelIndex 3/6/9）。
    // L4~L10 的 hp 覆盖值由 `npm run sim:pacing` 于 2026-07-04 校准（13 门槛全达标：
    // 裸装过 1~3、台阶关对低一档装备卡关、对达标装备可过）；改这些数值后要重跑 sim 回归。
    // 2026-07-11 技能 2 槽制重校（dps 少一技能，裸装/低档输出结构变化）：
    //   L3 减负（brute 3→1、zombie 12→10/血 150→110、runner 4→3，50 局诊断裸装胜率 96%）；
    //   L7 血量覆盖 -5%（2168→2060/770→730/426→405，4~6段 100% 过、1~3段 0% 卡）；
    //   L10 Boss 36000→39000（对冲坚壁被动，4~6段卡关余量恢复）。全量门槛六连跑全绿。
    // 第1关 · 试炼
    [0, '第1关 · 试炼', 600, 'c1_early', 0, 'zombie', 6,  0.7,  ''],
    [0, '第1关 · 试炼', 600, 'c1_early', 1, 'zombie', 8,  0.5,  ''],
    [0, '第1关 · 试炼', 600, 'c1_early', 1, 'runner', 3,  1.2,  ''],
    [0, '第1关 · 试炼', 600, 'c1_early', 2, 'brute',  2,  1.6,  ''],
    [0, '第1关 · 试炼', 600, 'c1_early', 2, 'zombie', 8,  0.45, ''],
    // 第2关 · 前哨 —— ≈4330（×1.2）
    [1, '第2关 · 前哨', 600, 'c1_early', 0, 'zombie', 10, 0.6,  ''],
    [1, '第2关 · 前哨', 600, 'c1_early', 1, 'zombie', 8,  0.5,  ''],
    [1, '第2关 · 前哨', 600, 'c1_early', 1, 'runner', 4,  1.0,  ''],
    [1, '第2关 · 前哨', 600, 'c1_early', 2, 'brute',  2,  1.6,  ''],
    [1, '第2关 · 前哨', 600, 'c1_early', 2, 'zombie', 8,  0.45, ''],
    [1, '第2关 · 前哨', 600, 'c1_early', 2, 'runner', 3,  1.0,  ''],
    // 第3关 · 溃堤 —— ≈5200（×1.46）
    [2, '第3关 · 溃堤', 600, 'c1_early', 0, 'runner', 8,  0.45, ''],
    [2, '第3关 · 溃堤', 600, 'c1_early', 1, 'zombie', 10, 0.4,  110],
    [2, '第3关 · 溃堤', 600, 'c1_early', 1, 'runner', 3,  1.0,  ''],
    [2, '第3关 · 溃堤', 600, 'c1_early', 2, 'brute',  1,  1.5,  ''],
    [2, '第3关 · 溃堤', 600, 'c1_early', 2, 'zombie', 8, 0.4,  ''],
    [2, '第3关 · 溃堤', 600, 'c1_early', 2, 'runner', 4,  0.8,  ''],
    // 第4关 · 铁壁（台阶一：重装比例突增，检查 1~3 段装备；裸装卡关）
    [3, '第4关 · 铁壁', 600, 'c1_mid', 0, 'zombie', 10, 0.5,  330],
    [3, '第4关 · 铁壁', 600, 'c1_mid', 1, 'brute',  4,  1.3,  790],
    [3, '第4关 · 铁壁', 600, 'c1_mid', 2, 'brute',  3,  1.4,  790],
    [3, '第4关 · 铁壁', 600, 'c1_mid', 2, 'runner', 6,  0.8,  155],
    [3, '第4关 · 铁壁', 600, 'c1_mid', 3, 'brute',  4,  1.2,  1010],
    [3, '第4关 · 铁壁', 600, 'c1_mid', 3, 'zombie', 8,  0.4,  330],
    // 第5关 · 缓坡
    [4, '第5关 · 缓坡', 600, 'c1_mid', 0, 'zombie', 14, 0.45, 300],
    [4, '第5关 · 缓坡', 600, 'c1_mid', 1, 'runner', 10, 0.5,  180],
    [4, '第5关 · 缓坡', 600, 'c1_mid', 2, 'brute',  3,  1.4,  920],
    [4, '第5关 · 缓坡', 600, 'c1_mid', 2, 'zombie', 10, 0.4,  300],
    [4, '第5关 · 缓坡', 600, 'c1_mid', 3, 'brute',  2,  1.5,  920],
    [4, '第5关 · 缓坡', 600, 'c1_mid', 3, 'runner', 10, 0.5,  180],
    // 第6关 · 夹击
    [5, '第6关 · 夹击', 600, 'c1_mid', 0, 'runner', 12, 0.4,  155],
    [5, '第6关 · 夹击', 600, 'c1_mid', 1, 'zombie', 14, 0.4,  275],
    [5, '第6关 · 夹击', 600, 'c1_mid', 2, 'brute',  4,  1.3,  780],
    [5, '第6关 · 夹击', 600, 'c1_mid', 2, 'runner', 6,  0.7,  155],
    [5, '第6关 · 夹击', 600, 'c1_mid', 3, 'brute',  3,  1.4,  780],
    [5, '第6关 · 夹击', 600, 'c1_mid', 3, 'zombie', 12, 0.4,  275],
    // 第7关 · 壁垒（台阶二：检查 4~6 段装备 + 合成；1~3 段装卡关）——tank+dps 双人后 hp ×1.15
    [6, '第7关 · 壁垒', 600, 'c1_late', 0, 'zombie', 12, 0.4,  730],
    [6, '第7关 · 壁垒', 600, 'c1_late', 1, 'brute',  4,  1.2,  2060],
    [6, '第7关 · 壁垒', 600, 'c1_late', 2, 'runner', 12, 0.4,  405],
    [6, '第7关 · 壁垒', 600, 'c1_late', 3, 'brute',  4,  1.2,  2060],
    [6, '第7关 · 壁垒', 600, 'c1_late', 3, 'zombie', 10, 0.4,  730],
    [6, '第7关 · 壁垒', 600, 'c1_late', 4, 'brute',  2,  1.4,  2060],
    [6, '第7关 · 壁垒', 600, 'c1_late', 4, 'runner', 6,  0.6,  405],
    // 第8关 · 风暴（快速刷怪波并发压力大，hp 系数低于 L9）
    [7, '第8关 · 风暴', 600, 'c1_late', 0, 'runner', 14, 0.35, 200],
    [7, '第8关 · 风暴', 600, 'c1_late', 1, 'zombie', 16, 0.35, 360],
    [7, '第8关 · 风暴', 600, 'c1_late', 2, 'brute',  4,  1.2,  1010],
    [7, '第8关 · 风暴', 600, 'c1_late', 3, 'zombie', 12, 0.4,  360],
    [7, '第8关 · 风暴', 600, 'c1_late', 3, 'runner', 8,  0.5,  200],
    [7, '第8关 · 风暴', 600, 'c1_late', 4, 'brute',  3,  1.3,  1010],
    [7, '第8关 · 风暴', 600, 'c1_late', 4, 'runner', 6,  0.6,  200],
    // 第9关 · 黑潮
    [8, '第9关 · 黑潮', 600, 'c1_late', 0, 'zombie', 14, 0.35, 420],
    [8, '第9关 · 黑潮', 600, 'c1_late', 1, 'brute',  4,  1.2,  1140],
    [8, '第9关 · 黑潮', 600, 'c1_late', 2, 'runner', 14, 0.35, 230],
    [8, '第9关 · 黑潮', 600, 'c1_late', 3, 'brute',  4,  1.2,  1140],
    [8, '第9关 · 黑潮', 600, 'c1_late', 3, 'zombie', 10, 0.4,  420],
    [8, '第9关 · 黑潮', 600, 'c1_late', 4, 'brute',  2,  1.4,  1140],
    [8, '第9关 · 黑潮', 600, 'c1_late', 4, 'runner', 8,  0.5,  230],
    // 第10关 · 屠夫领主（台阶三：4 普通波 + Boss 波；4~6 段装卡关）
    [9, '第10关 · 屠夫领主', 600, 'c1_boss', 0, 'zombie', 14, 0.35, 805],
    [9, '第10关 · 屠夫领主', 600, 'c1_boss', 1, 'runner', 12, 0.4,  405],
    [9, '第10关 · 屠夫领主', 600, 'c1_boss', 2, 'brute',  4,  1.2,  2015],
    [9, '第10关 · 屠夫领主', 600, 'c1_boss', 3, 'zombie', 12, 0.4,  805],
    [9, '第10关 · 屠夫领主', 600, 'c1_boss', 3, 'runner', 8,  0.5,  405],
    [9, '第10关 · 屠夫领主', 600, 'c1_boss', 4, 'boss_butcher', 1, 1.0, 39000],
    [9, '第10关 · 屠夫领主', 600, 'c1_boss', 4, 'runner', 6,  0.8,  405],
];

// —— Misc sheet：散落标量/键值（点分 key）——
const MISC_HEADER = ['key', 'value'];
const MISC_ROWS: (string | number)[][] = [
    ['startLevel', 0],
    ['squadCap', 2],
    ['roster', 'tank,dps'],
    // expBase / statGrowthPerLevel 为框架接管列（balance:derive 反解：经验=顺推自然到毕业级；等级线=20% 战力份额）
    ['charGrowth.expBase', derivedValues.battle.expBase],
    ['charGrowth.expGrowthPerLevel', 1.15],
    ['charGrowth.statGrowthPerLevel', derivedValues.battle.statGrowthPerLevel],
    ['charGrowth.maxLevel', 100],   // 2026-07-11 30→100：长线养成空间
    // 经验曲线分段（2026-07-11 产出 spec §2）：1~30 ×1.15 / 31~60 ×1.08 / 61~100 ×1.04（占位，子计划 B 反解）
    ['charGrowth.expSeg2Start', 31],
    ['charGrowth.expSeg2Growth', 1.08],
    ['charGrowth.expSeg3Start', 61],
    ['charGrowth.expSeg3Growth', 1.04],
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
// 难度缩放列按 levelIndex 追加（balance:derive 难度导出：新旧战力比 × 难度系数）
const enemyScales = (derivedValues.battle as { enemyScales?: readonly number[] }).enemyScales;
const LEVELS_ROWS_SCALED = LEVELS_ROWS.map(r => [...r, enemyScales?.[r[0] as number] ?? 1]);
addSheet('Levels', LEVELS_HEADER, LEVELS_ROWS_SCALED);
addSheet('Misc', MISC_HEADER, MISC_ROWS);
addSheet('Scene', SCENE_HEADER, SCENE_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
// bookType xlsx；cellDates 不需要（无日期列）
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Stats(${STATS_ROWS.length}) EnemyTypes(${ENEMY_ROWS.length}) Classes(${CLASSES_ROWS.length}) Levels(${LEVELS_ROWS.length}) Misc(${MISC_ROWS.length}) Scene(${SCENE_ROWS.length})`);
