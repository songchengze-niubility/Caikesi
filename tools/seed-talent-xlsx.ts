// talent.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/talent.xlsx，之后策划直接编辑该 xlsx。
// 两表：Nodes（心法节点：分支/前置/效果/成本）、FirstClearPages（关卡首通发放秘笈残页）。
// 数值全占位（spec 2026-07-12 ⑦：份额反解进 balance 框架另属后续计划）。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/talent.xlsx');

// 效果四类：stat（EquipStatKey，叠全队）/ econ（gold|exp|offlineRate）/
//           drop（equipQuality，蓝+品质权重放大）/ unlock（squadSlot3|chestCapacity|autoSell|offlineCap）
// 前置规则：prereq 全部点满才可点本节点；pageCost 仅一次性大节点（maxLevel=1）可 >0。
// 百分比按 0~1 小数填。goldCost(n) = round(goldBase × goldGrowth^(n-1))。
const NODES_HEADER = ['id', 'label', 'branch', 'tier', 'prereq', 'maxLevel',
    'effectKind', 'effectKey', 'valuePerLevel', 'goldBase', 'goldGrowth', 'pageCost'];
const NODES_ROWS: (string | number)[][] = [
    // —— 主干（纯属性，逐段解锁三条分支的入口）——
    ['trunk_1', '吐纳', 'trunk', 1, '',        5, 'stat', 'hpPct',    0.01, 100, 1.5, 0],
    ['trunk_2', '凝神', 'trunk', 2, 'trunk_1', 5, 'stat', 'atkPct',   0.01, 150, 1.5, 0],
    ['trunk_3', '固本', 'trunk', 3, 'trunk_2', 5, 'stat', 'defPct',   0.01, 220, 1.5, 0],
    ['trunk_4', '周天', 'trunk', 4, 'trunk_3', 5, 'stat', 'dmgBonus', 0.01, 330, 1.5, 0],
    // —— 战斗支（入口 trunk_2；末端大节点 心法大成）——
    ['combat_atk',    '剑势',     'combat', 1, 'trunk_2',     5, 'stat', 'atkPct',        0.02,  200,  1.6, 0],
    ['combat_hp',     '铁骨',     'combat', 2, 'trunk_2',     5, 'stat', 'hpPct',         0.02,  200,  1.6, 0],
    ['combat_crit',   '锋芒',     'combat', 3, 'combat_atk',  5, 'stat', 'critRate',      0.01,  300,  1.6, 0],
    ['combat_def',    '云甲',     'combat', 4, 'combat_hp',   5, 'stat', 'defPct',        0.02,  300,  1.6, 0],
    ['combat_haste',  '疾风',     'combat', 5, 'combat_crit', 5, 'stat', 'skillHaste',    0.02,  450,  1.6, 0],
    ['combat_dmg',    '破军',     'combat', 6, 'combat_crit', 5, 'stat', 'dmgBonus',      0.015, 450,  1.6, 0],
    ['combat_basic',  '淬刃',     'combat', 7, 'combat_dmg',  5, 'stat', 'basicDmgBonus', 0.02,  600,  1.6, 0],
    ['combat_master', '心法大成', 'combat', 8, 'combat_basic,combat_haste,combat_def', 1, 'stat', 'dmgBonus', 0.05, 2000, 1, 2],
    // —— 经济支（入口 trunk_3；大节点 入定=离线收益、拂尘=自动卖白绿）——
    ['econ_gold',     '生财', 'economy', 1, 'trunk_3',   5, 'econ', 'gold',        0.03, 250,  1.6, 0],
    ['econ_exp',      '悟性', 'economy', 2, 'trunk_3',   5, 'econ', 'exp',         0.03, 250,  1.6, 0],
    ['econ_gold2',    '聚宝', 'economy', 3, 'econ_gold', 5, 'econ', 'gold',        0.03, 400,  1.6, 0],
    ['econ_exp2',     '闻道', 'economy', 4, 'econ_exp',  5, 'econ', 'exp',         0.03, 400,  1.6, 0],
    ['econ_offline',  '入定', 'economy', 5, 'econ_gold2', 1, 'econ', 'offlineRate', 0.25, 1500, 1, 2],
    ['econ_autosell', '拂尘', 'economy', 6, 'econ_exp2',  1, 'unlock', 'autoSell',  1,    1500, 1, 2],
    // —— 掉落支（入口 trunk_4；大节点 乾坤袋=宝箱扩容）——
    ['drop_quality',  '慧眼',   'drop', 1, 'trunk_4',       5, 'drop', 'equipQuality', 0.03, 300,  1.6, 0],
    ['drop_quality2', '鉴宝',   'drop', 2, 'drop_quality',  5, 'drop', 'equipQuality', 0.03, 450,  1.6, 0],
    ['drop_quality3', '寻珍',   'drop', 3, 'drop_quality2', 5, 'drop', 'equipQuality', 0.04, 700,  1.6, 0],
    ['drop_quality4', '探骊',   'drop', 4, 'drop_quality3', 5, 'drop', 'equipQuality', 0.04, 1000, 1.6, 0],
    ['drop_chest',    '乾坤袋', 'drop', 5, 'drop_quality2', 1, 'unlock', 'chestCapacity', 20, 1800, 1, 2],
    // —— 汇合大节点：第 3 上阵位（树最深处；三支末端各点满）——
    ['func_squad3', '三才阵', 'trunk', 6, 'combat_master,econ_autosell,drop_chest', 1, 'unlock', 'squadSlot3', 1, 5000, 1, 4],
];

// 关卡首通发放秘笈残页：普通关 1、末关（Boss+章节）4；第一章共 13 页，
// 大节点总需 12 页（2+2+2+2+4），留 1 页余量（spec ⑥）。
const PAGES_HEADER = ['levelIndex', 'pages'];
const PAGES_ROWS: (string | number)[][] = [
    [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 4],
];

const wb = XLSX.utils.book_new();
function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}
addSheet('Nodes', NODES_HEADER, NODES_ROWS);
addSheet('FirstClearPages', PAGES_HEADER, PAGES_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Nodes(${NODES_ROWS.length}) FirstClearPages(${PAGES_ROWS.length})`);


