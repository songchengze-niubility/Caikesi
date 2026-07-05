# 3D 渲染序列帧管线（最小验证） 设计

> 日期：2026-07-05 ｜ 状态：**验证判负（2026-07-05）**——链路全程跑通，但风格不达标，详见文末「验证结论」
> 范围：用 dps 角色验证「图→3D→绑骨→动作→Blender 渲染」链路：idle/run 两个动作、对比预览、审核通过后按美术资源管线入游戏。
> 不在范围：attack/death 铺量、Tripo API 自动化、ComfyUI 本地方案、卡通着色（仅作为风格兜底预案）、替换/删除现有 sprite-keyframe 视频管线。

## 背景与动机

现行角色动画管线是「即梦生图 → 生视频 → sprite-keyframe 拆帧/抠图/锚点稳定」。视频这一步天生不为序列帧服务：透视/光照漂移、脚点不稳、循环不闭合、白底要抠、跨动作身材不一致——工具里的视觉锁定/脚尖硬锁与 ArtManifest 的 `bodyH/anchorX/footY` 都是补丁。3D 渲染管线在根上消除这些问题：一个模型出全部动作，透明底、精确帧数、天然循环、跨动作绝对一致。

## 决策记录

1. **最小验证先行**：1 个角色（dps）× idle/run 两个动作，效果达标后才建全套自动化管线。
2. **图转 3D + 自动绑骨选 Tripo**（2026 横评绑骨质量最好，T-pose 直出 + FBX 导出）；模型/绑骨质量差时备选切 Meshy 对比，流程不变。
3. **源图新生成**：不用现有临时帧的形象，按项目水墨武侠风 + T-pose 要求写即梦提示词，生成 3D 专用立绘。
4. **网页端人工、代码端自动**：Tripo 网页步骤（上传/生成/绑骨/挑动作/导出）由用户按清单手动操作；Blender 安装、渲染脚本、预览页、导入由 Claude 完成。
5. **动作来源四层瀑布**（缺动作补动作数据，模型与渲染链路不动）：
   - ① Tripo 预设（idle/run 等基础位移动作）；
   - ② Mixamo（免费 2500+ 库，攻击/受击/死亡等标准战斗动作的主力来源）；
   - ③ 文字生动作（DeepMotion SayMotion / Genaimo，定制技能动作如旋风斩）；
   - ④ 视频转动捕（即梦生成动作视频 → DeepMotion Animate 3D / QuickMagic 提取骨骼动画→重定向；视频只作动作来源，像素由 Blender 渲染，漂移/抠图问题不复存在）。
   验证期只用 ①，但需确认骨骼重定向链路可通（②③④ 的骨骼命名与 Tripo 不同，Blender 里一次性配映射，全动作通用）。

## 1. 流程与分工

| 步骤 | 谁 | 产出 |
|------|----|------|
| ① 即梦生成 T-pose 立绘（用 Claude 给的提示词） | 用户 | 正面全身、四肢展开、纯色背景 PNG，放 `docs/visual/staging/characters/` |
| ② Tripo：上传→生成模型→自动绑骨→挑 idle/run 预设→导出 FBX（按 Claude 给的逐步清单） | 用户 | 带动画 FBX（或模型+动画分件） |
| ③ 安装 Blender（winget）+ 渲染脚本 | Claude | `tools/sprite3d/render_sprites.py` |
| ④ 无头渲染 idle/run 各 8~10 帧 | Claude | 透明 PNG，帧高 ≤240，命名 `idle_0.png…` 对齐现有目录约定 |
| ⑤ 对比预览页（新帧 vs 现有临时帧，棋盘格+游戏近似背景色） | Claude 做页，用户审 | HTML 预览 + 用户审核记录 |
| ⑥ 审核通过后按 `ai/skills/美术资源管线.md` 导入 | Claude + 用户开编辑器 | ArtManifest 登记、`.meta` 修补、游戏内实测 |

