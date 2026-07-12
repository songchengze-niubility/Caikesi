// 统一单位模型（CombatUnit）—— 士兵与敌人共用一套类型，纯数据、不依赖 cc。
// 设计动机：Buff/控制/位移等"对任意单位生效"的机制只写一遍（见 spec 2026-07-11-combat-framework-design.md）。
// BattleManager 仍持 soldiers[]/enemies[] 两个数组（渲染层遍历方式不变），差异走 side + archetype。
//
// stats 双引用约定（重要）：
//   baseStats = 开战面板（装备/等级/镶嵌产物，或配置表引用——ConfigPanel 实时调参依赖这个引用）。
//   stats     = 战时属性：无 buff 时【就是 baseStats 同一引用】（调参实时生效）；
//               有 buff 时为 buffedStats 聚合出的副本，增删/叠层时经 recomputeDerived 重算（脏标记）。

import { BattleConfig, SoldierClass, AttackType, CombatStats } from '../config/BattleConfig';
import { getBuffDef } from '../config/BuffConfig';
import { passivesForClass, type PassiveDef } from '../config/SkillConfig';
import { buffedStats, buffGate, type BehaviorGate, type BuffInstance } from './BuffSystem';
import { UnitSkills, unitSkillsForClass } from './SkillRuntime';

export type UnitAction = 'idle' | 'run' | 'attack' | 'death';
export type UnitSide = 'ally' | 'enemy';

export interface CombatUnit {
    id: number;
    side: UnitSide;
    key: string;               // 职业 cls（ally）或怪物类型 key（enemy）
    displayName: string;
    archetype: AttackType;     // 'melee' | 'ranged' | 'heal'
    x: number; y: number;
    homeX: number; homeY: number;
    baseStats: CombatStats;
    stats: CombatStats;
    hp: number; maxHp: number;
    attackInterval: number;    // 基础攻击间隔（治疗为 0）；移动速度在 stats.moveSpeed（Buff 可减速）
    advanceLimit: number;      // 近战离原站位最多前压多远；敌人为 0（推进逻辑不走它）
    healPerSec: number;        // 每秒治疗量（非治疗为 0）
    radius: number;            // 体型/命中半径（士兵未使用，填 0）
    color: [number, number, number] | null;
    cd: number;                // 攻击冷却
    alive: boolean;
    action: UnitAction;
    actionTime: number;
    actionLock: number;
    buffs: BuffInstance[];
    gate: BehaviorGate;
    skills: UnitSkills | null;
    passives: PassiveDef[];   // 被动技能定义（士兵按职业装载；敌人空，第 3 段 Boss 可挂）
}

// 士兵工厂：字段映射自原 BattleManager._setupSquad
export function createSoldierUnit(id: number, cls: SoldierClass, stats: CombatStats, homeX: number, homeY: number): CombatUnit {
    const cdef = BattleConfig.classes[cls];
    return {
        id,
        side: 'ally',
        key: cls,
        displayName: cls,
        archetype: cdef.attackType,
        x: homeX, y: homeY,
        homeX, homeY,
        baseStats: stats,
        stats,
        hp: stats.hp, maxHp: stats.hp,
        attackInterval: cdef.fireInterval,
        advanceLimit: cdef.advanceLimit,
        healPerSec: cdef.healPerSec,
        radius: 0,
        color: null,
        cd: Math.random() * Math.max(cdef.fireInterval, 0.3),
        alive: true,
        action: 'idle', actionTime: 0, actionLock: 0,
        buffs: [],
        gate: { canMove: true, canAct: true, canCast: true, taunting: false },
        skills: unitSkillsForClass(cls),
        passives: passivesForClass(cls),
    };
}

// 敌人工厂：字段映射自原 BattleManager._spawnEnemyOfType。
// scale：关卡难度统一缩放（Levels.enemyScale，2026-07-12）——hp/atk/hp覆盖 全部 ×scale
// （spawn 行 hp 覆盖编码的是"该行怪的基准血量"，缩放照乘，保持旧难度形状整体平移）；
// scale=1 时保持 stats===配置引用（ConfigPanel 实时调参依赖）。
export function createEnemyUnit(id: number, type: string, hpOverride: number | undefined, x: number, y: number, scale = 1): CombatUnit | null {
    const t = BattleConfig.enemyTypes[type];
    if (!t) return null;
    const scaled = scale !== 1
        ? { ...t.stats, hp: Math.round(t.stats.hp * scale), atk: Math.round(t.stats.atk * scale) }
        : t.stats;
    const hp = hpOverride !== undefined ? Math.round(hpOverride * scale) : scaled.hp;
    return {
        id,
        side: 'enemy',
        key: type,
        displayName: t.name,
        archetype: 'melee',
        x, y,
        homeX: x, homeY: y,
        baseStats: scaled,
        stats: scaled,
        hp, maxHp: hp,
        attackInterval: t.attackInterval,
        advanceLimit: 0,
        healPerSec: 0,
        radius: t.radius,
        color: t.color,
        cd: t.attackInterval * 0.5,
        alive: true,
        action: 'run', actionTime: 0, actionLock: 0,
        buffs: [],
        gate: { canMove: true, canAct: true, canCast: true, taunting: false },
        skills: null,
        passives: [],
    };
}

// Buff 增删/叠层后的脏重算：stats（无 buff 恢复 baseStats 引用）与行为门。
export function recomputeDerived(u: CombatUnit): void {
    u.stats = u.buffs.length === 0 ? u.baseStats : buffedStats(u.baseStats, u.buffs, getBuffDef);
    const g = buffGate(u.buffs, getBuffDef);
    u.gate.canMove = g.canMove;
    u.gate.canAct = g.canAct;
    u.gate.canCast = g.canCast;
    u.gate.taunting = g.taunting;
}
