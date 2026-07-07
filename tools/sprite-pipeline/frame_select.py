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
    result = sorted(dict.fromkeys(picked))
    # 弧长坍缩回填：慢动作段（极值附近帧几乎不动）会让多个落点撞到同一帧，
    # 去重后不足 count 时，从未选帧里按「离已选帧时间距离最大」补齐
    if len(result) < count:
        remaining = [i for i in seg[:-1] if i not in result]
        while remaining and len(result) < count:
            best = max(remaining, key=lambda i: min(abs(i - p) for p in result))
            result.append(best)
            remaining.remove(best)
        result.sort()
    return result


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
    span_len = e - s
    assert span_len % 12 <= 1 or 12 - (span_len % 12) <= 1, f"循环长度 {span_len} 不接近周期倍数"
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
