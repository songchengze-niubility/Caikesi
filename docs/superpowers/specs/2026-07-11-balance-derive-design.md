# 生成式数值框架设计（子计划 B：balance.xlsx 真源 + 反解 derive）

日期：2026-07-11
状态：待用户审阅
范围：养成数值框架的"计算器"本体——把已定稿的份额（白板5/等级20/装备50/宝石17/铭文8）与体验锚点（中度：台阶关回刷 5~10 局、全程 25~40 局）变成**可反解、可重跑、防漂移**的数值管线，并产出玩家侧全部养成数值。怪物难度导出与推进模拟验证属第④步（另一 spec）。

## 1. 真源与数据流（核心架构决策）

```
tools/config-xlsx/balance.xlsx（新真源：Shares/Anchors/Caps/Overrides 四表，约 40 个旋钮）
  → tools/balance-model/（纯 TS 求解器）
  → npm run balance:derive → 写 tools/balance-model/derived.values.json（全部派生数值）
  → 各 seed 脚本 import derived.values.json 填"框架接管列" → npm run seed:*（重建 xlsx）
  → npm run config（现有导表不动）→ npm run verify
```

- **derive 不直接改 xlsx**：派生值落在 `derived.values.json`（入库），由 seed 脚本引用。理由：项目纪律是"seed 与 xlsx 同步、seed 是 xlsx 的代码真源"，若 derive 绕过 seed 直写 xlsx，seed 立即漂移、防漂移检查失效。
- **`npm run balance:check`**（挂进 `verify`）：重新求解 → 与入库的 derived.values.json 比对，漂移即红（与 `.generated.ts` 防漂移同模式）。
- 手感例外走 Overrides 表（覆盖某个派生键），不直改 seed/xlsx。

## 2. balance.xlsx 四表

| 表 | 内容 |
|---|---|
| **Shares** | 模块 → 毕业战力份额：base 0.05 / level 0.20 / equip 0.50 / gem 0.17 / inscription 0.08 / skill 0（留列）；校验合计 =1 |
| **Anchors** | 体验锚点与毕业快照参数：台阶回刷局数 5~8（取中值反解）、全程局数 25~40、毕业角色等级 12、毕业装备（品质档 rare~epic、等级 12、5 件）、毕业宝石（数量 9、均值等级 2）、毕业铭文条数 4.5、装备管道比 5:3:2、合成价=N 局收入（N=6）、出售回收率 0.18、经验目标（顺推+回刷自然到 Lv12）、宝石 levelRatio 1.6、铭文 roll 下限比 0.6、品质阶梯比 1.35 等 |
| **Caps** | 二级属性上限（暴击 0.5/暴伤 1.5/攻速 0.5/移速 0.4/急速 0.5/闪避 0.3/格挡 0.4/格挡减伤 0.7/减免 0.4/伤害类 0.4~0.6/三围% 词条+铭文 0.4）——求解产物必须使毕业快照不越限，越限即 derive 报错 |
| **Overrides** | `target(表.键.字段) / value / 理由`；求解后最后应用 |

## 3. tools/balance-model/ 模块

| 文件 | 职责 |
|---|---|
| `power.ts` | 战力口径：`power(stats, ctx) = EHP × DPS`——18 维全折算（DPS=atk×攻速×(1+暴率×暴伤)×(1+伤害加成期望)；EHP=hp÷[(1-闪避)×(1-格挡率×格挡减伤)×(1-减免)]×减法防御系数）。`ctx` 提供同期怪物 atk/def 参考值（减法公式下 def/atk 的价值依赖对手，参考值取现行怪表，第④步难度导出后再校准） |
| `snapshot.ts` | 毕业快照构造：按 Anchors 拼出"达标玩家"的白板+等级+装备+宝石+铭文面板（依赖求解中的数值，与 solve 迭代） |
| `solve.ts` | 份额反解：给定 Shares×总战力（=白板战力÷0.05），解各模块数值——等级线 `statGrowthPerLevel`、装备 `slotBonuses/品质倍率/affix 值`、宝石 `baseValue×5 类`、铭文 `valueMin/Max×池`。多维分配沿用现表内部比例（如头/胸/腿血量比、宝石类型间比例），只整体缩放到份额目标；解不闭合时定点迭代（≤100 轮收敛，否则报错） |
| `economy.ts` | 经济反解：中度局数 → 宝箱掉率（mobChance/finalChance）、Rewards 区间、drop 掉落组权重缩放、合成价（N 局石收入）、出售回收率、`expBase`（顺推+回刷经验累计=Lv12 门槛累计） |
| `derive.ts` | 编排：读 balance.xlsx → solve+economy → 应用 Overrides → 校验（份额偏差 ≤2pp、Caps 不越限、幂等）→ 写 `derived.values.json`（含每个值的来源注释键） |

npm 脚本：`balance:derive`、`balance:check`；`verify` 链尾追加 `balance:check`。

## 4. 框架接管的派生键（seed 引用 derived.values.json 的范围）

