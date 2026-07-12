// 角色天赋聚合纯函数（不依赖 cc）：把某职业的投点档汇总成 属性加成 + 已学被动列表。
// stats → EffectiveStats 的 perClassStats（只作用本角色）；passives → 开战追加进单位 passives。
// 被动只取当前级那条 PassiveDef（级间参数递进，非逐级叠加）。

import type { EquipStats, EquipStatKey } from '../inventory/EquipDefs';
import type { PassiveDef } from '../config/SkillConfig';
import { charTalentNodes, charTalentPassiveAt } from './CharTalentConfig';
import { nodeLevelOf, type CharTalentSave } from './CharTalentModel';

export interface CharTalentAggregate {
    stats: EquipStats;
    passives: PassiveDef[];
}

export function emptyCharTalentAggregate(): CharTalentAggregate {
    return { stats: {}, passives: [] };
}

export function charTalentAggregate(save: CharTalentSave | undefined, cls: string): CharTalentAggregate {
    const out = emptyCharTalentAggregate();
    if (!save) return out;
    for (const node of charTalentNodes(cls)) {
        const lv = Math.min(nodeLevelOf(save, cls, node.id), node.maxLevel);
        if (lv <= 0) continue;
        if (node.kind === 'stat') {
            const k = node.statKey as EquipStatKey;
            out.stats[k] = (out.stats[k] ?? 0) + node.valuePerLevel * lv;
        } else {
            const def = charTalentPassiveAt(node.id, lv);
            if (def) out.passives.push(def);
        }
    }
    return out;
}
