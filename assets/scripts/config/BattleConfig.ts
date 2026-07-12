// 战斗数值配置表（BattleConfig）
// ★★★ 数值现在由 Excel 管理 ★★★
//    源文件：tools/config-xlsx/battle.xlsx
//    改数值流程：编辑 Excel → 跑 `npm run config` → 生成 battle.config.generated.ts
//    本文件只保留 TypeScript 类型定义；数值对象 BattleConfig 直接引用生成产物。
//
// 整体竖屏，核心战斗【横向展开】：原点在屏幕中心，向右 x 增大、向左 x 减小。
//   小队在左边（前列坦克迎敌、后列输出/治疗），敌人从右边进场向左推进，集中在中部横向带。

import { generatedBattleConfig } from './battle.config.generated';

export type SoldierClass = 'tank' | 'dps' | 'healer';
// 攻击方式：melee 近战(贴身劈) / ranged 远程(发子弹) / heal 治疗(奶血不攻击)
export type AttackType = 'melee' | 'ranged' | 'heal';

// —— 统一战斗属性 —— 角色和怪都共用这一套属性，加新维度只改这里和公式。
export interface CombatStats {
    hp: number;          // 生命
    atk: number;         // 攻击力
    def: number;         // 防御力
    range: number;       // 攻击距离（远程=开火距离；近战=贴脸距离；可被装备/Buff 加成）
    attackSpeed: number; // 攻速倍率（实际攻击间隔 = 基础间隔 / attackSpeed）
    critRate: number;    // 暴击率
    critDmg: number;     // 暴击伤害加成（0.5 = 暴击多打 50%，即 1.5 倍）
    dodgeRate: number;   // 闪避率（防御方，完全免伤）
    blockRate: number;   // 格挡率（防御方）
    blockRatio: number;  // 格挡减伤比例
    dmgBonus: number;    // 全伤害加成（无条件生效，攻击方，最终伤害 ×(1+合计加成)，见 CombatFormula 同乘区加算）
    dmgReduce: number;   // 伤害减免（防御方，最终伤害 ×(1-dmgReduce)）
    moveSpeed: number;   // 移动速度（像素/秒）：近战冲锋/怪物推进/全队行军共用，可被装备/Buff 加减速
    skillHaste: number;     // 技能急速：计时型技能计时 ×(1+急速)；计数型所需普攻次数 ÷(1+急速)（向上取整，保底 1）
    basicDmgBonus: number;  // 普攻伤害加成（只吃普攻及普攻弹道）
    skillDmgBonus: number;  // 技能伤害加成（技能效果/技能弹道/场地/DoT）
    singleDmgBonus: number; // 单体伤害加成（本次结算目标数=1）
    aoeDmgBonus: number;    // 群体伤害加成（本次结算为 aoe/多目标）
}

// —— 一种怪物类型（图鉴）：自己的属性 + 移动/体型/外观 ——
export interface EnemyType {
    name: string;          // 名字（飘字/调试用）
    stats: CombatStats;    // 战斗属性（含 moveSpeed 推进速度）
    radius: number;        // 体型 + 命中半径
    attackInterval: number;// 基础贴身攻击间隔（秒）
    color: [number, number, number]; // 占位色块颜色 RGB
    exp: number;           // 击杀经验：喂给全部上阵角色
}

// —— 关卡编排 ——
export interface SpawnGroup {
    type: string;     // 对应 enemyTypes 的 key
    count: number;    // 这组刷多少只
    interval: number; // 这组每只的出怪间隔（秒）
    hp?: number;      // 可选：覆盖该类型的基础血量（做关卡难度递增）
}
export interface Wave {
    spawns: SpawnGroup[];  // 这一波要刷的怪（可多种混合，同时按各自间隔刷）
    distance: number;      // 清完本波后行军到下一个刷怪点的距离（像素）；末波该值无效
}
export interface Level {
    name: string;
    dropGroup: string;     // 胜利奖励掉落组 id；具体权重见 drop.xlsx
    enemyScale?: number;   // 本关怪物 hp/atk 统一缩放（难度导出列，balance:derive 产出；缺省 1）
    waves: Wave[];
}

// ★ 数值对象：直接引用 Excel 导出生成产物（结构与历史上手写版完全一致）。
//   生成器：tools/excel-to-config.ts（读 tools/config-xlsx/battle.xlsx）。
//   BattleManager 持有该对象内部引用用于实时调参，ConfigPanel 通过 setter 写回——
//   因此产物的结构必须保持与下方类型定义一致（生成器已保证）。
export interface BattleConfigData {
    stats: Record<SoldierClass, CombatStats>;
    enemyTypes: Record<string, EnemyType>;
    levels: Level[];
    startLevel: number;
    squadCap: number;
    charGrowth: {
        expBase: number;
        expGrowthPerLevel: number;   // 第 1 段每级增长率（升到 lv < expSeg2Start 的步）
        statGrowthPerLevel: number;
        maxLevel: number;
        // 经验曲线分段（2026-07-11，防纯几何到 100 级爆炸；缺省 = 单段旧公式）
        expSeg2Start?: number;   // 第 2 段起始等级（升到该级那步起用 expSeg2Growth）
        expSeg2Growth?: number;
        expSeg3Start?: number;
        expSeg3Growth?: number;
    };
    combat: { minDamageRate: number };
    classes: Record<SoldierClass, {
        attackType: AttackType;
        fireInterval: number;
        advanceLimit: number;
        healPerSec: number;
        size: number;
    }>;
    roster: SoldierClass[];
    layout: { frontMargin: number; spacing: number };
    bullet: { speed: number; radius: number };
    formation: { contactGap: number };
    scene: {
        horizonY: number;
        skyTop: [number, number, number];
        skyBottom: [number, number, number];
        groundTop: [number, number, number];
        groundBottom: [number, number, number];
        cloud: { count: number; color: [number, number, number]; speed: number };
        hill: { color: [number, number, number]; speed: number };
        groundScroll: number;
    };
}

export const BattleConfig: BattleConfigData = generatedBattleConfig;
