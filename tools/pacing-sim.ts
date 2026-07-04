// 关卡节奏门槛自检（纯逻辑，tsx 运行，不进常规测试链）。
// 用途：关卡/掉落/装备数值调参后跑 `npm run sim:pacing`，验证三台阶（第4/7/10关）卡点成立。
//
// 装备档位用「期望套装平铺加成」建模（数值由 equip.xlsx 推导，改了装备表要同步这里）：
//   全套 5 件的 hp/atk 基础平铺 = hp 725（头200+胸300+腿225）、atk 60（武器）；
//   实际加成 ≈ 平铺 × 品质倍率均值 × 等级系数（1+(lv-1)×0.03）：
//   - t1 过第4关：1~3关掉落成型（common/fine、Lv≈3）  F≈1.10×1.06≈1.17
//   - t2 过第7关：4~6关掉落成型（fine/rare、Lv≈7）    F≈1.50×1.18≈1.77
//   - t3 过第10关：7~9关掉落成型（rare/epic、Lv≈12）  F≈1.90×1.33≈2.53
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';

const RUNS = 5;            // 每个场景模拟次数（战斗内含暴击/闪避随机）
const MAX_TICKS = 24000;   // 0.05s/tick → 最长 20 分钟战斗，防不收敛
const PASS_RATE = 0.8;     // 「大概率通过」阈值
const FAIL_RATE = 0.4;     // 「大概率卡关」阈值（胜率必须低于它）

// 档位：裸装 / 1~3段成型 / 4~6段成型 / 7~9段成型（平铺加成见文件头推导）
const LOADOUTS = [
    { name: '裸装', hp: 0, atk: 0 },
    { name: '1~3段装', hp: 850, atk: 70 },
    { name: '4~6段装', hp: 1280, atk: 105 },
    { name: '7~9段装', hp: 1830, atk: 150 },
];

function winRate(levelIndex: number, tier: number): number {
    let wins = 0;
    for (let run = 0; run < RUNS; run++) {
        const base = BattleConfig.stats.dps;
        const gear = LOADOUTS[tier];
        const mgr = new BattleManager(470, 836, levelIndex, {
            dps: { ...base, hp: base.hp + gear.hp, atk: base.atk + gear.atk },
        });
        for (let i = 0; i < MAX_TICKS && mgr.phase !== 'won' && mgr.phase !== 'lost'; i++) {
            mgr.tick(0.05);
            mgr.drainEvents();
        }
        if (mgr.phase === 'won') wins++;
    }
    return wins / RUNS;
}

// 每个门槛：level 下标 + 应卡关的装备档（可缺省）+ 应通过的装备档
const GATES: Array<{ level: number; failTier?: number; passTier: number }> = [
    { level: 0, passTier: 0 },
    { level: 1, passTier: 0 },
    { level: 2, passTier: 0 },
    { level: 3, failTier: 0, passTier: 1 }, // 台阶一
    { level: 4, passTier: 1 },
    { level: 5, passTier: 1 },
    { level: 6, failTier: 1, passTier: 2 }, // 台阶二
    { level: 7, passTier: 2 },
    { level: 8, passTier: 2 },
    { level: 9, failTier: 2, passTier: 3 }, // 台阶三 Boss
];

let failed = 0;
for (const gate of GATES) {
    const name = BattleConfig.levels[gate.level].name;
    if (gate.failTier !== undefined) {
        const rate = winRate(gate.level, gate.failTier);
        const ok = rate < FAIL_RATE;
        if (!ok) failed++;
        console.log(`  ${ok ? '✓' : '✗'} ${name} @${LOADOUTS[gate.failTier].name} 应卡关：胜率 ${(rate * 100).toFixed(0)}%（要求 <${FAIL_RATE * 100}%）`);
    }
    const rate = winRate(gate.level, gate.passTier);
    const ok = rate >= PASS_RATE;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name} @${LOADOUTS[gate.passTier].name} 应通过：胜率 ${(rate * 100).toFixed(0)}%（要求 ≥${PASS_RATE * 100}%）`);
}

console.log(`\n节奏自检：${failed === 0 ? '全部达标' : failed + ' 项不达标'}`);
process.exit(failed ? 1 : 0);
