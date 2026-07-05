// inlay.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/inlay.xlsx，之后策划直接编辑该 xlsx。
// 三表：Gems（宝石类型→属性/基值/等级上限）、SocketCounts（品质→两组孔数）、Inscriptions（铭文效果池）。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/inlay.xlsx');

// 宝石加成 = baseValue × level。百分比属性(crit/dmg)按小数填。maxLevel 起手统一 4（与 MaterialId 联合类型耦合）。
const GEMS_HEADER = ['type', 'label', 'stat', 'baseValue', 'maxLevel'];
const GEMS_ROWS: (string | number)[][] = [
    ['atk', '攻击', 'atk', 30, 4],
    ['hp', '生命', 'hp', 120, 4],
    ['def', '防御', 'def', 8, 4],
    ['crit', '暴击', 'critRate', 0.02, 4],
    ['dmg', '增伤', 'dmgBonus', 0.03, 4],
];

// 两组独立孔数，按品质浮动（gemSockets / inscriptionSlots）。
const SOCKET_COUNTS_HEADER = ['quality', 'gemSockets', 'inscriptionSlots'];
const SOCKET_COUNTS_ROWS: (string | number)[][] = [
    ['common', 1, 0],
    ['fine', 1, 1],
    ['rare', 2, 1],
    ['epic', 2, 1],
    ['legend', 3, 2],
];

// 铭文效果池：打铭文时随机抽一行、在 [valueMin,valueMax] roll 出 value。百分比属性按小数填。
const INSCRIPTIONS_HEADER = ['stat', 'valueMin', 'valueMax'];
const INSCRIPTIONS_ROWS: (string | number)[][] = [
    ['atk', 10, 40],
    ['hp', 60, 200],
    ['def', 3, 10],
    ['critRate', 0.01, 0.05],
    ['critDmg', 0.05, 0.15],
    ['dmgBonus', 0.02, 0.08],
    ['dmgReduce', 0.01, 0.05],
];

const wb = XLSX.utils.book_new();
function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}
addSheet('Gems', GEMS_HEADER, GEMS_ROWS);
addSheet('SocketCounts', SOCKET_COUNTS_HEADER, SOCKET_COUNTS_ROWS);
addSheet('Inscriptions', INSCRIPTIONS_HEADER, INSCRIPTIONS_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Gems(${GEMS_ROWS.length}) SocketCounts(${SOCKET_COUNTS_ROWS.length}) Inscriptions(${INSCRIPTIONS_ROWS.length})`);
