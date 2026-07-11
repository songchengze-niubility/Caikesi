# Idle 8 帧样片 v01

- 日期：2026-07-11
- 状态：用户判退；保留为问题样本，不得进入 `assets/resources/art/`
- 输入：`../reference.png`（角色身份与风格锚点）
- 生成方式：Codex 内置 image generation
- 去底方式：纯色键背景 `#00ff00` → `remove_chroma_key.py` → RGBA
- 排列：4 列 × 2 行，左到右、上到下，共 8 帧
- 最终帧：`final_frames/idle_0.png` … `idle_7.png`

## 生成提示词

```text
Use case: stylized-concept
Asset type: production-oriented 2D game character sprite animation contact sheet
Input images: Image 1 is the identity and style anchor; preserve this exact character
Primary request: create exactly eight sequential frames for one seamless IDLE animation cycle
Subject: the same black-ink chibi swordsman from Image 1 — perfectly round black head with one restrained eye stroke, high long ponytail, layered torn black robe with wide sleeves and wrapped waist sash, black boots, long katana held in the right hand angled down toward screen-right
Style/medium: preserve the original sparse hand-painted Chinese ink-wash look, black and charcoal semi-silhouette, dry-brush and watercolor texture; do not redesign or clean it into vector art
View and direction: strict orthographic pure side view, full body, always facing screen-right, fixed camera, fixed body proportions and fixed sword length
Animation beats: eight distinct but subtle phases of one complete breathing cycle; feet stay planted; torso rises and settles slightly; ponytail, sash tails and robe hem follow with restrained secondary motion; sword grip and general downward-forward sword pose remain stable; frame 7 must flow naturally into frame 0 without duplicating frame 0
Layout: one landscape sprite sheet arranged conceptually as exactly 4 equal columns by 2 equal rows, reading left-to-right then top-to-bottom; exactly one complete character pose centered in each cell; identical character scale, baseline, margins and cell size; no visible grid lines, borders, dividers, numbers, labels or captions
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background across the entire sheet for local background removal
Constraints: every hair tip, robe edge, hand, foot and entire sword must stay fully inside its own cell with generous padding; background must be one uniform color with no shadows, gradients, texture, floor plane, reflections or lighting variation; do not use #00ff00 anywhere in the character; no cast shadow, no contact shadow, no glow, no motion blur, no VFX, no watermark, no text
Avoid: identity drift, changing head shape, changing costume details, changing weapon design or length, 3/4 view, front view, mirrored direction, camera movement, perspective scaling, extra limbs, missing hands, duplicate poses, frame-to-frame color flicker, poses crossing cell boundaries
```

## 自动质检

- 固定 8 帧：通过
- 尺寸统一：`320×240`：通过
- 格式：RGBA PNG：通过
- 四角透明：通过
- 脚底 X 范围：`133–136px`
- 脚底 Y 范围：`234–235px`
- 侧视身体主干 X 范围：`117–118px`
- 圆头内区逐帧可见像素差：`0`（固定使用第 0 帧头部）
- 详细数据：`alpha_qc.json`
- 棋盘格预览：`idle_preview_checker.gif`
- 深色底预览：`idle_preview_dark.gif`

## 本轮工具结论

已去底 RGBA 不能再次按边缘 RGB 抠底，否则透明像素中残留的黑色 RGB 会误删黑衣主体。本轮给 `sprite-keyframe-tool.py` 增加 `--background-mode alpha`，只使用现有 alpha matte 做归一与锚点处理。

用户复查首版发现明显左右位移。定位为 `sideview` 双锚完成后又叠加旧
`visual-stabilize`：它把马尾、披风和长剑纳入横向视觉带，尤其给第 6 帧追加了约
`-11px` 错误位移。现改为 `sideview` 模式跳过该二次校正，只保留身体主干列密度
X 锁和地线 Y 锁；最终身体主干 X 漂移压到 `1px`。

用户继续复查发现圆头本身存在轻微位置、轮廓和眼线变化。曾尝试把第 0 帧圆头硬覆盖
到其余帧；虽然像素指标归零，但破坏了头、颈、发根和身体动作的整体关系，用户判退。
结论：身份结构漂移属于生成问题，不能用局部硬截拼接冒充修复；回到生成源头重做整组。
