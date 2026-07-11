// 被动系统（PassiveSystem）—— 纯逻辑，不依赖 cc，注入 rng 可单测。
// 被动 = 配置数据（PassiveDef，见 SkillConfig），本模块只做触发过滤/掷骰/目标解析；
// 效果落地由调用方（BattleManager._firePassives）经 applyEffect 执行，并负责一层防递归。
// 语义（spec 2026-07-11-combat-flow2-design.md）：
//   always  = 开战常驻/光环（applyAlwaysPassives，无掷骰）
//   onHit   = 普攻命中（近战直击 + 普攻弹道命中，技能伤害不算）
//   onHurt  = 受击（applyEffect 直击伤害命中未闪避，DoT 不算）
//   onKill  = 击杀（直击致死且凶手可溯源；DoT 击杀不触发）
//   onCast  = 释放主动技能后
// targetMode：trigger=事件对象 / self=自己 / team=全队存活者。

import type { PassiveDef } from '../config/SkillConfig';
import type { CombatUnit } from './CombatUnit';
import type { Effect } from '../config/EffectTypes';

export type PassiveHook = 'onHit' | 'onHurt' | 'onKill' | 'onCast';

function applyToTargets(
    def: PassiveDef,
    owner: CombatUnit,
    other: CombatUnit | null,
    allies: readonly CombatUnit[],
    apply: (target: CombatUnit, eff: Effect) => void,
): void {
    if (def.targetMode === 'self') {
        for (const eff of def.effects) apply(owner, eff);
        return;
    }
    if (def.targetMode === 'trigger') {
        if (!other || !other.alive) return;
        for (const eff of def.effects) apply(other, eff);
        return;
    }
    // team：全队存活者
    for (const u of allies) {
        if (!u.alive) continue;
        for (const eff of def.effects) apply(u, eff);
    }
}

// 条件触发：过滤 trigger===hook → chance 掷骰 → 目标解析逐效果 apply
export function firePassives(
    passives: readonly PassiveDef[],
    hook: PassiveHook,
    owner: CombatUnit,
    other: CombatUnit | null,
    allies: readonly CombatUnit[],
    apply: (target: CombatUnit, eff: Effect) => void,
    rng: () => number = Math.random,
): void {
    for (const def of passives) {
        if (def.trigger !== hook) continue;
        if (def.chance < 1 && rng() >= def.chance) continue;
        applyToTargets(def, owner, other, allies, apply);
    }
}

// 开战常驻/光环：trigger==='always' 无掷骰（导表已校验 chance=1）
export function applyAlwaysPassives(
    passives: readonly PassiveDef[],
    owner: CombatUnit,
    allies: readonly CombatUnit[],
    apply: (target: CombatUnit, eff: Effect) => void,
): void {
    for (const def of passives) {
        if (def.trigger !== 'always') continue;
        applyToTargets(def, owner, null, allies, apply);
    }
}
