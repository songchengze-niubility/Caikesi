# 生成式数值框架实施计划（子计划 B）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `docs/superpowers/specs/2026-07-11-balance-derive-design.md` 落地 balance.xlsx 真源 → balance-model 求解 → derived.values.generated.ts → seed 引用 → xlsx 重建的完整管线，并用它反解出玩家侧全部养成数值（等级线/装备/宝石/铭文/合成/经验起点）。

**Architecture:** 求解器纯 TS（tools/balance-model/，进 tsconfig.tools），战力口径 EHP×DPS 全 18 维折算；份额用"去一法"贡献比 + 总量条件做阻尼定点迭代；经济层按快照=期望的口径先算宝箱期望再定价。派生值走 `derived.values.generated.ts`（.generated 模式入库），seed 只在"框架接管列"处引用它，其余照旧。

**Tech Stack:** TypeScript 5.8.2、tsx、xlsx 库（与 excel-to-config 同款）。

## Global Constraints

- 真源纪律：balance.xlsx 是新真源；seed 仍是各业务 xlsx 的代码真源（引用派生值）；勿手改任何 `*.generated.ts`。
- 白板 = 绝对锚点（现值不动）；份额目标 base 0.05 / level 0.20 / equip 0.50 / gem 0.17 / insc 0.08，验收偏差 ≤2pp。
- **落地后 13 项 pacing 门槛预期变红**（玩家侧重排、怪物未动）：终验时 pacing 红项如实报告并在 verify 链中临时改为非阻断（`sim:pacing` 从 verify 摘出、单独跑并记录），第④步难度导出后恢复阻断——不许假绿。
- 提交策略：只 `git add` 暂存不提交；与 Codex 美术线严格分组。
- 每任务收尾 `npm run typecheck && npm test`。

---

### Task 1: balance.xlsx 真源 + 导表接线

**Files:**
- Create: `tools/seed-balance-xlsx.ts`（Shares/Anchors/Caps/Overrides 四表）
- Modify: `tools/excel-to-config.ts`（SOURCES 加 balance 源 → `balance.config.generated.ts`）
- Create: `assets/scripts/config/BalanceConfig.ts`（仅类型 + 引用产物；游戏运行时不消费，供工具链强类型）
- Modify: `package.json`（`seed:balance` 脚本）
- Test: `tools/balance-model-test.ts`（新建，注册 `test:balance` 进 npm test 链）

**Interfaces:**
- Produces: `BalanceConfig = { shares: Record<'base'|'level'|'equip'|'gem'|'inscription'|'skill', number>, anchors: Record<string, number>, caps: Record<string, number>, overrides: Array<{ target: string; value: number; reason: string }> }`。
- Anchors 键（初值）：`farmRunsPerGate 6 / totalRuns 32 / gradCharLevel 12 / gradEquipLevel 12 / gradQualityRank 2.5(rare~epic) / craftCostRuns 6 / sellReturnRate 0.18 / gemLevelRatio 1.6 / inscRollFloor 0.6 / qualityStep 1.35 / ctxEnemyAtk 30 / ctxEnemyDef 8`。
- Caps 键：`critRate 0.5 / critDmg 1.5 / attackSpeed 0.5 / moveSpeedPct 0.4 / skillHaste 0.5 / dodgeRate 0.3 / blockRate 0.4 / blockRatio 0.7 / dmgReduce 0.4 / basicDmgBonus 0.4 / skillDmgBonus 0.4 / singleDmgBonus 0.4 / aoeDmgBonus 0.4 / dmgBonus 0.6 / hpPct 0.4 / atkPct 0.4 / defPct 0.4`。

**Steps:** 失败测试（读 BalanceConfig.shares 合计=1、anchors/caps 关键键存在）→ 跑红 → seed-balance + 解析器（shares 合计≠1 报错、caps/anchors 数值校验、Overrides 三列必填）→ `npm run seed:balance && npm run config` → 测试绿 → `git add`。

---

### Task 2: power.ts 战力口径

**Files:**
- Create: `tools/balance-model/power.ts`
- Test: `tools/balance-model-test.ts` 追加

**Interfaces:**
- Produces: `powerOf(stats: CombatStats, ctx: PowerCtx): number`、`teamPower(panels: CombatStats[], ctx): number`（求和）、`PowerCtx = { enemyAtk: number; enemyDef: number; minDamageRate: number }`。
- 公式：`DPS = max(atk−enemyDef, atk×minDamageRate) × attackSpeed × (1+critRate×critDmg) × (1+dmgBonus+basicDmgBonus×0.7+skillDmgBonus×0.3+singleDmgBonus×0.6+aoeDmgBonus×0.4)`（普攻/技能、单体/群体按经验权重折算期望覆盖率）；`EHP = hp ÷ [(1−dodgeRate)×(1−blockRate×blockRatio)×(1−dmgReduce)] × enemyAtk ÷ max(enemyAtk−def, enemyAtk×minDamageRate)`；`power = √(DPS×EHP)`（几何均值，防单边堆叠刷分）。
- 测试：每维 +10% 战力不降（18 维遍历）；atk 与 hp 同比例提升战力增幅接近（几何均值性质）。

---

### Task 3: snapshot.ts + solve.ts 份额反解

**Files:**
- Create: `tools/balance-model/snapshot.ts`、`tools/balance-model/solve.ts`
- Test: `tools/balance-model-test.ts` 追加

