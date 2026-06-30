# 序列帧准备工具：抠白底 + 拆关键帧

本工具用于把白底小人图和参考视频整理成可继续加工的 2D 序列帧素材。

## 可视化界面

```bash
npm run sprite:keyframes:ui
```

启动后会打开本地页面：

```text
http://127.0.0.1:8765
```

界面输出默认写入：

```text
output/sprite-keyframes/ui/
```

生成后可以在界面里直接导入到 Cocos 资源目录：

```text
资源键：char/dps/attack_01
文件名前缀：attack_01
播放 FPS：12
循环播放：攻击动作通常不勾选
```

导入后会复制关键帧到：

```text
assets/resources/art/char/dps/attack_01/
```

并自动写入：

```ts
'char/dps/attack_01': {
  type: 'frames',
  dir: 'art/char/dps/attack_01',
  prefix: 'attack_01',
  frames: 14,
  fps: 12,
  loop: false
}
```

文件会按你选择的前缀命名：

```text
attack_01_0.png
attack_01_1.png
attack_01_2.png
...
```

## 推荐命令

```bash
npm run sprite:keyframes -- \
  --character path/to/hero.png \
  --video path/to/reference.mp4 \
  --out output/sprite-keyframes/hero_attack_01 \
  --sample-fps 12 \
  --video-seconds 1 \
  --selection-mode diverse \
  --frame-size 512 \
  --max-keyframes 12
```

也可以只处理图片：

```bash
npm run sprite:keyframes -- --character path/to/hero.png --out output/sprite-keyframes/hero
```

或只拆视频关键帧：

```bash
npm run sprite:keyframes -- --video path/to/reference.mp4 --out output/sprite-keyframes/ref_attack
```

## 输出

```text
output/sprite-keyframes/<name>/
  character_transparent.png   # 小人抠白底后的透明图
  character_frame.png         # 底部中心锚点归一化的小人图
  keyframes/
    key_000.png
    key_001.png
    ...
  raw_frames_preview.png     # 源视频采样对照图，用来判断参考视频有没有真实动作变化
  keyframes_strip.png         # 横向透明序列帧条
  keyframes_preview.png       # 棋盘格预览图
  keyframes_preview_dark.png  # 深色底预览图，用来检查白边残留
  manifest.json               # 抽帧参数、时间点、归一化信息
```

## 常用参数

- `--white-threshold 245`：越低，越多接近白色的区域会被当成背景。
- `--white-softness 28`：越高，白底边缘会更柔，但也更可能吃掉浅色细节。
- `--background-mode auto`：默认自动模式，会结合纯白和图片边缘背景色抠底。
- `--edge-tolerance 65`：边缘背景容忍度。还有白底残留时可试 `75-90`；误删衣服时调低。
- `--edge-softness 42`：边缘背景柔化范围，数值越高边缘越柔。
- `--hole-min-area 120`：清理内部白孔的最小连通面积；眼睛高光被误删时可调高。
- `--hole-max-area 30000`：清理内部白孔的最大连通面积；头发缝大白块没清掉时可调高。
- `--no-hole-cleanup`：关闭内部白孔清理。
- `--fringe-radius 2`：清理透明边缘附近几像素的浅色白边。
- `--fringe-strength 0.85`：白边净化强度；白边仍明显时调高到 `0.95`，误伤细节时调低。
- `--fringe-brightness 155`：白边亮度阈值；浅灰白边仍明显时调低，误伤发丝高光时调高。
- `--no-fringe-cleanup`：关闭浅色白边净化。
- `--sample-fps 12`：视频先按多少 FPS 采样。
- `--video-seconds 1`：只处理视频前几秒，默认 `1`；设为 `0` 表示完整处理整段视频。
- `--diff-threshold 12`：动作变化达到多大才选为新关键帧。
- `--selection-mode diverse`：默认高精模式，按主体姿态差异挑帧；`diff` 是变化阈值；`even` 是均匀抽帧。
- `--min-gap 2`：两个关键帧之间至少间隔几个采样帧。
- `--max-keyframes 24`：最多输出多少关键帧，设为 `0` 表示不限制。
- `--target-keyframes 8`：强制整理成接近指定数量的关键帧。
- `--frame-size 512`：输出统一画布尺寸；也支持 `320x256`；设为 `0` 表示自动尺寸。
- `--padding 8`：角色离画布边缘的安全距离。
- `--no-anchor-stabilize`：关闭多点主体稳定。默认会从角色上/中/下多个横带估计身体核心锚点，并把每帧主体锁到统一位置，适合待机、原地跑、原地攻击；如果想保留视频里真实横向冲刺位移再关闭。
- `--scale-stabilize`：额外启用每帧缩放稳定，默认关闭。待机动作通常不要开，避免角色忽大忽小；只有参考视频真的有远近缩放抖动时再试。
- `--alpha-threshold 28`：裁切主体时忽略很淡的透明边缘。视频压缩导致整屏被裁进去时，可以调高到 `40-80`。
- `--keep-raw-frames`：保留从视频里采样出来的原始帧。

## 约定

关键帧输出会使用统一画布、共享缩放、多点主体稳定和输出后位置校验。这样后续把素材放入
`assets/resources/art/char/<role>/<action>/` 时，不会因为头发、衣摆、武器、抠底边界变化或 AI 视频里的轻微身体漂移，导致角色中心被重新计算后左右/上下抽搐。