| seed | 接管键 |
|---|---|
| seed-battle | `Stats` 三职业白板（保持现值=绝对锚点，仅登记）、`charGrowth.statGrowthPerLevel/expBase`、`EnemyTypes.exp`（经验流速） |
| seed-equip | `SlotBonuses` 全部 value、`Qualities.multiplier`、`Affixes` 全部 value |
| seed-inlay | `Gems.baseValue`、`Inscriptions.valueMin/Max` |
| seed-craft | `Tiers.costForgeStone`、`qualityWeights`（tier_1 精调；tier_2/3 外推标 provisional） |
| seed-drop | `QualityWeights` 各组缩放（管道比 5:3:2 的"关卡掉落"份额） |
| seed-chest | `Groups.mobChance/finalChance`、`Rewards` 全部区间 |
| InventoryModel | `SELL_FORGE_STONE`（唯一代码内数值：derive 产出后人工回填+注释来源，或后续搬表） |

**不接管**（第④步/后续）：EnemyTypes 战斗属性、Levels 波次 hp、offline.xlsx、金币、技能倍率。

## 5. 求解顺序（derive 内部）

1. 白板战力 P_base（现值直算）→ 总战力 P_total = P_base ÷ share_base。
2. 等级线：解 `statGrowthPerLevel` 使 Lv12 的三围百分比乘全池贡献 share_level。
3. 装备：解平铺池整体缩放系数使"rare~epic Lv12 五件套"贡献 share_equip（品质阶梯 1.35、等级斜率沿用，仅解基数）。
4. 宝石/铭文：同法解 baseValue 池 / roll 区间池。
5. 经济：经验流速（局均 exp → expBase）、宝箱/合成/回收（局数锚点）。
6. Caps 校验 + Overrides + 幂等校验 → 落盘。

（2~4 步互相影响——等级百分比放大装备宝石——按上述顺序定点迭代至份额偏差 ≤2pp。）

## 6. 校验与测试

- 导出时：Shares 合计=1、Caps 不越限、迭代收敛、Override 目标存在、derive 两次零 diff。
- 单测（`tools/balance-model-test.ts`，进 `npm test`）：power 单调性（每维 +10% 战力不降）、份额反解往返（解出的数值代回快照，份额偏差 ≤2pp）、经济反解往返（掉率代回期望局数落在锚点区间）、无 Overrides 幂等。
- 门禁顺序：`balance:check → config → typecheck → test → sim:pacing → art → alpha`。
- **本 spec 落地后现有 13 项 pacing 门槛预计会红**（玩家侧数值整体重排而怪物未动）——属预期：第④步难度导出会按新玩家战力重导怪物曲线并重校门槛。过渡期 `verify` 临时以 `balance:check` 代替 `sim:pacing` 的红项报告（实施计划里给具体处置），不带病绿灯。

## 7. 不做 / 后置

- 怪物难度导出、pacing 门槛重校、推进模拟、手感复核 → 第④步 spec。
- offline.xlsx 重调（只校验不破坏）、金币经济、技能升级份额、第二章 → 后续。

## 8. 实施偏差记录（2026-07-11 落地后回写）

1. **derive 产物为 `derived.values.generated.ts`**（TS 而非 json），无时间戳、确定性内容，`balance:check` 直接比对文本。
2. **新增 `tools/balance-model/templates.ts` 形状模板层**：seed 与求解器的共同真源（部位/词条池/宝石/铭文的手调比例 + 等级线基准 0.05）。原因：求解基线若读"当前生成配置"，重导后 derive 会相对已缩放的表再解一遍，`balance:check` 永久漂移——模板层使 derive→seed→config→check 成为不动点（已实测验证）。
3. **快照数量完全来自经济期望并按孔位封顶**：现结构下毕业宝石期望 56.8 颗 >> 全队 20 孔，快照取 min(期望, 孔位)；Anchors 的数量锚点未启用 fallback。掉率端的"宝石严重过剩"作为事实移交第④步/用户裁量（可调 Rewards.gemCount 或接受背包囤积）。
4. **战力口径两处修正**：`power = √(DPS×EHP)` 几何均值（防单边堆叠刷分）；防御估值用平滑线性 `1+def/enemyAtk` 而非真实减法+保底公式（后者在 def→enemyAtk 时估值悬崖，解算器会薅"廉价防御"）。
5. **缩放只作用一级平铺**（hp/atk/def/moveSpeed 及其百分比）：暴击/伤害类等概率型词条保持模板值，Caps 才守得住；解得 kLevel 0.68 / kEquip 1.30 / kGem 1.20 / kInsc 5.16。
6. **pacing 门槛未红、保留在 verify**：pacing-sim 的装备档位是内部手写平铺（不读装备表），白板与怪物未动故 13 项照绿；但其档位模型已与真实表脱钩（差约 ×1.3 + 宝石/铭文/等级未计），第④步用 derive 报告重校 LOADOUT 并导怪物曲线。§6 预告的"临时摘除"未发生。
7. `SELL_FORGE_STONE` 按 derive 产出人工回填 5/10/20/40/80（common~legend），注释注明来源。

## 9. 验收标准

- `balance:derive` 产出 derived.values.json，各 seed 重建 xlsx、`npm run config` 全绿。
- 份额验证：毕业快照按 power.ts 折算，各模块份额与 Shares 偏差 ≤2 个百分点。
- 经济验证：按产出掉率算期望，台阶期攒一次合成 ≈6 局、顺推+回刷到毕业 ≈Lv12、毕业宝石 ≈9 颗。
- `balance:check` 挂进 verify 且幂等；Overrides 机制可用（示例 override 一条并生效）。
