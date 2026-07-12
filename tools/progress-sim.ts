// 推进模拟（第④步，慢验证，不进 verify）：N 个虚拟玩家从 L1 真实打到 L10——
// BattleManager 实跑、LootService 真掉落、ChestDropService/ChestService 真开箱、
// CraftService 真合成、InlayModel 真镶嵌/铭文、CharacterGrowthModel 真升级、出售返石真回收。
// 断言中度锚点：通关第一章总局数中位数 ∈ [25,40]，台阶关（L4/L7/L10）卡关额外局数中位数 ∈ [3,12]。
// 确定性：每玩家种子化 LCG 顶替 Math.random（战斗内随机），服务层本身走显式 seed。
// 用法：npm run sim:progress

import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { BattleConfig, type CombatStats, type SoldierClass } from '../assets/scripts/config/BattleConfig';
import { buildEffectiveStatsMap } from '../assets/scripts/combat/EffectiveStats';
import { InventoryModel } from '../assets/scripts/inventory/InventoryModel';
import { CharacterGrowthModel } from '../assets/scripts/growth/CharacterGrowthModel';
import { generateStageReward } from '../assets/scripts/loot/LootService';
import { rollChestDrop } from '../assets/scripts/chest/ChestDropService';
import { openChest } from '../assets/scripts/chest/ChestService';
import { craftEquipment } from '../assets/scripts/craft/CraftService';
import { ensureInlaySlots, socketGem, applyInscription } from '../assets/scripts/inlay/InlayModel';
import { gemMaterialId, type MaterialSave, type RewardBundle } from '../assets/scripts/services/RewardTypes';
import { gemTypes, gemMaxLevel } from '../assets/scripts/inlay/InlayConfig';
import type { EquipItem, EquipSlot, GemType, CharacterId } from '../assets/scripts/inventory/EquipDefs';
import { SLOTS } from '../assets/scripts/inventory/EquipDefs';

const PLAYERS = 20;
const MAX_TOTAL_RUNS = 200;   // 单玩家保险丝
const MAX_TICKS = 24000;
const GATE_LEVELS = [3, 6, 9];

