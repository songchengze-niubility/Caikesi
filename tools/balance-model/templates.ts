// 形状模板（手调的相对比例）——seed 脚本与 balance-model 求解器的共同真源。
// 架构约定：框架只解"整体缩放"（kEquip/kGem/kInsc/kLevel），模板定"内部比例"（头/胸/腿血量比、
// 宝石类型间比例、词条池构成）。改比例改这里；改份额/锚点改 balance.xlsx；两者都改后跑
// npm run balance:derive && npm run seed:* && npm run config。
// ⚠️ 求解基线必须是模板而非当前生成配置——否则重导后 derive 相对"已缩放的表"再解一遍，
// balance:check 永远漂移（不动点被破坏）。

export type SlotBonusRow = readonly [slot: string, stat: string, value: number];
export type AffixRow = readonly [stat: string, value: number];
export type GemRow = readonly [type: string, label: string, stat: string, baseValue: number, maxLevel: number, levelRatio: number];
export type InscriptionRow = readonly [stat: string, valueMin: number, valueMax: number];

export const TPL = {
    // 等级线形状基准：每级三围百分比（kLevel 相对它缩放）
    statGrowthPerLevel: 0.05,

    // 装备部位基础加成（value = 模板值；落表 = 一级键 × equip.primaryScale）
    slotBonuses: [
        ['weapon', 'atk', 60],
        ['weapon', 'critRate', 0.02],
        ['helmet', 'hp', 200],
        ['helmet', 'def', 2],
        ['chest', 'hp', 300],
        ['chest', 'def', 4],
        ['chest', 'dmgReduce', 0.02],
        ['pants', 'hp', 225],
        ['pants', 'dodgeRate', 0.015],
        ['shoes', 'range', 20],
        ['shoes', 'attackSpeed', 0.08],
    ] as readonly SlotBonusRow[],

    // 高品质附加词条池（2026-07-11 属性扩展后 19 行）
    affixes: [
        ['hp', 140],
        ['atk', 25],
        ['def', 1.5],
        ['range', 10],
        ['attackSpeed', 0.03],
        ['critRate', 0.012],
        ['critDmg', 0.04],
        ['dodgeRate', 0.01],
        ['blockRate', 0.012],
        ['dmgBonus', 0.012],
        ['dmgReduce', 0.01],
        ['hpPct', 0.03],
        ['atkPct', 0.03],
        ['defPct', 0.03],
        ['moveSpeed', 15],
        ['moveSpeedPct', 0.03],
        ['skillHaste', 0.05],
        ['basicDmgBonus', 0.04],
        ['skillDmgBonus', 0.04],
    ] as readonly AffixRow[],

    // 宝石（一级属性行 baseValue × inlay.gemPrimaryScale；crit/dmg 保持模板值）
    gems: [
        ['atk', '攻击', 'atk', 30, 6, 1.6],
        ['hp', '生命', 'hp', 120, 6, 1.6],
        ['def', '防御', 'def', 8, 6, 1.6],
        ['crit', '暴击', 'critRate', 0.02, 6, 1.6],
        ['dmg', '增伤', 'dmgBonus', 0.03, 6, 1.6],
    ] as readonly GemRow[],

    // 铭文池（一级行 × inlay.inscPrimaryScale；概率型行保持模板值；下限 ≈ 上限 ×0.6）
    inscriptions: [
        ['atk', 10, 40],
        ['hp', 60, 200],
        ['def', 3, 10],
        ['critRate', 0.01, 0.05],
        ['critDmg', 0.05, 0.15],
        ['dmgBonus', 0.02, 0.08],
        ['dmgReduce', 0.01, 0.05],
        ['atkPct', 0.02, 0.06],
        ['hpPct', 0.02, 0.06],
        ['defPct', 0.02, 0.06],
        ['moveSpeedPct', 0.02, 0.05],
        ['singleDmgBonus', 0.02, 0.06],
        ['aoeDmgBonus', 0.02, 0.06],
        ['skillHaste', 0.03, 0.08],
    ] as readonly InscriptionRow[],
} as const;
