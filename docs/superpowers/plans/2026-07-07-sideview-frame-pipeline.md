# 纯侧视序列帧管线（手动挑帧 + 抠图加固 + 侧视防滑双锚）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在网页对 30fps 全帧点选关键帧（糊帧标红/推荐标绿），后端按选中帧完成抠图加固+侧视防滑对齐+组合，产出 game_keyframes 接现有 Cocos 导入链。

**Architecture:** 三层：① `frame_select.py` 纯函数（清晰度/循环点/弧长选帧，自测内置）；② `sprite-keyframe-tool.py` 手术式扩展（原生 fps 抽帧、`--frames-dir`+`--select-indices` 旁路选帧、`--largest-component-only` 抠图、`anchor_mode=sideview` 双锚——以 `stable_point_alignment` 同构 dict 插入 `normalize_images`，下游零改动）；③ `sprite-keyframe-ui.py/.html` 加 `/api/extract-all` + `/api/assemble-selection` 两端点和挑帧面板，产物结构对齐现有 `/api/process`，`import-art` 导入链零改动。

**Tech Stack:** Python 3 + numpy + PIL + ffmpeg（imageio-ffmpeg 兜底）；原生 http.server 单页 UI（无前端框架）。

**Spec:** `docs/superpowers/specs/2026-07-06-sideview-frame-pipeline-design.md`

**真素材:** `docs/visual/staging/characters/dps-video/clips/run.mp4`（5.08s，已冒烟：现行均匀拆帧只能 1fps×5 帧跨循环乱抽——本计划的靶子）；立绘 `dps_sideview.png`。

## Global Constraints

- 帧数红线 ≤10、fps 上限 18、「宁短勿卡」不变；游戏帧高钳制默认 240 不变。
- 纯侧视假设仅用于 `anchor_mode=sideview`：地线锁/躯干带对齐只做**整体平移**，不缩放不形变。
- 推荐（循环点/弧长选帧）是**辅助非强制**：全部可被用户手选覆盖，推荐失败不阻断流程。
- 现有 `/api/process` 全自动流程、`split_action.py`、`import-art` 行为保持不变（只加不改语义）。
- 提交：中文 commit message，结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

### Task 1: `frame_select.py` 纯函数模块（清晰度 / 循环点 / 弧长选帧）+ 内置自测

**Files:**
- Create: `tools/sprite-pipeline/frame_select.py`

**Interfaces:**
- Produces（Task 5 的 UI 服务 importlib 加载调用）:
  - `sharpness_scores(paths: list[Path]) -> list[float]`（Laplacian 方差，未归一原值）
  - `blur_flags(scores: list[float], ratio: float = 0.5) -> list[bool]`（低于中位数×ratio 判糊）
  - `feature_vectors(paths: list[Path], size: int = 32) -> list[np.ndarray]`（灰度小图特征）
  - `detect_loop_span(features, min_len_ratio: float = 0.35) -> tuple[int, int]`（循环起止帧对）
  - `arclength_pick(features, span, count, sharpness=None, snap: int = 1) -> list[int]`（弧长均匀+清晰度吸附）

- [ ] **Step 1: 写模块（含 `--self-test`）**

