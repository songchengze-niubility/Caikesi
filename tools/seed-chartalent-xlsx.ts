// chartalent.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/chartalent.xlsx，之后策划直接编辑该 xlsx。
// 两表：Nodes（角色天赋节点：职业/等级门槛/属性或被动）、Passives（被动节点每级一条 PassiveDef）。
// 数值全占位（spec 2026-07-12-char-talent-design.md §3.4）。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/chartalent.xlsx');

// kind=stat：statKey 为 EquipStatKey，效果 = valuePerLevel × 已投级数（百分比 0~1 小数）。
// kind=passive：statKey/valuePerLevel 置空，每级效果见 Passives 表（只取当前级那条注入战斗）。
// levelReq：角色等级门槛（分层 1/5/10/20/35/50/70）；无节点连线依赖。
const NODES_HEADER = ['cls', 'id', 'label', 'tier', 'levelReq', 'maxLevel', 'kind', 'statKey', 'valuePerLevel'];
const NODES_ROWS: (string | number)[][] = [
    // —— tank：生存反制 ——
    ['tank', 'ct_tank_hp',        '筋骨',   1, 1,  12, 'stat', 'hpPct',        0.01],
    ['tank', 'ct_tank_def',       '铁壁',   1, 1,  12, 'stat', 'defPct',       0.01],
    ['tank', 'ct_tank_hpflat',    '蓄血',   2, 5,  12, 'stat', 'hp',           30],
    ['tank', 'ct_tank_block',     '格挡',   2, 5,  12, 'stat', 'blockRate',    0.01],
    ['tank', 'ct_tank_thorns',    '反震',   3, 10, 5,  'passive', '',          0],
    ['tank', 'ct_tank_defflat',   '淬甲',   3, 10, 12, 'stat', 'def',          2],
    ['tank', 'ct_tank_bulwark',   '坚韧',   4, 20, 5,  'passive', '',          0],
    ['tank', 'ct_tank_blockpow',  '沉肩',   4, 20, 12, 'stat', 'blockRatio',   0.015],
    ['tank', 'ct_tank_guard',     '守护',   5, 35, 5,  'passive', '',          0],
    ['tank', 'ct_tank_reduce',    '磐石',   5, 35, 12, 'stat', 'dmgReduce',    0.005],
    ['tank', 'ct_tank_atk',       '腕力',   6, 50, 12, 'stat', 'atkPct',       0.01],
    ['tank', 'ct_tank_speed',     '疾步',   6, 50, 12, 'stat', 'moveSpeedPct', 0.01],
    ['tank', 'ct_tank_warwill',   '战意',   7, 70, 5,  'passive', '',          0],
    // —— dps：爆发斩杀 ——
    ['dps', 'ct_dps_atk',         '磨剑',   1, 1,  12, 'stat', 'atkPct',          0.01],
    ['dps', 'ct_dps_atkflat',     '劲力',   1, 1,  12, 'stat', 'atk',             3],
    ['dps', 'ct_dps_crit',        '锐目',   2, 5,  12, 'stat', 'critRate',        0.005],
    ['dps', 'ct_dps_basic',       '快刃',   2, 5,  12, 'stat', 'basicDmgBonus',   0.01],
    ['dps', 'ct_dps_bloodthirst', '嗜血',   3, 10, 5,  'passive', '',             0],
    ['dps', 'ct_dps_aspd',        '轻身',   3, 10, 12, 'stat', 'attackSpeed',     0.02],
    ['dps', 'ct_dps_combo',       '连击',   4, 20, 5,  'passive', '',             0],
    ['dps', 'ct_dps_critdmg',     '重创',   4, 20, 12, 'stat', 'critDmg',         0.02],
    ['dps', 'ct_dps_pojun',       '破军',   5, 35, 5,  'passive', '',             0],
    ['dps', 'ct_dps_single',      '专注',   5, 35, 12, 'stat', 'singleDmgBonus',  0.01],
    ['dps', 'ct_dps_aoe',         '横扫',   6, 50, 12, 'stat', 'aoeDmgBonus',     0.01],
    ['dps', 'ct_dps_skill',       '御气',   6, 50, 12, 'stat', 'skillDmgBonus',   0.01],
    ['dps', 'ct_dps_shadow',      '残影',   7, 70, 5,  'passive', '',             0],
    // —— healer：团队增益 ——
    ['healer', 'ct_healer_hp',      '养气', 1, 1,  12, 'stat', 'hpPct',        0.01],
    ['healer', 'ct_healer_atk',     '灵枢', 1, 1,  12, 'stat', 'atkPct',       0.01],
    ['healer', 'ct_healer_haste',   '凝思', 2, 5,  12, 'stat', 'skillHaste',   0.01],
    ['healer', 'ct_healer_def',     '云袖', 2, 5,  12, 'stat', 'defPct',       0.01],
    ['healer', 'ct_healer_rejuv',   '回春', 3, 10, 5,  'passive', '',          0],
    ['healer', 'ct_healer_hpflat',  '固元', 3, 10, 12, 'stat', 'hp',           25],
    ['healer', 'ct_healer_shelter', '庇护', 4, 20, 5,  'passive', '',          0],
    ['healer', 'ct_healer_dodge',   '飘然', 4, 20, 12, 'stat', 'dodgeRate',    0.005],
    ['healer', 'ct_healer_inspire', '鼓舞', 5, 35, 5,  'passive', '',          0],
    ['healer', 'ct_healer_speed',   '踏云', 5, 35, 12, 'stat', 'moveSpeedPct', 0.01],
    ['healer', 'ct_healer_reduce',  '柔劲', 6, 50, 12, 'stat', 'dmgReduce',    0.005],
    ['healer', 'ct_healer_atkflat', '通络', 6, 50, 12, 'stat', 'atk',          2],
    ['healer', 'ct_healer_deft',    '妙手', 7, 70, 5,  'passive', '',          0],
];

