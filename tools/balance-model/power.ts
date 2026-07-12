// 战力口径（balance-model 第 1 层）：power = √(DPS × EHP)，18 维全折算。
// 几何均值防单边堆叠刷分（纯堆攻或纯堆血的战力增速都是 √k）。
// 减法公式下 atk/def 的价值依赖对手，ctx 提供同期怪物参考值（balance.xlsx/Anchors 的 ctxEnemy*；
// 第④步难度导出后按新怪物曲线校准）。range/moveSpeed 是功能维度，不进战力。
// 伤害分类加成按经验覆盖率折算期望：普攻 0.7 / 技能 0.3、单体 0.6 / 群体 0.4；
// 技能急速按"技能伤害占比 0.3"折算成 DPS 增益（技能频率 ∝ 1+急速）。

import type { CombatStats } from '../../assets/scripts/config/BattleConfig';

export interface PowerCtx {
    enemyAtk: number;      // 对手参考攻（EHP 折算防御减伤用）
    enemyDef: number;      // 对手参考防（DPS 折算减法伤害用）
    minDamageRate: number; // 保底伤害率（镜像 BattleConfig.combat.minDamageRate）
}

// 伤害分类覆盖率（经验权重，与 CombatFormula 的同乘区加算口径一致）
const W_BASIC = 0.7;
const W_SKILL = 0.3;
const W_SINGLE = 0.6;
const W_AOE = 0.4;

export function dpsOf(st: CombatStats, ctx: PowerCtx): number {
    const perHit = Math.max(st.atk - ctx.enemyDef, st.atk * ctx.minDamageRate);
    const critMult = 1 + st.critRate * st.critDmg;
    const dmgMult = 1 + st.dmgBonus
        + st.basicDmgBonus * W_BASIC + st.skillDmgBonus * W_SKILL
        + st.singleDmgBonus * W_SINGLE + st.aoeDmgBonus * W_AOE;
    const hasteMult = 1 + st.skillHaste * W_SKILL;   // 急速只加速技能份额的输出频率
    return perHit * st.attackSpeed * critMult * dmgMult * hasteMult;
}

export function ehpOf(st: CombatStats, ctx: PowerCtx): number {
    // 防御估值用平滑线性 1+def/enemyAtk，不用真实减法+保底公式——
    // 后者在 def→enemyAtk 时 defMult 悬崖式飙向 1/minDamageRate（10×），
    // 解算器会去薅"廉价防御"导致产出畸形；估值模型只需单调合理，不必逐帧精确。
    const defMult = 1 + st.def / Math.max(1, ctx.enemyAtk);
    const avoid = (1 - st.dodgeRate) * (1 - st.blockRate * st.blockRatio) * (1 - st.dmgReduce);
    return st.hp * defMult / Math.max(0.01, avoid);
}

export function powerOf(st: CombatStats, ctx: PowerCtx): number {
    return Math.sqrt(dpsOf(st, ctx) * ehpOf(st, ctx));
}

// 小队战力 = 各面板战力求和（roster 由调用方给，医师 atk=0 时 DPS 走保底不为负）
export function teamPower(panels: CombatStats[], ctx: PowerCtx): number {
    let sum = 0;
    for (const p of panels) sum += powerOf(p, ctx);
    return sum;
}
