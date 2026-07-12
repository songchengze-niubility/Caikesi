// Effect 管线（Effects）—— 唯一状态变更入口，纯逻辑、不依赖 cc。
// 哲学与 CombatFormula 一致：calcDamage 是唯一伤害公式，applyEffect 是唯一"改变单位状态"的入口。
// 普攻、子弹命中、敌人攻击、技能、Boss 招式、场地效果一律走这里；加内容 = 加 Effect 数据，不改管线。
// 周期跳伤/跳疗（DoT）不走本入口——语义不同（按 srcAtk 快照、无闪避暴击），见 BattleManager._onBuffPeriodic。

import { calcDamage, DamageResult, DamageTags } from './CombatFormula';
import type { CombatStats } from '../config/BattleConfig';
import type { Effect } from '../config/EffectTypes';
import { getBuffDef } from '../config/BuffConfig';
import { applyBuffStack, dispelByTag } from './BuffSystem';
import { CombatUnit, recomputeDerived } from './CombatUnit';

// 伤害/治疗只需要攻击属性——CombatUnit 和 Bullet（携带开火者 stats）都天然满足
export interface EffectSource { stats: CombatStats; }

export type FloatKind = 'normal' | 'crit' | 'block' | 'dodge' | 'skill' | 'heal';

// 由 BattleManager 注入的回调（构造时建一次，不每帧建）
export interface EffectHooks {
    spawnFloat(x: number, y: number, r: DamageResult, kind?: FloatKind): void;
    markDead(u: CombatUnit): void;
    onBuffChanged(target: CombatUnit, buffId: string, applied: boolean, stacks: number): void;
    // 位移需要战场知识（钳制边界、事件），由 BattleManager 实现
    applyKnockback(target: CombatUnit, distance: number): void;
    // 被动钩子（可选）：直击伤害命中未闪避 / 直击致死（DoT 不走本入口天然排除）
    onDamaged?(target: CombatUnit, attacker: CombatUnit | null, damage: number): void;
    onKilled?(attacker: CombatUnit | null, victim: CombatUnit): void;
}

// 攻击者溯源（结构探测，避免引入 BattleManager 类型依赖）：
// CombatUnit 有 side 字段；Projectile/ZoneEffect 带 owner 字段；其余（快照字面量）→ null
function resolveAttacker(source: EffectSource): CombatUnit | null {
    if ((source as { side?: unknown }).side !== undefined) return source as CombatUnit;
    return (source as { owner?: CombatUnit | null }).owner ?? null;
}

export interface EffectOutcome { damage: number; crit: boolean; dodged: boolean; }
const NONE: EffectOutcome = { damage: 0, crit: false, dodged: false };

export function applyEffect(source: EffectSource, target: CombatUnit, effect: Effect, hooks: EffectHooks, floatKind?: FloatKind, tags?: DamageTags): EffectOutcome {
    switch (effect.kind) {
        case 'damage': {
            const r = calcDamage(source.stats, target.stats, tags);
            const damage = r.dodged ? 0 : Math.max(1, Math.round(r.damage * effect.mult));
            target.hp -= damage;
            // mult=1 时 damage===r.damage，直接透传 r（普攻热路径零分配）；倍率伤害才拷贝改写
            hooks.spawnFloat(target.x, target.y, damage === r.damage ? r : { ...r, damage }, floatKind);
            const killed = target.hp <= 0;
            if (killed) hooks.markDead(target);
            if (damage > 0) {
                const attacker = (hooks.onDamaged || hooks.onKilled) ? resolveAttacker(source) : null;
                if (!killed && hooks.onDamaged) hooks.onDamaged(target, attacker, damage);   // 受击（活着才谈受击被动）
                if (killed && hooks.onKilled) hooks.onKilled(attacker, target);
            }
            return { damage, crit: r.crit, dodged: r.dodged };
        }
        case 'heal': {
            const amount = Math.max(1, Math.round(source.stats.atk * effect.mult));
            target.hp = Math.min(target.maxHp, target.hp + amount);
            hooks.spawnFloat(target.x, target.y, { damage: amount, crit: false, blocked: false, dodged: false }, 'heal');
            return NONE;
        }
        case 'applyBuff': {
            const def = getBuffDef(effect.buffId);
            if (!def) return NONE;   // 配置缺失：no-op（导表校验兜底，运行时不炸）
            // DoT 属技能伤害：快照 1+全伤害+技能伤害（不吃单体/群体——周期伤害无目标数概念）
            const srcMult = 1 + source.stats.dmgBonus + source.stats.skillDmgBonus;
            if (applyBuffStack(target.buffs, def, source.stats.atk, effect.stacks, srcMult)) recomputeDerived(target);
            hooks.onBuffChanged(target, effect.buffId, true, effect.stacks);
            return NONE;
        }
        case 'dispel': {
            if (dispelByTag(target.buffs, getBuffDef, effect.tag, effect.count)) {
                recomputeDerived(target);
                hooks.onBuffChanged(target, effect.tag, false, 0);
            }
            return NONE;
        }
        case 'knockback': {
            hooks.applyKnockback(target, effect.distance);
            return NONE;
        }
        case 'summon':      // 第 3 段实装（召唤走刷怪管线）
            return NONE;
    }
}
