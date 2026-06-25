// 战斗公式（CombatFormula）—— 所有伤害结算的唯一入口
// 结算顺序：闪避 → 减法基础 → 暴击 → 格挡 → 伤害加成(攻) → 伤害减免(防)。
// 攻防双方都传统一的 CombatStats，加新维度只改这一个文件。

import { BattleConfig, CombatStats } from '../config/BattleConfig';

// 一次伤害结算的结果（damage=0 且 dodged 表示被闪避）
export interface DamageResult {
    damage: number;
    crit: boolean;
    blocked: boolean;
    dodged: boolean;
}

const NONE: DamageResult = { damage: 0, crit: false, blocked: false, dodged: false };

export function calcDamage(att: CombatStats, def: CombatStats): DamageResult {
    if (att.atk <= 0) return NONE;

    // 1) 闪避：完全免伤
    if (Math.random() < def.dodgeRate) {
        return { damage: 0, crit: false, blocked: false, dodged: true };
    }

    // 2) 减法基础伤害（带保底）
    let dmg = Math.max(att.atk - def.def, att.atk * BattleConfig.combat.minDamageRate);

    // 3) 暴击：× (1 + 暴击伤害加成)
    let crit = false;
    if (Math.random() < att.critRate) {
        dmg *= (1 + att.critDmg);
        crit = true;
    }

    // 4) 格挡：按比例减伤
    let blocked = false;
    if (Math.random() < def.blockRate) {
        dmg *= (1 - def.blockRatio);
        blocked = true;
    }

    // 5) 伤害加成（攻击方） 6) 伤害减免（防御方）
    dmg *= (1 + att.dmgBonus);
    dmg *= (1 - def.dmgReduce);

    return { damage: Math.max(1, Math.round(dmg)), crit, blocked, dodged: false };
}
