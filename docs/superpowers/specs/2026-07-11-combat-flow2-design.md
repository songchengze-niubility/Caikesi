# 战斗流程 2.0 设计(技能槽/被动 + 行军推进)

> 2026-07-11。两个子系统:①角色技能槽(2 槽,主动/被动混装,被动含常驻/条件触发/光环三形态);②横向长图行军推进(清波→行军到下个刷怪点→再战,最后一波清完通关)。均构建在战斗框架第 1/2 段(CombatUnit/applyEffect/Buff/弹道/场地)之上。

## 需求口径(已与用户钉死)

- 技能槽:每角色 **2 槽**,槽内主动/被动皆可;**现阶段按职业固定填表**,玩家不可装配(不动存档)。
- 主动技能:沿用现有两种触发(攻击 X 次 / 每 X 秒),纯自动无输入。
- 被动三形态全做:常驻属性加成、条件触发型、光环型。
- 条件触发钩子 v1 四个:**普攻命中时 / 受击时 / 击杀时 / 释放主动技能时**。
- 行军:全队同速齐进(取最慢者),途中不遭遇,到刷怪点才出怪。
- 移动速度进 `CombatStats` 统一属性表(装备/铭文/Buff 可加减速)。

## 两个关键架构决策

1. **行军 = 表现假象,不做世界坐标**。战斗逻辑永远在同一套局部坐标(布阵/防线/刷怪 x=halfW 不动);行军是新战斗阶段 `marching`:按 `距离 ÷ 全队最慢 moveSpeed` 倒计时,期间渲染层背景卷动+角色原地跑。判负方案:真实 worldX+镜头系统——防线/前压钳制/刷怪/渲染全要重写,画面效果与假象方案无差别。
2. **被动复用 Buff 系统,不建独立结算层**。Buff 加"永久"时长(`duration: -1` 不衰减、不可驱散除非带标签);常驻加成=开战给自己上永久 Buff,光环=开战给全队上永久 Buff;条件触发=轻量钩子层,proc 后对事件对象走 `applyEffect`。属性聚合/事件/渲染全部复用既有系统。

## A. 技能槽与被动

### A1. skill.xlsx 表结构(重构)

| 列 | 说明 |
|----|------|
| id / name / cls | 沿用;**每职业最多 2 行**(=2 槽,导表校验超出报错) |
| kind | `active` / `passive`(新列) |
| trigger / triggerValue / target / radius / maxTargets / effects / delivery | 主动行沿用现有语义;被动行 trigger 等主动专属列必须为空(导表校验) |
| passiveTrigger | 被动专属:`always`(常驻/光环,开战生效) / `onHit`(普攻命中) / `onHurt`(受击) / `onKill`(击杀) / `onCast`(释放主动技能后) |
| chance | 被动专属:触发概率 0~1(always 必须为 1) |
| targetMode | 被动专属:`trigger`(事件对象:onHit=被打的敌人、onHurt=攻击者、onKill=被杀者无意义故禁配、onCast=自己) / `self`(自己) / `team`(全队存活者) |

示例编码:
- 普攻 20% 附毒:`passive, onHit, 0.2, trigger, effects=applyBuff:poison`
- 受击 15% 上石肤:`passive, onHurt, 0.15, self, effects=applyBuff:stone_skin`
- 击杀回血:`passive, onKill, 1.0, self, effects=heal:0.3`
- 全队攻击光环:`passive, always, 1.0, team, effects=applyBuff:war_banner`(war_banner 为 duration=-1 的永久 Buff,buff.xlsx 新行)

### A2. 永久 Buff

- `buff.xlsx` 的 `duration` 允许 `-1` = 永久:`tickBuffs` 跳过时长递减(周期效果照跳);导表校验放行 -1、拒绝 0 和其他负数。
- 永久 Buff 到期事件永不触发;可被驱散(若带 dispelTag)——光环被驱散不自动补挂,v1 接受(占位阶段无敌方驱散)。

### A3. PassiveSystem(新纯逻辑模块 `combat/PassiveSystem.ts`)

- 装载:`_setupSquad` 时按职业读 skill 配置,`kind=active` 进 `UnitSkills`(现状),`kind=passive` 进单位的 `passives` 列表(挂 CombatUnit 可选字段)。
- `always` 被动在开战时立即执行一次(对 self/team 逐效果 `applyEffect`)。
- 钩子入口:`firePassives(owner, hook, other)`——按 `chance` 掷概率(裸 Math.random,与战斗随机同口径),命中则按 `targetMode` 解析目标、逐效果 `applyEffect`。
- BattleManager 四个调用位点:普攻命中后(近战直击 + 弹道命中,技能伤害**不算**普攻)、受击后(damage 效果实际命中未闪避时,DoT 不算)、击杀后(`_markDead` 且凶手可溯源时)、`skillCast` 事件推入后。
- 防递归:被动 proc 出的效果(伤害/上 Buff)**不再触发**被动钩子(一层截断,防"反击触发反击"死循环)。

