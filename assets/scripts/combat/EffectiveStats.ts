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
    'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce',
];
const PROB_STATS: (keyof CombatStats)[] = ['critRate', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgReduce'];

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

function normalizeStats(st: CombatStats): CombatStats {
    st.hp = Math.max(1, st.hp);
    st.atk = Math.max(0, st.atk);
    st.def = Math.max(0, st.def);
    st.range = Math.max(0, st.range);
    st.attackSpeed = Math.max(0.01, st.attackSpeed);
    st.critDmg = Math.max(0, st.critDmg);
    st.dmgBonus = Math.max(0, st.dmgBonus);
    for (const k of PROB_STATS) st[k] = clamp(st[k], 0, 1);
    return st;
}

export function calcEffectiveStats(base: CombatStats, items: (EquipItem | null | undefined)[]): CombatStats {
    const out: CombatStats = { ...base };
    for (const item of items) {
        if (!item) continue;
        const inlay = itemInlayStats(item);
        for (const k of STAT_KEYS) {
            const bonus = (item.stats?.[k] ?? 0) + (inlay[k] ?? 0);
            if (bonus) out[k] += bonus;
        }
    }
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
        const scaledBase: CombatStats = level
            ? { ...base, hp: base.hp * charLevelCoef(level), atk: base.atk * charLevelCoef(level) }
            : base;
        const slots = equipped?.[c];
        map[cls] = calcEffectiveStats(scaledBase, slots ? SLOTS.map(s => slots[s]) : []);
    }
    return map;
}
