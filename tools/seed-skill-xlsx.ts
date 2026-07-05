// skill.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/skill.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/skill.xlsx');

// 行顺序即 UI 按钮顺序（左→右）。数值为占位，经 `npm run sim:pacing` 校准后回填。
const SKILLS_HEADER = ['id', 'name', 'cls', 'trigger', 'triggerValue', 'target', 'radius', 'maxTargets', 'dmgMult'];
const SKILLS_ROWS: (string | number)[][] = [
    ['whirlwind',     '旋风斩',   'dps', 'attackCount', 8,  'aoe',     220, 0, 1.2],
    ['ground_smash',  '裂地击',   'dps', 'timer',       7,  'nearest', 0,   3, 1.8],
    ['lethal_strike', '致命一击', 'dps', 'attackCount', 15, 'single',  0,   0, 4.0],
];

const wb = XLSX.utils.book_new();

function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}

addSheet('Skills', SKILLS_HEADER, SKILLS_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Skills(${SKILLS_ROWS.length})`);
