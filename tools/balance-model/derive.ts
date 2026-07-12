// derive 编排（balance-model 顶层）：读 balance.xlsx 真源 → economy + solve → Caps 校验 →
// Overrides → 写 derived.values.generated.ts（确定性产物、无时间戳，入库）。
// 用法：npm run balance:derive（生成/更新）；npm run balance:check（重算比对，漂移 exit 1，挂 verify）。
// 各 seed 脚本 import derivedValues 填"框架接管列"——派生值永远经 seed 进 xlsx，不直写。

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BalanceConfig } from '../../assets/scripts/config/BalanceConfig';
import { BattleConfig, type CombatStats } from '../../assets/scripts/config/BattleConfig';
import { solveEconomy, type EconomyResult } from './economy';
import { solveShares, type SolveResult } from './solve';
import { buildSnapshot, buildPanels } from './snapshot';
import { buildProgressCurve } from './progress';
import { deriveDifficulty, type PacingLoadout } from './difficulty';
import { TPL } from './templates';
import type { PowerCtx } from './power';

const OUT = resolve(__dirname, 'derived.values.generated.ts');

export interface DerivedValues {
    battle: { statGrowthPerLevel: number; expBase: number; enemyScales: number[] };
    equip: { primaryScale: number };
    inlay: { gemPrimaryScale: number; inscPrimaryScale: number };
    craft: { tierCosts: Record<'tier_1' | 'tier_2' | 'tier_3', number>; provisional: string[] };
    sell: { forgeStone: Record<string, number> };
    report: {
        solveK: Record<string, number>;
        sharesActual: Record<string, number>;
        snapshotCounts: Record<string, number>;
        chestsPerRun: number;
        stonesPerRun: number;
        expPerRun: number;
        gemsExpected: number;
        scrollsExpected: number;
        iterations: number;
        progressPower: { entry: number[]; ready: number[] };   // P(n) 曲线（诊断）
        pacingLoadouts: PacingLoadout[];                        // 四档等效平铺（诊断/展示用）
        pacingPanels: { entry: CombatStats[][]; ready: CombatStats[][] };   // pacing-sim 消费的完整面板
    };
}

// 快照面板的二级属性不得越 Caps（上限语义：面板值相对白板的增量；attackSpeed/critDmg 同口径）
function checkCaps(panels: CombatStats[], caps: Record<string, number>) {
    const CAP_KEYS: (keyof CombatStats)[] = ['critRate', 'critDmg', 'attackSpeed', 'skillHaste', 'dodgeRate',
        'blockRate', 'blockRatio', 'dmgReduce', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus', 'aoeDmgBonus', 'dmgBonus'];
    const roster = BattleConfig.roster;
    panels.forEach((panel, i) => {
        const base = BattleConfig.stats[roster[i]];
        for (const k of CAP_KEYS) {
            const cap = caps[k];
            if (cap === undefined) continue;
            const bonus = panel[k] - base[k];
            if (bonus > cap + 1e-9) {
                throw new Error(`Caps 越限：${roster[i]}.${k} 毕业增量 ${bonus.toFixed(3)} > 上限 ${cap}（调 Shares/Anchors 或加 Override）`);
            }
        }
    });
}

function round(v: number, digits: number): number {
    const f = Math.pow(10, digits);
    return Math.round(v * f) / f;
}

function roundStats(st: CombatStats): CombatStats {
    const out = { ...st };
    for (const k of Object.keys(out) as (keyof CombatStats)[]) out[k] = round(out[k], 3);
    return out;
}

// 点分路径覆盖（Overrides 表）：如 "equip.primaryScale"
function applyOverride(values: DerivedValues, target: string, value: number) {
    const parts = target.split('.');
    let node: Record<string, unknown> = values as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
        const next = node[parts[i]];
        if (typeof next !== 'object' || next === null) throw new Error(`Override 目标不存在：${target}`);
        node = next as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1];
    if (typeof node[leaf] !== 'number') throw new Error(`Override 目标不是数值：${target}`);
    node[leaf] = value;
}

