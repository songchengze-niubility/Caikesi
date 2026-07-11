# 战斗流程 2.0 Plan B(行军推进 + moveSpeed 属性迁移)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移动速度迁入 `CombatStats` 统一属性表(装备/Buff 可加减速),战斗改为"清波 → 行军到下个刷怪点 → 再战"的推进结构,最后一波清完通关;行军为表现假象(局部坐标不变),`verify` 与重校后的 pacing 全绿。

**Architecture:** 两步走:①属性迁移——`CombatStats.moveSpeed` 落地,`classes.moveSpeed`/`enemyTypes.speed` 废弃,单位读取全改 `u.stats.moveSpeed`(Buff 减速即刻生效);②状态机——`BattlePhase` 的 `gap` 替换为 `marching`,时长 = `wave.distance ÷ 全队存活最慢 moveSpeed`,行军首帧清弹道/场地、吐 `marchStarted/marchEnded` 事件,渲染层背景加速卷动。战场三不变量零触碰。

**Tech Stack:** TypeScript 5.8.2 双 tsconfig、tsx 单测、xlsx 导表(种子脚本重建 battle.xlsx 是结构变更的既定流程)、Cocos 3.8.8(渲染仅最简表现)。

## Global Constraints

- 战斗逻辑纯数据不依赖 cc;改单位状态必须走 `applyEffect`;三条战场不变量(近战前压硬保险/远程有限射程/防线用 homeX)不动。
- 行军是**表现假象**:布阵/防线/刷怪坐标全部保持局部坐标,禁止引入世界坐标。
- 结构性改 `battle.xlsx` 的流程:改 `tools/seed-battle-xlsx.ts` → `npm run seed:battle` → `npm run config`(种子与 xlsx 保持同步是既定纪律)。
- 数值迁移原则:tank/怪物移速沿用现值(近战冲锋与怪推进行为等价);dps/healer 新增移速仅用于行军(战斗中钉站位分支改由 `archetype !== 'melee'` 单独判定,不再依赖 moveSpeed<=0)。
- 中文 commit + `Co-Authored-By: Claude <noreply@anthropic.com>`;每 Task 一 commit 不 push;每 Task 结束 `npm run typecheck && npm test && npm run sim:pacing`,收尾跑完整 `npm run verify`。

---

### Task 1: moveSpeed 迁入 CombatStats(属性表结构迁移)

**Files:**
- Modify: `assets/scripts/config/BattleConfig.ts`(CombatStats 加 moveSpeed;EnemyType 删 speed;classes 删 moveSpeed)
- Modify: `tools/seed-battle-xlsx.ts`(STATS_HEADER/ENEMY_HEADER/CLASSES_HEADER 迁列 + 各 ROWS 数值搬运)
- Modify: `tools/excel-to-config.ts`(STAT_KEYS 加 moveSpeed;EnemyTypes 删 speed 解析;Classes 删 moveSpeed 解析;checkStatRanges 非负列表加 moveSpeed)
- Modify: `assets/scripts/config/EffectTypes.ts`、`assets/scripts/combat/EffectiveStats.ts`(各自 STAT_KEYS 加 moveSpeed;normalizeStats 钳 `moveSpeed ≥ 0`)
- Modify: `assets/scripts/combat/CombatUnit.ts`(删单位 moveSpeed 字段,工厂不再赋值)
- Modify: `assets/scripts/combat/BattleManager.ts`(读取点改 `stats.moveSpeed`;近战钉站位分支改 `s.archetype !== 'melee'` 单判)
- Modify: `assets/scripts/debug/ConfigPanel.ts`(STAT_META 加 moveSpeed 行;删 classes 移速滑块与 enemyTypes 移速滑块——统一属性循环自动覆盖)
- Modify: `tools/seed-buff-xlsx.ts`(加占位减速 Buff:`['frost','冰缓',3,1,'refresh',0,'','moveSpeed%:-0.3','','debuff']`)+ 重跑 seed:buff/config
- 迁移测试引用(typecheck 驱动):`tools/*.ts` 中构造 CombatStats 字面量处
- 产物:`battle.xlsx`/`battle.config.generated.ts`/`buff.config.generated.ts` 重新生成提交

**Interfaces(后续 Task 依赖):**
- `CombatStats.moveSpeed: number`(全单位移动速度,像素/秒;Buff/装备可修正)。
- `CombatUnit` 不再有 `moveSpeed` 字段——一切读 `u.stats.moveSpeed`。

**数值搬运表(种子脚本里写死):** Stats 表 tank 移速=原 Classes 表 tank moveSpeed 值、dps/healer=220(行军用,战斗中钉站位不受影响);EnemyTypes 各怪 moveSpeed=原 speed 值。

- [ ] **Step 1: 类型与工具链迁移**(上列 Files 全部改完;`CombatUnit` 删字段后 `npm run typecheck` 驱动清理所有编译错——BattleManager 369/385 行近战冲锋、敌人推进循环、测试里钉怪的 `e.moveSpeed = 0` 改 `e.baseStats = {...e.baseStats, moveSpeed: 0}; e.stats = e.baseStats` 或提为共用 helper)
- [ ] **Step 2: 重新生成配置** — Run: `npm run seed:battle && npm run seed:buff && npm run config`,Expected: battle 源无校验错误,buff 源 buffs=7
- [ ] **Step 3: 全量回归** — Run: `npm run typecheck && npm test && npm run sim:pacing`,Expected: 全绿(数值等价搬运,pacing 行为不变;抖动复跑确认)
- [ ] **Step 4: Commit** — `refactor(战斗框架): moveSpeed 迁入 CombatStats 统一属性表——减速可 Buff 化,classes/enemyTypes 顶层移速废弃`

