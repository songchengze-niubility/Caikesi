// 装备 → 战斗属性的纯计算层。
// InventoryModel 只存装备；BattleManager 只吃 CombatStats；这里负责把两边接起来。

import { BattleConfig, CombatStats, SoldierClass } from '../config/BattleConfig';
import { CHARACTERS, EquipItem, SLOTS } from '../inventory/EquipDefs';
import type { CharEquipped } from '../inventory/InventoryModel';
import { charLevelCoef } from '../growth/CharGrowthConfig';
import { itemInlayStats } from '../inlay/InlayStats';

export type EffectiveStatsMap = Partial<Record<SoldierClass, CombatStats>>;

const STAT_KEYS: (keyof CombatStats)[] = [
    'hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg',
    'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce', 'moveSpeed',
    'skillHaste', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus', 'aoeDmgBonus',
];
const PROB_STATS: (keyof CombatStats)[] = ['critRate', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgReduce'];

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

export function normalizeStats(st: CombatStats): CombatStats {
    st.hp = Math.max(1, st.hp);
    st.atk = Math.max(0, st.atk);
    st.def = Math.max(0, st.def);
    st.range = Math.max(0, st.range);
    st.attackSpeed = Math.max(0.01, st.attackSpeed);
    st.critDmg = Math.max(0, st.critDmg);
    st.dmgBonus = Math.max(0, st.dmgBonus);
    st.moveSpeed = Math.max(0, st.moveSpeed);
    st.skillHaste = Math.max(0, st.skillHaste);
    st.basicDmgBonus = Math.max(0, st.basicDmgBonus);
    st.skillDmgBonus = Math.max(0, st.skillDmgBonus);
    st.singleDmgBonus = Math.max(0, st.singleDmgBonus);
    st.aoeDmgBonus = Math.max(0, st.aoeDmgBonus);
    for (const k of PROB_STATS) st[k] = clamp(st[k], 0, 1);
    return st;
}

// 百分比键 → 作用的面板键。双层公式（2026-07-11）：面板 = (白板+固定) × (1+百分比合计)
const PCT_MAP = { hpPct: 'hp', atkPct: 'atk', defPct: 'def', moveSpeedPct: 'moveSpeed' } as const;
type PctKey = keyof typeof PCT_MAP;
const PCT_KEYS = Object.keys(PCT_MAP) as PctKey[];

// levelPct：角色等级的三围百分比（乘全池——白板+装备+宝石一起放大；不作用 moveSpeed）
export function calcEffectiveStats(base: CombatStats, items: (EquipItem | null | undefined)[], levelPct = 0): CombatStats {
    const out: CombatStats = { ...base };
    const pct = { hp: levelPct, atk: levelPct, def: levelPct, moveSpeed: 0 };
    for (const item of items) {
        if (!item) continue;
        const inlay = itemInlayStats(item);
        for (const k of STAT_KEYS) {
            const bonus = (item.stats?.[k] ?? 0) + (inlay[k] ?? 0);
            if (bonus) out[k] += bonus;
        }
        for (const pk of PCT_KEYS) {
            const bonus = (item.stats?.[pk] ?? 0) + (inlay[pk] ?? 0);
            if (bonus) pct[PCT_MAP[pk]] += bonus;
        }
    }
    out.hp = Math.round(out.hp * (1 + pct.hp));
    out.atk = Math.round(out.atk * (1 + pct.atk));
    out.def = Math.round(out.def * (1 + pct.def));
    out.moveSpeed = Math.round(out.moveSpeed * (1 + pct.moveSpeed));
    return normalizeStats(out);
}

// levels 缺省/角色缺项 = 不做等级缩放（向后兼容，pacing-sim 不传即纯装备档位）。
export function buildEffectiveStatsMap(
    equipped: CharEquipped | undefined,
    levels: Partial<Record<SoldierClass, number>> = {},
): EffectiveStatsMap {
    const map: EffectiveStatsMap = {};
    for (const c of CHARACTERS) {
        const cls = c as SoldierClass;
        const base = BattleConfig.stats[cls];
        if (!base) continue;
        const level = levels[cls];
        const slots = equipped?.[c];
        // 等级 = 三围百分比乘全池（旧行为只放大白板 hp/atk；2026-07-11 双层公式改此，含 def）
        map[cls] = calcEffectiveStats(base, slots ? SLOTS.map(s => slots[s]) : [], level ? charLevelCoef(level) - 1 : 0);
    }
    return map;
}
