# 序列帧准备工具：抠白底 + 拆关键帧

本工具用于把白底小人图和参考视频整理成可继续加工的 2D 序列帧素材。

## 可视化界面

首次使用先安装 Python 依赖：

```bash
npm run sprite:keyframes:deps
```

> Windows 上请通过 `py -3` 启动。本机的 `python` 可能是 Microsoft Store 占位符，会直接退出，导致页面打不开。
> 处理视频需要 ffmpeg；依赖脚本会安装 `imageio-ffmpeg` 作为兜底，不要求系统 PATH 里已有 ffmpeg。

```bash
npm run sprite:keyframes:ui
```

启动后会打开本地页面：

```text
http://127.0.0.1:8765
```

界面处理结果默认只写入临时预览缓存，不算正式导出：

```text
temp/sprite-keyframes/ui-preview/
```

确认预览后，可以在界面里点“导出到 output”再写入正式输出目录：

```text
output/sprite-keyframes/ui/
```

也可以不导出，直接在界面里导入到 Cocos 资源目录。导入时优先从“目标文件夹”下拉里选择已有目录；要新建动作目录时，再手动填写资源键和文件名前缀：

```text
目标文件夹：char/001/attack_01
资源键：char/001/attack_01
文件名前缀：attack_01
播放 FPS：12
循环播放：攻击动作通常不勾选
```

导入时会先按所有帧的共同透明边界裁切成同一尺寸，再写入 Cocos 资源目录：

```text
assets/resources/art/char/dps/attack_01/
```

处理完成后，网页结果区会额外生成并播放 `game_keyframes/`：这批帧已经按导入游戏时的共同透明边界裁切，动画预览、深色底检查、strip 和缩略图都会优先使用它。也就是说，页面上的动画预览现在对应的是即将写进 `assets/resources/art/...` 的 PNG，而不是导入前的 512 统一画布临时帧。

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

如果目标帧已经被 Cocos 导入并存在 `.png.meta`，导入器还会把这些 sprite-frame `.meta` 改成 `trimType: "custom"` 的全帧尺寸，避免 Cocos 再按每一帧单独自动裁切。这样工具里的动画预览和游戏里的运行预览会使用同一套裁切边界。

> **新目录必须走两步**：全新动作目录首次导入时还没有 `.meta`，之后开 Cocos 编辑器会生成默认
> `trimType: "auto"` 的 meta——在游戏 `SizeMode.CUSTOM` 下会逐帧拉伸抖动。Cocos 导入完成后，
> 回到本页面在「资源键」填该目录（如 `char/dps/attack_01`），点 **「修补 .meta」** 按钮即可，
> 不需要重新生成或覆盖导入。`npm run check:art` 会校验所有序列帧 meta（trimType/尺寸/同动作同尺寸），
> 漏了这一步会直接报红。

导入时还会自动计算**身体基准指标**写进 ArtManifest 条目（均为 0-1 归一化，逐帧取中位数抗单帧异常）：

```ts
bodyH: 0.9451,   // 身体高/帧高
anchorX: 0.3841, // 脚接触点 X/帧宽
footY: 1,        // 身体底 Y/帧高
```

游戏侧按 `bodyH` 把「身体」而不是「整帧」缩放到职业目标高，并按 `anchorX`/`footY` 对齐脚点——
否则各动作按自身透明边界裁切后，切动作时身体会忽大忽小、左右横移。指标不准时可手改 manifest 微调。
覆盖导入帧数变少时，多余的孤儿 `.meta` 会被自动清掉。

如果输出名称很长，导入/导出也会保留完整 `jobId` 查找目录，不再截断后报“找不到这次生成结果”。

## 推荐命令

