// 毕业快照构造（balance-model 第 2 层）：按锚点拼"达标玩家"的 roster 面板。
// 复用游戏侧 EffectiveStats.calcEffectiveStats（无 cc 依赖）保证叠算语义一致——
// 快照即"白板 + 五件套(装备+镶嵌折进 item.stats) × (1+等级%)"的真实双层公式。
//
// ⚠️ 求解基线读 templates.ts 模板而非当前生成配置（防"相对已缩放表再解"的漂移回路）；
// 品质倍率/等级斜率/孔数是手值不受 derive 缩放，读 EquipConfig 稳定。
//
// 缩放语义（防二级属性爆表）：kEquip/kGem/kInsc 只缩放一级平铺（hp/atk/def/moveSpeed 及其百分比），
// 暴击/伤害类等二级词条保持模板值（概率型数值不随战力盘子线性放大，Caps 才守得住）；
// kLevel 缩放 TPL.statGrowthPerLevel。

import { BattleConfig, type CombatStats, type SoldierClass } from '../../assets/scripts/config/BattleConfig';
import { EquipConfig } from '../../assets/scripts/config/EquipConfig';
import { calcEffectiveStats } from '../../assets/scripts/combat/EffectiveStats';
import { SLOTS, QUALITIES, type EquipItem, type EquipStats, type EquipStatKey } from '../../assets/scripts/inventory/EquipDefs';
import { TPL } from './templates';

export interface SolveVars { kLevel: number; kEquip: number; kGem: number; kInsc: number }
export interface SnapshotCounts { gems: number; gemAvgLevel: number; inscriptions: number }

// 任意进度点的玩家状态（毕业快照 = coverage 1 + 锚点值的特例；progress.ts 用它拼各关入场/达标面板）
export interface ProgressState {
    qualityRank: number;     // 装备品质分数 0白..4传说（可小数插值）
    equipLevel: number;      // 装备等级
    equipCoverage: number;   // 装备收集覆盖度 0..1（期望已凑齐几成五件套）
    counts: SnapshotCounts;  // 已插宝石/生效铭文（累计期望，孔位封顶）
    charLevel: number;       // 角色等级
}

// 一级平铺键（受 k 缩放）；其余词条键按模板值进快照
const PRIMARY_KEYS = new Set<EquipStatKey>(['hp', 'atk', 'def', 'moveSpeed', 'hpPct', 'atkPct', 'defPct', 'moveSpeedPct']);

// 品质分数（0白..4传说）→ 相邻档几何插值的倍率与词条数
function qualityAt(rank: number): { mult: number; extraStats: number } {
    const clamped = Math.max(0, Math.min(QUALITIES.length - 1, rank));
    const lo = Math.floor(clamped), hi = Math.min(QUALITIES.length - 1, lo + 1);
    const t = clamped - lo;
    const qLo = EquipConfig.qualities[QUALITIES[lo]];
    const qHi = EquipConfig.qualities[QUALITIES[hi]];
    const mult = qLo.multiplier * Math.pow(qHi.multiplier / qLo.multiplier, t);
    const extraStats = qLo.extraStats + (qHi.extraStats - qLo.extraStats) * t;
    return { mult, extraStats };
}

function addStat(out: EquipStats, key: EquipStatKey, v: number) {
    out[key] = (out[key] ?? 0) + v;
}

// 单角色五件套的期望 item 列表（装备主词条+期望词条+分摊的宝石/铭文全部折进 item.stats）
function buildItems(k: SolveVars, state: ProgressState, rosterSize: number): EquipItem[] {
    const { mult, extraStats } = qualityAt(state.qualityRank);
    const lvlCoef = 1 + (Math.max(1, state.equipLevel) - 1) * (EquipConfig.levelScaling?.growthPerLevel ?? 0);
    const coverage = Math.max(0, Math.min(1, state.equipCoverage));
    const scaleFor = (key: EquipStatKey) => (PRIMARY_KEYS.has(key) ? k.kEquip : 1);

    const items: EquipItem[] = SLOTS.map(slot => {
        const stats: EquipStats = {};
        for (const [rowSlot, stat, value] of TPL.slotBonuses) {
            if (rowSlot !== slot) continue;
            const key = stat as EquipStatKey;
            addStat(stats, key, value * mult * lvlCoef * coverage * scaleFor(key));
        }
        // 期望词条：extraStats 条均摊到词条池每一行（value × 期望条数/池大小）
        for (const [stat, value] of TPL.affixes) {
            const key = stat as EquipStatKey;
            addStat(stats, key, value * mult * lvlCoef * coverage * scaleFor(key) * (extraStats / TPL.affixes.length));
        }
        return { id: `snap_${slot}`, slot, name: 'snapshot', quality: 'rare', level: state.equipLevel, stats } as EquipItem;
    });

    // 宝石：全队 counts.gems 颗均摊到本角色（÷rosterSize），类型均摊，等级取均值等比
    const gemsPerChar = state.counts.gems / rosterSize;
    for (const [, , stat, baseValue, , levelRatio] of TPL.gems) {
        const key = stat as EquipStatKey;
        const value = baseValue * Math.pow(levelRatio, Math.max(1, state.counts.gemAvgLevel) - 1);
        const scale = PRIMARY_KEYS.has(key) ? k.kGem : 1;   // 一级属性宝石受 kGem 缩放，暴击/增伤宝石保持模板值
        addStat(items[0].stats!, key, value * scale * (gemsPerChar / TPL.gems.length));
    }
    // 铭文：全队 counts.inscriptions 条均摊，池内每行取区间中值
    const inscPerChar = state.counts.inscriptions / rosterSize;
    for (const [stat, valueMin, valueMax] of TPL.inscriptions) {
        const key = stat as EquipStatKey;
        const mid = (valueMin + valueMax) / 2;
        addStat(items[1].stats!, key, mid * (PRIMARY_KEYS.has(key) ? k.kInsc : 1) * (inscPerChar / TPL.inscriptions.length));
    }
    return items;
}

// 任意进度点面板：roster 全体（默认 BattleConfig.roster）
export function buildPanels(state: ProgressState, k: SolveVars): CombatStats[] {
    const roster = BattleConfig.roster as SoldierClass[];
    const levelPct = k.kLevel * TPL.statGrowthPerLevel * (Math.max(1, state.charLevel) - 1);
    return roster.map(cls => {
        const base = BattleConfig.stats[cls];
        const items = buildItems(k, state, roster.length);
        return calcEffectiveStats(base, items, levelPct);
    });
}

// 毕业快照 = 锚点状态的特例（coverage 1）
export function buildSnapshot(k: SolveVars, counts: SnapshotCounts, anchors: Record<string, number>): CombatStats[] {
    return buildPanels({
        qualityRank: anchors.gradQualityRank,
        equipLevel: anchors.gradEquipLevel,
        equipCoverage: 1,
        counts,
        charLevel: anchors.gradCharLevel,
    }, k);
}
