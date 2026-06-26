# Caikesi · AI 工作约束

本文件每次会话自动加载，是智能体的**强制入口**。

## ⚠️ 每次上下文必读（固定小集合，别全量读 skills）

1. `ai/README.md` —— 工作区地图 + **技能索引**（看 description 决定读哪条）。
2. `ai/memory/项目状态.md` —— 当前进度 / 方向 / 待办。
3. `ai/memory/代码地图.md` —— 模块 → 职责 → 关键文件（导航）。

## 按需读（不要一次全读）

- **相关技能**：按当前任务，从 README 技能索引里挑 1~2 个相关的 `ai/skills/*.md` 读，别全量加载。
- **为什么这么设计**：要查历史决策时才读 `ai/memory/设计日志.md`。

> 规模会涨：技能多了仍只读相关那几条，靠 frontmatter 的 `description`/`when` 判断，控制上下文成本。

## 开发收尾（每段开发结束/交接前）

按 `ai/skills/开发收尾.md` 走一遍：
- 刷新 `ai/memory/项目状态.md`（含顶部「最近进展」——新对话的接力点）。
- 方向性决策 → 追加到 `ai/memory/设计日志.md`（带日期+理由）；过长/里程碑完结 → 剪到 `ai/memory/归档/`。
- **新增/移动模块、改了文件职责 → 同步 `ai/memory/代码地图.md`**（否则导航失真）。
- 提交。

## 边界

- 逻辑与渲染分离：数值进 `assets/scripts/config/`，逻辑在 `combat/`，渲染在 `BattleEntry`/`Background`。
- 现处「色块占位」阶段：先调玩法手感，真实美术后置。
- 与通用插件（如 Superpowers）规则冲突时，**以本项目 ai/ 约定为准**。

## 提交

- 中文 commit，结尾带 `Co-Authored-By: Claude ...`；只在用户要求时提交/推送。