```python
# 侧视序列帧挑帧辅助：清晰度评分 / 循环点检测 / 弧长均匀选帧。
# 纯函数（numpy+PIL），供 sprite-keyframe-ui 的 /api/extract-all 调用。
# 自测：py -3 tools/sprite-pipeline/frame_select.py --self-test
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def _gray(path: Path | Image.Image, size: int) -> np.ndarray:
    img = path if isinstance(path, Image.Image) else Image.open(path)
    small = img.convert("L").resize((size, size), Image.BILINEAR)
    return np.asarray(small, dtype=np.float32) / 255.0


def laplacian_var(gray: np.ndarray) -> float:
    """4-邻域拉普拉斯的方差：越大越清晰（糊帧/重影的高频响应低）。"""
    lap = (-4.0 * gray[1:-1, 1:-1] + gray[:-2, 1:-1] + gray[2:, 1:-1]
           + gray[1:-1, :-2] + gray[1:-1, 2:])
    return float(lap.var())


def sharpness_scores(paths: list[Path], size: int = 128) -> list[float]:
    return [laplacian_var(_gray(p, size)) for p in paths]


def blur_flags(scores: list[float], ratio: float = 0.5) -> list[bool]:
    if not scores:
        return []
    median = float(np.median(np.asarray(scores)))
    return [s < median * ratio for s in scores]


def feature_vectors(paths: list[Path], size: int = 32) -> list[np.ndarray]:
    return [_gray(p, size).reshape(-1) for p in paths]


def frame_distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean(np.abs(a - b)))


def detect_loop_span(features: list[np.ndarray], min_len_ratio: float = 0.35) -> tuple[int, int]:
    """在前 1/3 找起点、其后找终点，选首尾姿势特征距离最小的 (s,e)；e-s ≥ n*min_len_ratio。
    帧数 <6 时退化为全片段。"""
    n = len(features)
    if n < 6:
        return 0, n - 1
    min_len = max(3, int(n * min_len_ratio))
    best: tuple[float, int, int] | None = None
    for s in range(0, max(1, n // 3)):
        for e in range(s + min_len, n):
            d = frame_distance(features[s], features[e])
            if best is None or d < best[0]:
                best = (d, s, e)
    return best[1], best[2]


def arclength_pick(
    features: list[np.ndarray],
    span: tuple[int, int],
    count: int,
    sharpness: list[float] | None = None,
    snap: int = 1,
) -> list[int]:
    """循环区间内按累计姿势变化量均匀取 count 帧（首帧含、尾帧不含——尾≈首），
    每个落点在 ±snap 邻域内吸附到清晰度最高帧。"""
    s, e = span
    seg = list(range(s, e + 1))
    if count <= 0 or len(seg) <= count:
        return seg[:-1] if len(seg) > 1 else seg
    dists = [frame_distance(features[i], features[i + 1]) for i in seg[:-1]]
    cum = np.concatenate([[0.0], np.cumsum(np.asarray(dists))])
    total = float(cum[-1]) or 1.0
    picked: list[int] = []
    for t in np.linspace(0.0, total, count, endpoint=False):
        idx = min(int(np.searchsorted(cum, t)), len(seg) - 2)
        cands = range(max(0, idx - snap), min(len(seg) - 1, idx + snap) + 1)
        if sharpness is not None:
            idx = max(cands, key=lambda j: sharpness[seg[j]])
        picked.append(seg[idx])
    return sorted(dict.fromkeys(picked))


def _self_test() -> None:
    # 合成 36 帧：方块沿正弦轨迹平移（周期 12），第 7/20 帧高斯糊
    from PIL import ImageFilter
    frames: list[Image.Image] = []
    for i in range(36):
        img = Image.new("L", (96, 96), 255)
        x = 40 + int(24 * np.sin(2 * np.pi * i / 12))
        img.paste(0, (x, 40, x + 16, 56))
        if i in (7, 20):
            img = img.filter(ImageFilter.GaussianBlur(3))
        frames.append(img)
    feats = [_gray(f, 32).reshape(-1) for f in frames]
    sharp = [laplacian_var(_gray(f, 128)) for f in frames]
    flags = blur_flags(sharp)
    assert flags[7] and flags[20], "糊帧未被标记"
    assert sum(flags) <= 6, f"误报过多: {sum(flags)}"
    s, e = detect_loop_span(feats)
    assert (e - s) % 12 <= 1 or 12 - ((e - s) % 12) <= 1, f"循环长度 {e - s} 不接近周期倍数"
    picked = arclength_pick(feats, (s, e), 8, sharpness=sharp)
    assert len(picked) == 8 and len(set(picked)) == 8, f"选帧数不对: {picked}"
    assert all(s <= p <= e for p in picked), "选帧越界"
    assert 7 not in picked and 20 not in picked, "糊帧未被吸附避开"
    print("[frame_select] self-test OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        _self_test()
```

- [ ] **Step 2: 跑自测**

Run: `py -3 tools/sprite-pipeline/frame_select.py --self-test`
Expected: `[frame_select] self-test OK`（若循环断言偶发失败，微调合成周期/断言容差后复跑——断言必须先红过再绿的话可先把 `_self_test` 里 assert 条件反写验证会红）。

- [ ] **Step 3: 提交**

```bash
git add tools/sprite-pipeline/frame_select.py
git commit -m "feat(art): 挑帧纯函数模块——清晰度评分/循环点检测/弧长均匀选帧，内置自测"
```

---

### Task 2: 工具支持原生 fps 抽帧 + `--frames-dir`/`--select-indices` 旁路选帧

**Files:**
- Modify: `tools/sprite-keyframe-tool.py`（`parse_args`、`extract_video_frames`、`process_video` 尾段抽公共函数、新增 `process_frames_dir`、`main`）

**Interfaces:**
- Consumes: 现有 `cut_white_background`/`normalize_images`/`make_*` 全部原样复用。
- Produces（Task 5 调用）: CLI 形如
  `py -3 tools/sprite-keyframe-tool.py --frames-dir <job>/raw_frames --select-indices 3,17,42 --out <job> [抠图/锚点参数]`
  → 产出 `<out>/keyframes/key_*.png + keyframes_strip/preview/preview_dark + manifest.json`（结构同 video 模式）。
- `--sample-fps 0` = 原生 fps（不加 `-vf fps=` 滤镜）。

- [ ] **Step 1: 原生 fps**

`extract_video_frames` 中 `command += ["-vf", f"fps={sample_fps}", ...]` 改为：

