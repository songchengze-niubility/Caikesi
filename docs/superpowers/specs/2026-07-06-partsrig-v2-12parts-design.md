# 部件规范 v2：12 件标准骨架（肘关节 + 袍摆前后片）设计

> 日期：2026-07-06 ｜ 状态：方向已与用户对齐（方案一），细节待用户审阅本 spec
> 取代 `2026-07-05-partsrig-design.md` 第 1 节的拆件规范（8 件 v1 → 12 件 v2）；该 spec 的三层架构、振幅红线、真素材调参、失败兜底仍有效。
> 范围：拆件规范 v2、生成提示词模板 v2、组装/绑骨管线重做、四动作关键帧重写。
> 不在范围：Cocos 接入决策（继续后置，倾向原生 dragonBones 组件）、怪物/其他角色铺量、换装。

## 背景与动机

用户在 DB 审 8 件骨架动作草稿：attack 挥臂像整根棍子（无肘部发力）、run 腿直挺挺（整体僵）。
单件肢体靠调参救不回来——需要加关节。结合真素材事实（dps 为长袍角色：画面上无大腿/膝盖，
袍摆整片焊死在躯干件里，run 僵硬的最大来源是**死袍摆**），「手和腿各多一个关节」落地为：

- 手臂拆 **大臂 / 小臂**（肘关节；宽袖口是天然断缝，同裤脚口原理）；
- 腿保持单件（本来就是袍摆下的小腿+鞋段），生动度改由**袍摆前后片**独立摆动承担。

已评估并否决的替代案：14 件（再拆膝）——对长袍角色增益趋近零、多 4 条断缝；
12 件按字面拆膝不拆袍摆——run 最大僵硬源未解决。

## 1. 部件规范 v2（12 件，全角色同件同锚点同父子链，动作参数共享）

| # | 件 | 内容 | 锚点 | 父级 | 层级(后→前) |
|---|------|------|------|------|------|
| 1 | `hairBack` | 马尾 | 扎发点 | head | 1 |
| 2 | `armBackUpper` | 后大臂+宽袖 | 肩口 | torso | 2 |
| 3 | `armBackLower` | 后小臂+手 | 肘（袖口内） | armBackUpper | 3 |
| 4 | `robeBack` | 袍摆后片 | 腰带后缘 | torso | 4 |
| 5 | `legBack` | 后小腿+鞋 | 裤脚口 | root | 5 |
| 6 | `legFront` | 前小腿+鞋 | 裤脚口 | root | 6 |
| 7 | `robeFront` | 袍摆前片 | 腰带前缘 | torso | 7 |
| 8 | `torso` | 上身衣袍（领口/双肩口/腰带，腰带以下收口） | 领口 | root | 8 |
| 9 | `head` | 头+前发 | 脖颈 | torso | 9 |
| 10 | `armFrontUpper` | 持械大臂+宽袖 | 肩口 | torso | 10 |
| 11 | `armFrontLower` | 持械小臂+拳 | 肘（袖口内） | armFrontUpper | 11 |
| 12 | `weapon` | 武器 | 握把 | `armFrontLower`（v1 挂 armFront） | 12 |

- 腿夹在袍摆前后片之间（robeBack 之前、robeFront 之后）：跑动时脚从摆间露出、被前片半掩，
  袍角翻飞遮挡关系正确。腿挂 root 不变（脚踩地，不随上身呼吸/前倾漂移）。
- 断缝遮挡策略：肘=小臂肘端圆头伸进宽袖口（袖口盖缝）；腰=袍摆两片与躯干在腰带处画足重叠余量；
  其余收口面沿用 v1（颈口/肩口/裤脚口）。
- `RIG_MAX_PART_OFFSET = 14` 振幅红线不变。

## 2. 素材与提示词模板 v2（`ai/memory/视觉风格.md` 同步升级）

- 每角色交付物仍是双图：完整立绘 + **十二件拆解图**（image-2 挂立绘做参考图）。
- 模板相对 v1 的增量：躯干改"腰带以下收口、不含袍摆"；新增袍摆前/后片（腰带处收口）；
  双臂各拆两件（大臂：肩口+袖口双收口；小臂：从袖口伸出、肘端圆头收口）；腿件描述不变。
- 断缝遮挡要求写进提示词（肘端圆头、腰带重叠余量）。
- 挑图关键更新：正好 12 件互不合并；已知风险——件数越多越易合并/遗漏（v1 八件就爱把双腿并一件），
  预期多抽几张；三坑防线全保留（泛洪抠图治同色衣料、组装 flip 治鞋尖反向、相位断言治同手同脚）。
- dps 用现有立绘 `docs/visual/staging/characters/new_dps.png` 参考重生成，形象不变，用户审图。
- 新拆解图落位：`docs/visual/staging/characters/dps_parts_sheet_12.png`。

## 3. 管线与代码改造（**重头开始**：组装校准不继承 v1 数值）

- `tools/sprite-pipeline/slice_sheet.py`：泛洪切件件数无关，不改。
- 新写 `tools/sprite-pipeline/assemble_parts12.py`：12 件 CONFIG 校准表**从零标定**（缩放/锚点/落点/
  镜像/基础角），不复制 `assemble_parts8.py` 的数值；parts8 版脚本与 `parts8_final/` 产物只留档不删。
- `tools/sprite-pipeline/export_dragonbones.py`：骨架链升 v2（12 骨、weapon 挂 armFrontLower），
  重出 DB 工程 `temp/partsrig-demo/dragonbones/`（旧 8 骨工程留档）。
- `assets/scripts/art/PartsRigConfig.ts`：`RigPartId` 联合类型、`RIG_PARENTS`、色块调试绑定表升 12 件。
- `assets/scripts/art/parts.actions.generated.ts`：四动作关键帧**全部重写**——
  run：袍摆前后片反相摆动 + 肘部跟随甩动；attack：屈肘蓄力→直臂鞭甩爆发（预备-爆发-僵直三段）；
  idle：呼吸 + 袍摆微漾；death：沿用整体倒地淡出。
- `tools/parts-rig-test.ts`：断言升级——父子链无环覆盖新链、新增肘部归位/袍摆前后片反相断言，
  跑步同手同脚相位拦截保留。
- `tools/parts-rig-preview.ts` 等预览工具随件表适配。

## 4. 分工、验收与回退

- 分工不变：AI 写 12 骨关键帧 JSON 重导出 ↔ 用户在 DragonBones 审/手改，先磨 attack 打击感。
- 验收：120px 下四动作可读、循环无跳变、断缝不露馅；本次专项目标——**run 袍摆活起来、
  attack 有肘部鞭甩感**（v1 的两处僵硬点消失即过）。
- 回退：8 件素材/工程/动作全部留档，v2 素材或手感失败可整体回退 v1。

## 实施顺序

1. `视觉风格.md` 模板 v2 + 本 spec 落库 → **把生成提示词交给用户**（用户生图是唯一外部依赖，先解锁）；
2. 代码侧先行：PartsRigConfig v2 + 测试断言 + export_dragonbones 骨链（可用色块/旧件占位自测数学）；
3. 用户交付 `dps_parts_sheet_12.png` → slice_sheet 切件 → assemble_parts12 从零校准（对照立绘自查）；
4. 重出 DB 工程 + AI 写四动作关键帧 → rig:preview 预览页 + 用户 DB 审。
