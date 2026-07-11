// Effect 管线（Effects）—— 唯一状态变更入口，纯逻辑、不依赖 cc。
// 哲学与 CombatFormula 一致：calcDamage 是唯一伤害公式，applyEffect 是唯一"改变单位状态"的入口。
// 普攻、子弹命中、敌人攻击、技能、Boss 招式、场地效果一律走这里；加内容 = 加 Effect 数据，不改管线。
// 周期跳伤/跳疗（DoT）不走本入口——语义不同（按 srcAtk 快照、无闪避暴击），见 BattleManager._onBuffPeriodic。

import { calcDamage, DamageResult } from './CombatFormula';
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
}

export interface EffectOutcome { damage: number; crit: boolean; dodged: boolean; }
const NONE: EffectOutcome = { damage: 0, crit: false, dodged: false };

export function applyEffect(source: EffectSource, target: CombatUnit, effect: Effect, hooks: EffectHooks, floatKind?: FloatKind): EffectOutcome {
    switch (effect.kind) {
        case 'damage': {
            const r = calcDamage(source.stats, target.stats);
            const damage = r.dodged ? 0 : Math.max(1, Math.round(r.damage * effect.mult));
            target.hp -= damage;
            // mult=1 时 damage===r.damage，直接透传 r（普攻热路径零分配）；倍率伤害才拷贝改写
            hooks.spawnFloat(target.x, target.y, damage === r.damage ? r : { ...r, damage }, floatKind);
            if (target.hp <= 0) hooks.markDead(target);
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
            if (applyBuffStack(target.buffs, def, source.stats.atk, effect.stacks)) recomputeDerived(target);
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
