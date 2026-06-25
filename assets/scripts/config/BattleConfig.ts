// 战斗数值配置表（BattleConfig）
// ★★★ 这是给策划（你）改的文件 ★★★
// 整体竖屏，核心战斗【横向展开】：原点在屏幕中心，向右 x 增大、向左 x 减小。
//   小队在左边（前列坦克迎敌、后列输出/治疗），敌人从右边进场向左推进，集中在中部横向带。

export type SoldierClass = 'tank' | 'dps' | 'healer';
export type UnitKind = SoldierClass | 'enemy';           // 含敌人的全部单位类型
// 攻击方式：melee 近战(贴身劈) / ranged 远程(发子弹) / heal 治疗(奶血不攻击)
export type AttackType = 'melee' | 'ranged' | 'heal';

// —— 统一战斗属性 —— 所有单位（角色 + 怪）共用这一套属性，加新维度只改这里和公式。
export interface CombatStats {
    hp: number;          // 生命（敌人的 hp 由 waves 覆盖，这里可填 0）
    atk: number;         // 攻击力
    def: number;         // 防御力
    attackSpeed: number; // 攻速倍率（实际攻击间隔 = 基础间隔 / attackSpeed）
    critRate: number;    // 暴击率
    critDmg: number;     // 暴击伤害加成（0.5 = 暴击多打 50%，即 1.5 倍）
    dodgeRate: number;   // 闪避率（防御方，完全免伤）
    blockRate: number;   // 格挡率（防御方）
    blockRatio: number;  // 格挡减伤比例
    dmgBonus: number;    // 伤害加成（攻击方，最终伤害 ×(1+dmgBonus)）
    dmgReduce: number;   // 伤害减免（防御方，最终伤害 ×(1-dmgReduce)）
}

export const BattleConfig = {
    // ========== 统一属性表 ==========
    // 一行一个单位，一列一个属性。调战斗数值主要看这张表。
    stats: {
        //         hp    atk  def  攻速   暴击率 暴伤  闪避   格挡率 格挡减伤 伤害加成 伤害减免
        tank:   { hp: 360, atk: 14, def: 10, attackSpeed: 1.0, critRate: 0.05, critDmg: 0.5, dodgeRate: 0.0,  blockRate: 0.30, blockRatio: 0.5, dmgBonus: 0.0, dmgReduce: 0.10 },
        dps:    { hp: 90,  atk: 28, def: 2,  attackSpeed: 1.3, critRate: 0.25, critDmg: 1.0, dodgeRate: 0.05, blockRate: 0.0,  blockRatio: 0.0, dmgBonus: 0.10, dmgReduce: 0.0 },
        healer: { hp: 120, atk: 0,  def: 4,  attackSpeed: 1.0, critRate: 0.0,  critDmg: 0.5, dodgeRate: 0.10, blockRate: 0.0,  blockRatio: 0.0, dmgBonus: 0.0, dmgReduce: 0.0 },
        enemy:  { hp: 0,   atk: 18, def: 4,  attackSpeed: 1.0, critRate: 0.05, critDmg: 0.5, dodgeRate: 0.05, blockRate: 0.0,  blockRatio: 0.0, dmgBonus: 0.0, dmgReduce: 0.0 },
    } as Record<UnitKind, CombatStats>,

    // —— 战斗公式参数 ——
    combat: {
        // 减法公式保底：最终伤害至少为攻击力的这个比例，防止「防御≥攻击」时被完全免伤。
        minDamageRate: 0.1,
    },

    // ========== 职业行为（非战斗属性，战斗属性见上面 stats 表）==========
    // attackType 攻击方式；fireInterval 基础攻击间隔；range 攻击距离；
    // moveSpeed 移速（近战冲锋，0=不动）；advanceLimit 前压上限；healPerSec 每秒治疗；size 占位方块大小。
    classes: {
        tank:   { attackType: 'melee'  as AttackType, fireInterval: 0.5,  range: 90,  moveSpeed: 300, advanceLimit: 80, healPerSec: 0,  size: 74 },
        dps:    { attackType: 'ranged' as AttackType, fireInterval: 0.33, range: 320, moveSpeed: 0,   advanceLimit: 0,  healPerSec: 0,  size: 52 },
        healer: { attackType: 'heal'   as AttackType, fireInterval: 0,    range: 0,   moveSpeed: 0,   advanceLimit: 0,  healPerSec: 16, size: 52 },
    } as Record<SoldierClass, { attackType: AttackType; fireInterval: number; range: number; moveSpeed: number; advanceLimit: number; healPerSec: number; size: number }>,

    // —— 小队阵容 —— 数组顺序就是从前到后的站位顺序（第一个最靠前迎敌）。
    roster: ['tank', 'dps', 'healer'] as SoldierClass[],

    // —— 站位（单排一字阵：全员同一条横线 y=0，沿 x 分前后）——
    layout: {
        frontMargin: 360,  // 最前单位（坦克）离屏幕左边的距离：越大越靠右、越靠近敌人
        spacing: 110,      // 前后相邻单位的间距（沿 x，越靠后越靠左）
    },

    // —— 子弹 ——
    bullet: {
        speed: 1100,
        radius: 8,
    },

    // —— 敌人行为（战斗属性见 stats.enemy）——
    enemy: {
        speed: 90,             // 向左推进速度（像素/秒）
        radius: 28,            // 体型 + 命中半径
        attackInterval: 0.8,   // 基础贴身攻击间隔（秒）
        contactGap: 150,       // 怪冲到防线前多远停下（必须 > 坦克 advanceLimit，怪才会停在坦克前方）
    },

    // —— 波次：数组长度=总波数，打完最后一波即胜利。hp 覆盖 stats.enemy.hp ——
    waves: [
        { count: 6,  hp: 120, interval: 0.7 },
        { count: 10, hp: 180, interval: 0.55 },
        { count: 14, hp: 260, interval: 0.45 },
    ],

    waveGap: 2.0,              // 波次间隔（秒）
};