```python
    if sample_fps > 0:
        command += ["-vf", f"fps={sample_fps}"]
    command += [str(frame_pattern)]
```

- [ ] **Step 2: 抽公共尾段 `matte_and_finalize`**

把 `process_video` 里「逐选中帧 cut_white_background → normalize_images → 存 keyframes → make_strip/preview/dark」一段（现 1804~1857 行）原样搬进新函数：

```python
def matte_and_finalize(
    frames: list[Path],
    selected: list[int],
    selected_details: list[dict[str, Any]],
    args: argparse.Namespace,
) -> dict[str, Any]:
    """选中帧 → 抠图 → 归一对齐 → keyframes/预览产物。返回写 manifest 的公共字段。"""
    key_dir = args.out / "keyframes"
    clear_pngs(key_dir)
    cut_images: list[tuple[str, Image.Image]] = []
    for order, frame_index in enumerate(selected):
        with Image.open(frames[frame_index]) as source:
            cut = cut_white_background(
                source,
                threshold=args.white_threshold,
                softness=args.white_softness,
                chroma_tolerance=args.chroma_tolerance,
                alpha_cutoff=args.alpha_threshold,
                background_mode=args.background_mode,
                edge_tolerance=args.edge_tolerance,
                edge_softness=args.edge_softness,
                hole_cleanup=not args.no_hole_cleanup,
                hole_min_area=args.hole_min_area,
                hole_max_area=args.hole_max_area,
                fringe_cleanup=not args.no_fringe_cleanup,
                fringe_radius=args.fringe_radius,
                fringe_strength=args.fringe_strength,
                fringe_brightness=args.fringe_brightness,
                decontaminate=not args.no_decontaminate,
                edge_contract=args.edge_contract,
            )
        cut_images.append((f"key_{order:03d}", cut))

    normalized, normalization_info = normalize_images(
        cut_images,
        frame_size=parse_frame_size(args.frame_size),
        padding=args.padding,
        allow_upscale=args.allow_upscale,
        alpha_threshold=args.alpha_threshold,
        stabilize_anchor=not args.no_anchor_stabilize,
        anchor_mode=args.anchor_mode,
        stabilize_search_radius=args.stabilize_search_radius,
        scale_stabilize=args.scale_stabilize,
        visual_stabilize=args.visual_stabilize,
        foot_contact_lock_enabled=not args.no_foot_contact_lock,
        foot_contact_freeze_rows=args.foot_contact_freeze_rows,
    )

    key_paths: list[Path] = []
    for item, detail in zip(normalized, selected_details):
        name, image, stats = item
        out_path = key_dir / f"{name}.png"
        image.save(out_path)
        key_paths.append(out_path)
        detail["output"] = str(out_path)
        detail["stats"] = stats

    make_strip(key_paths, args.out / "keyframes_strip.png")
    make_preview(key_paths, args.out / "keyframes_preview.png", args.preview_columns)
    make_color_preview(key_paths, args.out / "keyframes_preview_dark.png", args.preview_columns, (42, 48, 50))
    return {
        "selected_keyframe_count": len(selected_details),
        "normalization": normalization_info,
        "keyframes": selected_details,
        "strip": str(args.out / "keyframes_strip.png"),
        "preview": str(args.out / "keyframes_preview.png"),
        "dark_preview": str(args.out / "keyframes_preview_dark.png"),
    }
```

`process_video` 改为调用它（行为不变），`manifest["video"]` 组装处合并公共字段。

- [ ] **Step 3: 新入口 `process_frames_dir` + 参数**

`parse_args` 新增：

```python
    parser.add_argument("--frames-dir", type=Path, default=None,
                        help="直接处理已抽好的帧目录（跳过视频抽帧与自动选帧）")
    parser.add_argument("--select-indices", default="",
                        help="逗号分隔的帧下标（针对 frames-dir 排序后的 PNG；配合 --frames-dir）")
```

新函数：

```python
def process_frames_dir(args: argparse.Namespace, manifest: dict[str, Any]) -> None:
    frames = sorted(args.frames_dir.glob("*.png"))
    if not frames:
        fail(f"frames-dir 里没有 PNG: {args.frames_dir}")
    if not args.select_indices.strip():
        fail("--frames-dir 模式必须提供 --select-indices")
    try:
        selected = sorted({int(part) for part in args.select_indices.split(",") if part.strip() != ""})
    except ValueError:
        fail(f"--select-indices 解析失败: {args.select_indices}")
    bad = [i for i in selected if i < 0 or i >= len(frames)]
    if bad:
        fail(f"帧下标越界 {bad}（共 {len(frames)} 帧）")
    selected_details = [{"frame_index": i, "source": str(frames[i])} for i in selected]
    common = matte_and_finalize(frames, selected, selected_details, args)
    manifest["frames_dir"] = {"source": str(args.frames_dir), "raw_frame_count": len(frames),
                              "select_indices": selected, **common}
```