**Interfaces:**
- `buildSnapshot(k: SolveVars, counts: SnapshotCounts, ctx): CombatStats[]`——按 roster(tank+dps) 构造毕业面板：白板(现值) → +装备平铺(kEquip×现表比例×品质1.35^rank×等级系数) → +宝石(kGem×类型比例×counts.gems×均值等级) → 铭文(kInsc×池均值×counts.inscriptions) → ×(1+等级%(kLevel×(gradCharLevel−1)))，走真实 `calcEffectiveStats` 语义（双层公式手拟，不 import 游戏侧带 cc 依赖的模块——EffectiveStats 无 cc 依赖可直接 import，优先复用）。
- `SolveVars = { kLevel, kEquip, kGem, kInsc }`（相对现表的缩放系数，初值 1）。
- `solveShares(cfg: BalanceConfig, counts, ctx): SolveResult`——迭代：去一法贡献 `Δ_m = P_full − P_without_m`，比率对齐 20:50:17:8（阻尼 0.5 幂），总量对齐 `P_full = P_base_only ÷ share_base`（等比缩放四个 k）；≤100 轮、份额偏差 ≤2pp 收敛，否则 throw。
- 测试：收敛性（默认配置能收敛）；往返（解出的 k 代回快照，四模块去一法份额比与 20:50:17:8 偏差 ≤2pp，总量偏差 ≤5%）。

---

### Task 4: economy.ts 经济反解

**Files:**
- Create: `tools/balance-model/economy.ts`
- Test: `tools/balance-model-test.ts` 追加

**Interfaces:**
- `solveEconomy(cfg, ctx): EconomyResult`——**快照=期望口径**：
  1. 期望宝箱/局 = 关卡平均怪数×mobChance + finalChance（读现 battle/chest 表结构）；
  2. `E[stones/局]`、`E[gems 到毕业]`、`E[scrolls 到毕业]` 按 Rewards 现区间 × totalRuns 推得 → 输出 `SnapshotCounts { gems, inscriptions }` 喂给 solve（快照数量不再拍脑袋，锚点表值仅作 fallback）；
  3. 合成价：`tier1 = round(craftCostRuns × E[stones/局])`，tier2/3 按 2.5×/5× 外推 provisional；
  4. 出售返石：`SELL_FORGE_STONE[q] = round(tier1 × sellReturnRate × 品质系数(0.5/1/2/4/8 归一))`；
  5. 经验：顺推+回刷总击杀经验（现 EnemyTypes.exp × totalRuns 期望击杀）≈ Lv1→gradCharLevel 累计门槛 → 解 `expBase`（EnemyTypes.exp 保持现值，只解 expBase）。
- 测试：往返——产出的 craft 价 ÷ E[stones/局] ≈ craftCostRuns（±1 局）；expBase 代回三段曲线，totalRuns 期望经验落在 Lv11~13。

---

### Task 5: derive.ts 编排 + derived.values.generated.ts + balance:check

**Files:**
- Create: `tools/balance-model/derive.ts`、产物 `tools/balance-model/derived.values.generated.ts`
- Modify: `package.json`（`balance:derive`、`balance:check`；`verify` 链尾加 `balance:check`，`sim:pacing` 暂移出 verify 并注明第④步恢复）
- Test: `tools/balance-model-test.ts` 追加（幂等）

**Interfaces:**
- Produces: `export const derivedValues = { battle: { statGrowthPerLevel, expBase }, equip: { slotBonusScale, qualityMultipliers, affixScale }, inlay: { gemBaseValues, inscScale }, craft: { tierCosts, provisional: ['tier_2','tier_3'] }, chest: { rewards 原样回写 }, sell: { forgeStone }, report: { shares实测, snapshotCounts, expectations } }`（结构精确形状以实现为准，含 `// 来源:` 注释）。
- 流程：读 BalanceConfig → economy → solve → Caps 校验（毕业快照逐维不越限，越限 throw）→ Overrides 应用（target 形如 `equip.slotBonusScale`）→ 与现产物比对幂等 → 写文件。
- `balance:check` = derive 到内存与入库产物深比对，漂移 exit 1。

---

### Task 6: seeds 接派生值 + 全量重导

**Files:**
- Modify: `tools/seed-battle-xlsx.ts`（statGrowthPerLevel/expBase ← derivedValues）
- Modify: `tools/seed-equip-xlsx.ts`（SlotBonuses/Qualities.multiplier/Affixes ×scale）
- Modify: `tools/seed-inlay-xlsx.ts`（Gems.baseValue/Inscriptions ×scale）
- Modify: `tools/seed-craft-xlsx.ts`（Tiers.costForgeStone）
- Modify: `assets/scripts/inventory/InventoryModel.ts`（SELL_FORGE_STONE ← 派生值回填 + 来源注释）
- 重跑 `seed:* && config`，更新受影响单测的硬编码期望值（equip/inlay/effective-stats/craft 等按新值重算或改为读配置断言）。

**验收：** `balance:check` 绿、typecheck/test 绿、`sim:pacing` 单独跑如实记录红项清单（预期红，留给第④步）。

---

### Task 7: 终验 + spec 偏差回写 + 记忆收尾

- `npm run verify`（含 balance:check，不含 pacing）全绿；`sim:pacing` 红项记录进 项目状态.md。
- spec 回写偏差：快照数量改为"经济期望推算、锚点仅 fallback"；其余实现裁定。
- 项目状态/代码地图 更新；只暂存。

## Self-Review 记录

- Spec 覆盖：§1→T1/T5/T6；§2→T1；§3→T2-T5；§4→T6；§5→T3/T4；§6→各任务测试+T7；§7 未偷跑。
- 已知偏差（相对 spec，实施前声明）：快照宝石/铭文数量由经济期望推算（spec §2 Anchors 中对应值降级为 fallback）——T7 回写。
- 类型一致性：SolveVars/SnapshotCounts/PowerCtx/derivedValues 形状在 T2-T6 一致引用。