---

### Task 2: marching 状态机(清波→行军→再战)

**Files:**
- Modify: `assets/scripts/config/BattleConfig.ts`(`Wave` 加 `distance: number`;`Level` 删 `waveGap`)
- Modify: `tools/seed-battle-xlsx.ts`(LEVELS_HEADER 的 `waveGap` 列换 `distance` 列,每波行填占位 600,末波填 0)
- Modify: `tools/excel-to-config.ts`(Levels 解析:distance 挂 wave 且同波一致性校验,删 waveGap;distance<0 报错)
- Modify: `assets/scripts/combat/BattleManager.ts`(状态机)
- Modify: `assets/scripts/debug/ConfigPanel.ts`(删"波次间隔"滑块,加每波"行军距离"滑块)
- Create: `tools/march-test.ts`;Modify: `package.json`(`test:march` + test 链)
- 产物:`battle.xlsx`/`battle.config.generated.ts` 重新生成提交

**Interfaces:**
```ts
export type BattlePhase = 'spawning' | 'marching' | 'won' | 'lost';   // 'gap' 删除
export interface MarchStartedEvent { type: 'marchStarted'; distance: number; duration: number; }
export interface MarchEndedEvent { type: 'marchEnded'; }
// BattleEvent union += 两者
marchDuration: number;   // 本次行军总时长(渲染层做进度插值用),行军外为 0
marchRemaining: number;  // 剩余时长
```

**状态机要点:**
1. `_checkWinLose` 清波分支:最后一波 → `won`(现状);否则 → `_startMarch(下一波)`:`phase='marching'`,时长 = `waves[当前波].distance ÷ minMoveSpeed`(`minMoveSpeed` = 存活士兵 `stats.moveSpeed` 最小值,全体 ≤0 时兜底 1 防除零),清 `projectiles.length=0`/`zones.length=0`,push `marchStarted`。
2. `_updateSpawning` 的 gap 分支改 marching:`marchRemaining -= dt`,每帧给存活士兵 `actionLock<=0` 时 `_setAction(s,'run')`;走完 → push `marchEnded`、`_startWave(next)`。
3. 行军中 Buff 照 tick(`_updateBuffs` 在 phase 判定之外,现状即如此)、技能计时照走(`_updateSkills` 无怪不放,保留待放语义天然成立)、治疗照跑(奶残血)。
4. `gapTimer`/`waveGap` 引用全删。

- [ ] **Step 1: 写失败测试 `tools/march-test.ts`**(骨架同 zone-test;mkQuietManager 造高攻速队清波):清第 1 波后 `phase==='marching'` 且 `marchDuration == distance/最慢移速`;给一名士兵上 frost 减速 Buff 后再清波,时长按减速后最慢值算;行军首帧 `projectiles/zones` 为空;走完时长后 `phase==='spawning'` 且敌人再度刷出;事件流含 `marchStarted{distance,duration}`/`marchEnded`;打完最后一波直接 `won` 不行军。
- [ ] **Step 2: 确认失败** — Run: `npx tsx tools/march-test.ts`,Expected: FAIL
- [ ] **Step 3: 实现**(配置链 + 状态机四要点;`npm run seed:battle && npm run config` 重生成)
- [ ] **Step 4: 全量回归** — Run: `npx tsx tools/march-test.ts && npm run typecheck && npm test && npm run sim:pacing`,Expected: 全绿——pacing 里 march 只是加时间,胜负结构不变;13 门槛复跑确认
- [ ] **Step 5: Commit** — `feat(战斗流程): marching 行军推进状态机——清波行军到下个刷怪点,waveGap 废弃`

---

### Task 3: 渲染最简表现 + 收尾

**Files:**
- Modify: `assets/scripts/ui/BattleStageView.ts`(marching 时:背景滚动提速 ×3(读 `mgr.phase`,Background 的 update dt 乘系数或调既有滚动参数——以实际 API 为准,先 grep `Background` 的驱动点)、HUD 状态文字显示"行军中"+ 进度(`1 - marchRemaining/marchDuration`))
- Modify: `ai/memory/代码地图.md`(BattleManager 行:行军状态机/事件;BattleConfig 行:moveSpeed 入 stats、Wave.distance)
- Modify: `ai/skills/战斗框架.md`(不变量补"行军是表现假象,禁止世界坐标";stats 表加 moveSpeed 说明)
- Modify: `ai/skills/配置与关卡.md`(Levels 表结构变更:waveGap→distance)
- Modify: `ai/memory/项目状态.md`(最近进展 + 待办)
- Modify: `docs/superpowers/specs/2026-07-11-combat-flow2-design.md`(实做偏差回写,如有)

- [ ] **Step 1: 渲染表现**(先 `grep -n "background\|Background" assets/scripts/ui/BattleStageView.ts assets/scripts/BattleEntry.ts` 确认 Background 驱动点再动手;色块阶段只做背景提速+文字,不做镜头)
- [ ] **Step 2: Cocos 网页预览人工点验**(唯一必须人工的步骤,请用户开一局看:清波→背景加速卷动+全员跑步→到点刷怪→通关;不通过则回 Task 2 修)
- [ ] **Step 3: 文档同步五件套**
- [ ] **Step 4: 终验** — Run: `npm run verify && npm run sim:pacing`,Expected: 全绿
- [ ] **Step 5: Commit** — `docs(战斗流程): Plan B 收尾——行军表现/文档同步/终验`
