# 角色美术管线（纯侧视 · 序列帧回归）设计

> 日期：2026-07-06 ｜ 状态：方向已与用户对齐，细节待用户审阅本 spec
> 范围：① 上游定案纯侧视 + 提示词模板；② 网页手动挑帧（抽全帧/清晰度标记/推荐高亮/挑帧导出）；③ 抠图加固 + 侧视防滑双锚 + 组合；④ 12 件部件缓动路线判负留档 + 记忆同步。
> 不在范围：Cocos import-art 下游（现有链路不动）、怪物/子弹、多角色铺量。
> 取代方向：部件缓动（PartsRig/DragonBones）从主路线降级为判负存档；序列帧重新成为角色动画主路线。

## 背景与动机

用户在 DragonBones 审 12 件骨架动画后判负——部件组装路线放弃，回归序列帧。同时提出两条改进：
① **抽帧工具要优化**，痛点在 **A 抠图/锚点质量**（残渣/白边/脚底打滑）+ **C 选帧智能度**（均匀拆帧拆到废帧、循环点靠人剪不准）；
② **只需要侧视图**——上游素材从源头锁纯侧视，工具端可据此做更狠可靠的自动化。

分工原则（承接跨会话记忆「协作风格」）：**用户挑帧（审美判断），AI 做机械环节（抠图+对齐+组合）**。因此自动选帧从「替用户决定」降级为「推荐起点，可接受可无视」。

## 1. 上游定案：纯侧视

- 每角色交付物：**1 张侧视立绘 + N 段侧视动作视频**（不再要拆解图/多视角参考）。
- `ai/memory/视觉风格.md` 新增「侧视动作视频提示词模板」：正侧机位锁定、禁转身/禁运镜/禁透视缩放、原地动作（角色不做整体位移）、纯白背景、固定光照、单动作单循环。
- 侧视是工具端一切自动化的前提假设（地线锁定 / 水平漂移补偿 / 躯干带对齐在非侧视下不成立）。

## 2. 网页手动挑帧（第一段 · 用户环节）

现有 `tools/sprite-keyframe-ui.py`（本地 http server）+ `sprite-keyframe-ui.html`（单页）加「手动挑帧」流程，新增两个端点：

### 2.1 `POST /api/extract-all`
- 入参：上传视频 + 可选 `sample_fps`（默认 0 = 原生 fps）。
- 处理：ffmpeg 按原生 fps 抽**全部帧**到 job 目录 `_allframes/raw_*.png`；对每帧算：
  - **清晰度分** `frame_sharpness`：Laplacian 方差（numpy 4-邻域算子，不引 cv2/scipy），归一到 0-1；低于中位数 ×0.5 标「糊」。
  - **推荐集**（方案1 智能，作绿框高亮）：`select_recommendation`——用现有 `frame_feature` 抽姿势特征 →
    - `detect_loop_span`：候选起止帧对里选姿势特征距离最小的一对，作循环起止；
    - `arclength_pick`：在循环区间内按**累计姿势变化量**（相邻帧特征距离前缀和）均匀取 `target`（默认 8）帧，每帧就近吸附到清晰度更高的邻帧。
- 返回：帧缩略图 URL 列表 + 每帧 `{index, sharpness, isBlur, recommended}` + 原视频 URL（供内嵌播放对照）。

### 2.2 前端「手动挑帧」面板
- 缩略图九宫格：糊帧红框压暗、推荐帧绿框；点选/取消切换选中态。
- 内嵌 `<video>` 播放原片对照；顶部帧预算计数（选 N / 红线 10，超红线变红警告）。
- 「一键接受推荐」按钮（把推荐集填入选中态，再手动微调）。
- 「生成」按钮 → 把选中帧号（升序）POST 到 2.3。

