// Buff 系统（BuffSystem）—— 纯函数，不依赖 cc，可 tsx 单测。
// 实例只存 {id, stacks, remaining, periodAccum, srcAtk}，定义查 BuffConfig（config-driven）。
// srcAtk：施加时快照施法者 atk，周期跳伤/跳疗用它结算（DoT 不走 calcDamage、无闪避暴击，可预期）。
// 属性聚合走脏标记：只有 applyBuffStack/dispel/到期返回 true 时才需要重算 buffedStats/buffGate，
// 战斗帧的 tickBuffs 快路径零分配（swap-remove 参考 BattleManager._cleanupDeadEnemies）。

import type { BuffDef } from '../config/BuffConfig';
import type { CombatStats } from '../config/BattleConfig';
import { normalizeStats } from './EffectiveStats';

export interface BuffInstance {
    id: string;
    stacks: number;
    remaining: number;
    periodAccum: number;
    srcAtk: number;    // 施加时的施法者 atk 快照
    srcMult: number;   // 施加时快照 1+全伤害+技能伤害（DoT 跳伤乘它；HoT 跳疗不乘）
}

export interface BehaviorGate { canMove: boolean; canAct: boolean; canCast: boolean; taunting: boolean; }

// 上/叠一层。已有实例：refresh 重置时长、add 叠层钳 maxStacks 且重置时长；都刷新 srcAtk/srcMult 快照。
// 返回是否需要重算属性/门。
export function applyBuffStack(buffs: BuffInstance[], def: BuffDef, srcAtk: number, stacks = 1, srcMult = 1): boolean {
    for (const inst of buffs) {
        if (inst.id !== def.id) continue;
        inst.remaining = def.duration;
        inst.srcAtk = srcAtk;
        inst.srcMult = srcMult;
        if (def.stackRule === 'add') {
            const next = Math.min(def.maxStacks, inst.stacks + stacks);
            const changed = next !== inst.stacks;
            inst.stacks = next;
            return changed;
        }
        return false;   // refresh：层数没变，属性聚合不变
    }
    buffs.push({ id: def.id, stacks: Math.min(def.maxStacks, Math.max(1, stacks)), remaining: def.duration, periodAccum: 0, srcAtk, srcMult });
    return true;
}

// 驱散：按 dispelTag 移除至多 count 个；返回是否有移除。
export function dispelByTag(buffs: BuffInstance[], getDef: (id: string) => BuffDef | undefined, tag: string, count: number): boolean {
    if (!tag || count <= 0) return false;
    let removed = 0;
    let w = 0;
    for (let i = 0; i < buffs.length; i++) {
        const def = getDef(buffs[i].id);
        if (removed < count && def && def.dispelTag === tag) { removed++; continue; }
        buffs[w++] = buffs[i];
    }
    buffs.length = w;
    return removed > 0;
}

// 每帧：时长递减、周期触发（单帧可跨多周期补触发）、到期移除。返回是否有移除（需要重算）。
export function tickBuffs(
    buffs: BuffInstance[], dt: number,
    getDef: (id: string) => BuffDef | undefined,
    onPeriodic: (def: BuffDef, inst: BuffInstance) => void,
    onExpired: (def: BuffDef) => void,
): boolean {
    let w = 0;
    let dirty = false;
    for (let i = 0; i < buffs.length; i++) {
        const inst = buffs[i];
        const def = getDef(inst.id);
        if (!def) { dirty = true; continue; }   // 配置被删的孤儿实例直接清掉
        const permanent = def.duration === -1;   // 永久 Buff（常驻/光环被动）：不递减、永不到期
        if (!permanent) inst.remaining -= dt;
        if (def.period > 0 && def.periodicEffect) {
            inst.periodAccum += dt;
            while (inst.periodAccum >= def.period) {
                inst.periodAccum -= def.period;
                onPeriodic(def, inst);
            }
        }
        if (!permanent && inst.remaining <= 0) {
            dirty = true;
            onExpired(def);
            continue;
        }
        buffs[w++] = inst;
    }
    buffs.length = w;
    return dirty;
}

// base + 全部 buff 的 statMods（flat×层数、base×pct×层数）→ 新对象，normalizeStats 钳制。不改 base。
export function buffedStats(base: CombatStats, buffs: BuffInstance[], getDef: (id: string) => BuffDef | undefined): CombatStats {
    const out: CombatStats = { ...base };
    for (const inst of buffs) {
        const def = getDef(inst.id);
        if (!def) continue;
        for (const m of def.statMods) {
            out[m.key] += m.flat * inst.stacks + base[m.key] * m.pct * inst.stacks;
        }
    }
    return normalizeStats(out);
}

// 行为门聚合：stun 禁动禁攻禁技；silence 只禁技能释放（进度照走）；taunt 标记吸引火力。
export function buffGate(buffs: BuffInstance[], getDef: (id: string) => BuffDef | undefined): BehaviorGate {
    let canMove = true, canAct = true, canCast = true, taunting = false;
    for (const inst of buffs) {
        const def = getDef(inst.id);
        if (!def) continue;
        for (const f of def.flags) {
            if (f === 'stun') { canMove = false; canAct = false; canCast = false; }
            else if (f === 'silence') canCast = false;
            else if (f === 'taunt') taunting = true;
        }
    }
    return { canMove, canAct, canCast, taunting };
}
