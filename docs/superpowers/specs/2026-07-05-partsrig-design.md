# PartsRig 部件缓动动画系统 设计

> **修订（2026-07-05 晚）**：实施中两次重大演进，以下第 1/3 节的"四件拆件规范/动作参数"已被取代——
> ① 部件规范升级为 **8 件标准骨架**（用户定为设计规范，见 `设计日志.md` 与 `PartsRigConfig.ts`，提示词模板在 `视觉风格.md`）；
> ② 动画制作路线改为 **DragonBones 编辑器 + `export_dragonbones.py` 自动绑骨 + AI 写关键帧**（自研编辑器判负，Spine 类工具翻案理由见设计日志）。
> 本文其余部分（三层架构/振幅红线/真素材调参/失败兜底）仍有效；cc 接入层倾向 Cocos 原生 dragonBones 组件（届时 Sampler 退役为工具层）。
>
> 日期：2026-07-05 ｜ 状态：已与用户对齐（方向），实现细节待用户审阅本 spec
> 范围：角色部件缓动动画的渲染层系统：部件节点树 + 纯函数动作采样 + cc tween 驱动；色块 demo 验证手感 → new_dps 四件真图接入。
> 不在范围：怪物/子弹接入（角色验收后按同模板扩）、换装、多层骨骼链、Spine、动作融合。
> 上游决策：风格转向与路线选择理由见 `ai/memory/设计日志.md`（2026-07-05 角色美术转向条目）；本 spec 只谈怎么实现。

## 背景

角色动画主路线从序列帧改为部件缓动：头/马尾/身/武器 3~5 个静态件挂节点树，动作=代码缓动参数组。收益：细节免费（单张静态图）、显存趋近一张立绘、加动作=写参数、循环数学完美。BattleManager 的 `idle/run/attack/death` 动作状态机保持不动（逻辑与渲染分离边界）。

## 1. 部件与拆件规范（每角色交付物）

| 部件 | 内容 | 锚点（pivot） | 层级（后→前） |
|------|------|------|------|
| `hair` | 马尾+发带 | 扎发点 | 1（最底，身后） |
| `body` | 躯干+腿+手臂+握拳 | 脚底中心 | 2 |
| `head` | 头+脸+前发 | 脖颈 | 3 |
| `weapon` | 整把武器 | 握把中心 | 4（最上） |

- 遮挡用**层级设计**消除而非补画：头压领口切（body 保留被遮领口）、拳头留在 body 上（weapon 独立旋转）。四件均无需 AI 补全。
- 目录：`assets/resources/art/char/<角色>/parts/{hair,body,head,weapon}.png`；白衣角色源图用浅灰底生成再抠。
- ArtManifest 新条目类型：`'parts'`——`{ type:'parts', dir, pieces:{hair,body,head,weapon}, pivots:{...} }`，逻辑键 `char/<角色>/parts`；`check-art` 照常校验文件存在。

## 2. 架构（三层，纯逻辑可单测）

| 文件 | 职责 | 依赖 cc |
|------|------|------|
| `art/PartsRigConfig.ts` | 动作参数数据表：每动作每部件的关键帧曲线（位移/旋转/缩放/透明度 + 缓动函数名 + 时长 + loop），纯数据 | 否 |
| `art/PartsRigSampler.ts` | 纯函数采样：`sampleRig(config, action, t) → 各部件 transform`；循环取模、非循环钳制、attack 结束回 idle 的归位约定 | 否 |
| `art/PartsRigPlayer.ts` | cc 胶水：按 manifest 建部件节点树（层级/锚点），每帧用 Sampler 结果写节点 transform；`setAction(action)` 切动作（带 0.1s 过渡插值）；色块模式（无图时部件用纯色 Sprite/Graphics 占位，**demo 即用这个**） | 是 |

- `BattleEntry`：单位角色若在 ArtManifest 有 `parts` 键 → 用 PartsRigPlayer；否则维持现有 FrameAnim 序列帧 → 色块回退链不变。切换点只在渲染层建单位视图处。
- 单测：`tools/parts-rig-test.ts`（tsx）覆盖 Sampler——循环闭合（t=0 与 t=T 相等）、非循环钳制、动作切换归位、参数表完整性（四动作四部件全有定义）。

## 3. 第一版动作参数（demo 手感基准，数值调参用）

- `idle`（loop ~1.2s）：body scaleY 1→1.02 呼吸、head 随呼吸微沉浮（相位滞后 0.1）、hair 小幅摆动（相位滞后 0.25）、weapon 随手微动。
- `run`（loop ~0.5s）：body 前倾 ~8° + y 颠簸两拍、head 反向微稳、hair 大幅后摆、weapon 随臂节奏。
- `attack`（one-shot ~0.35s）：weapon 绕握把 -120°→+70° 抡劈（先蓄后快，ease-in-out 分段）、body 前突 12px 回位、hair 甩动跟随；结束回 idle 姿态。**与攻速的关系**：动画由 BattleManager 的"普攻挥出"事件逐次触发；若单位实际攻击间隔 < 动画时长，按比例压缩动画时长（time scale），保证每刀都完整播完不重叠。
- `death`（one-shot ~0.6s）：整体绕脚底倒 ~85° + 整体淡出至 0.4，保持现有尸体停留逻辑。
- 所有数值都在 `PartsRigConfig` 数据表里，调手感=改数字，配合 ActionPreviewPanel 或网页预览即时看。

## 4. 实施顺序与验收

1. **色块 demo**：PartsRig 三层 + 色块部件（头圆/身方/发条/剑条），网页预览四动作手感——**用户看色块人打拳定手感**，不依赖任何美术、不烧积分；
2. 用户过手感 → 拆 `new_dps.png` 四件（Claude 用 PIL 多边形蒙版切 + 逐件视觉校验 + 拼装对比图给用户）；
3. 真图接入：parts 落 `resources/art/char/dps/parts/` + ArtManifest 登记 + Cocos 导入 `.meta` → 游戏内实战验收；
4. 验收标准：四动作在 120px 下动作可读、循环无跳变、切动作无闪烁/漂移；帧率无回归（部件 tween 每帧只写 4 个节点 transform，性能预期优于序列帧切图）。

## 5. 风险与兜底

- 部件缓动表现力上限（无形变）：武侠"挥袖"类柔性表演做不出 → 复杂表演走视频拆帧管线（已验证），两路线并存。
- 拆件断口在动画中露馅（头抬起露出领口切缝）→ 动作振幅约束在遮挡余量内（规范：重叠区 ≥ 最大位移 ×2），Sampler 单测断言振幅上限。
- 手感调不出"打击感" → attack 参数加预备-爆发-僵直三段式曲线；仍不行加 1~2 张武器挥动补间帧（混合方案，帧数远低于纯序列帧）。