## 2. 渲染脚本 `tools/sprite3d/render_sprites.py`

验证期写的即是正式管线的沉淀件，不是一次性代码。

- 调用方式：`blender -b -P render_sprites.py -- --fbx <路径> --action <名> --frames <N> --out <目录>`。
- 正交相机、侧视角（角色朝右，与游戏一致）、透明背景、Workbench/Eevee 平光渲染。
- 按动画时长均匀采样 N 帧；循环动作首尾帧不重复采。
- 输出高度直接渲染为 ≤240px，从源头满足显存红线，不依赖后期缩放。
- 相机取景框按骨骼包围盒统一计算一次、全动作共用 → 跨动作身材/脚点天然一致，`bodyH/anchorX/footY` 可不填。
- 预留骨骼名重定向入口（Mixamo/SayMotion → Tripo 骨骼映射表），验证期打通但不铺量。

## 3. 失败处理

- Tripo 模型/绑骨质量差 → 微调提示词换源图重试一次；仍差 → 切 Meshy 对比（流程不变）。
- Tripo 预设动作僵硬/缺失 → 按四层瀑布逐层降级（Mixamo → 文字生动作 → 视频转动捕）。
- 120px 下 3D 感太重、风格违和 → 加 Blender 卡通着色（Freestyle 描边 + 色阶化）再渲一轮；仍不行则判负止损，回退方向改为「视频管线自动化」（即梦 CLI `frames2video` 首尾帧同图循环 + sprite-keyframe 无头化）。

## 4. 验收标准

- 用户在对比预览页与游戏内（ActionPreviewPanel 或实战）认可观感；
- idle/run 循环无跳帧、脚点稳定；
- 单动作 ≤10 帧、帧高 ≤240、透明底干净，`npm run check:art` 全绿；
- 骨骼重定向链路确认可通：任选一个 Mixamo 动作重定向到 Tripo 模型并渲染出帧、无明显骨骼扭曲，即算通过（为 attack/death 铺量铺路）。

## 5. 验证通过后的展望（本期不做）

全套自动化：即梦 API 生图 → Tripo API 模型+绑骨 → 动作库批量套用 → Blender 批量渲染 → ArtManifest 自动登记。届时 `sprite-keyframe` 视频管线退为备用，角色/怪物铺量按脚本分钟级产出。

## 验证结论（2026-07-05，判负）

**技术链路全部跑通**：image2 T-pose 立绘 → Tripo 图转 3D（质量好）→ Mixamo 自动绑骨（原模型面数过高卡 Tripo 绑骨，Mixamo 成功）→ idle/run 带动画 FBX → Blender 4.5 无头渲染（`tools/sprite3d/render_sprites.py`，正交 45° 朝右、统一取景、透明底、240px、Workbench 平涂与 Eevee+Freestyle 卡通两种模式）→ 三方对比预览页（含游戏主背景真实比例垫底）。

**判负原因**：渲染观感与项目手绘水墨风差距过大。原味渲染"手办感"重；卡通模式（平涂+描边）改善明显但仍是"赛璐璐动画"质感，放在水墨背景上违和，用户判定完全不可接受。根因是 3D 渲染给不出手绘贴图的水彩笔触——这是着色器层面解决不了的风格鸿沟（AI 风格化后处理理论上可救，但用户判定方向不对，不再追加投入）。

**沉淀资产**（保留，换美术风格时可复活此路线）：`tools/sprite3d/{render_sprites.py, clean_for_mixamo.py}`、Blender 4.5 便携版（`F:\tools`）、`docs/visual/staging/characters/dps-3d/`（源图/FBX/渲染帧/预览页，FBX 已 gitignore）。

**转向**：回到视频路线自动化（原方案 C）：即梦 CLI `frames2video` 首尾帧同图生成循环动画 + Agent 批量调用 + `sprite-keyframe` 后处理无头化。另立 spec。
