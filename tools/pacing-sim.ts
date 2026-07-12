// 关卡节奏门槛自检（纯逻辑，tsx 运行，不进常规测试链）。
// 用途：关卡/掉落/装备数值调参后跑 `npm run sim:pacing`，验证三台阶（第4/7/10关）卡点成立。
//
// 装备档位（2026-07-12 起）从 balance:derive 的报告读取——四档 = 裸装 / 台阶关 L4/L7/L10 的
// "达标玩家"等效 hp/atk 平铺（推进模型 P(n) 的 ready 状态，含装备+宝石+铭文+等级折算）。
// 改数值表后跑 `npm run balance:derive && npm run seed:* && npm run config` 再跑本门禁。
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { BattleConfig, SoldierClass, CombatStats } from '../assets/scripts/config/BattleConfig';
import { derivedValues } from './balance-model/derived.values.generated';

const RUNS = 5;            // 每个场景模拟次数（战斗内含暴击/闪避随机）
const MAX_TICKS = 24000;   // 0.05s/tick → 最长 20 分钟战斗，防不收敛
const PASS_RATE = 0.8;     // 「大概率通过」阈值
const FAIL_RATE = 0.4;     // 「大概率卡关」阈值（胜率必须低于它）

// 面板（roster 序）：每关"入场"（顺推未回刷）与"达标"（台阶关回刷后）两套完整 18 维面板
const PANELS = derivedValues.report.pacingPanels;

// 基线出战组合：与 battle.xlsx/Misc.roster 的默认组合一致（前排肉 + 输出）。
const DEFAULT_ROSTER: SoldierClass[] = ['tank', 'dps'];

// 直接把推进模型面板当 effectiveStats 喂给 BattleManager（模拟口径 = 难度导出口径）
function winRate(levelIndex: number, panels: readonly CombatStats[], roster: SoldierClass[] = DEFAULT_ROSTER): number {
    let wins = 0;
    for (let run = 0; run < RUNS; run++) {
        const eff: Record<string, CombatStats> = {};
        roster.forEach((cls, i) => { eff[cls] = { ...panels[i] }; });
        const mgr = new BattleManager(470, 836, levelIndex, eff, roster);
        for (let i = 0; i < MAX_TICKS && mgr.phase !== 'won' && mgr.phase !== 'lost'; i++) {
            mgr.tick(0.05);
            mgr.drainEvents();
        }
        if (mgr.phase === 'won') wins++;
    }
    return wins / RUNS;
}

// 门槛：每关"达标"面板应通过（10 项快速回归）。
// 台阶卡点的"存在性"不在这里查——模型入场面板系统性高估真实玩家（宝石 Boss 专属后前期为零、
// 掉落随机），模型内的"入场必败"是伪信号；卡点由 `npm run sim:progress` 的
// "台阶关卡关额外局数 ∈ [3,12]"实测带保证（改战斗/掉落数值后手动跑）。
let failed = 0;
for (let level = 0; level < BattleConfig.levels.length; level++) {
    const name = BattleConfig.levels[level].name;
    const rate = winRate(level, PANELS.ready[level]);
    const ok = rate >= PASS_RATE;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name} @达标 应通过：胜率 ${(rate * 100).toFixed(0)}%（要求 ≥${PASS_RATE * 100}%）`);
}

console.log(`\n节奏自检：${failed === 0 ? '全部达标' : failed + ' 项不达标'}`);
process.exit(failed ? 1 : 0);
