# 难度导出与节奏验证实施计划（第④步）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `docs/superpowers/specs/2026-07-12-difficulty-derive-design.md` 落地：宝石掉率砍档（用户拍板 A）、玩家战力进度曲线 P(n)、`enemyScale` 机制列、难度导出进 derive、pacing 档位重校、`sim:progress` 推进模拟验证中度锚点。

**Architecture:** snapshot 重构出参数化 `buildPanels(state,k)`（毕业快照=特例）；progress.ts 按推进模型算各关入场/达标面板；difficulty 导出 `enemyScale(n)=difficulty(n)×P_ready(n)÷P_old(n)`（P_old=旧 pacing 档位的等效战力，作换算基准）；Levels 表 hp 覆盖清空、难度全由 enemyScale 管；pacing LOADOUT 从 derive 报告读取。

## Global Constraints

- 只 `git add` 暂存不提交；与 Codex 线分组。每任务 `npm run typecheck && npm test`。
- derive→seed→config→balance:check 不动点必须保持（新导出项同样走 templates/anchors 基线）。
- Anchors 新增旋钮：`difficultyNormal 0.85 / difficultyGate 1.10 / difficultyBoss 1.25`。
- 验收：verify 全绿（含重校后 13 项 pacing）；`sim:progress` 中位数总局数 ∈[25,40]、台阶回刷 ∈[4,10]。

### Task D1: 宝石掉率砍档（normal 0 / boss 2 / chapter 3）
seed-chest Rewards 行改 gemCount；services-test rewards 断言同步；economy 期望自动重算 → `balance:derive`（宝石快照数量变小、kGem 变大属预期）→ 全链重导重测。

### Task D2: snapshot 参数化 + progress.ts P(n) 曲线
snapshot 抽 `buildPanels(state: ProgressState, k)`（state={qualityRank, equipLevel, equipCoverage, counts, charLevel}），buildSnapshot=毕业特例；progress.ts：推进日程（顺推+台阶前回刷 6 局）→ 各关 entry/ready 状态（装备品质/等级/覆盖度线性推进、宝石铭文按每局期望累计封顶、等级按累计经验过曲线）→ `teamPower`。测试：P 单调不减、毕业点与 solve 总量一致（±10%）。

### Task D3: enemyScale 机制列
BattleConfig `Level.enemyScale: number`；seed-battle Levels 加列（暂全 1、hp 覆盖清空）；excel-to-config 校验同关一致且 >0；BattleManager 刷怪应用 hp/atk ×scale（spawn 行 hp 覆盖为绝对值、优先于缩放）。combat-test 补用例（scale=2 的关卡怪血攻翻倍）。

### Task D4: difficulty 导出 + pacing 重校
difficulty.ts：`enemyScales[10]` 进 derivedValues（Anchors 三档难度系数）；seed-battle Levels 列引用；pacing-sim LOADOUTS 改读 `derivedValues.report.pacingLoadouts`（naked/ready(3)/ready(6)/ready(9) 四档等效 hp/atk 平铺）；迭代难度旋钮至 13 门槛绿。

### Task D5: sim:progress 推进模拟
`tools/progress-sim.ts`（`npm run sim:progress`，不进 verify）：N=20 虚拟玩家全程真实模拟（BattleManager 实跑、ChestService 真开箱、CraftService 真合成、InlayModel 真镶嵌、Growth 真升级；败则回刷前关）；输出各关局数分布/资源收支；断言中度锚点。红则回调旋钮迭代。

### Task D6: verify 终验 + spec 偏差回写 + 记忆收尾（只暂存）
