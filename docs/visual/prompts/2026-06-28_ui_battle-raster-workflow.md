# 2026-06-28 UI Battle Raster Workflow

## 输入

- 来源：用户已放入 Figma `Cgameui` 的 GPT PNG 示意图（节点 `47:3`）。
- 用途：UI / 战斗主界面 / Figma 分层、热区和可交互原型准备。
- 目标画幅：1080 × 1920，竖屏 9:16。
- 是否准备进游戏运行：否，当前是 Figma 视觉归档、交互热区和开发拆解稿。

## 原始要求摘要

```text
不要重新绘制整张图，不要改成扁平矢量风。
基于 1080×1920 PNG 游戏界面参考图做 Figma 分层、标注和可交互原型。

创建 Battle_UI_Reference：导入原 PNG，x=0,y=0,width=1080,height=1920，图层名 00_Raster_Reference_Locked，锁定，不修改底图；上方创建透明热区。

创建 Battle_UI_Raster_Slices：复制 PNG 多份，通过 crop/mask 拆分 TopHUD_Raster、Battle_BG_Raster、Battle_Units_Raster、Skill_Bar_Raster、Bottom_Nav_Raster，保持原始像素视觉。

创建 Battle_UI_Editable_Trace：原 PNG 放底层，opacity=35%，锁定；只临摹 UI 组件，不重绘复杂水墨背景、角色和怪物。
```

## Figma

- 文件：[Cgameui](https://www.figma.com/design/7eSuvkgKCiYkzoQamQ5YJt/Cgameui?node-id=47-3&m=dev&t=HHNj1520cRDmHl8J-1)
- 原 PNG 节点：`47:3`
- 新建 Frame：
  - `Battle_UI_Reference`
  - `Battle_UI_Raster_Slices`
  - `Battle_UI_Editable_Trace`

## 导出图

- `docs/visual/exports/ui/2026-06-28_ui_battle-reference-locked_v01.png`
- `docs/visual/exports/ui/2026-06-28_ui_battle-raster-slices_v01.png`
- `docs/visual/exports/ui/2026-06-28_ui_battle-editable-trace_v01.png`

## 取舍记录

- 保留：PNG 原始视觉、角色/怪物/背景/按钮/导航的高保真像素效果。
- 调整：只增加透明交互热区、raster crop/mask 分层、UI 可编辑 trace。
- 淘汰：整图重绘、扁平矢量化、重新设计角色/怪物/背景。

## 验证

- `Battle_UI_Reference`：1080×1920；`00_Raster_Reference_Locked` 锁定，x=0/y=0/1080×1920。
- 热区：11 个，fill opacity=0，stroke=none。
- `Battle_UI_Raster_Slices`：5 个 crop/mask raster 层，均使用同一 PNG imageHash。
- `Battle_UI_Editable_Trace`：底图 opacity=35%，锁定；只叠 UI 组件 trace。

## 2026-06-28 修正

- 问题：`battle-ui-sliced_v01` 证明 raw rectangular crop 会把源图纸纹/背景一起带进组件，落到游戏里会显脏底。
- 结论：raster crop 只允许作为 reference；进入 `assets/resources/art/ui/...` 前必须重抠为透明组件、生成 HTML 预览，并通过 `npm run check:ui-alpha`。
- 本轮修正预览：`docs/visual/exports/ui/2026-06-28_battle-ui-runtime-clean_v02/preview.html`。
