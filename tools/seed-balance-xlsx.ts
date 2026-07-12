// balance.xlsx 种子脚本——养成数值框架的真源（spec 2026-07-11-balance-derive-design.md）。
// 四表：Shares（模块战力份额）/ Anchors（体验锚点与毕业快照参数）/ Caps（二级属性上限）/ Overrides（手感例外）。
// 这里是"旋钮"，业务数值由 `npm run balance:derive` 反解产出 derived.values.generated.ts，再经各 seed 写回业务 xlsx。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/balance.xlsx');

// —— Shares：毕业战力份额（合计必须 = 1；skill 留列第二章分配）——
const SHARES_HEADER = ['module', 'share'];
const SHARES_ROWS: (string | number)[][] = [
    ['base', 0.05],          // 白板：绝对锚点（现职业白板值不动，总战力 = 白板 ÷ 0.05）
    ['level', 0.20],
    ['equip', 0.50],
    ['gem', 0.17],
    ['inscription', 0.08],
    ['skill', 0],
];

// —— Anchors：体验锚点（中度：台阶关回刷 5~8 局取中值、全程 25~40 局取中值）——
const ANCHORS_HEADER = ['key', 'value'];
const ANCHORS_ROWS: (string | number)[][] = [
    ['farmRunsPerGate', 6],     // 台阶关回刷局数（反解合成/掉率用中值）
    ['totalRuns', 32],          // 第一章全程局数中值
    ['gradCharLevel', 12],      // 毕业角色等级
    ['gradEquipLevel', 12],     // 毕业装备等级
    ['gradQualityRank', 2.5],   // 毕业品质档（0白1优2稀有3史诗4传说 → 2.5=稀有~史诗）
    ['craftCostRuns', 6],       // 一次合成 ≈ N 局打造石收入
    ['sellReturnRate', 0.18],   // 出售返石 ≈ 合成价 ×18%
    ['gemLevelRatio', 1.6],     // 宝石等比价值比率
    ['inscRollFloor', 0.6],     // 铭文 roll 区间下限 = 上限 ×0.6
    ['qualityStep', 1.35],      // 装备品质阶梯（相邻倍率）
    ['ctxEnemyAtk', 30],        // 战力折算的对手参考攻（现行怪表中坚档，第④步难度导出后校准）
    ['ctxEnemyDef', 8],         // 对手参考防
    // 难度系数（第④步）：作用于模拟标定出的 kPass/卡点带；1.0 = 标定原值。
    // 2026-07-12 按 sim:progress 迭代：真实玩家弱于推进模型（随机掉落/宝石 Boss 专属后前期为零），整体下调
    ['difficultyNormal', 0.75],
    ['difficultyGate', 0.80],
    ['difficultyBoss', 0.70],
];

// —— Caps：二级属性上限（毕业快照不得越限，derive 校验用）——
const CAPS_HEADER = ['key', 'value'];
const CAPS_ROWS: (string | number)[][] = [
    ['critRate', 0.5],
    ['critDmg', 1.5],
    ['attackSpeed', 0.5],
    ['moveSpeedPct', 0.4],
    ['skillHaste', 0.5],
    ['dodgeRate', 0.3],
    ['blockRate', 0.4],
    ['blockRatio', 0.7],
    ['dmgReduce', 0.4],
    ['basicDmgBonus', 0.4],
    ['skillDmgBonus', 0.4],
    ['singleDmgBonus', 0.4],
    ['aoeDmgBonus', 0.4],
    ['dmgBonus', 0.6],
    ['hpPct', 0.4],
    ['atkPct', 0.4],
    ['defPct', 0.4],
];

// —— Overrides：手感例外（target 形如 "equip.slotBonusScale"；调手感不直改派生格）——
const OVERRIDES_HEADER = ['target', 'value', 'reason'];
const OVERRIDES_ROWS: (string | number)[][] = [
    // 示例（留空表头即可；有例外时按行加）：['equip.slotBonusScale', 1.1, '首章装备手感偏肉一点'],
];

const wb = XLSX.utils.book_new();
function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}
addSheet('Shares', SHARES_HEADER, SHARES_ROWS);
addSheet('Anchors', ANCHORS_HEADER, ANCHORS_ROWS);
addSheet('Caps', CAPS_HEADER, CAPS_ROWS);
addSheet('Overrides', OVERRIDES_HEADER, OVERRIDES_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(OUT, buf);

console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Shares(${SHARES_ROWS.length}) Anchors(${ANCHORS_ROWS.length}) Caps(${CAPS_ROWS.length}) Overrides(${OVERRIDES_ROWS.length})`);
