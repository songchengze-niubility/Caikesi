// 心法聚合纯函数（不依赖 cc）：把 TalentSave 汇总成四类加成，供组合根注入各消费方。
// stats → EffectiveStats（全上阵角色）；econ → 结算/离线；drop → 掉落品质；unlocks → 功能开关。

import type { EquipStats, EquipStatKey } from '../inventory/EquipDefs';
import { talentNodes } from './TalentConfig';
import { nodeLevel, type TalentSave } from './TalentModel';

export interface TalentAggregate {
    stats: EquipStats;
    econ: { gold: number; exp: number; offlineRate: number };
    drop: { equipQuality: number };
    unlocks: { squadSlot3: boolean; chestCapacity: number; autoSell: boolean; offlineCap: number };
}

export function emptyTalentAggregate(): TalentAggregate {
    return {
        stats: {},
        econ: { gold: 0, exp: 0, offlineRate: 0 },
        drop: { equipQuality: 0 },
        unlocks: { squadSlot3: false, chestCapacity: 0, autoSell: false, offlineCap: 0 },
    };
}

export function talentAggregate(save: TalentSave | undefined): TalentAggregate {
    const out = emptyTalentAggregate();
    if (!save) return out;
    for (const node of talentNodes()) {
        const lv = nodeLevel(save, node.id);
        if (lv <= 0) continue;
        const total = node.valuePerLevel * Math.min(lv, node.maxLevel);
        if (node.effectKind === 'stat') {
            const k = node.effectKey as EquipStatKey;
            out.stats[k] = (out.stats[k] ?? 0) + total;
        } else if (node.effectKind === 'econ') {
            if (node.effectKey === 'gold') out.econ.gold += total;
            else if (node.effectKey === 'exp') out.econ.exp += total;
            else if (node.effectKey === 'offlineRate') out.econ.offlineRate += total;
        } else if (node.effectKind === 'drop') {
            if (node.effectKey === 'equipQuality') out.drop.equipQuality += total;
        } else if (node.effectKind === 'unlock') {
            if (node.effectKey === 'squadSlot3') out.unlocks.squadSlot3 = true;
            else if (node.effectKey === 'chestCapacity') out.unlocks.chestCapacity += total;
            else if (node.effectKey === 'autoSell') out.unlocks.autoSell = true;
            else if (node.effectKey === 'offlineCap') out.unlocks.offlineCap += total;
        }
    }
    return out;
}
