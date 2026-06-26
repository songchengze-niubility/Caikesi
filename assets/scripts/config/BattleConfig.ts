// 战斗数值配置表（BattleConfig）
// ★★★ 这是给策划（你）改的文件 ★★★
// 整体竖屏，核心战斗【横向展开】：原点在屏幕中心，向右 x 增大、向左 x 减小。
//   小队在左边（前列坦克迎敌、后列输出/治疗），敌人从右边进场向左推进，集中在中部横向带。

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
    dmgBonus: number;    // 伤害加成（攻击方，最终伤害 ×(1+dmgBonus)）
    dmgReduce: number;   // 伤害减免（防御方，最终伤害 ×(1-dmgReduce)）
}

// —— 一种怪物类型（图鉴）：自己的属性 + 移动/体型/外观 ——
export interface EnemyType {
    name: string;          // 名字（飘字/调试用）
    stats: CombatStats;    // 战斗属性
    speed: number;         // 向左推进速度（像素/秒）
    radius: number;        // 体型 + 命中半径
    attackInterval: number;// 基础贴身攻击间隔（秒）
    color: [number, number, number]; // 占位色块颜色 RGB
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
}
export interface Level {
    name: string;
    waveGap: number;       // 波与波之间的间隔（秒）
    waves: Wave[];
}

