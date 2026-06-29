# Cgame 视觉产出库

这里存放已经整理过、需要长期追溯的 GPT 网页生图、Figma 整理、UI/美术示意图和人工审核记录。它是视觉归档库，不等于游戏运行资源。

类 VberAI 的本地 UI 拆分工作台已按用户要求删除。后续新图片先在本目录归档参考、提示词、Figma 导出和人工审核记录；确认要进游戏的资源再进入 `assets/resources/art/`。

## 目录

- `references/`：用户发来的原始参考图、GPT 网页生成图、截图。
- `prompts/`：每轮提示词记录，包含原 prompt、改写 prompt、结果评价；新记录可从 `prompts/TEMPLATE.md` 复制。
- `exports/ui/`：通过审核后需要追溯的 UI 示意图，以及人工整理的 UI 拆件记录（组件 PNG、预览、alpha/坐标记录）。
- `exports/art/`：Figma 导出的角色、怪物、背景、图标、特效等美术示意。
- `exports/style/`：Figma 导出的风格板、色板、组件质感板。

## 命名

- 图片：`YYYY-MM-DD_<用途>_<主题>_vNN.png`
- 提示词记录：`YYYY-MM-DD_<用途>_<主题>.md`
- 示例：`2026-06-28_ui_battle-main_v01.png`

## 权威来源

- 流程怎么做：`ai/skills/UI与美术产出管线.md`
- 新图片归档：`docs/visual/`
- 当前风格结论：`ai/memory/视觉风格.md`
- 游戏运行资源：`assets/resources/art/` + `assets/scripts/art/ArtManifest.ts`

确定要进游戏运行的图片，必须有明确用户审核通过记录，再转入 `assets/resources/art/` 并按 `ai/skills/美术资源管线.md` 登记和校验。

UI 拆件包必须有可复核预览或截图记录：组件叠在棋盘格和游戏近似背景色上没有源图脏底，才允许进入 `assets/resources/art/ui/...`。矩形 raw crop 只能当 reference。
