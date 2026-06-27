# 美术/UI 资源管线 · 设计文档

> 日期：2026-06-27 · 阶段：色块占位 → 真实美术过渡 · 面向 AI（Codex）驱动的资源交付

## 目标

让"换美术"变成可靠、可重复的傻瓜操作：Codex 把图按约定丢进仓库 + 登记一笔，游戏自动用上；**没画的图自动回退到现有色块，绝不阻塞玩法或报错**。代码与美术彻底解耦。

## 核心思路：逻辑键 + 回退

代码永远用**逻辑键**（如 `bg/main`、`char/tank/idle`）要资源，不写文件路径。`ArtRegistry` 把键解析成 SpriteFrame；**解析不到返回 null**，渲染层回退到现有 Graphics 色块。
→ 美术可逐个替换、缺图不崩，贴合"色块占位 → 真实美术"的阶段化。

## 范围（第一版）

**做**：静态 2D 图（PNG→SpriteFrame）+ 序列帧动画（一组 PNG，代码驱动播放）。建好管线基础设施，并在**两个参考实体**上打通端到端：
- **背景**（静态图）——证明静态路径；
- **小队 3 个角色**（序列帧待机）——证明动画路径 + 缺图回退。

其余实体（怪/子弹/UI 图标按钮）按同一模板后续迁移，不在本版。

**不做（非目标）**：Spine 骨骼动画、音频、BMFont 飘字、微信分包打包。

## 交付与导入工作流（约定）

1. **Codex**：把图按目录约定放进 `assets/resources/art/...`（序列帧用编号 `idle_0.png`…）；在 `ArtManifest` 加逻辑键条目；`git commit`（图 + 清单）。
2. **人（你）**：打开一次 Cocos 编辑器，等它自动导入生成 `.meta`，把 `.meta` 一起提交。（Cocos 规定每个资源须经编辑器导入获得 uuid，此步不可省，但只是开软件等几秒。）
3. **游戏**：运行时按逻辑键加载；缺图回退色块。

## 架构与组件

```
assets/resources/art/         （放 resources/ 下才能按路径 resources.load）
  bg/  char/<职业>/<动作>/  enemy/  bullet/  ui/
assets/scripts/art/
  ArtManifest.ts     逻辑键 → 资源描述（Codex 直接编辑的纯 TS 表）
  ArtRegistry.ts     加载/缓存/回退：preload(keys) + get(key)→SpriteFrame|null
  FrameAnim.ts       给一个 Sprite 节点按 frames/fps/loop 代码切帧（不需编辑器 AnimationClip）
tools/check-art.ts   校验脚本：遍历 ArtManifest，每个文件/编号帧在磁盘是否存在
ai/skills/美术资源管线.md   给 Codex/你的操作约定（升级现有「渲染与美术替换.md」）
```

### ArtManifest（纯 TS，Codex 维护）
逻辑键 → 资源描述。两种类型：
```ts
export type ArtEntry =
  | { type: 'sprite'; path: string }                                  // 单张静态图
  | { type: 'frames'; dir: string; frames: number; fps: number; loop: boolean }; // 序列帧

export const ArtManifest: Record<string, ArtEntry> = {
  'bg/main':        { type: 'sprite', path: 'art/bg/main' },
  'char/tank/idle': { type: 'frames', dir: 'art/char/tank/idle', frames: 6, fps: 8, loop: true },
  // ...Codex 加美术时在此登记
};
```
- 路径相对 `resources/`，不带扩展名（Cocos `resources.load` 约定）。
- 序列帧约定文件名 `<dir>/idle_0.png … idle_{frames-1}.png`。

### ArtRegistry（加载 + 回退）
- `preload(keys: string[]): Promise<void>`——进战斗/打开界面前批量预载（避免运行中卡顿，呼应性能约束）。
- `getSprite(key): SpriteFrame | null`——静态键，缺则 null。
- `getFrames(key): { frames: SpriteFrame[]; fps; loop } | null`——序列帧键，任一帧缺则整体 null。
- 内部缓存已加载资源；未登记或加载失败 → 返回 null（不抛）。
- 记录"缺失的键"列表，供调试浮层与排查用。

### FrameAnim（代码驱动序列帧）
- 给定一个 `Sprite` + `getFrames` 结果，按 `fps` 定时切 `spriteFrame`，`loop` 控制循环。
- 不依赖编辑器 AnimationClip；纯代码，最易被 AI 交付的图驱动。

### 渲染层接入模式（参考实体）
渲染层对每个实体：向 `ArtRegistry` 要资源 → **拿到就用 `Sprite` 节点（静态）/ `Sprite`+`FrameAnim`（动画）；拿不到就走原 Graphics 色块分支**。
- **背景**（`Background.ts` / `bgNode`）：`getSprite('bg/main')` → 有则给 bgNode 挂 Sprite，无则画现有渐变。
- **角色**（`BattleEntry` 渲染小队处）：每个 soldier 一个持久 `Sprite` 节点，`getFrames('char/<cls>/idle')` → 有则播放序列帧，无则画现有色块方块（保留血条逻辑）。

> 怪/子弹/UI 暂留色块，等本管线验证通过后按同模板迁移。

## 验证

- **`npm run check:art`（tsx）**：遍历 `ArtManifest`，逐条确认对应文件/编号帧在 `assets/resources/` 下真实存在 → 缺文件报错并列出。Codex 提交后一跑即知有没有漏图。
- **游戏内调试浮层**：列出本局 `ArtRegistry` 记录的"缺失键"，肉眼可见哪些还在用色块。
- 参考实体的端到端手动验证：放一张真背景图 + 一组角色帧 → 编辑器导入 → 预览，确认显示真图；删掉登记 → 回退色块、不报错。

## 关键不变量

- 代码只认逻辑键，不写资源路径（路径只在 `ArtManifest`）。
- 任何资源缺失 → 回退色块，**永不阻塞玩法、不抛异常**。
- 资源加载集中在 `preload`（进场前），不在战斗每帧加载（性能约束）。
- `art/`、`ArtRegistry`、`FrameAnim` 是渲染层；不进 `combat/` 逻辑层。
- "需要哪些美术 + 放哪" 的唯一权威 = `ArtManifest`（被代码读、被 `check-art` 校验）；"怎么操作" 的权威 = `ai/skills/美术资源管线.md`。

## 文件清单

| 文件 | 职责 | 新建/改 |
|------|------|--------|
| `assets/scripts/art/ArtManifest.ts` | 逻辑键→资源描述（Codex 维护） | 新建 |
| `assets/scripts/art/ArtRegistry.ts` | 加载/缓存/回退 + 缺失键记录 | 新建 |
| `assets/scripts/art/FrameAnim.ts` | 代码驱动序列帧播放 | 新建 |
| `assets/resources/art/...` | 资源目录约定（含 1 张占位背景 + 1 组角色帧作样板） | 新建 |
| `tools/check-art.ts` + `package.json` 脚本 | 资源完整性校验 | 新建/改 |
| `combat/Background.ts` | 背景接 `getSprite('bg/main')`，缺则原渐变 | 改 |
| `BattleEntry.ts` | 角色接序列帧，缺则色块；挂调试浮层 | 改 |
| `ai/skills/美术资源管线.md` | Codex/你的操作约定 | 新建（升级渲染与美术替换） |
