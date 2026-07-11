// buff.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/buff.xlsx，之后策划直接编辑该 xlsx。
// 编码格式见 assets/scripts/config/EffectTypes.ts 文件头注释。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/buff.xlsx');

// 数值全部占位，后续数值平衡阶段折进 sim:pacing 校准。
const BUFFS_HEADER = ['id', 'name', 'duration', 'maxStacks', 'stackRule', 'period', 'periodicEffect', 'statMods', 'flags', 'dispelTag'];
const BUFFS_ROWS: (string | number)[][] = [
    ['poison',     '中毒', 6,   3, 'add',     1, 'damage:0.15', 'def:-2',                '',     'debuff'],
    ['battle_cry', '战吼', 5,   1, 'refresh', 0, '',            'atk%:0.25',             '',     'buff'],
    ['stone_skin', '石肤', 8,   1, 'refresh', 0, '',            'def:+6|dmgReduce:+0.1', '',     'buff'],
    ['stun',       '眩晕', 1.5, 1, 'refresh', 0, '',            '',                      'stun',    'debuff'],
    ['taunt_shout', '挑衅', 3,  1, 'refresh', 0, '',            '',                      'taunt',   'buff'],
    ['silence_seal', '沉默', 3, 1, 'refresh', 0, '',            '',                      'silence', 'debuff'],
    ['frost',        '冰缓', 3, 1, 'refresh', 0, '',            'moveSpeed%:-0.3',       '',        'debuff'],
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([BUFFS_HEADER, ...BUFFS_ROWS]);
XLSX.utils.book_append_sheet(wb, ws, 'Buffs');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Buffs(${BUFFS_ROWS.length})`);