// 被动每级一条完整 PassiveDef 行；always 被动用「Buff 层数=级数」承载强度（buffedStats 按层数相乘）。
const PASSIVES_HEADER = ['nodeId', 'level', 'name', 'trigger', 'chance', 'targetMode', 'effects'];
function ladder(nodeId: string, name: string, trigger: string, targetMode: string,
    mk: (lv: number) => { chance: number; effects: string }): (string | number)[][] {
    const rows: (string | number)[][] = [];
    for (let lv = 1; lv <= 5; lv++) {
        const { chance, effects } = mk(lv);
        rows.push([nodeId, lv, name, trigger, chance, targetMode, effects]);
    }
    return rows;
}
const r2 = (v: number) => Math.round(v * 100) / 100;
const PASSIVES_ROWS: (string | number)[][] = [
    // tank：反震（受击概率反伤攻击者）/坚韧（常驻免伤）/守护（受击概率全队石肤）/战意（普攻命中概率自身战吼）
    ...ladder('ct_tank_thorns',  '反震', 'onHurt', 'trigger', lv => ({ chance: r2(0.08 + 0.02 * lv), effects: `damage:${r2(0.3 + 0.1 * lv)}` })),
    ...ladder('ct_tank_bulwark', '坚韧', 'always', 'self',    lv => ({ chance: 1, effects: `applyBuff:ct_bulwark:${lv}` })),
    ...ladder('ct_tank_guard',   '守护', 'onHurt', 'team',    lv => ({ chance: r2(0.05 + 0.01 * lv), effects: 'applyBuff:stone_skin:1' })),
    ...ladder('ct_tank_warwill', '战意', 'onHit',  'self',    lv => ({ chance: r2(0.06 + 0.02 * lv), effects: 'applyBuff:battle_cry:1' })),
    // dps：嗜血（击杀回血）/连击（普攻命中概率追伤）/破军（放技能自增全伤害）/残影（常驻闪避）
    ...ladder('ct_dps_bloodthirst', '嗜血', 'onKill', 'self',    lv => ({ chance: 1, effects: `heal:${r2(0.15 + 0.15 * lv)}` })),
    ...ladder('ct_dps_combo',       '连击', 'onHit',  'trigger', lv => ({ chance: r2(0.08 + 0.02 * lv), effects: `damage:${r2(0.3 + 0.05 * lv)}` })),
    ...ladder('ct_dps_pojun',       '破军', 'onCast', 'self',    lv => ({ chance: 1, effects: `applyBuff:ct_po_jun:${lv}` })),
    ...ladder('ct_dps_shadow',      '残影', 'always', 'self',    lv => ({ chance: 1, effects: `applyBuff:ct_shadow:${lv}` })),
    // healer：回春（放技能全队小疗）/庇护（受击概率自身石肤）/鼓舞（常驻全队攻）/妙手（放技能概率全队疗+石肤）
    ...ladder('ct_healer_rejuv',   '回春', 'onCast', 'team', lv => ({ chance: 1, effects: `heal:${r2(0.06 + 0.04 * lv)}` })),
    ...ladder('ct_healer_shelter', '庇护', 'onHurt', 'self', lv => ({ chance: r2(0.1 + 0.02 * lv), effects: 'applyBuff:stone_skin:1' })),
    ...ladder('ct_healer_inspire', '鼓舞', 'always', 'team', lv => ({ chance: 1, effects: `applyBuff:ct_inspire:${lv}` })),
    ...ladder('ct_healer_deft',    '妙手', 'onCast', 'team', lv => ({ chance: r2(0.25 + 0.05 * lv), effects: 'heal:0.05|applyBuff:stone_skin:1' })),
];

const wb = XLSX.utils.book_new();
function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}
addSheet('Nodes', NODES_HEADER, NODES_ROWS);
addSheet('Passives', PASSIVES_HEADER, PASSIVES_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Nodes(${NODES_ROWS.length}) Passives(${PASSIVES_ROWS.length})`);