`main()` 分派：`--frames-dir` 优先于 `--video`（`if args.frames_dir is not None: process_frames_dir(...)`）。

- [ ] **Step 4: 回归验证**

Run: `py -3 tools/sprite-pipeline/split_action.py --clips docs/visual/staging/characters/dps-video/clips --action run`
Expected: 与本计划开头冒烟同样成功产出（公共段重构未破坏 video 模式）。

Run（旁路模式冒烟，用刚才管线残留的原始帧目录不存在——先手动抽一次）:
```powershell
py -3 tools/sprite-keyframe-tool.py --video docs/visual/staging/characters/dps-video/clips/run.mp4 --out temp/sprite-keyframes/manual-test --sample-fps 0 --video-seconds 0 --keep-raw-frames --max-keyframes 4 --target-keyframes 4 --selection-mode even --min-gap 1
py -3 tools/sprite-keyframe-tool.py --frames-dir temp/sprite-keyframes/manual-test/raw_frames --select-indices 0,10,20,30 --out temp/sprite-keyframes/manual-test2
```
Expected: 第二条产出 `manual-test2/keyframes/key_000..003.png` 与三张预览图；原生 fps 下 `raw_frames` 帧数 ≈ 视频秒数×原生fps（5.08s×30≈152）。

- [ ] **Step 5: 提交**

```bash
git add tools/sprite-keyframe-tool.py
git commit -m "feat(art): 抽帧工具支持原生fps与 frames-dir+select-indices 旁路选帧（公共尾段重构）"
```

---

### Task 3: 抠图加固——`--largest-component-only`

**Files:**
- Modify: `tools/sprite-keyframe-tool.py`（新 helper + `matte_and_finalize` 调用点 + `parse_args`）

**Interfaces:**
- Produces: CLI flag `--largest-component-only`；Task 5 的 assemble-selection 默认带上。

- [ ] **Step 1: helper + 接线**

```python
def keep_largest_component(image: Image.Image, alpha_threshold: int) -> Image.Image:
    """只保留 alpha 最大连通域（4 邻域 BFS），游离残渣/飞白全清。"""
    arr = np.array(image)
    mask = arr[:, :, 3] > alpha_threshold
    if not mask.any():
        return image
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    current = 0
    best_label, best_area = 0, 0
    from collections import deque
    for sy, sx in zip(*np.where(mask)):
        if labels[sy, sx]:
            continue
        current += 1
        area = 0
        queue = deque([(sy, sx)])
        labels[sy, sx] = current
        while queue:
            y, x = queue.popleft()
            area += 1
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = current
                    queue.append((ny, nx))
        if area > best_area:
            best_area, best_label = area, current
    keep = labels == best_label
    arr[:, :, 3] = np.where(keep, arr[:, :, 3], 0)
    return Image.fromarray(arr)
```

`parse_args` 加 `parser.add_argument("--largest-component-only", action="store_true", help="抠图后只保留最大连通域（清游离残渣；衣袖/武器与主体断开时勿开）")`；
`matte_and_finalize` 里 `cut_images.append` 前：

```python
        if args.largest_component_only:
            cut = keep_largest_component(cut, args.alpha_threshold)
```

- [ ] **Step 2: 验证**

Run: `py -3 tools/sprite-keyframe-tool.py --frames-dir temp/sprite-keyframes/manual-test/raw_frames --select-indices 0,10,20,30 --out temp/sprite-keyframes/manual-test3 --largest-component-only`
Expected: 正常产出；Read `manual-test3/keyframes_preview.png` 目检角色主体完整（黑衣剑客与剑相连不被误杀——若剑被切掉说明该素材主体断开，记录为该 flag 的使用注意，不阻塞）。

- [ ] **Step 3: 提交**

```bash
git add tools/sprite-keyframe-tool.py
git commit -m "feat(art): 抠图加固——largest-component-only 只保留最大连通域清游离残渣"
```

---

### Task 4: 侧视防滑双锚 `anchor_mode=sideview`

**Files:**
- Modify: `tools/sprite-keyframe-tool.py`（新 `sideview_alignment` + `normalize_images` 分支 + `parse_args` choices）

**Interfaces:**
- Consumes: `alpha_mask`/`bool_bbox`/`overlap_shift_score`（既有）。
- Produces: `--anchor-mode sideview`；返回 dict 与 `stable_point_alignment` 同构（键 `offsets/scales/anchor_x/anchor_y`，供 `normalize_images` 现有消费代码直接用——**执行时先读 `stable_point_alignment` 的完整返回结构 `tools/sprite-keyframe-tool.py:805-888`，缺哪个键补哪个**）。

- [ ] **Step 1: 写 `sideview_alignment`**

