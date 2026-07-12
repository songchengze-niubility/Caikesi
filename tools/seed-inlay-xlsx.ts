// inlay.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/inlay.xlsx，之后策划直接编辑该 xlsx。
// 三表：Gems（宝石类型→属性/基值/等级上限）、SocketCounts（品质→两组孔数）、Inscriptions（铭文效果池）。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { derivedValues } from './balance-model/derived.values.generated';
import { TPL } from './balance-model/templates';

const OUT = resolve(__dirname, 'config-xlsx/inlay.xlsx');

// 框架接管：一级属性宝石 baseValue × gemPrimaryScale（17% 份额）、铭文一级行 × inscPrimaryScale（8% 份额）；
// 暴击/伤害类保持手填值（概率型数值不随战力盘子线性放大）。
const KG = derivedValues.inlay.gemPrimaryScale;
const KI = derivedValues.inlay.inscPrimaryScale;
const PRIMARY = new Set(['atk', 'hp', 'def', 'moveSpeed']);
const PRIMARY_PCT = new Set(['atkPct', 'hpPct', 'defPct', 'moveSpeedPct']);
const gemScaled = (stat: string, v: number) => (PRIMARY.has(stat) ? Number((v * KG).toFixed(1)) : v);
const inscScaled = (stat: string, v: number) =>
    PRIMARY.has(stat) ? Math.round(v * KI) : PRIMARY_PCT.has(stat) ? Number((v * KI).toFixed(4)) : v;

// 宝石加成 = baseValue × levelRatio^(lv-1)（2026-07-11 改等比价值）。百分比属性(crit/dmg)按小数填。
// maxLevel 统一 6（与 RewardTypes.GemMaterialId 联合类型耦合，改上限必须同步拓宽联合）。
// 形状在 tools/balance-model/templates.ts 单一真源；此处只做缩放落表。
const GEMS_HEADER = ['type', 'label', 'stat', 'baseValue', 'maxLevel', 'levelRatio'];
const GEMS_ROWS: (string | number)[][] = TPL.gems.map(r => [...r]);

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
// 形状在 tools/balance-model/templates.ts 单一真源；此处只做缩放落表。
const INSCRIPTIONS_ROWS: (string | number)[][] = TPL.inscriptions.map(r => [...r]);

const wb = XLSX.utils.book_new();
function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}
// 一级属性行经框架缩放后落表
const GEMS_SCALED = GEMS_ROWS.map(([type, label, stat, baseValue, maxLevel, levelRatio]) =>
    [type, label, stat, gemScaled(stat as string, baseValue as number), maxLevel, levelRatio]);
const INSCRIPTIONS_SCALED = INSCRIPTIONS_ROWS.map(([stat, valueMin, valueMax]) =>
    [stat, inscScaled(stat as string, valueMin as number), inscScaled(stat as string, valueMax as number)]);

addSheet('Gems', GEMS_HEADER, GEMS_SCALED);
addSheet('SocketCounts', SOCKET_COUNTS_HEADER, SOCKET_COUNTS_ROWS);
addSheet('Inscriptions', INSCRIPTIONS_HEADER, INSCRIPTIONS_SCALED);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Gems(${GEMS_ROWS.length}) SocketCounts(${SOCKET_COUNTS_ROWS.length}) Inscriptions(${INSCRIPTIONS_ROWS.length})`);
