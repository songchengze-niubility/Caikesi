# 临时美术资源池

这里存放尚未审核、尚未定稿或尚未决定是否进入游戏的临时美术资源。

这些文件不会被游戏直接加载，也不要在 `ArtManifest` 中登记。只有用户明确审核通过，并确认要作为运行资源使用后，才从这里整理到 `docs/visual/exports/...` 或复制到 `assets/resources/art/...`，再按 `ai/skills/美术资源管线.md` 走登记和校验。

## 子目录

- `characters/`：角色、小人、动作视频或序列帧草稿。
- `monsters/`：怪物、敌人、Boss 草稿。
- `effects/`：攻击、受击、技能、环境特效草稿。
- `ui/`：UI 参考、临时拆件、按钮或图标草稿。
- `backgrounds/`：背景、场景、氛围图草稿。

## 命名建议

- `YYYY-MM-DD_用途_主题_vNN.ext`
- 示例：`2026-06-30_character_swordsman_walk_v01.mp4`

## 边界

- 不放进 `assets/resources/art/`，除非已经确认要进游戏。
- 不登记 `assets/scripts/art/ArtManifest.ts`。
- 不把这里的 raw crop 或未审核 AI 图直接当运行资源。
