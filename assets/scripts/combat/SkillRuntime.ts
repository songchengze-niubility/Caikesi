// 技能运行态（SkillRuntime）—— 纯逻辑，不依赖 cc。
// 每个单位持一份 UnitSkills（挂在单位实例上，后续 Boss 技能可复用）：
// 装载技能定义，维护计时/计数；触发条件满足但选不到目标时保留待放，
// 有目标的第一帧释放并重置。伤害结算不在这里——BattleManager 拿到
// collectCasts 结果后走 CombatFormula.calcDamage。

import { SkillDef, skillsForClass } from '../config/SkillConfig';

export interface SkillTargetable {
    x: number;
    y: number;
    alive: boolean;
}

interface SkillState {
    def: SkillDef;
    timer: number;          // timer 型已积累秒数（就绪后继续积累无副作用，释放时清零）
    attackCounter: number;  // attackCount 型已积累普攻次数
}

export interface SkillCast<T extends SkillTargetable> {
    def: SkillDef;
    targets: T[];
}

export function selectTargets<T extends SkillTargetable>(
    def: SkillDef, cx: number, cy: number, enemies: readonly T[], currentTarget: T | null,
): T[] {
    if (def.target === 'single') {
        return currentTarget && currentTarget.alive ? [currentTarget] : [];
    }
    const alive = enemies.filter(e => e.alive);
    if (def.target === 'aoe') {
        const r2 = def.radius * def.radius;
        return alive.filter(e => {
            const dx = e.x - cx, dy = e.y - cy;
            return dx * dx + dy * dy <= r2;
        });
    }
    // nearest：按距离升序取前 maxTargets 个
    return alive
        .map(e => ({ e, d: (e.x - cx) * (e.x - cx) + (e.y - cy) * (e.y - cy) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, Math.max(1, Math.floor(def.maxTargets)))
        .map(x => x.e);
}

export class UnitSkills {
    private states: SkillState[];

    // 技能急速（来自面板 skillHaste，BattleManager 每帧刷新，Buff 增减急速自然生效；0 = 无加速）
    haste = 0;

    constructor(defs: SkillDef[]) {
        this.states = defs.map(def => ({ def, timer: 0, attackCounter: 0 }));
    }

    get count(): number { return this.states.length; }
    defAt(i: number): SkillDef | undefined { return this.states[i]?.def; }

    // 触发门槛：timer 型原值（急速加在计时增速上）；attackCount 型所需次数 ÷(1+急速) 向上取整、保底 1
    private _required(st: SkillState): number {
        if (st.def.trigger === 'timer') return st.def.triggerValue;
        return Math.max(1, Math.ceil(st.def.triggerValue / (1 + this.haste)));
    }

    tick(dt: number) {
        for (const st of this.states) {
            if (st.def.trigger === 'timer') st.timer += dt * (1 + this.haste);
        }
    }

    onBasicAttack() {
        for (const st of this.states) {
            if (st.def.trigger === 'attackCount') st.attackCounter += 1;
        }
    }

    // 触发进度 0~1（就绪后钳在 1），渲染层画遮罩直接用
    progress(i: number): number {
        const st = this.states[i];
        if (!st) return 0;
        const v = st.def.trigger === 'timer' ? st.timer : st.attackCounter;
        return Math.max(0, Math.min(1, v / this._required(st)));
    }

    private _ready(st: SkillState): boolean {
        const v = st.def.trigger === 'timer' ? st.timer : st.attackCounter;
        return v >= this._required(st);
    }

    // 收集本帧可释放的技能：就绪且选得到目标才出手并重置；选不到目标保留待放
    collectCasts<T extends SkillTargetable>(
        cx: number, cy: number, enemies: readonly T[], currentTarget: T | null,
    ): SkillCast<T>[] {
        const casts: SkillCast<T>[] = [];
        for (const st of this.states) {
            if (!this._ready(st)) continue;
            const targets = selectTargets(st.def, cx, cy, enemies, currentTarget);
            if (targets.length === 0) continue;   // 保留待放
            if (st.def.trigger === 'timer') st.timer = 0;
            else st.attackCounter = 0;
            casts.push({ def: st.def, targets });
        }
        return casts;
    }
}

export function unitSkillsForClass(cls: string): UnitSkills {
    return new UnitSkills(skillsForClass(cls));
}
