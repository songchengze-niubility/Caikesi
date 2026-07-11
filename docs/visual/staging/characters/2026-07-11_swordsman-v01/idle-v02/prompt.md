# Idle 8 帧重生版 v02

- 日期：2026-07-11
- 状态：上游 staging，待用户审核；不得进入 `assets/resources/art/`
- 输入：`../reference.png`（唯一身份、结构与风格锚点）
- 生成方式：Codex 内置 image generation，整组重新生成
- 去底方式：纯色键背景 `#00ff00` → `remove_chroma_key.py` → RGBA
- 最终帧：`final_frames/idle_0.png` … `idle_7.png`
- v01 判退原因：用第 0 帧头部硬覆盖其余帧，局部指标正确但整体连接关系错误

## 本轮生成原则

整组从源头采用 limited animation：头、眼线、发根、颈部、身体、手、剑和脚点共用
同一个刚性主画；只允许马尾发梢、腰带尾与破损袍摆产生连续的八相位风摆。禁止后处理
硬截头部或局部拼贴。

## 自动质检

- 固定 8 帧：通过
- 尺寸统一：`320×240` RGBA PNG：通过
- 四角透明：通过
- 头部暗色核心质心范围：X `0.568px` / Y `0.428px`
- 身体主干 X 范围：`0.5px`
- 脚点 X 范围：`1px`
- 脚点 Y 范围：`0px`
- 详细数据：`alpha_qc.json`
- 棋盘格动画：`idle_preview_checker.gif`
- 深色底动画：`idle_preview_dark.gif`
- 头部逐帧对比：`head_diagnostic.png`

## 生成提示词

```text
Use case: identity-preserve
Asset type: production 2D game sprite sheet, exactly eight frames for one seamless idle loop
Input images: Image 1 is the sole identity, anatomy, costume, weapon and ink-style anchor
Primary request: regenerate the complete eight-frame idle sheet from scratch as coherent limited animation; do not patch or collage existing frames

NON-NEGOTIABLE SHARED MASTER CEL:
Build all eight frames from one shared rigid master drawing of the character.
The round head, head size, head silhouette, eye stroke, face direction, forehead bang, hairline, hair tie and ponytail attachment point must be visually identical and occupy exactly the same pixels/position in every panel.
The neck, shoulders, torso, belt, arms, hands, sword grip, katana shape and length, legs, boots, body scale, body center and ground contact must also remain fixed in every panel.
When the eight panels are overlaid, the head and rigid body must not wobble, resize, rotate, redraw, breathe sideways, bob, or morph.

ONLY THESE PARTS MAY CHANGE:
1. the loose ponytail strands after the fixed hair tie,
2. the two loose waist sash tails,
3. the outer torn robe hem and a few dry-brush fringe tips.
Animate only those flexible parts through eight restrained, smooth wind-sway phases. Their roots stay attached at identical points. Frame 7 must lead naturally into frame 0 without duplicating frame 0. The motion should feel like one continuous gentle breeze cycle, not eight redesigned poses.

Character identity: exactly the black-ink chibi swordsman in Image 1, strict pure side view facing screen-right, perfectly round black head with one restrained eye stroke, high long ponytail, layered torn black robe, wrapped sash, black boots, long katana angled down toward screen-right
Style/medium: preserve the original sparse hand-painted Chinese ink-wash, black and charcoal semi-silhouette, watercolor and dry-brush texture; retain intentional rough ink edges; do not convert to vector, 3D, polished anime or clean cel shading
Layout: one landscape sheet, exactly 4 equal columns by 2 equal rows, read left-to-right then top-to-bottom; exactly one complete character per cell; same scale, same center, same baseline and generous equal padding; no visible grid lines, borders, numbers, labels or captions
Scene/backdrop: perfectly flat uniform solid #00ff00 chroma-key background across the entire sheet for local removal
Constraints: every hair tip, robe edge, hand, foot and full sword stays inside its own cell; no shadows, gradients, floor, reflections, texture or lighting variation in the background; do not use #00ff00 inside the character; no cast shadow, no contact shadow, no motion blur, no VFX, no watermark, no text
Avoid: any head variation, eye variation, neck stretch, head bob, body translation, changing body proportions, changing costume, changing sword, 3/4 view, mirrored direction, extra or missing limbs, detached hair or cloth, duplicate frames, frame-to-frame brightness flicker, poses crossing cell boundaries
```