### A4. 迁移与数值(知情项)

- dps 现 3 主动砍到 2 槽:保留 `whirlwind`(旋风斩)+ `lethal_strike`(致命一击),`ground_smash` 移除;tank/healer 各配 1 个占位被动(tank:受击概率石肤;healer:全队小幅攻击光环)示范三形态。
- **pacing 13 门槛必须重校**:技能输出结构变化 + 新被动,按"各关手感接近现状"原则微调 `battle.xlsx`,重跑 `sim:pacing` 至全绿(数值平衡待办的提前小块)。
- 战斗 HUD 技能按钮:按上阵单位的主动技能动态出(≤2×2),色块阶段简单排布。

## B. 行军推进

### B1. 状态机

`BattlePhase` 加 `marching`。流转:`spawning`(刷怪+战斗)→ 清波 → 非最后一波 → `marching`(取代原 `waveGap` 呆等)→ 倒计时走完 → `_startWave(next)`;最后一波清完 → `won`。全灭 → `lost` 不变。

- `battle.xlsx` Levels 的波次数据加 `distance` 列(种子脚本/导表器同步):语义为**清完第 i 波后行军到第 i+1 波刷怪点的距离**,最后一波该列无意义(填 0);
- 行军时长 = `waves[i].distance ÷ 全队存活者最慢 stats.moveSpeed`;
- 行军开始时清残留:弹道、场地全清(毒池不随队行军);Buff **保留**(常驻/光环跨波存续,限时 Buff 行军中照样倒计时);
- 行军中单位动作置 `run`,技能计时**照走**(下一波开战可能技能已就绪,属可接受收益);
- 事件:`marchStarted { distance, duration }` / `marchEnded {}`。

### B2. moveSpeed 进 CombatStats(新战斗维度标准流程)

- `CombatStats` 加 `moveSpeed`;`battle.xlsx` Stats 表、EnemyTypes 的 stats 组各加一列;`classes.moveSpeed` 与 `enemyTypes.speed` 顶层字段废弃删除(种子脚本/导表器/类型同步)。
- `CombatUnit.moveSpeed` 单位字段删除,所有读取改 `u.stats.moveSpeed`(Buff 减速即刻生效——近战冲锋、怪推进、行军全吃);`normalizeStats` 钳 `moveSpeed ≥ 0`;ConfigPanel `STAT_META` 补一行。
- 减速类 Buff(如 `frost` 移速 -30%)作为占位内容进 `buff.xlsx` 示范。

### B3. 渲染与表现(色块阶段最简)

- `BattleStageView`:`marching` 阶段背景视差卷动加速(Background 已有滚动能力)、全员 run、敌尸已清;HUD 波次条显示"行军中"进度(用 marchStarted 的 duration 做本地插值即可)。
- `BattleEntry` 事件消费:march 事件当前可忽略(渲染直接读 phase),仅保留扩展位。

## 测试与回归口径

- 新增:`passive-test`(四钩子/概率边界 0 与 1/targetMode 三种/防递归/always 开战生效/永久 Buff 不衰减)、`march-test`(清波→marching 时长计算(最慢者/减速 Buff 影响)→刷下一波→最后一波直接胜利→行军清弹道场地)。
- 迁移:`skill-test`/`combat-test`/`pacing-sim` 适配;**pacing 门槛重校**是 Plan A 的显式任务,不是顺带。
- `verify` 全绿为每段交付线。

## 实施拆分

一份 spec、两个独立 plan:
- **Plan A:技能槽 + 被动**(表结构重构、永久 Buff、PassiveSystem、四钩子接线、dps 技能迁移、占位被动内容、pacing 重校)。
- **Plan B:行军推进**(moveSpeed 属性迁移、marching 状态机、渲染最简表现、march-test)。
- B 不依赖 A;先 B 后 A 可让 pacing 重校只发生一次(A 的重校在 B 的行军节奏之上做),**推荐先 B 后 A**。

## Plan B 实做偏差回写(2026-07-11)

- dps 实为近战、原移速 300——保留 300(而非设计稿臆写的 220),近战冲锋行为等价;healer 从 0 补 220 仅供行军。
- 末波 `distance` 列填 600 而非 0(该列对末波无效,不强制归零,省一次特判)。
- 其余按设计落地:表现假象行军、marching 取代 waveGap、moveSpeed 进 CombatStats、frost 减速占位 Buff。

## 明确不做(YAGNI)

- 玩家装配技能槽/技能获得(后续版本,届时加 PlayerData 字段)。
- 行军途中遭遇战、往回走、多路线分支。
- 被动内置冷却、被动触发被动的链式反应。
- 主动技能手动释放(纯自动已定)。