export const BattleConfig = {
    // ========== 小队统一属性表 ==========
    // 一行一个职业，一列一个属性。
    stats: {
        //         hp    atk  def  射程  攻速   暴击率 暴伤  闪避   格挡率 格挡减伤 伤害加成 伤害减免
        tank:   { hp: 360, atk: 14, def: 10, range: 90,  attackSpeed: 1.0, critRate: 0.05, critDmg: 0.5, dodgeRate: 0.0,  blockRate: 0.30, blockRatio: 0.5, dmgBonus: 0.0,  dmgReduce: 0.10 },
        dps:    { hp: 90,  atk: 28, def: 2,  range: 320, attackSpeed: 1.3, critRate: 0.25, critDmg: 1.0, dodgeRate: 0.05, blockRate: 0.0,  blockRatio: 0.0, dmgBonus: 0.10, dmgReduce: 0.0 },
        healer: { hp: 120, atk: 0,  def: 4,  range: 0,   attackSpeed: 1.0, critRate: 0.0,  critDmg: 0.5, dodgeRate: 0.10, blockRate: 0.0,  blockRatio: 0.0, dmgBonus: 0.0,  dmgReduce: 0.0 },
    } as Record<SoldierClass, CombatStats>,

    // ========== 怪物类型表（图鉴）==========
    // 每种怪一套属性 + 移动/体型/颜色。关卡里按 key 引用。
    enemyTypes: {
        zombie: { name: '丧尸', speed: 90,  radius: 28, attackInterval: 0.8, color: [230, 70, 70],
                  stats: { hp: 120, atk: 18, def: 4,  range: 0, attackSpeed: 1.0, critRate: 0.05, critDmg: 0.5, dodgeRate: 0.05, blockRate: 0.0, blockRatio: 0.0, dmgBonus: 0.0, dmgReduce: 0.0 } },
        runner: { name: '疾行者', speed: 175, radius: 22, attackInterval: 0.6, color: [240, 150, 60],
                  stats: { hp: 70,  atk: 14, def: 2,  range: 0, attackSpeed: 1.4, critRate: 0.05, critDmg: 0.5, dodgeRate: 0.15, blockRate: 0.0, blockRatio: 0.0, dmgBonus: 0.0, dmgReduce: 0.0 } },
        brute:  { name: '重装', speed: 55,  radius: 40, attackInterval: 1.2, color: [170, 80, 200],
                  stats: { hp: 360, atk: 30, def: 12, range: 0, attackSpeed: 0.8, critRate: 0.05, critDmg: 0.5, dodgeRate: 0.0,  blockRate: 0.0, blockRatio: 0.0, dmgBonus: 0.0, dmgReduce: 0.15 } },
    } as Record<string, EnemyType>,

    // ========== 关卡表 ==========
    // 每关多波，每波可混合多种怪。spawn.hp 不填则用该怪类型的基础血量。
    levels: [
        {
            name: '第1关 · 试炼',
            waveGap: 2.0,
            waves: [
                { spawns: [{ type: 'zombie', count: 6, interval: 0.7 }] },
                { spawns: [{ type: 'zombie', count: 8, interval: 0.5 }, { type: 'runner', count: 3, interval: 1.2 }] },
                { spawns: [{ type: 'brute', count: 2, interval: 1.6 }, { type: 'zombie', count: 8, interval: 0.45 }] },
            ],
        },
        {
            name: '第2关 · 猛攻',
            waveGap: 1.8,
            waves: [
                { spawns: [{ type: 'runner', count: 8, interval: 0.45 }] },
                { spawns: [{ type: 'zombie', count: 12, interval: 0.4, hp: 180 }, { type: 'runner', count: 4, interval: 1.0 }] },
                { spawns: [{ type: 'brute', count: 4, interval: 1.3, hp: 460 }] },
                { spawns: [{ type: 'brute', count: 3, interval: 1.5, hp: 460 }, { type: 'runner', count: 8, interval: 0.4 }, { type: 'zombie', count: 10, interval: 0.4 }] },
            ],
        },
    ] as Level[],

    startLevel: 0,   // 默认进入第几关（下标）

    // —— 战斗公式参数 ——
    combat: {
        minDamageRate: 0.1,  // 减法保底：最终伤害至少为攻击力的此比例
    },

    // ========== 职业行为（非战斗属性；射程已移入 stats 表）==========
    classes: {
        tank:   { attackType: 'melee'  as AttackType, fireInterval: 0.5,  moveSpeed: 300, advanceLimit: 80, healPerSec: 0,  size: 74 },
        dps:    { attackType: 'ranged' as AttackType, fireInterval: 0.33, moveSpeed: 0,   advanceLimit: 0,  healPerSec: 0,  size: 52 },
        healer: { attackType: 'heal'   as AttackType, fireInterval: 0,    moveSpeed: 0,   advanceLimit: 0,  healPerSec: 16, size: 52 },
    } as Record<SoldierClass, { attackType: AttackType; fireInterval: number; moveSpeed: number; advanceLimit: number; healPerSec: number; size: number }>,

    // —— 小队阵容（从前到后的站位顺序）——
    roster: ['tank', 'dps', 'healer'] as SoldierClass[],

    // —— 站位 ——
    layout: {
        frontMargin: 360,
        spacing: 110,
    },

    // —— 子弹 ——
    bullet: {
        speed: 1100,
        radius: 8,
    },

    // —— 阵型 ——
    formation: {
        contactGap: 150,   // 怪冲到防线前多远停下（须 > 坦克 advanceLimit）
    },

    // —— 场景背景（占位用代码画蓝天白云 + 地面）——
    // 【替换真实背景】：给背景节点换成 Sprite 指定图片即可，这里的颜色只是占位。
    scene: {
        horizonY: 40,                  // 地平线高度（屏幕中心为 0，往上为正）；其上为天空、其下为地面
        skyTop: [95, 160, 235],        // 天空顶部色（RGB）
        skyBottom: [180, 215, 250],    // 天空近地平线色
        groundTop: [120, 185, 95],     // 地面近地平线色
        groundBottom: [70, 120, 55],   // 地面底部色
        cloud: {
            count: 5,                  // 云朵数量
            color: [255, 255, 255],    // 云颜色
            speed: 16,                 // 云基础漂移速度（像素/秒，向左；大云更快=更近）
        },
        hill: {
            color: [80, 140, 110],     // 远处山丘剪影色
            speed: 22,                 // 山丘滚动速度（远景，慢）
        },
        groundScroll: 90,              // 地面纹理滚动速度（近景，快，营造前进感）
    },
};
