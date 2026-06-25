// 战斗数值配置表（BattleConfig）
// ★★★ 这是给策划（你）改的文件 ★★★
// 整体竖屏，核心战斗【横向展开】：原点在屏幕中心，向右 x 增大、向左 x 减小。
//   小队在左边，敌人从右边进场向左推进。
//   战斗集中在屏幕中部的一条横向带(lane)内，上下留白以后放 UI。
//   职业分前后「列」：坦克在前列（靠右迎敌）当肉墙，输出/治疗在后列（靠左）。

export type SoldierClass = 'tank' | 'dps' | 'healer';

export const BattleConfig = {
    // —— 三种职业的数值 ——
    // damage=0 表示不开火；healPerSec>0 表示是治疗，每秒奶这么多血。
    classes: {
        tank:   { hp: 360, damage: 9,  fireInterval: 0.6,  healPerSec: 0,  size: 74 },
        dps:    { hp: 90,  damage: 28, fireInterval: 0.33, healPerSec: 0,  size: 52 },
        healer: { hp: 120, damage: 0,  fireInterval: 0,    healPerSec: 16, size: 52 },
    } as Record<SoldierClass, { hp: number; damage: number; fireInterval: number; healPerSec: number; size: number }>,

    // —— 小队阵容 —— 数组顺序就是从前到后的站位顺序（第一个最靠前迎敌）。
    roster: ['tank', 'dps', 'healer'] as SoldierClass[],

    // —— 站位（单排一字阵：全员同一条横线 y=0，沿 x 分前后）——
    layout: {
        frontMargin: 360,  // 最前单位（坦克）离屏幕左边的距离：越大越靠右、越靠近敌人
        spacing: 110,      // 前后相邻单位的间距（沿 x，越靠后越靠左）
    },

    // —— 子弹（伤害取自开火者的职业 damage）——
    bullet: {
        speed: 1100,
        radius: 8,
    },

    // —— 敌人 ——
    enemy: {
        speed: 90,             // 向左推进速度（像素/秒）
        radius: 28,            // 体型 + 命中半径
        damage: 18,            // 贴身每次攻击的伤害
        attackInterval: 0.8,   // 贴身攻击间隔（秒）
        contactGap: 64,        // 最前的怪与我方防线之间留的间距（贴脸但不重叠）
        queueSpacing: 66,      // 后面排队的怪之间的间距（避免重叠）
    },

    // —— 波次：数组长度=总波数，打完最后一波即胜利 ——
    waves: [
        { count: 6,  hp: 44,  interval: 0.7 },
        { count: 10, hp: 66,  interval: 0.55 },
        { count: 14, hp: 95,  interval: 0.45 },
    ],

    waveGap: 2.0,              // 波次间隔（秒）
};
