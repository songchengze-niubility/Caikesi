// skill.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/skill.xlsx，之后策划直接编辑该 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/skill.xlsx');

// 行顺序即 UI 按钮顺序（左→右）。数值为占位，经 `npm run sim:pacing` 校准后回填。
const SKILLS_HEADER = ['id', 'name', 'cls', 'kind', 'trigger', 'triggerValue', 'target', 'radius', 'maxTargets', 'effects', 'delivery', 'passiveTrigger', 'chance', 'targetMode'];
const SKILLS_ROWS: (string | number)[][] = [
    // 2026-07-04 sim:pacing 校准：技能定位是节奏点缀（AoE 清波感），总输出占比压低，
    // 台阶门槛主要由关卡 hp 承担；改这里要重跑 `npm run sim:pacing`。
    // 2026-07-11 Plan A：2 槽制（每职业 ≤2 行，主/被动混装）。dps 移除 ground_smash（timer8 ×1.2×3），
    // 补偿定稿：whirlwind 0.5→0.8、lethal_strike 2.5→3.5（首试 0.65/3.0 时第 7 关 4~6 段装胜率 0%，
    // 加档后 sim:pacing 13 门槛复跑全绿；再调要同时盯住 4/7/10 关"低档装应卡关 <40%"不被推过）。
    // 被动行：主动列（trigger~delivery）留空；passiveTrigger/chance/targetMode 填写。
    ['whirlwind',      '旋风斩',   'dps',    'active',  'attackCount', 10, 'aoe',     220, 0,  'damage:0.8',         '', '',       '',   ''],
    ['lethal_strike',  '致命一击', 'dps',    'active',  'attackCount', 15, 'single',  0,   0,  'damage:3.5',          '', '',       '',   ''],
    ['tank_stoneskin', '坚壁',     'tank',   'passive', '',            '', '',        '',  '', 'applyBuff:stone_skin', '', 'onHurt', 0.15, 'self'],
    ['healer_banner',  '战旗光环', 'healer', 'passive', '',            '', '',        '',  '', 'applyBuff:war_banner', '', 'always', 1,    'team'],
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