```bash
npm run sprite:keyframes -- \
  --character path/to/hero.png \
  --video path/to/reference.mp4 \
  --out output/sprite-keyframes/hero_attack_01 \
  --sample-fps 12 \
  --video-start 2.5 \
  --video-end 4.2 \
  --selection-mode diverse \
  --frame-size 512 \
  --visual-stabilize \
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
  character_frame.png         # 按当前锚点模式归一化的小人图
  keyframes/
    key_000.png
    key_001.png
    ...
  raw_frames_preview.png     # 源视频采样对照图，用来判断参考视频有没有真实动作变化
  keyframes_strip.png         # 横向透明序列帧条
  keyframes_preview.png       # 棋盘格预览图
  keyframes_preview_dark.png  # 深色底预览图，用来检查白边残留
  game_keyframes/             # 与导入到 Cocos 相同裁切边界的游戏预览帧
    key_000.png
    key_001.png
    ...
  game_keyframes_strip.png
  game_keyframes_preview.png
  game_keyframes_preview_dark.png
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
- `--edge-contract 1`：抠图后向内腐蚀 alpha 边缘 N 像素，切掉抗锯齿产生的半透明白边（深色底显灰白描边的根源）。`0` 关闭；小人尺寸默认 `1` 已能砍掉约半数白边像素且不啃主体；白边仍重可调 `2`。fringe 只降亮到阈值的像素、对中灰半透明边无能为力，这一步是兜底。
- `--sample-fps 12`：视频先按多少 FPS 采样。
- `--video-start 0`：从视频第几秒开始采样，默认从 0 秒开始。
- `--video-end 1`：采样到视频第几秒结束；必须大于 `--video-start`。设为 `0` 时不指定结束点。
- `--video-seconds 1`：兼容旧用法，表示从 `--video-start` 起处理多少秒；当 `--video-end > 0` 时会被忽略。`--video-end 0 --video-seconds 0` 表示从起始秒处理到片尾。
- `--diff-threshold 12`：动作变化达到多大才选为新关键帧。
- `--selection-mode diverse`：默认高精模式，按主体姿态差异挑帧；`diff` 是变化阈值；`even` 是均匀抽帧。
- `--min-gap 2`：两个关键帧之间至少间隔几个采样帧。
- `--max-keyframes 24`：最多输出多少关键帧，设为 `0` 表示不限制。
- `--target-keyframes 8`：强制整理成接近指定数量的关键帧。
- `--frame-size 512`：输出统一画布尺寸；也支持 `320x256`；设为 `0` 表示自动尺寸。
- `--padding 8`：角色离画布边缘的安全距离。
- `--anchor-mode foot`：锚点模式。默认 `foot` 会先做主体稳定，再用脚尖/鞋底接触像素做最终硬锁，最适合待机、跑动、站桩攻击；`body` 会锁身体中心，适合角色大幅离地的素材。
- `--no-anchor-stabilize`：关闭多点主体稳定。默认会先估计主体稳定偏移，再按 `anchor-mode` 把每帧锁到统一位置；如果想保留视频里真实横向冲刺位移再关闭。
- `--visual-stabilize`：视觉锁定。站地锚点后再按躯干几段 alpha 加权中心做横向微调，适合 idle/站桩动作里“脚不动但人眼觉得身体左右飘”的情况；如果动作本来要横向位移，不要开启。
- `--no-foot-contact-lock`：关闭脚尖硬锁。默认开启；`foot` 模式会在视觉锁定之后再把最底接触像素压回同一列，避免脚尖被躯干微调带走。
- `--foot-contact-freeze-rows 4`：脚尖硬锁后，把最底接地像素行从参考帧复制到所有帧，默认 4 行；设为 `0` 可关闭。这个只应给 idle/站桩等站地动作使用，跑动或真实脚步位移动作觉得鞋底被“粘住”时调成 `0` 或关闭脚尖硬锁。
- `--scale-stabilize`：额外启用每帧缩放稳定，默认关闭。待机动作通常不要开，避免角色忽大忽小；只有参考视频真的有远近缩放抖动时再试。
- `--alpha-threshold 28`：裁切主体时忽略很淡的透明边缘。视频压缩导致整屏被裁进去时，可以调高到 `40-80`。
- `--keep-raw-frames`：保留从视频里采样出来的原始帧。

## 约定

关键帧输出会使用统一画布、共享缩放、多点主体稳定、视觉锁定、脚尖硬锁和输出后位置校验；导入到
`assets/resources/art/char/<role>/<action>/` 时，再统一裁成共同透明边界并修补已有 Cocos `.meta` 为全帧 custom。这样不会因为头发、衣摆、武器、抠底边界变化、AI 视频里的轻微身体漂移，或 Cocos 每帧自动裁切，导致角色中心被重新计算后左右/上下抽搐。