```python
def sideview_alignment(
    images: list[tuple[str, Image.Image]],
    bboxes: list[tuple[int, int, int, int] | None],
    alpha_threshold: int,
    search_radius: int = 48,
) -> dict[str, Any] | None:
    """纯侧视原地动作双锚：地线 Y 硬锁（最低实心行对齐中位数）+ 躯干带 X 互相关（对首帧）。
    只输出整体平移，scales 恒 1。"""
    masks = [alpha_mask(image, alpha_threshold) for _, image in images]
    ground_ys: list[int] = []
    for mask in masks:
        min_pixels = max(3, int(mask.shape[1] * 0.02))
        rows = np.where(mask.sum(axis=1) >= min_pixels)[0]
        ground_ys.append(int(rows[-1]) if len(rows) else 0)
    target_y = int(np.median(np.asarray(ground_ys)))

    def torso_band(mask: np.ndarray, bbox) -> np.ndarray:
        left, top, right, bottom = bbox
        band = np.zeros_like(mask)
        band_bottom = top + max(1, int((bottom - top) * 0.6))
        band[top:band_bottom, left:right] = mask[top:band_bottom, left:right]
        return band

    ref_index = next((i for i, b in enumerate(bboxes) if b is not None), None)
    if ref_index is None:
        return None
    ref_band = torso_band(masks[ref_index], bboxes[ref_index])
    offsets: list[tuple[float, float]] = []
    for i, mask in enumerate(masks):
        if bboxes[i] is None:
            offsets.append((0.0, 0.0))
            continue
        band = torso_band(mask, bboxes[i])
        best_dx, best_score = 0, -1
        for dx in range(-search_radius, search_radius + 1):
            score = overlap_shift_score(band, ref_band, dx, 0)
            if score > best_score:
                best_score, best_dx = score, dx
        offsets.append((float(best_dx), float(target_y - ground_ys[i])))

    ref_bbox = bboxes[ref_index]
    anchor_x = (ref_bbox[0] + ref_bbox[2]) / 2.0
    return {
        "offsets": offsets,
        "scales": [1.0 for _ in images],
        "anchor_x": anchor_x,
        "anchor_y": float(target_y),
    }
```

> 执行注意 ①：`overlap_shift_score(current, target, dx, dy)` 的 dx 语义（current 相对 target 平移方向）先读 `tools/sprite-keyframe-tool.py:734-754` 确认，offset 记「把本帧移回参考系需要的平移」，与 `stable_point_alignment` 的 offsets 语义一致（读 805-888 对齐）。
> 执行注意 ②：若 `stable_point_alignment` 返回 dict 还有别的键被 941-1000 行消费（如 method/matched 标志），`sideview_alignment` 补齐同名键。

- [ ] **Step 2: 接进 `normalize_images` 与参数**

`normalize_images` 的 `if stabilize_anchor:` 分支改为：

```python
    if stabilize_anchor:
        if anchor_mode == "sideview":
            alignment_info = sideview_alignment(images, bboxes, alpha_threshold, stabilize_search_radius)
        else:
            alignment_info = stable_point_alignment(images, bboxes, alpha_threshold, stabilize_search_radius)
```

开头校验 `anchor_mode not in {"foot", "body", "sideview"}`；`parse_args` 的 `--anchor-mode` choices 同步加 `"sideview"`（读现有定义处照改）。sideview 模式下 `foot_contact_lock` 沿用默认开（地线锁后脚尖硬锁是二次保险，不冲突）。

- [ ] **Step 3: 真素材验证（防滑效果目检）**

Run:
```powershell
py -3 tools/sprite-keyframe-tool.py --frames-dir temp/sprite-keyframes/manual-test/raw_frames --select-indices 0,4,8,12,16,20,24,28 --out temp/sprite-keyframes/manual-test4 --anchor-mode sideview --largest-component-only
```
Expected: 产出成功；Read `manual-test4/keyframes_preview.png`：8 帧脚底同一水平线、躯干水平位置稳定（对比不带 sideview 的 manual-test3 应无横向漂移）。

- [ ] **Step 4: 提交**

```bash
git add tools/sprite-keyframe-tool.py
git commit -m "feat(art): 侧视防滑双锚 anchor_mode=sideview——地线Y硬锁+躯干带X互相关"
```

---

### Task 5: UI 后端两端点 `/api/extract-all` + `/api/assemble-selection`

**Files:**
- Modify: `tools/sprite-keyframe-ui.py`

**Interfaces:**
- Consumes: Task 1 `frame_select.py`（importlib 加载，同 `split_action.py` 加载 ui 模块的写法）、Task 2/3/4 的 CLI。
- Produces（Task 6 前端调用）:
  - `POST /api/extract-all`（multipart: `video` 文件, 可选 `sample_fps` 默认 0=原生）→
    `{ok, jobId, videoUrl, fps, frameCount, loopSpan:[s,e], frames:[{index, url, thumbUrl, sharpness, isBlur, recommended}]}`
  - `POST /api/assemble-selection`（json: `jobId`, `indices:[int]`, 可选 `game_target_height` 默认 240, `anchor_mode` 默认 `"sideview"`, `largest_component` 默认 true, `preview_columns` 默认 6）→ 结构与 `/api/process` 相同的 `{ok, jobId, manifest, files:{...gameKeyframes 等}}`（`import-art` 凭 jobId 零改动可用）。