### 2.3 `POST /api/assemble-selection`
- 入参：`jobId` + `indices`（选中帧号）+ 抠图/组合选项（沿用现有 option_defaults 的白底/锚点参数）。
- 处理：见第 3 节；返回 game_keyframes/strip/预览 URL（结构对齐现有 `/api/process` 的 files_payload），后续 import-art 不变。

## 3. 抠图加固 + 侧视防滑双锚 + 组合（第二段 · AI 机械环节）

对选中帧（`_allframes/raw_<i>.png`）按序处理：

### 3.1 抠图加固（治 A）
- 复用 `cut_white_background`，新增 `largest_component_only`：抠出 alpha 后只保留**最大连通域**（游离残渣/飞白/断裂拖影直接丢），用现有 `edge_connected_mask`/连通域逻辑实现。
- 白边去污染：现有 `decontaminate` 默认开；边缘收缩 `edge_contract` 保留。

### 3.2 侧视防滑双锚（治 A，吃侧视红利）
新增 `align_sideview(frames) -> aligned_frames`，纯侧视原地动作假设下：
- **地线 Y 硬锁**：每帧取最低稳定 alpha 行（底部 ≤3 行 alpha 面积 > 阈值的最下行），全序列对齐到该行的中位数 Y（脚底不再上下跳）。
- **躯干带 X 对齐**：取每帧 alpha bbox 上 60%（躯干+头，run/attack 中位移最小）做相邻帧亚像素互相关（复用 `estimate_mask_translation`/`overlap_shift_score` 思路），累计补偿水平漂移，消掉即梦视频的机位/主体横移。
- 二者只做整体平移，不缩放不形变（侧视下主体视觉尺寸恒定，平移即够）。

### 3.3 组合
- 复用 `build_game_preview_frames`：shared-alpha-bbox 统一裁剪 + `game_target_height` 帧高钳制 → game_keyframes + strip + 明/暗预览。
- 输出结构与现有 `/api/process` 一致，前端预览与 import-art 零改动复用。

## 4. 判负留档 + 记忆同步

- **12 件部件缓动全部留档不删**（同 3D 管线判负存档）：`PartsRigConfig.ts`/`parts.actions.generated.ts`/`assemble_parts12.py`/`export_dragonbones.py`/`parts12_final/`/`dragonbones/` 原地保留；代码地图标注「判负存档，勿复用」。
- `ai/memory/设计日志.md`：记「部件缓动（8→12 件）判负、回归序列帧」的动机与理由（DB 审后判负、序列帧+纯侧视+挑帧分工更适配单人产能）。
- `ai/memory/项目状态.md`「最近进展」刷新为本管线；`代码地图.md` 更新 sprite-pipeline 相关行。
- 旧分工修正：`2026-07-05-video-sprite-pipeline-design.md` 里「循环点裁剪留人工」作废——工具接管循环点检测，人只负责挑帧。

## 实施顺序

1. 后端：`frame_sharpness` + `select_recommendation`（`detect_loop_span`/`arclength_pick`）+ `align_sideview` + `largest_component_only` 抠图选项，各带纯函数单测（tsx/py 二选一，跟随现有工具用 py 内联自测）。
2. 端点：`/api/extract-all` + `/api/assemble-selection`。
3. 前端：手动挑帧面板（九宫格/播放/预算/推荐/导出）。
4. 上游模板 + 记忆同步 + 12 件留档标注。
5. 用户在真实侧视视频上验收（真素材调参原则：占位视频只验证流程，美学阈值在真素材上定）。

## 风险与兜底

- 即梦侧视视频仍可能有轻微透视/位移 → 躯干带对齐 + 地线锁按「整体平移」兜底；残留漂移用户可在挑帧时避开问题帧。
- 清晰度/推荐是**辅助非强制**：全部可被用户手选覆盖，工具不因推荐失败而阻断。
- 抠图最大连通域可能误杀「飞起的衣袖/武器脱开主体」→ 该选项可关（回退现有全连通域抠图）。