export function computeDerived(): DerivedValues {
    const cfg = BalanceConfig;
    const ctx: PowerCtx = {
        enemyAtk: cfg.anchors.ctxEnemyAtk,
        enemyDef: cfg.anchors.ctxEnemyDef,
        minDamageRate: BattleConfig.combat.minDamageRate,
    };
    const economy: EconomyResult = solveEconomy(cfg);
    const solved: SolveResult = solveShares(cfg, economy.counts, ctx);

    checkCaps(buildSnapshot(solved.k, economy.counts, cfg.anchors), cfg.caps);

    // 难度导出：P(n) 曲线 → 完整面板 → 模拟标定 enemyScale + pacing 面板
    const curve = buildProgressCurve(cfg, solved.k, economy, ctx);
    const pacingPanels = {
        entry: curve.map(p => buildPanels(p.entryState, solved.k).map(roundStats)),
        ready: curve.map(p => buildPanels(p.readyState, solved.k).map(roundStats)),
    };
    const difficulty = deriveDifficulty(cfg, curve, pacingPanels);

    const values: DerivedValues = {
        battle: {
            // 基准取模板值而非当前配置（防重导后的反馈回路，见 templates.ts 头注）
            statGrowthPerLevel: round(TPL.statGrowthPerLevel * solved.k.kLevel, 4),
            expBase: economy.expBase,
            enemyScales: difficulty.enemyScales,
        },
        equip: { primaryScale: round(solved.k.kEquip, 3) },
        inlay: {
            gemPrimaryScale: round(solved.k.kGem, 3),
            inscPrimaryScale: round(solved.k.kInsc, 3),
        },
        craft: { tierCosts: economy.craftTierCosts, provisional: ['tier_2', 'tier_3'] },
        sell: { forgeStone: economy.sellForgeStone },
        report: {
            solveK: {
                kLevel: round(solved.k.kLevel, 4), kEquip: round(solved.k.kEquip, 4),
                kGem: round(solved.k.kGem, 4), kInsc: round(solved.k.kInsc, 4),
            },
            sharesActual: Object.fromEntries(Object.entries(solved.sharesActual).map(([m, v]) => [m, round(v, 4)])),
            snapshotCounts: {
                gems: round(economy.counts.gems, 2),
                gemAvgLevel: round(economy.counts.gemAvgLevel, 2),
                inscriptions: round(economy.counts.inscriptions, 2),
            },
            chestsPerRun: round(economy.chestsPerRun, 3),
            stonesPerRun: round(economy.stonesPerRun, 2),
            expPerRun: round(economy.expPerRun, 1),
            gemsExpected: round(economy.report.gemsExpected, 1),
            scrollsExpected: round(economy.report.scrollsExpected, 1),
            iterations: solved.iterations,
            progressPower: {
                entry: curve.map(p => Math.round(p.entryPower)),
                ready: curve.map(p => Math.round(p.readyPower)),
            },
            pacingLoadouts: difficulty.pacingLoadouts,
            // 每关入场/达标的完整 18 维面板（roster 序）——pacing-sim 直接吃面板，
            // 模拟口径与难度标定口径完全一致（只给平铺会丢防御/暴击/百分比维度）
            pacingPanels,
        },
    };

    for (const ov of cfg.overrides) applyOverride(values, ov.target, ov.value);
    return values;
}

function genCode(values: DerivedValues): string {
    return `// ⚠️ 本文件由 tools/balance-model/derive.ts 自动生成，请勿手改。
// 真源：tools/config-xlsx/balance.xlsx（Shares/Anchors/Caps/Overrides）→ npm run balance:derive。
// 消费端：各 tools/seed-*-xlsx.ts 的"框架接管列" + InventoryModel.SELL_FORGE_STONE 回填。
// 确定性产物（无时间戳）：balance:check 靠内容比对防漂移。
/* eslint-disable */
export const derivedValues = ${JSON.stringify(values, null, 4)} as const;
`;
}

// —— CLI：默认生成；--check 比对防漂移（仅作为入口脚本执行时运行，import 不触发）——
if (require.main === module) {
    const isCheck = process.argv.includes('--check');
    const values = computeDerived();
    const code = genCode(values);
    if (isCheck) {
        const existing = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
        if (existing.replace(/\r\n/g, '\n') !== code.replace(/\r\n/g, '\n')) {
            console.error('✗ balance:check 失败——derived.values.generated.ts 与 balance.xlsx 真源不一致，请跑 npm run balance:derive 并重建受影响的 seed/xlsx');
            process.exit(1);
        }
        console.log('✓ balance:check 通过（派生值与真源一致）');
    } else {
        writeFileSync(OUT, code);
        console.log(`✓ 已生成 ${OUT}`);
        console.log(`  k=${JSON.stringify(values.report.solveK)} tier1=${values.craft.tierCosts.tier_1} expBase=${values.battle.expBase}`);
    }
}