- [ ] **Step 1: `/api/extract-all`**

`do_POST` 加路由；处理函数要点（新代码，模式照抄 `handle_process` 的 job 目录/上传/异常习惯）：

```python
    def handle_extract_all(self) -> None:
        try:
            fields, files = self.parse_multipart()
            PREVIEW_ROOT.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            job_id = f"{timestamp}-pick-{secrets.token_hex(3)}"
            out_dir = PREVIEW_ROOT / job_id
            upload_dir = out_dir / "_input"
            upload_dir.mkdir(parents=True, exist_ok=True)
            video = self.save_upload(files, "video", upload_dir)
            if video is None:
                self.send_json(400, {"ok": False, "error": "需要上传一个动作视频。"})
                return
            sample_fps = float(form_value(fields, "sample_fps", "0"))

            tool_mod = load_tool_module()          # importlib 加载 sprite-keyframe-tool.py
            fs = load_frame_select_module()        # importlib 加载 sprite-pipeline/frame_select.py
            raw_dir = out_dir / "raw_frames"
            frames = tool_mod.extract_video_frames(video, raw_dir, sample_fps, 0.0, None)
            thumb_dir = out_dir / "thumbs"
            thumb_dir.mkdir(parents=True, exist_ok=True)
            for i, frame in enumerate(frames):
                with Image.open(frame) as im:
                    im.thumbnail((160, 160))
                    im.save(thumb_dir / f"thumb_{i:05d}.png")
            scores = fs.sharpness_scores(frames)
            flags = fs.blur_flags(scores)
            feats = fs.feature_vectors(frames)
            span = fs.detect_loop_span(feats)
            recommended = set(fs.arclength_pick(feats, span, 8, sharpness=scores))
            payload_frames = [
                {
                    "index": i,
                    "url": job_file_url(frames[i]),
                    "thumbUrl": job_file_url(thumb_dir / f"thumb_{i:05d}.png"),
                    "sharpness": round(scores[i], 2),
                    "isBlur": bool(flags[i]),
                    "recommended": i in recommended,
                }
                for i in range(len(frames))
            ]
            self.send_json(200, {"ok": True, "jobId": job_id, "videoUrl": job_file_url(video),
                                 "frameCount": len(frames), "loopSpan": list(span),
                                 "frames": payload_frames})
        except Exception as exc:  # noqa: BLE001
            self.send_json(500, {"ok": False, "error": str(exc)})
```

模块加载 helper（文件顶部区域，仿 `split_action.load_ui_module`）：

```python
def load_tool_module():
    spec = importlib.util.spec_from_file_location("sprite_keyframe_tool", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_frame_select_module():
    path = ROOT / "tools" / "sprite-pipeline" / "frame_select.py"
    spec = importlib.util.spec_from_file_location("frame_select", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
```

（`import importlib.util` 加到顶部 imports；`load_tool_module` 若因 argparse 顶层执行报错，读 tool 的 `if __name__ == "__main__"` 保护确认可安全 import——该文件有 main() 守卫，可直接加载。）

> 注意：raw_frames 全帧 + 缩略图会留在 job 目录（供网页展示与后续 assemble），**不删**；`_allframes` 命名 spec 里提过，这里统一用现成的 `raw_frames` 名。

- [ ] **Step 2: `/api/assemble-selection`**

```python
    def handle_assemble_selection(self) -> None:
        try:
            payload = json.loads(self.read_body().decode("utf-8"))
            job_id = safe_job_id(str(payload.get("jobId", "")))
            indices = payload.get("indices", [])
            if not job_id or not isinstance(indices, list) or not indices:
                self.send_json(400, {"ok": False, "error": "缺少 jobId 或 indices。"})
                return
            job_dir_path = job_dir(job_id)
            if job_dir_path is None or not (job_dir_path / "raw_frames").is_dir():
                self.send_json(404, {"ok": False, "error": "找不到该任务的原始帧。"})
                return
            indices = sorted({int(i) for i in indices})
            command = [
                sys.executable, str(TOOL),
                "--frames-dir", str(job_dir_path / "raw_frames"),
                "--select-indices", ",".join(str(i) for i in indices),
                "--out", str(job_dir_path),
                "--anchor-mode", str(payload.get("anchor_mode", "sideview")),
            ]
            if bool(payload.get("largest_component", True)):
                command.append("--largest-component-only")
            result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            if result.returncode != 0:
                self.send_json(500, {"ok": False, "error": "处理失败。",
                                     "stdout": result.stdout, "stderr": result.stderr})
                return
            # 组装 game_keyframes + files_payload：与 handle_process 同一段逻辑
            ...  # 执行时把 handle_process 里 manifest 读取→build_game_preview_frames→files_payload
                 # 一段抽成 self._finalize_job(out_dir, preview_columns, game_target_height)
                 # 两个 handler 共用，返回 files_payload 与 manifest
        except Exception as exc:  # noqa: BLE001
            self.send_json(500, {"ok": False, "error": str(exc)})
```