function lcg(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

// 简易装备评分（选穿策略用；不追求精确，够单调即可）
function scoreOf(item: EquipItem | null | undefined): number {
    if (!item?.stats) return 0;
    const s = item.stats;
    return (s.atk ?? 0) * 3 + (s.hp ?? 0) * 0.35 + (s.def ?? 0) * 2
        + ((s.atkPct ?? 0) + (s.hpPct ?? 0)) * 800 + ((s.critRate ?? 0) + (s.dmgBonus ?? 0)) * 600;
}

interface PlayerResult { totalRuns: number; runsAtLevel: number[]; cleared: boolean; finalLevels: Record<string, number> }

function simulatePlayer(pid: number): PlayerResult {
    const roster = BattleConfig.roster as SoldierClass[];
    const inv = new InventoryModel(200, 200);
    const growth = new CharacterGrowthModel();
    const materials: MaterialSave = {};
    const rng = lcg(pid * 48271 + 7);
    const runsAtLevel = new Array(10).fill(0);
    let target = 0;          // 当前要打的关
    let totalRuns = 0;
    let chestSeq = 0;

    const collectReward = (reward: RewardBundle, levelIndex: number) => {
        for (const item of reward.equipments) inv.addItemToBackpack(item);
        for (const m of reward.materials) materials[m.id] = (materials[m.id] ?? 0) + m.count;
        for (const chest of reward.chests) {
            const opened = openChest(chest);
            if (opened.ok && opened.reward) collectReward(opened.reward, levelIndex);
        }
    };

    const gearUp = () => {
        // 穿最优：每角色每部位择分高者（穿戴等级校验真实生效）
        for (const c of roster) {
            for (const slot of SLOTS) {
                const equipped = inv.equipped[c as CharacterId][slot];
                let best: EquipItem | null = null;
                for (const item of inv.backpack) {
                    if (item.slot !== slot) continue;
                    if (!best || scoreOf(item) > scoreOf(best)) best = item;
                }
                if (best && scoreOf(best) > scoreOf(equipped)) {
                    inv.equip(best.id, c as CharacterId, growth.levelOf(c));
                }
            }
        }
        // 合成兜底：石头够就打造，产物下轮择优
        while ((materials['forge_stone'] ?? 0) >= 58) {
            const slot = SLOTS[Math.floor(rng() * SLOTS.length)] as EquipSlot;
            const r = craftEquipment(materials, 'tier_1', slot, rng);
            if (!r.ok || !r.item) break;
            Object.assign(materials, r.remainingMaterials);
            inv.addItemToBackpack(r.item);
        }
        // 镶嵌：空孔插最高级可用宝石；空铭文位打卷轴
        for (const c of roster) {
            for (const slot of SLOTS) {
                const item = inv.equipped[c as CharacterId][slot];
                if (!item) continue;
                ensureInlaySlots(item);
                item.gemSockets?.forEach((g, i) => {
                    if (g) return;
                    for (let lv = 6; lv >= 1; lv--) {
                        for (const t of gemTypes()) {
                            if (lv > gemMaxLevel(t)) continue;
                            if ((materials[gemMaterialId(t, lv)] ?? 0) >= 1) {
                                socketGem(item, i, t as GemType, lv, materials);
                                return;
                            }
                        }
                    }
                });
                item.inscriptions?.forEach((insc, i) => {
                    if (!insc && (materials['rune_scroll'] ?? 0) >= 1) applyInscription(item, i, materials, rng);
                });
            }
        }
        // 出售全部剩余背包件（返石回收，锁定/已穿不受影响）
        const sold = inv.sellBatch('legend', ['backpack']);
        if (sold.ok) for (const m of sold.returnedMaterials ?? []) materials[m.id] = (materials[m.id] ?? 0) + m.count;
    };

    const fight = (levelIndex: number): boolean => {
        const levels: Partial<Record<SoldierClass, number>> = {};
        for (const c of roster) levels[c] = growth.levelOf(c);
        const eff = buildEffectiveStatsMap(inv.equipped, levels);
        const effMap: Record<string, CombatStats> = {};
        for (const c of roster) effMap[c] = eff[c]!;
        const origRandom = Math.random;
        let won = false;
        let expGained = 0;
        let mobKills = 0;
        try {
            Math.random = lcg(pid * 65537 + totalRuns * 131 + levelIndex);
            const mgr = new BattleManager(470, 836, levelIndex, effMap, roster);
            for (let i = 0; i < MAX_TICKS && mgr.phase !== 'won' && mgr.phase !== 'lost'; i++) {
                mgr.tick(0.05);
                for (const ev of mgr.drainEvents()) {
                    if (ev.type === 'enemyKilled') {
                        expGained += BattleConfig.enemyTypes[ev.enemyType]?.exp ?? 0;
                        if (!ev.isStageFinalKill) mobKills++;
                    }
                }
            }
            won = mgr.phase === 'won';
        } finally {
            Math.random = origRandom;
        }
        // 经验：全体上阵各一份全额（胜负都给，镜像 BattleEntry._commitBattleExp）
        for (const c of roster) growth.gainExp(c, expGained);
        // 宝箱：小怪逐只掷 + 胜利关底掷（镜像在线链路）
        const dropGroup = BattleConfig.levels[levelIndex].dropGroup;
        for (let m = 0; m < mobKills; m++) {
            const r = rollChestDrop({ levelIndex, dropGroup, source: 'monster', seed: `p${pid}|r${totalRuns}|m${m}|${chestSeq++}`, createdAt: totalRuns * 1000 + m });
            collectReward(r, levelIndex);
        }
        if (won) {
            const r = rollChestDrop({ levelIndex, dropGroup, source: 'stageFinal', seed: `p${pid}|r${totalRuns}|final|${chestSeq++}`, createdAt: totalRuns * 1000 + 999 });
            collectReward(r, levelIndex);
            collectReward(generateStageReward({ levelIndex, source: 'StageClear', seed: `p${pid}|r${totalRuns}|loot` }), levelIndex);
        }
        return won;
    };

    let cleared = false;
    while (totalRuns < MAX_TOTAL_RUNS) {
        gearUp();
        runsAtLevel[target]++;
        totalRuns++;
        const won = fight(target);
        if (won) {
            if (target === 9) { cleared = true; break; }
            target++;
        } else if (target > 0) {
            // 打不过：追加一局回刷最高已通关关卡攒收益（失败尝试与回刷局都计入当前卡关的局数账）
            runsAtLevel[target]++;
            totalRuns++;
            fight(target - 1);
        }
    }
    const finalLevels: Record<string, number> = {};
    for (const c of roster) finalLevels[c] = growth.levelOf(c);
    return { totalRuns, runsAtLevel, cleared, finalLevels };
}

// —— 跑 N 个玩家并汇总 ——
const results: PlayerResult[] = [];
for (let p = 0; p < PLAYERS; p++) results.push(simulatePlayer(p));

function median(arr: number[]): number {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

const clearedResults = results.filter(r => r.cleared);
console.log(`推进模拟：${PLAYERS} 名虚拟玩家，通关 ${clearedResults.length} 名`);
const totals = clearedResults.map(r => r.totalRuns);
console.log(`  总局数：中位 ${median(totals)}，min ${Math.min(...totals)}，max ${Math.max(...totals)}`);
for (const g of GATE_LEVELS) {
    const stuck = clearedResults.map(r => r.runsAtLevel[g] - 1);   // 额外局数 = 该关消耗局数 − 1（首次通关那局）
    console.log(`  L${g + 1} 卡关额外局数：中位 ${median(stuck)}，min ${Math.min(...stuck)}，max ${Math.max(...stuck)}`);
}
const lvls = clearedResults.map(r => r.finalLevels['dps'] ?? 1);
console.log(`  毕业角色等级（dps）：中位 Lv${median(lvls)}`);
console.log(`  各关局数（首名玩家）：${clearedResults[0]?.runsAtLevel.join(' ')}`);

let failed = 0;
const totalMed = median(totals);
if (clearedResults.length < PLAYERS) { failed++; console.error(`✗ 有 ${PLAYERS - clearedResults.length} 名玩家 ${MAX_TOTAL_RUNS} 局内未通关`); }
if (!(totalMed >= 25 && totalMed <= 40)) { failed++; console.error(`✗ 总局数中位 ${totalMed} 超出中度锚点 [25,40]`); }
else console.log(`✓ 总局数中位 ${totalMed} ∈ [25,40]`);
for (const g of GATE_LEVELS) {
    const m = median(clearedResults.map(r => r.runsAtLevel[g] - 1));
    if (!(m >= 3 && m <= 12)) { failed++; console.error(`✗ L${g + 1} 卡关额外局数中位 ${m} 超出 [3,12]`); }
    else console.log(`✓ L${g + 1} 卡关额外局数中位 ${m} ∈ [3,12]`);
}
console.log(failed ? `\n推进模拟：${failed} 项不达标` : '\n推进模拟：全部达标');
process.exit(failed ? 1 : 0);