> 本 Task 的重构要求：`handle_process` 尾段（manifest 读取、`build_game_preview_frames`、`files_payload` 组装，现 624~680 行）抽成 `_finalize_job()` 供两个 handler 共用——**不是**复制一份。

- [ ] **Step 3: 端点冒烟（无前端，curl 级验证）**

Run（PowerShell）:
```powershell
Start-Process py -ArgumentList '-3','tools/sprite-keyframe-ui.py' ; Start-Sleep 2
curl.exe -s -F "video=@docs/visual/staging/characters/dps-video/clips/run.mp4" http://127.0.0.1:8765/api/extract-all -o temp/extract-all.json
py -3 -c "import json;d=json.load(open('temp/extract-all.json',encoding='utf-8'));print(d['ok'],d['frameCount'],d['loopSpan'],[f['index'] for f in d['frames'] if f['recommended']])"
```
Expected: `True ~152 [s,e] [8个推荐帧号]`；随后用推荐帧号 POST assemble-selection，返回 `files.gameKeyframes` 非空。验证后停掉服务进程。

- [ ] **Step 4: 提交**

```bash
git add tools/sprite-keyframe-ui.py
git commit -m "feat(art): 挑帧后端两端点——extract-all 全帧+清晰度+推荐，assemble-selection 按选中帧抠图组合"
```

---

### Task 6: 前端手动挑帧面板

**Files:**
- Modify: `tools/sprite-keyframe-ui.html`

**Interfaces:**
- Consumes: Task 5 两端点。
- Produces: 页面新增「手动挑帧」区块；生成结果后沿用页面既有的 game 预览展示与「导入 Cocos」表单（凭 jobId）。

- [ ] **Step 1: 面板实现**

在现有页面顶层加一个独立 `<section id="pick-panel">`（样式沿用页面现有 class 习惯），包含：

1. 视频上传 `<input type="file" accept="video/*">` + 「抽全帧」按钮 → POST `/api/extract-all`（FormData）。
2. `<video controls loop>` 内嵌播放原片（src=返回的 `videoUrl`）。
3. 帧栅格 `<div id="pick-grid">`：每帧一个 `<div class="pick-cell">`（`<img src=thumbUrl>` + 帧号角标）。状态样式：
   - `.blur`：红色边框 + `filter: brightness(.55)`；
   - `.recommended`：绿色边框；
   - `.selected`：加粗蓝边 + 右上角 ✓ 徽标（点击 toggle，`selected` 优先级最高）。
4. 工具条：已选计数 `已选 N / 红线 10`（N>10 变红加警告 title）；「一键接受推荐」（把 `recommended` 集合写入 `selected`）；「清空」；「生成序列帧」按钮。
5. 「生成序列帧」→ POST `/api/assemble-selection` `{jobId, indices:[...]}` → 用返回 `files` 渲染 gamePreview/gameDarkPreview/strip 图 + 把 jobId 填进页面既有导入表单（复用现有展示函数——执行时先读该 html 现有 JS 的结果渲染函数名并复用，不重写一份）。

核心 JS（骨架，命名与页面现有风格对齐后落地）：

```javascript
const pickState = { jobId: null, frames: [], selected: new Set() };
async function extractAll(file) {
  const fd = new FormData(); fd.append('video', file);
  const res = await fetch('/api/extract-all', { method: 'POST', body: fd }).then(r => r.json());
  if (!res.ok) return alert(res.error);
  pickState.jobId = res.jobId; pickState.frames = res.frames; pickState.selected.clear();
  document.getElementById('pick-video').src = res.videoUrl;
  renderPickGrid();
}
function renderPickGrid() {
  const grid = document.getElementById('pick-grid'); grid.innerHTML = '';
  for (const f of pickState.frames) {
    const cell = document.createElement('div');
    cell.className = 'pick-cell' + (f.isBlur ? ' blur' : '') + (f.recommended ? ' recommended' : '')
      + (pickState.selected.has(f.index) ? ' selected' : '');
    cell.innerHTML = `<img src="${f.thumbUrl}" loading="lazy"><span class="idx">${f.index}</span>`;
    cell.onclick = () => { pickState.selected.has(f.index) ? pickState.selected.delete(f.index) : pickState.selected.add(f.index); renderPickGrid(); };
    grid.appendChild(cell);
  }
  const n = pickState.selected.size;
  const counter = document.getElementById('pick-counter');
  counter.textContent = `已选 ${n} / 红线 10`;
  counter.classList.toggle('over', n > 10);
}
async function assembleSelection() {
  const indices = [...pickState.selected].sort((a, b) => a - b);
  if (!indices.length) return alert('先选帧');
  const res = await fetch('/api/assemble-selection', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: pickState.jobId, indices }) }).then(r => r.json());
  if (!res.ok) return alert(res.error + '\n' + (res.stderr || ''));
  showPickResult(res);   // 复用现有结果渲染 + 导入表单 jobId 回填
}
```

- [ ] **Step 2: 人工冒烟**

Run: `npm run sprite:keyframes:ui`（或 `py -3 tools/sprite-keyframe-ui.py --open`），上传 run.mp4 → 抽全帧 → 栅格可见糊帧红框/推荐绿框 → 点「接受推荐」→ 生成 → game 预览图出现。
Expected: 全流程无 JS 报错（F12 Console 干净）。

- [ ] **Step 3: 提交**

```bash
git add tools/sprite-keyframe-ui.html
git commit -m "feat(art): 网页手动挑帧面板——全帧栅格/糊帧红框/推荐绿框/点选生成"
```

---

### Task 7: 真素材验收 + 文档记忆收尾

**Files:**
- Modify: `ai/memory/视觉风格.md`、`ai/memory/设计日志.md`、`ai/memory/项目状态.md`、`ai/memory/代码地图.md`
- Modify: `docs/superpowers/specs/2026-07-05-video-sprite-pipeline-design.md`（顶部加修订注记）

**Interfaces:** 无代码；验收以 run.mp4 走新全流程为准。

- [ ] **Step 1: run.mp4 全流程验收**

AI 侧先代选（推荐集直接生成）出预览页给用户；用户再开网页实选一轮对比。两轮产物都保留在各自 job 目录。
Expected: 用户认可挑帧体验与成片质量（真素材调参原则：阈值/半径类参数不满意在此轮调）。

- [ ] **Step 2: 记忆四件套**

- `视觉风格.md`：角色规则更新为**黑衣墨影半剪影定案**（黑衣墨块+肉色皮肤+细线眼+青绿发带点缀；敌我区分=敌方红眼/玩家青绿+肉色）；新增「侧视立绘提示词模板」「侧视动作视频提示词模板」（用本轮实际过审版）；十二件拆解图模板标注「部件缓动判负，随规范废弃（git 可查）」。
- `设计日志.md`：追加两条——①「部件缓动（8→12 件）判负、回归序列帧」（动机：用户 DB 审判负；纯侧视+手动挑帧+工具自动化的新分工更适配单人产能与生成器能力）；②「角色风格第三次转向：黑衣墨影半剪影」（脸部生成不稳定教训：提示词提脸必触发补脸→纯剪影+肉色皮肤折中；眼睛问题最终由风格转向消解）。
- `项目状态.md`「最近进展」刷新：新管线落地、run 已验收/待验收、下一步=其余三动作视频→挑帧→入库→Cocos 替换临时序列帧。
- `代码地图.md`：`frame_select.py` 新行；`sprite-keyframe-tool.py`/`sprite-keyframe-ui` 行补挑帧/双锚/largest-component 描述；PartsRig 四行标注「判负存档勿复用」。
- `2026-07-05-video-sprite-pipeline-design.md` 顶部加：「修订 2026-07-07：循环点裁剪不再留人工——挑帧网页接管（spec 2026-07-06-sideview-frame-pipeline）」。

- [ ] **Step 3: 提交**

```bash
git add ai/memory docs/superpowers/specs/2026-07-05-video-sprite-pipeline-design.md
git commit -m "docs(art): 纯侧视挑帧管线收尾——风格定案黑衣墨影/新分工/判负标注四件套同步"
```

---

## Self-Review 记录

1. **Spec coverage**：spec §1 侧视模板→Task 7；§2.1 extract-all（清晰度/循环/弧长）→Task 1+5；§2.2 面板→Task 6；§2.3 assemble-selection→Task 5；§3.1 最大连通域→Task 3；§3.2 双锚→Task 4；§3.3 组合复用→Task 2 `matte_and_finalize`+Task 5 `_finalize_job`；§4 判负留档+记忆→Task 7。无缺口。
2. **Placeholder scan**：Task 5 Step 2 的 `...` 是显式重构指令（抽 `_finalize_job` 共用，指明源行号与产物），非悬空 TBD；Task 4 两处「执行注意」为读现源对齐语义的硬指令。其余步骤代码完整。
3. **Type consistency**：`frame_select` 五个函数签名在 Task 1（定义）与 Task 5（调用）一致；`--frames-dir/--select-indices/--largest-component-only/--anchor-mode sideview` 在 Task 2/3/4（定义）与 Task 5（command 组装）拼写一致；`files_payload` 结构 Task 5 与现有 `/api/process`、Task 6 渲染约定一致。
