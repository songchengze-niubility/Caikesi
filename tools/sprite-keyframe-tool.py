#!/usr/bin/env python3
"""
Prepare 2D sprite references from a white-background character image and/or video.

Outputs:
- character_transparent.png
- raw_frames/frame_00001.png...
- keyframes/key_000.png...
- keyframes_strip.png
- keyframes_preview.png
- manifest.json
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Remove white backgrounds and extract normalized keyframes from a reference video."
    )
    parser.add_argument("--character", type=Path, help="White-background character image to cut out.")
    parser.add_argument("--video", type=Path, help="Reference video to sample and split into keyframes.")
    parser.add_argument("--frames-dir", type=Path, default=None,
                        help="直接处理已抽好的帧目录（跳过视频抽帧与自动选帧，配合 --select-indices）")
    parser.add_argument("--select-indices", default="",
                        help="逗号分隔的帧下标（针对 frames-dir 排序后的 PNG；配合 --frames-dir）")
    parser.add_argument("--largest-component-only", action="store_true",
                        help="抠图后只保留最大连通域（清游离残渣；衣袖/武器与主体断开时勿开）")
    parser.add_argument("--out", type=Path, default=Path("output/sprite-keyframes"), help="Output directory.")

    parser.add_argument("--sample-fps", type=float, default=12.0, help="Video sampling FPS before keyframe picking.")
    parser.add_argument(
        "--video-start",
        type=float,
        default=0.0,
        help="Start timestamp in seconds for video sampling.",
    )
    parser.add_argument(
        "--video-end",
        type=float,
        default=0.0,
        help="End timestamp in seconds for video sampling. 0 means use --video-seconds or sample to the end.",
    )
    parser.add_argument(
        "--video-seconds",
        type=float,
        default=1.0,
        help="Compatibility duration from --video-start. Ignored when --video-end is greater than 0. 0 samples to the end.",
    )
    parser.add_argument(
        "--diff-threshold",
        type=float,
        default=12.0,
        help="Mean pixel difference needed before selecting a new keyframe.",
    )
    parser.add_argument("--min-gap", type=int, default=2, help="Minimum sampled-frame gap between keyframes.")
    parser.add_argument("--max-keyframes", type=int, default=24, help="Maximum selected video keyframes. 0 disables.")
    parser.add_argument(
        "--target-keyframes",
        type=int,
        default=0,
        help="Force an approximate keyframe count by filling/downsampling evenly. 0 disables.",
    )
    parser.add_argument(
        "--selection-mode",
        choices=("diverse", "diff", "even"),
        default="diverse",
        help="Keyframe picker: diverse foreground poses, threshold diff, or even spacing.",
    )

    parser.add_argument("--white-threshold", type=int, default=245, help="Pixels this close to white are background.")
    parser.add_argument("--white-softness", type=float, default=28.0, help="Soft alpha width around white edges.")
    parser.add_argument(
        "--chroma-tolerance",
        type=float,
        default=24.0,
        help="Allowed RGB channel spread for white-background candidates.",
    )
    parser.add_argument(
        "--alpha-threshold",
        type=int,
        default=28,
        help="Alpha cutoff used for bounding boxes and weak-edge cleanup.",
    )
    parser.add_argument(
        "--background-mode",
        choices=("auto", "white", "edge", "alpha"),
        default="auto",
        help=(
            "Background removal mode: auto combines white and sampled edge color; "
            "alpha preserves an existing transparent matte without re-keying RGB."
        ),
    )
    parser.add_argument(
        "--edge-tolerance",
        type=float,
        default=65.0,
        help="RGB distance tolerance for sampled edge-background removal.",
    )
    parser.add_argument(
        "--edge-softness",
        type=float,
        default=42.0,
        help="Soft alpha width around sampled edge-background color.",
    )
    parser.add_argument(
        "--no-hole-cleanup",
        action="store_true",
        help="Disable removal of enclosed pale background holes.",
    )
    parser.add_argument(
        "--hole-min-area",
        type=int,
        default=120,
        help="Minimum connected pale-hole area to remove.",
    )
    parser.add_argument(
        "--hole-max-area",
        type=int,
        default=30000,
        help="Maximum connected pale-hole area to remove.",
    )
    parser.add_argument(
        "--no-fringe-cleanup",
        action="store_true",
        help="Disable pale matte fringe cleanup around transparent edges.",
    )
    parser.add_argument(
        "--fringe-radius",
        type=int,
        default=2,
        help="How many pixels around transparency to clean pale matte fringe.",
    )
    parser.add_argument(
        "--fringe-strength",
        type=float,
        default=0.85,
        help="Alpha reduction strength for pale matte fringe, 0-1.",
    )
    parser.add_argument(
        "--fringe-brightness",
        type=float,
        default=155.0,
        help="Minimum mean RGB brightness treated as pale fringe near transparent edges.",
    )
    parser.add_argument("--no-decontaminate", action="store_true", help="Do not remove white edge contamination.")
    parser.add_argument(
        "--edge-contract",
        type=int,
        default=1,
        help="Erode the alpha edge inward by N pixels after cutout to remove the semi-transparent anti-aliased fringe. "
        "0 disables. 1 is a safe default for small sprites; raise to 2 if a heavy fringe remains.",
    )

    parser.add_argument(
        "--frame-size",
        default="512",
        help="Normalized keyframe canvas, e.g. 128 or 160x128. Use 0 for auto size.",
    )
    parser.add_argument("--padding", type=int, default=8, help="Padding inside normalized keyframe canvas.")
    parser.add_argument("--allow-upscale", action="store_true", help="Allow small sprites to be scaled up.")
    parser.add_argument(
        "--no-anchor-stabilize",
        action="store_true",
        help="Disable multi-point body-anchor stabilization during normalization.",
    )
    parser.add_argument(
        "--anchor-mode",
        choices=("foot", "body", "sideview"),
        default="foot",
        help="Anchor used to lock frames after background removal. foot locks body X and floor Y; body preserves center mass.",
    )
    parser.add_argument(
        "--stabilize-search-radius",
        type=int,
        default=48,
        help="Maximum source-pixel shift searched by stable-point alignment.",
    )
    parser.add_argument(
        "--scale-stabilize",
        action="store_true",
        help="Also apply per-frame scale stabilization. Disabled by default because it can cause zoom jitter.",
    )
    parser.add_argument(
        "--visual-stabilize",
        action="store_true",
        help="Apply a final horizontal torso visual-center lock. Useful for idle/standing loops with tiny perceived sway.",
    )
    parser.add_argument(
        "--no-foot-contact-lock",
        action="store_true",
        help="Disable the final pixel-precise foot contact lock used by foot anchor mode.",
    )
    parser.add_argument(
        "--foot-contact-freeze-rows",
        type=int,
        default=4,
        help="Bottom contact rows copied from a reference frame after foot locking. Use 0 to disable.",
    )
    parser.add_argument("--preview-columns", type=int, default=6, help="Columns in the preview sheet.")
    parser.add_argument("--keep-raw-frames", action="store_true", help="Keep sampled raw frames after processing.")
    return parser.parse_args()


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_file(path: Path | None, label: str) -> Path | None:
    if path is None:
        return None
    if not path.exists():
        fail(f"{label} does not exist: {path}")
    if not path.is_file():
        fail(f"{label} is not a file: {path}")
    return path.resolve()


def parse_frame_size(value: str) -> tuple[int, int] | None:
    text = value.lower().strip()
    if text in {"0", "auto", "none"}:
        return None
    if "x" in text:
        left, right = text.split("x", 1)
        width, height = int(left), int(right)
    else:
        width = height = int(text)
    if width <= 0 or height <= 0:
        fail("--frame-size must be positive, or 0 for auto size.")
    return width, height


def prepare_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def clear_pngs(path: Path) -> None:
    prepare_dir(path)
    for item in path.glob("*.png"):
        item.unlink()


def edge_connected_mask(mask: np.ndarray) -> np.ndarray:
    height, width = mask.shape
    connected = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    def push(y: int, x: int) -> None:
        if mask[y, x] and not connected[y, x]:
            connected[y, x] = True
            queue.append((y, x))

    for x in range(width):
        push(0, x)
        push(height - 1, x)
    for y in range(height):
        push(y, 0)
        push(y, width - 1)

    while queue:
        y, x = queue.popleft()
        if y > 0:
            push(y - 1, x)
        if y + 1 < height:
            push(y + 1, x)
        if x > 0:
            push(y, x - 1)
        if x + 1 < width:
            push(y, x + 1)
    return connected


def small_component_mask(mask: np.ndarray, min_area: int, max_area: int) -> np.ndarray:
    height, width = mask.shape
    visited = np.zeros((height, width), dtype=bool)
    selected = np.zeros((height, width), dtype=bool)
    min_area = max(1, min_area)
    max_area = max(min_area, max_area)

    for start_y in range(height):
        for start_x in range(width):
            if visited[start_y, start_x] or not mask[start_y, start_x]:
                continue

            pixels: list[tuple[int, int]] = []
            queue: deque[tuple[int, int]] = deque([(start_y, start_x)])
            visited[start_y, start_x] = True

            while queue:
                y, x = queue.popleft()
                pixels.append((y, x))
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        queue.append((ny, nx))

            if min_area <= len(pixels) <= max_area:
                ys, xs = zip(*pixels)
                selected[np.array(ys), np.array(xs)] = True

    return selected


def dilate_mask(mask: np.ndarray, radius: int) -> np.ndarray:
    result = mask.copy()
    radius = max(0, radius)
    for _ in range(radius):
        padded = np.pad(result, 1, mode="constant", constant_values=False)
        result = (
            padded[0:-2, 0:-2] | padded[0:-2, 1:-1] | padded[0:-2, 2:] |
            padded[1:-1, 0:-2] | padded[1:-1, 1:-1] | padded[1:-1, 2:] |
            padded[2:, 0:-2] | padded[2:, 1:-1] | padded[2:, 2:]
        )
    return result


def erode_alpha(alpha: np.ndarray, radius: int) -> np.ndarray:
    """把 alpha 通道向内腐蚀 radius 圈（灰度腐蚀：每像素取 3x3 邻域最小值）。
    边缘那圈半透明像素会被外侧的 0 拉低，主体内部的高 alpha 不受影响——
    直接切掉抗锯齿混合边（白边根源），代价是轮廓向内缩 radius 像素。"""
    result = alpha
    radius = max(0, radius)
    for _ in range(radius):
        padded = np.pad(result, 1, mode="edge")
        result = np.minimum.reduce([
            padded[0:-2, 0:-2], padded[0:-2, 1:-1], padded[0:-2, 2:],
            padded[1:-1, 0:-2], padded[1:-1, 1:-1], padded[1:-1, 2:],
            padded[2:, 0:-2], padded[2:, 1:-1], padded[2:, 2:],
        ])
    return result


def sampled_edge_color(rgb: np.ndarray) -> np.ndarray:
    height, width, _ = rgb.shape
    strip = max(3, min(height, width) // 32)
    samples = np.concatenate(
        [
            rgb[:strip, :, :].reshape(-1, 3),
            rgb[height - strip :, :, :].reshape(-1, 3),
            rgb[:, :strip, :].reshape(-1, 3),
            rgb[:, width - strip :, :].reshape(-1, 3),
        ],
        axis=0,
    )
    return np.median(samples, axis=0).astype(np.float32)


def soft_fade(distance: np.ndarray, hard: float, softness: float) -> np.ndarray:
    if softness <= 0:
        return np.where(distance <= hard, 0.0, 1.0).astype(np.float32)
    return np.clip((distance - hard) / softness, 0.0, 1.0).astype(np.float32)


def cut_white_background(
    source: Image.Image,
    *,
    threshold: int,
    softness: float,
    chroma_tolerance: float,
    alpha_cutoff: int,
    background_mode: str,
    edge_tolerance: float,
    edge_softness: float,
    hole_cleanup: bool,
    hole_min_area: int,
    hole_max_area: int,
    fringe_cleanup: bool,
    fringe_radius: int,
    fringe_strength: float,
    fringe_brightness: float,
    decontaminate: bool,
    edge_contract: int = 0,
) -> Image.Image:
    image = source.convert("RGBA")
    arr = np.asarray(image, dtype=np.float32).copy()
    rgb = arr[:, :, :3]
    original_alpha = arr[:, :, 3]

    # 已经由 chroma-key/抠图工具产出的 RGBA 不能再按边缘 RGB 去底：透明像素的
    # RGB 常被写成黑色，二次 edge key 会把黑衣角色本体一起删掉。alpha 模式只
    # 尊重现有 matte，并保留统一的 alpha cutoff / edge-contract 收尾能力。
    if background_mode == "alpha":
        new_alpha = original_alpha.copy()
        if alpha_cutoff > 0:
            new_alpha[new_alpha < alpha_cutoff] = 0.0
        if edge_contract > 0:
            new_alpha = erode_alpha(new_alpha, edge_contract)
        arr[:, :, 3] = np.clip(new_alpha, 0.0, 255.0)
        return Image.fromarray(arr.astype(np.uint8), "RGBA")

    dist_from_white = np.linalg.norm(255.0 - rgb, axis=2)
    channel_spread = rgb.max(axis=2) - rgb.min(axis=2)
    hard_dist = math.sqrt(3.0) * max(0, 255 - threshold)
    soft_dist = hard_dist + max(0.0, softness)
    edge_color = sampled_edge_color(rgb)
    dist_from_edge = np.linalg.norm(rgb - edge_color, axis=2)
    edge_soft_dist = edge_tolerance + max(0.0, edge_softness)

    white_candidate = (dist_from_white <= soft_dist) & (channel_spread <= chroma_tolerance)
    edge_candidate = dist_from_edge <= edge_soft_dist
    if background_mode == "white":
        background_candidate = white_candidate
    elif background_mode == "edge":
        background_candidate = edge_candidate
    else:
        background_candidate = white_candidate | edge_candidate
    background = edge_connected_mask(background_candidate)
    if hole_cleanup:
        bright_neutral = (rgb.mean(axis=2) >= 210.0) & (channel_spread <= max(chroma_tolerance, 38.0))
        hole_candidate = background_candidate & ~background & bright_neutral
        holes = small_component_mask(hole_candidate, hole_min_area, hole_max_area)
        background = background | holes

    fade = np.ones_like(original_alpha, dtype=np.float32)
    if background_mode == "white":
        fade_model = soft_fade(dist_from_white, hard_dist, softness)
        decontam_color = np.array([255.0, 255.0, 255.0], dtype=np.float32)
    elif background_mode == "edge":
        fade_model = soft_fade(dist_from_edge, edge_tolerance, edge_softness)
        decontam_color = edge_color
    else:
        fade_model = np.minimum(
            soft_fade(dist_from_white, hard_dist, softness),
            soft_fade(dist_from_edge, edge_tolerance, edge_softness),
        )
        decontam_color = edge_color
    fade[background] = fade_model[background]

    new_alpha = original_alpha * fade
    if alpha_cutoff > 0:
        new_alpha[new_alpha < alpha_cutoff] = 0.0

    if fringe_cleanup and fringe_strength > 0:
        transparent = new_alpha <= max(0, alpha_cutoff)
        near_transparent = dilate_mask(transparent, fringe_radius) & ~transparent
        neutral = channel_spread <= max(chroma_tolerance, 42.0)
        bright = rgb.mean(axis=2) >= fringe_brightness
        bg_distance = np.minimum(dist_from_white, dist_from_edge)
        fringe_zone = near_transparent & neutral & bright
        fringe_fade = soft_fade(bg_distance, edge_tolerance, max(softness, edge_softness))
        strength = float(np.clip(fringe_strength, 0.0, 1.0))
        factor = 1.0 - strength * (1.0 - fringe_fade)
        new_alpha[fringe_zone] = new_alpha[fringe_zone] * factor[fringe_zone]
        if alpha_cutoff > 0:
            new_alpha[new_alpha < alpha_cutoff] = 0.0

    if decontaminate:
        alpha_unit = np.clip(new_alpha / 255.0, 0.0, 1.0)
        edge = background & (alpha_unit > 0.001) & (alpha_unit < 0.999)
        if np.any(edge):
            a = alpha_unit[edge][:, None]
            rgb[edge] = np.clip((rgb[edge] - decontam_color * (1.0 - a)) / a, 0.0, 255.0)
        rgb[background & (alpha_unit <= 0.001)] = decontam_color

    # 最后一步：向内腐蚀 alpha 边缘，切掉抗锯齿混合边（半透明白边根源）。
    # 放在 decontaminate 之后——先把边缘颜色修对，再砍掉最外圈。
    if edge_contract > 0:
        new_alpha = erode_alpha(new_alpha, edge_contract)

    arr[:, :, :3] = rgb
    arr[:, :, 3] = np.clip(new_alpha, 0.0, 255.0)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def alpha_bbox(image: Image.Image, alpha_threshold: int = 24) -> tuple[int, int, int, int] | None:
    arr = np.asarray(image.convert("RGBA"))
    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > alpha_threshold)
    if len(xs) == 0 or len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def crop_to_alpha(
    image: Image.Image,
    padding: int,
    alpha_threshold: int,
) -> tuple[Image.Image, tuple[int, int, int, int] | None]:
    bbox = alpha_bbox(image, alpha_threshold)
    if bbox is None:
        return image.copy(), None
    left, top, right, bottom = bbox
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(image.width, right + padding)
    bottom = min(image.height, bottom + padding)
    return image.crop((left, top, right, bottom)), (left, top, right, bottom)


def alpha_composite_clipped(canvas: Image.Image, source: Image.Image, dest: tuple[int, int]) -> None:
    x, y = dest
    src_left = max(0, -x)
    src_top = max(0, -y)
    src_right = min(source.width, canvas.width - x)
    src_bottom = min(source.height, canvas.height - y)
    if src_right <= src_left or src_bottom <= src_top:
        return
    dst_x = max(0, x)
    dst_y = max(0, y)
    canvas.alpha_composite(source.crop((src_left, src_top, src_right, src_bottom)), (dst_x, dst_y))


def shift_image_fractional(image: Image.Image, dx: float, dy: float = 0.0) -> Image.Image:
    if abs(dx) < 0.001 and abs(dy) < 0.001:
        return image.copy()
    return image.transform(
        image.size,
        Image.Transform.AFFINE,
        (1.0, 0.0, -dx, 0.0, 1.0, -dy),
        resample=Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    )


def lower_alpha_center_x(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    alpha_threshold: int,
) -> float:
    left, top, right, bottom = bbox
    height = bottom - top
    band_height = max(4, int(round(height * 0.3)))
    band_top = max(top, bottom - band_height)
    alpha = np.asarray(image.convert("RGBA"))[:, :, 3]
    ys, xs = np.where(alpha[band_top:bottom, left:right] > alpha_threshold)
    if len(xs) == 0:
        return (left + right) / 2.0
    return left + float(np.median(xs))


def body_anchor_x(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    alpha_threshold: int,
) -> float:
    left, top, right, bottom = bbox
    height = bottom - top
    alpha = np.asarray(image.convert("RGBA"))[:, :, 3]
    centers: list[float] = []
    for start, end in ((0.22, 0.34), (0.42, 0.55), (0.62, 0.75), (0.78, 0.93)):
        band_top = max(top, int(round(top + height * start)))
        band_bottom = min(bottom, int(round(top + height * end)))
        if band_bottom <= band_top:
            continue
        _, xs = np.where(alpha[band_top:band_bottom, left:right] > alpha_threshold)
        if len(xs) >= 8:
            centers.append(left + float(np.median(xs)))
    if centers:
        return float(np.median(centers))
    return lower_alpha_center_x(image, bbox, alpha_threshold)


def foot_contact_anchor_x(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    alpha_threshold: int,
) -> float:
    left, top, right, bottom = bbox
    height = bottom - top
    alpha = np.asarray(image.convert("RGBA"))[:, :, 3]
    body_x = body_anchor_x(image, bbox, alpha_threshold)

    contact_row = alpha[bottom - 1, left:right]
    row_xs = np.where(contact_row > alpha_threshold)[0]
    if len(row_xs) >= 2:
        min_x = left + int(row_xs.min())
        max_x = left + int(row_xs.max())
        return float(min_x if abs(min_x - body_x) >= abs(max_x - body_x) else max_x)

    band_heights = [
        max(2, min(10, int(round(height * 0.012)))),
        max(4, min(14, int(round(height * 0.02)))),
        max(6, min(20, int(round(height * 0.035)))),
    ]
    for band_height in band_heights:
        band_top = max(top, bottom - band_height)
        band_alpha = alpha[band_top:bottom, left:right]
        ys, xs = np.where(band_alpha > alpha_threshold)
        if len(xs) < 4:
            continue

        unique_x, counts = np.unique(xs, return_counts=True)
        min_hits = max(1, int(math.ceil(band_height * 0.2)))
        robust_x = unique_x[counts >= min_hits]
        if len(robust_x) < 4:
            robust_x = unique_x
        min_x = left + int(robust_x.min())
        max_x = left + int(robust_x.max())
        return float(min_x if abs(min_x - body_x) >= abs(max_x - body_x) else max_x)

    return lower_alpha_center_x(image, bbox, alpha_threshold)


def visual_core_anchor_x(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    alpha_threshold: int,
) -> float:
    left, top, right, bottom = bbox
    height = bottom - top
    alpha = np.asarray(image.convert("RGBA"))[:, :, 3]
    centers: list[float] = []
    for start, end in ((0.25, 0.40), (0.42, 0.58), (0.60, 0.78)):
        band_top = max(top, int(round(top + height * start)))
        band_bottom = min(bottom, int(round(top + height * end)))
        if band_bottom <= band_top:
            continue
        band_alpha = alpha[band_top:band_bottom, left:right]
        ys, xs = np.where(band_alpha > alpha_threshold)
        if len(xs) < 8:
            continue
        weights = band_alpha[ys, xs].astype(np.float32)
        centers.append(left + float(np.sum(xs * weights) / max(1.0, float(np.sum(weights)))))
    if centers:
        return float(np.median(centers))
    return body_anchor_x(image, bbox, alpha_threshold)


def body_anchor_point(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    alpha_threshold: int,
) -> tuple[float, float]:
    left, top, right, bottom = bbox
    width = right - left
    height = bottom - top
    alpha = np.asarray(image.convert("RGBA"))[:, :, 3]
    anchor_x = body_anchor_x(image, bbox, alpha_threshold)

    core_half_w = max(8, int(round(width * 0.22)))
    core_left = max(left, int(round(anchor_x - core_half_w)))
    core_right = min(right, int(round(anchor_x + core_half_w)))
    core_top = max(top, int(round(top + height * 0.16)))
    core_bottom = min(bottom, int(round(top + height * 0.82)))
    ys, xs = np.where(alpha[core_top:core_bottom, core_left:core_right] > alpha_threshold)
    if len(xs) >= 16:
        return anchor_x, core_top + float(np.median(ys))

    ys, xs = np.where(alpha[top:bottom, left:right] > alpha_threshold)
    if len(xs) >= 16:
        return anchor_x, top + float(np.median(ys))
    return anchor_x, (top + bottom) / 2.0


def foot_anchor_point(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    alpha_threshold: int,
) -> tuple[float, float]:
    _, _, _, bottom = bbox
    anchor_x = foot_contact_anchor_x(image, bbox, alpha_threshold)
    return anchor_x, float(bottom)


def sideview_anchor_point(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    alpha_threshold: int,
) -> tuple[float, float]:
    """侧视锚点：x=身体主干中心（列密度最高簇，甩动的马尾/手臂密度低被排除），
    y=地线（最低实心行）。与 sideview_alignment 同口径——输出位置校准用它时是加固而非打架。"""
    _, _, _, bottom = bbox
    mask = np.asarray(image.convert("RGBA"))[:, :, 3] > alpha_threshold
    col_density = mask.sum(axis=0)
    peak = col_density.max()
    if peak <= 0:
        return (bbox[0] + bbox[2]) / 2.0, float(bottom)
    cols = np.where(col_density >= peak * 0.55)[0]
    min_pixels = max(3, int(mask.shape[1] * 0.02))
    rows = np.where(mask.sum(axis=1) >= min_pixels)[0]
    ground_y = float(rows[-1]) if len(rows) else float(bottom)
    return float(cols.mean()), ground_y


def action_anchor_point(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    alpha_threshold: int,
    anchor_mode: str,
) -> tuple[float, float]:
    if anchor_mode == "body":
        return body_anchor_point(image, bbox, alpha_threshold)
    if anchor_mode == "sideview":
        return sideview_anchor_point(image, bbox, alpha_threshold)
    return foot_anchor_point(image, bbox, alpha_threshold)


def alpha_mask(image: Image.Image, alpha_threshold: int) -> np.ndarray:
    return np.asarray(image.convert("RGBA"))[:, :, 3] > alpha_threshold


def bool_bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(mask)
    if len(xs) == 0 or len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def resize_bool_mask(mask: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    image = Image.fromarray(mask.astype(np.uint8) * 255, "L")
    resized = image.resize(size, Image.Resampling.NEAREST)
    return np.asarray(resized) > 0


def scale_bool_mask_about(mask: np.ndarray, factor: float, anchor: tuple[float, float]) -> np.ndarray:
    if abs(factor - 1.0) < 0.0001:
        return mask
    height, width = mask.shape
    image = Image.fromarray(mask.astype(np.uint8) * 255, "L")
    anchor_x, anchor_y = anchor
    inv = 1.0 / factor
    scaled = image.transform(
        (width, height),
        Image.Transform.AFFINE,
        (inv, 0.0, anchor_x - anchor_x * inv, 0.0, inv, anchor_y - anchor_y * inv),
        resample=Image.Resampling.NEAREST,
        fillcolor=0,
    )
    return np.asarray(scaled) > 0


def fit_bool_mask(mask: np.ndarray, max_size: int) -> tuple[np.ndarray, float, float]:
    height, width = mask.shape
    scale = min(1.0, max_size / max(width, height))
    if scale >= 1.0:
        return mask, 1.0, 1.0
    size = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
    fitted = resize_bool_mask(mask, size)
    return fitted, size[0] / width, size[1] / height


def mask_edge(mask: np.ndarray) -> np.ndarray:
    eroded = mask.copy()
    eroded[1:, :] &= mask[:-1, :]
    eroded[:-1, :] &= mask[1:, :]
    eroded[:, 1:] &= mask[:, :-1]
    eroded[:, :-1] &= mask[:, 1:]
    return mask & ~eroded


def choose_stable_mask(masks: list[np.ndarray]) -> tuple[np.ndarray | None, float, int]:
    if not masks:
        return None, 0.0, 0

    occupancy = np.zeros(masks[0].shape, dtype=np.uint16)
    areas: list[int] = []
    for mask in masks:
        occupancy += mask
        areas.append(int(np.count_nonzero(mask)))

    median_area = float(np.median(areas)) if areas else 0.0
    min_points = max(64, int(median_area * 0.015))
    for fraction in (0.9, 0.8, 0.7, 0.6, 0.5, 0.4):
        needed = max(1, int(math.ceil(len(masks) * fraction)))
        stable = occupancy >= needed
        stable_count = int(np.count_nonzero(stable))
        if stable_count >= min_points:
            return stable, fraction, stable_count
    return None, 0.0, 0


def overlap_shift_score(current: np.ndarray, target: np.ndarray, dx: int, dy: int) -> int:
    height, width = target.shape
    if dx >= 0:
        src_x0, src_x1 = 0, width - dx
        dst_x0, dst_x1 = dx, width
    else:
        src_x0, src_x1 = -dx, width
        dst_x0, dst_x1 = 0, width + dx

    if dy >= 0:
        src_y0, src_y1 = 0, height - dy
        dst_y0, dst_y1 = dy, height
    else:
        src_y0, src_y1 = -dy, height
        dst_y0, dst_y1 = 0, height + dy

    if src_x1 <= src_x0 or src_y1 <= src_y0:
        return 0
    return int(np.count_nonzero(current[src_y0:src_y1, src_x0:src_x1] & target[dst_y0:dst_y1, dst_x0:dst_x1]))


def estimate_mask_translation(
    current: np.ndarray,
    target: np.ndarray,
    max_shift_x: int,
    max_shift_y: int,
) -> tuple[int, int, float]:
    best_dx = 0
    best_dy = 0
    best_score = -1
    target_count = max(1, int(np.count_nonzero(target)))
    current_count = max(1, int(np.count_nonzero(current)))
    normalizer = math.sqrt(target_count * current_count)
    for dy in range(-max_shift_y, max_shift_y + 1):
        for dx in range(-max_shift_x, max_shift_x + 1):
            score = overlap_shift_score(current, target, dx, dy)
            if score > best_score or (
                score == best_score and abs(dx) + abs(dy) < abs(best_dx) + abs(best_dy)
            ):
                best_score = score
                best_dx = dx
                best_dy = dy
    return best_dx, best_dy, best_score / normalizer


def estimate_mask_similarity(
    current: np.ndarray,
    target: np.ndarray,
    max_shift_x: int,
    max_shift_y: int,
    anchor: tuple[float, float],
) -> tuple[int, int, float, float]:
    best_dx = 0
    best_dy = 0
    best_scale = 1.0
    best_score = -1.0
    for scale in (0.9, 0.92, 0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06, 1.08, 1.1):
        scaled = scale_bool_mask_about(current, scale, anchor)
        dx, dy, score = estimate_mask_translation(scaled, target, max_shift_x, max_shift_y)
        if score > best_score or (
            abs(score - best_score) < 0.0001
            and abs(scale - 1.0) + (abs(dx) + abs(dy)) * 0.01
            < abs(best_scale - 1.0) + (abs(best_dx) + abs(best_dy)) * 0.01
        ):
            best_dx = dx
            best_dy = dy
            best_scale = scale
            best_score = score
    return best_dx, best_dy, best_score, best_scale


def stable_point_alignment(
    images: list[tuple[str, Image.Image]],
    bboxes: list[tuple[int, int, int, int] | None],
    alpha_threshold: int,
    search_radius: int,
) -> dict[str, Any] | None:
    valid = [(index, image, bbox) for index, (_, image), bbox in zip(range(len(images)), images, bboxes) if bbox is not None]
    if len(valid) < 2:
        return None

    sizes = {(image.width, image.height) for _, image, _ in valid}
    if len(sizes) != 1:
        return None

    masks_by_index: dict[int, np.ndarray] = {
        index: alpha_mask(image, alpha_threshold)
        for index, image, _ in valid
    }
    stable, fraction, stable_count = choose_stable_mask(list(masks_by_index.values()))
    if stable is None:
        return None

    stable_bbox = bool_bbox(stable)
    if stable_bbox is None:
        return None

    reference_index, reference_image, reference_bbox = valid[0]
    reference_mask = masks_by_index[reference_index]
    ref_left, ref_top, ref_right, ref_bottom = reference_bbox
    stable_radius = max(8, int(round(search_radius * 0.34)))
    core_region = dilate_mask(stable, stable_radius) & reference_mask
    core_bbox = bool_bbox(core_region) or stable_bbox
    core_left, core_top, core_right, core_bottom = core_bbox

    reference_feature = mask_edge(reference_mask) & core_region
    if np.count_nonzero(reference_feature) < 64:
        reference_feature = mask_edge(reference_mask)
    if np.count_nonzero(reference_feature) < 64:
        reference_feature = reference_mask

    anchor_x = lower_alpha_center_x(reference_image, reference_bbox, alpha_threshold)
    anchor_y = float(reference_bbox[3])
    stable_low, scale_x, scale_y = fit_bool_mask(reference_feature, 256)
    low_size = (stable_low.shape[1], stable_low.shape[0])
    radius_x = max(1, int(math.ceil(search_radius * scale_x)))
    radius_y = max(1, int(math.ceil(search_radius * scale_y)))
    low_anchor = (anchor_x * scale_x, anchor_y * scale_y)

    offsets: list[tuple[float, float] | None] = [None for _ in images]
    frame_scales: list[float | None] = [None for _ in images]
    scores: list[float] = []
    for index, mask in masks_by_index.items():
        current_feature = mask_edge(mask)
        if np.count_nonzero(current_feature) < 64:
            current_feature = mask
        current_low = resize_bool_mask(current_feature, low_size)
        dx, dy, score, match_scale = estimate_mask_similarity(current_low, stable_low, radius_x, radius_y, low_anchor)
        offsets[index] = (dx / scale_x, dy / scale_y)
        frame_scales[index] = match_scale
        scores.append(score)

    for index in range(len(offsets)):
        if offsets[index] is None:
            offsets[index] = (0.0, 0.0)
        if frame_scales[index] is None:
            frame_scales[index] = 1.0

    return {
        "offsets": offsets,
        "scales": frame_scales,
        "anchor_x": anchor_x,
        "anchor_y": anchor_y,
        "stable_bbox": stable_bbox,
        "reference_index": reference_index,
        "reference_core_bbox": (core_left, core_top, core_right, core_bottom),
        "stable_fraction": fraction,
        "stable_points": stable_count,
        "stable_feature_points": int(np.count_nonzero(reference_feature)),
        "search_radius": search_radius,
        "low_search_radius": [radius_x, radius_y],
        "mean_score": float(np.mean(scores)) if scores else 0.0,
    }


def sideview_alignment(
    images: list[tuple[str, Image.Image]],
    bboxes: list[tuple[int, int, int, int] | None],
    alpha_threshold: int,
    search_radius: int = 48,
) -> dict[str, Any] | None:
    """纯侧视原地动作双锚：地线 Y 硬锁（最低实心行对齐中位数）+ 躯干带 X 互相关（对首个有效帧）。
    只输出整体平移（offsets 语义=把本帧移回参考系），scales 恒 1。
    返回 dict 与 stable_point_alignment 同构（offsets/scales/anchor_x/anchor_y + 诊断字段）。"""
    masks = [alpha_mask(image, alpha_threshold) for _, image in images]
    ground_ys: list[int] = []
    for mask in masks:
        min_pixels = max(3, int(mask.shape[1] * 0.02))
        rows = np.where(mask.sum(axis=1) >= min_pixels)[0]
        ground_ys.append(int(rows[-1]) if len(rows) else 0)
    target_y = int(np.median(np.asarray(ground_ys)))

    def body_core_x(mask: np.ndarray) -> float | None:
        """身体主干中心 x = 列密度最高的那簇列的均值。
        主干（头+躯干+腿竖向贯穿）列像素数远高于甩动的马尾/伸出的手臂（宽而薄/细），
        密度阈值 55% 天然把它们排除——比躯干带互相关稳（互相关会被大马尾整片甩动带跑），
        且是绝对量，没有搜索半径限制（整段走位多大都锁得回来）。"""
        col_density = mask.sum(axis=0)
        peak = col_density.max()
        if peak <= 0:
            return None
        cols = np.where(col_density >= peak * 0.55)[0]
        return float(cols.mean())

    ref_index = next((i for i, bbox in enumerate(bboxes) if bbox is not None), None)
    if ref_index is None:
        return None
    core_xs = [body_core_x(mask) if bboxes[i] is not None else None for i, mask in enumerate(masks)]
    valid_cores = [c for c in core_xs if c is not None]
    target_x = float(np.median(np.asarray(valid_cores))) if valid_cores else 0.0
    offsets: list[tuple[float, float]] = []
    for index in range(len(masks)):
        if bboxes[index] is None or core_xs[index] is None:
            offsets.append((0.0, 0.0))
            continue
        offsets.append((target_x - core_xs[index], float(target_y - ground_ys[index])))

    ref_bbox = bboxes[ref_index]
    return {
        "offsets": offsets,
        "scales": [1.0 for _ in images],
        "anchor_x": (ref_bbox[0] + ref_bbox[2]) / 2.0,
        "anchor_y": float(target_y),
        "method": "sideview",
        "reference_index": ref_index,
        "ground_ys": ground_ys,
        "search_radius": search_radius,
    }


def normalize_images(
    images: list[tuple[str, Image.Image]],
    *,
    frame_size: tuple[int, int] | None,
    padding: int,
    allow_upscale: bool,
    alpha_threshold: int,
    stabilize_anchor: bool = True,
    anchor_mode: str = "foot",
    stabilize_search_radius: int = 48,
    scale_stabilize: bool = False,
    visual_stabilize: bool = False,
    foot_contact_lock_enabled: bool = True,
    foot_contact_freeze_rows: int = 4,
) -> tuple[list[tuple[str, Image.Image, dict[str, Any]]], dict[str, Any]]:
    if anchor_mode not in {"foot", "body", "sideview"}:
        fail(f"Unsupported anchor mode: {anchor_mode}")
    bboxes: list[tuple[int, int, int, int] | None] = [
        alpha_bbox(image, alpha_threshold)
        for _, image in images
    ]
    valid_bboxes = [bbox for bbox in bboxes if bbox is not None]
    content_sizes = [
        (bbox[2] - bbox[0], bbox[3] - bbox[1])
        for bbox in valid_bboxes
    ]
    if not content_sizes:
        fail("No non-transparent pixels were found after background removal.")

    max_content_w = max(width for width, _ in content_sizes)
    max_content_h = max(height for _, height in content_sizes)
    if frame_size is None:
        canvas_w = max_content_w + padding * 2
        canvas_h = max_content_h + padding * 2
    else:
        canvas_w, canvas_h = frame_size

    if canvas_w <= padding * 2 or canvas_h <= padding * 2:
        fail("Frame size is too small for the requested padding.")

    frame_offsets: list[tuple[float, float]] = [(0.0, 0.0) for _ in images]
    frame_scales: list[float] = [1.0 for _ in images]
    anchor_corrections: list[tuple[float, float]] = [(0.0, 0.0) for _ in images]
    transformed_bboxes: list[tuple[float, float, float, float] | None] = [None for _ in images]
    source_anchor_x: float | None = None
    source_anchor_y: float | None = None
    alignment_info: dict[str, Any] | None = None
    canvas_anchor_x = canvas_w / 2.0
    canvas_anchor_y = canvas_h - padding
    scale_x = (canvas_w - padding * 2) / max_content_w
    scale_y = (canvas_h - padding * 2) / max_content_h
    if stabilize_anchor:
        if anchor_mode == "sideview":
            alignment_info = sideview_alignment(images, bboxes, alpha_threshold, stabilize_search_radius)
        else:
            alignment_info = stable_point_alignment(images, bboxes, alpha_threshold, stabilize_search_radius)
        if alignment_info is not None:
            frame_offsets = [(float(dx), float(dy)) for dx, dy in alignment_info["offsets"]]
            detected_frame_scales = [float(item) for item in alignment_info["scales"]]
            frame_scales = detected_frame_scales if scale_stabilize else [1.0 for _ in images]
            source_anchor_x = float(alignment_info["anchor_x"])
            match_anchor_y = float(alignment_info["anchor_y"])
            # sideview：双锚 offsets 即最终对齐（地线 Y 硬锁 + 躯干带 X），
            # 跳过下方按 foot/body 锚点中位数的再校正（会用脚部质心把锁好的对齐重新拉漂）
            action_anchors = [
                action_anchor_point(image, bbox, alpha_threshold, anchor_mode) if bbox is not None else None
                for (_, image), bbox in zip(images, bboxes)
            ] if anchor_mode != "sideview" else [None for _ in images]
            transformed_action_anchors: list[tuple[float, float] | None] = [None for _ in images]
            for index, (bbox, action_anchor, offset, frame_scale) in enumerate(
                zip(bboxes, action_anchors, frame_offsets, frame_scales)
            ):
                if bbox is None or action_anchor is None:
                    continue
                action_anchor_x_value, action_anchor_y_value = action_anchor
                transformed_action_anchors[index] = (
                    source_anchor_x + offset[0] + frame_scale * (action_anchor_x_value - source_anchor_x),
                    match_anchor_y + offset[1] + frame_scale * (action_anchor_y_value - match_anchor_y),
                )
            valid_action_anchors = [item for item in transformed_action_anchors if item is not None]
            if valid_action_anchors:
                action_reference_x = float(np.median([item[0] for item in valid_action_anchors]))
                action_reference_y = float(np.median([item[1] for item in valid_action_anchors]))
                source_anchor_x = action_reference_x
                for index, transformed_anchor in enumerate(transformed_action_anchors):
                    if transformed_anchor is None:
                        continue
                    correction_x = action_reference_x - transformed_anchor[0]
                    correction_y = action_reference_y - transformed_anchor[1]
                    anchor_corrections[index] = (correction_x, correction_y)
                    offset = frame_offsets[index]
                    frame_offsets[index] = (offset[0] + correction_x, offset[1] + correction_y)
            for index, (bbox, offset, frame_scale) in enumerate(zip(bboxes, frame_offsets, frame_scales)):
                if bbox is None:
                    continue
                dx, dy = offset
                transformed_bboxes[index] = (
                    source_anchor_x + dx + frame_scale * (bbox[0] - source_anchor_x),
                    match_anchor_y + dy + frame_scale * (bbox[1] - match_anchor_y),
                    source_anchor_x + dx + frame_scale * (bbox[2] - source_anchor_x),
                    match_anchor_y + dy + frame_scale * (bbox[3] - match_anchor_y),
                )
            source_anchor_y = max(
                transformed[3]
                for transformed in transformed_bboxes
                if transformed is not None
            )

        directional_scales: list[float] = []
        if source_anchor_x is not None and source_anchor_y is not None:
            left_extent = max(
                max(0.0, source_anchor_x - transformed[0])
                for transformed in transformed_bboxes
                if transformed is not None
            )
            right_extent = max(
                max(0.0, transformed[2] - source_anchor_x)
                for transformed in transformed_bboxes
                if transformed is not None
            )
            top_extent = max(
                max(0.0, source_anchor_y - transformed[1])
                for transformed in transformed_bboxes
                if transformed is not None
            )
            bottom_extent = max(
                max(0.0, transformed[3] - source_anchor_y)
                for transformed in transformed_bboxes
                if transformed is not None
            )
            if top_extent > 0:
                scale_y = (canvas_anchor_y - padding) / top_extent
            if bottom_extent > 0:
                lower_room = max(1.0, canvas_h - padding - canvas_anchor_y)
                scale_y = min(scale_y, lower_room / bottom_extent)
        else:
            left_extent = max_content_w / 2.0
            right_extent = max_content_w / 2.0

        if left_extent > 0:
            directional_scales.append((canvas_anchor_x - padding) / left_extent)
        if right_extent > 0:
            directional_scales.append((canvas_w - padding - canvas_anchor_x) / right_extent)
        if directional_scales:
            scale_x = min(directional_scales)

    scale = min(scale_x, scale_y)
    if not allow_upscale:
        scale = min(1.0, scale)

    normalized: list[tuple[str, Image.Image, dict[str, Any]]] = []
    for index, ((name, image), bbox, offset, frame_scale, transformed) in enumerate(
        zip(
            images,
            bboxes,
            frame_offsets,
            frame_scales,
            transformed_bboxes,
        )
    ):
        canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        if bbox is None:
            normalized.append((name, canvas, {"empty": True}))
            continue

        crop = image.crop(bbox)
        output_scale = scale * frame_scale
        scaled_w = max(1, int(round(crop.width * output_scale)))
        scaled_h = max(1, int(round(crop.height * output_scale)))
        if (scaled_w, scaled_h) != crop.size:
            crop = crop.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)

        if source_anchor_x is None or source_anchor_y is None or transformed is None:
            paste_x = int(round((canvas_w - scaled_w) / 2.0))
            paste_y = canvas_h - padding - scaled_h
        else:
            paste_x = int(round(canvas_anchor_x + (transformed[0] - source_anchor_x) * scale))
            paste_y = int(round(canvas_anchor_y + (transformed[1] - source_anchor_y) * scale))
        alpha_composite_clipped(canvas, crop, (paste_x, paste_y))
        normalized.append(
            (
                name,
                canvas,
                {
                    "source_bbox": list(bbox),
                    "source_anchor": [round(source_anchor_x, 4), round(source_anchor_y, 4)]
                    if source_anchor_x is not None and source_anchor_y is not None
                    else None,
                    "stabilize_offset": [round(offset[0], 4), round(offset[1], 4)],
                    "anchor_correction": [
                        round(anchor_corrections[index][0], 4),
                        round(anchor_corrections[index][1], 4),
                    ],
                    "anchor_correction_x": round(anchor_corrections[index][0], 4),
                    "anchor_correction_y": round(anchor_corrections[index][1], 4),
                    "stabilize_scale": round(frame_scale, 4),
                    "content_size": [bbox[2] - bbox[0], bbox[3] - bbox[1]],
                    "normalized_bbox": [paste_x, paste_y, paste_x + scaled_w, paste_y + scaled_h],
                },
            )
        )

    output_position_calibration: dict[str, Any] | None = None
    if stabilize_anchor and len(normalized) > 1:
        output_anchors: list[tuple[int, float, float]] = []
        for index, (_, image, _) in enumerate(normalized):
            bbox = alpha_bbox(image, alpha_threshold)
            if bbox is None:
                continue
            anchor_x, anchor_y = action_anchor_point(image, bbox, alpha_threshold, anchor_mode)
            output_anchors.append((index, anchor_x, anchor_y))

        if output_anchors:
            reference_x = float(np.median([item[1] for item in output_anchors]))
            reference_y = float(np.median([item[2] for item in output_anchors]))
            before_x = [item[1] for item in output_anchors]
            before_y = [item[2] for item in output_anchors]
            final_offsets: list[tuple[float, float]] = [(0.0, 0.0) for _ in normalized]
            recalibrated = list(normalized)
            for index, anchor_x, anchor_y in output_anchors:
                dx = int(round(reference_x - anchor_x))
                dy = int(round(reference_y - anchor_y))
                final_offsets[index] = (float(dx), float(dy))
                if dx == 0 and dy == 0:
                    continue
                name, image, stats = recalibrated[index]
                shifted = Image.new("RGBA", image.size, (0, 0, 0, 0))
                alpha_composite_clipped(shifted, image, (dx, dy))
                stats = dict(stats)
                stats["output_position_correction"] = [dx, dy]
                normalized_bbox = stats.get("normalized_bbox")
                if isinstance(normalized_bbox, list) and len(normalized_bbox) == 4:
                    stats["normalized_bbox"] = [
                        normalized_bbox[0] + dx,
                        normalized_bbox[1] + dy,
                        normalized_bbox[2] + dx,
                        normalized_bbox[3] + dy,
                    ]
                recalibrated[index] = (name, shifted, stats)
            normalized = recalibrated

            after_anchors: list[tuple[float, float]] = []
            for _, image, _ in normalized:
                bbox = alpha_bbox(image, alpha_threshold)
                if bbox is None:
                    continue
                after_anchors.append(action_anchor_point(image, bbox, alpha_threshold, anchor_mode))
            after_x = [item[0] for item in after_anchors]
            after_y = [item[1] for item in after_anchors]
            output_position_calibration = {
                "reference": [round(reference_x, 4), round(reference_y, 4)],
                "before_range": [
                    round(max(before_x) - min(before_x), 4),
                    round(max(before_y) - min(before_y), 4),
                ],
                "after_range": [
                    round(max(after_x) - min(after_x), 4) if after_x else 0,
                    round(max(after_y) - min(after_y), 4) if after_y else 0,
                ],
                "offset_range": [
                    [round(min(item[0] for item in final_offsets), 4), round(max(item[0] for item in final_offsets), 4)],
                    [round(min(item[1] for item in final_offsets), 4), round(max(item[1] for item in final_offsets), 4)],
                ],
            }

    visual_stabilization: dict[str, Any] | None = None
    if visual_stabilize and anchor_mode == "sideview":
        # sideview 已用“身体主干列密度 + 地线”锁定世界坐标。旧 visual core 会把
        # 马尾、披风和长剑纳入多个横向带，反而可能给单帧追加十余像素的错误平移。
        visual_stabilization = {
            "skipped": True,
            "reason": "sideview anchor already locks the body core and ground line",
        }
    elif visual_stabilize and len(normalized) > 1:
        visual_anchors: list[tuple[int, float]] = []
        for index, (_, image, _) in enumerate(normalized):
            bbox = alpha_bbox(image, alpha_threshold)
            if bbox is None:
                continue
            visual_anchors.append((index, visual_core_anchor_x(image, bbox, alpha_threshold)))

        if visual_anchors:
            reference_x = float(np.median([item[1] for item in visual_anchors]))
            before_x = [item[1] for item in visual_anchors]
            final_offsets_x: list[float] = [0.0 for _ in normalized]
            recalibrated = list(normalized)
            for index, anchor_x in visual_anchors:
                dx = reference_x - anchor_x
                final_offsets_x[index] = dx
                if abs(dx) < 0.001:
                    continue
                name, image, stats = recalibrated[index]
                shifted = shift_image_fractional(image, dx, 0.0)
                stats = dict(stats)
                stats["visual_stabilize_correction_x"] = round(dx, 4)
                normalized_bbox = stats.get("normalized_bbox")
                if isinstance(normalized_bbox, list) and len(normalized_bbox) == 4:
                    stats["normalized_bbox"] = [
                        round(normalized_bbox[0] + dx, 4),
                        normalized_bbox[1],
                        round(normalized_bbox[2] + dx, 4),
                        normalized_bbox[3],
                    ]
                recalibrated[index] = (name, shifted, stats)
            normalized = recalibrated

            after_x: list[float] = []
            for _, image, _ in normalized:
                bbox = alpha_bbox(image, alpha_threshold)
                if bbox is None:
                    continue
                after_x.append(visual_core_anchor_x(image, bbox, alpha_threshold))
            visual_stabilization = {
                "reference_x": round(reference_x, 4),
                "before_range_x": round(max(before_x) - min(before_x), 4),
                "after_range_x": round(max(after_x) - min(after_x), 4) if after_x else 0,
                "offset_range_x": [
                    round(min(final_offsets_x), 4),
                    round(max(final_offsets_x), 4),
                ],
            }

    foot_contact_lock: dict[str, Any] | None = None
    if foot_contact_lock_enabled and stabilize_anchor and anchor_mode == "foot" and len(normalized) > 1:
        contact_anchors: list[tuple[int, float, float]] = []
        for index, (_, image, _) in enumerate(normalized):
            bbox = alpha_bbox(image, alpha_threshold)
            if bbox is None:
                continue
            anchor_x, anchor_y = foot_anchor_point(image, bbox, alpha_threshold)
            contact_anchors.append((index, anchor_x, anchor_y))

        if contact_anchors:
            reference_x = float(round(float(np.median([item[1] for item in contact_anchors]))))
            reference_y = float(round(float(np.median([item[2] for item in contact_anchors]))))
            before_x = [item[1] for item in contact_anchors]
            before_y = [item[2] for item in contact_anchors]
            final_offsets: list[tuple[int, int]] = [(0, 0) for _ in normalized]
            recalibrated = list(normalized)
            for index, anchor_x, anchor_y in contact_anchors:
                dx = int(round(reference_x - anchor_x))
                dy = int(round(reference_y - anchor_y))
                final_offsets[index] = (dx, dy)
                if dx == 0 and dy == 0:
                    continue
                name, image, stats = recalibrated[index]
                shifted = Image.new("RGBA", image.size, (0, 0, 0, 0))
                alpha_composite_clipped(shifted, image, (dx, dy))
                stats = dict(stats)
                stats["foot_contact_lock_correction"] = [dx, dy]
                normalized_bbox = stats.get("normalized_bbox")
                if isinstance(normalized_bbox, list) and len(normalized_bbox) == 4:
                    stats["normalized_bbox"] = [
                        normalized_bbox[0] + dx,
                        normalized_bbox[1] + dy,
                        normalized_bbox[2] + dx,
                        normalized_bbox[3] + dy,
                    ]
                recalibrated[index] = (name, shifted, stats)
            normalized = recalibrated

            after_anchors: list[tuple[float, float]] = []
            for _, image, _ in normalized:
                bbox = alpha_bbox(image, alpha_threshold)
                if bbox is None:
                    continue
                after_anchors.append(foot_anchor_point(image, bbox, alpha_threshold))
            after_x = [item[0] for item in after_anchors]
            after_y = [item[1] for item in after_anchors]
            final_dx = [item[0] for item in final_offsets]
            final_dy = [item[1] for item in final_offsets]
            foot_contact_lock = {
                "reference": [round(reference_x, 4), round(reference_y, 4)],
                "before_range": [
                    round(max(before_x) - min(before_x), 4),
                    round(max(before_y) - min(before_y), 4),
                ],
                "after_range": [
                    round(max(after_x) - min(after_x), 4) if after_x else 0,
                    round(max(after_y) - min(after_y), 4) if after_y else 0,
                ],
                "offset_range": [
                    [min(final_dx), max(final_dx)],
                    [min(final_dy), max(final_dy)],
                ],
            }

            freeze_rows = max(0, int(foot_contact_freeze_rows))
            if freeze_rows > 0 and after_anchors:
                reference_index = contact_anchors[0][0]
                reference_image = normalized[reference_index][1]
                reference_bbox = alpha_bbox(reference_image, alpha_threshold)
                if reference_bbox is not None:
                    _, _, _, reference_bottom = reference_bbox
                    patch_top = max(0, reference_bottom - freeze_rows)
                    reference_strip = reference_image.crop((0, patch_top, reference_image.width, reference_bottom))
                    frozen = list(normalized)
                    for frame_index, (name, image, stats) in enumerate(frozen):
                        bbox = alpha_bbox(image, alpha_threshold)
                        if bbox is None:
                            continue
                        _, _, _, bottom = bbox
                        strip_top = max(0, bottom - reference_strip.height)
                        if bottom <= strip_top:
                            continue
                        shifted = image.copy()
                        clear = Image.new("RGBA", (image.width, bottom - strip_top), (0, 0, 0, 0))
                        shifted.paste(clear, (0, strip_top))
                        shifted.alpha_composite(reference_strip, (0, strip_top))
                        stats = dict(stats)
                        stats["foot_contact_freeze_rows"] = reference_strip.height
                        frozen[frame_index] = (name, shifted, stats)
                    normalized = frozen

                    frozen_anchors: list[tuple[float, float]] = []
                    for _, image, _ in normalized:
                        bbox = alpha_bbox(image, alpha_threshold)
                        if bbox is None:
                            continue
                        frozen_anchors.append(foot_anchor_point(image, bbox, alpha_threshold))
                    frozen_x = [item[0] for item in frozen_anchors]
                    frozen_y = [item[1] for item in frozen_anchors]
                    foot_contact_lock["freeze_rows"] = reference_strip.height
                    foot_contact_lock["after_freeze_range"] = [
                        round(max(frozen_x) - min(frozen_x), 4) if frozen_x else 0,
                        round(max(frozen_y) - min(frozen_y), 4) if frozen_y else 0,
                    ]

    info = {
        "frame_size": [canvas_w, canvas_h],
        "padding": padding,
        "anchor": f"stable-points-{anchor_mode}" if source_anchor_x is not None else "bottom-center",
        "anchor_mode": anchor_mode,
        "source_anchor": [round(source_anchor_x, 4), round(source_anchor_y, 4)]
        if source_anchor_x is not None and source_anchor_y is not None
        else None,
        "stable_alignment": {
            "method": alignment_info.get("method", "stable-points"),
            "stable_bbox": list(alignment_info["stable_bbox"]) if alignment_info.get("stable_bbox") else None,
            "reference_index": alignment_info.get("reference_index"),
            "reference_core_bbox": list(alignment_info["reference_core_bbox"]) if alignment_info.get("reference_core_bbox") else None,
            "stable_fraction": alignment_info.get("stable_fraction"),
            "stable_points": alignment_info.get("stable_points"),
            "stable_feature_points": alignment_info.get("stable_feature_points"),
            "search_radius": alignment_info.get("search_radius"),
            "low_search_radius": alignment_info.get("low_search_radius"),
            "mean_score": round(alignment_info["mean_score"], 4) if alignment_info.get("mean_score") is not None else None,
            "scale_range": [round(min(frame_scales), 4), round(max(frame_scales), 4)],
            "detected_scale_range": [
                round(min(float(item) for item in alignment_info["scales"]), 4),
                round(max(float(item) for item in alignment_info["scales"]), 4),
            ],
            "scale_stabilize": scale_stabilize,
            "action_anchor_correction_range": [
                [round(min(item[0] for item in anchor_corrections), 4), round(max(item[0] for item in anchor_corrections), 4)],
                [round(min(item[1] for item in anchor_corrections), 4), round(max(item[1] for item in anchor_corrections), 4)],
            ],
        }
        if alignment_info is not None
        else None,
        "output_position_calibration": output_position_calibration,
        "visual_stabilization": visual_stabilization,
        "foot_contact_lock": foot_contact_lock,
        "shared_scale": scale,
        "alpha_threshold": alpha_threshold,
        "max_content_size": [max_content_w, max_content_h],
    }
    return normalized, info


def checkerboard(size: tuple[int, int], block: int = 8) -> Image.Image:
    width, height = size
    base = Image.new("RGBA", size, (238, 238, 238, 255))
    alt = Image.new("RGBA", (block, block), (204, 204, 204, 255))
    for y in range(0, height, block):
        for x in range(0, width, block):
            if ((x // block) + (y // block)) % 2:
                base.alpha_composite(alt, (x, y))
    return base


def make_strip(paths: list[Path], out_path: Path) -> None:
    if not paths:
        return
    frames = [Image.open(path).convert("RGBA") for path in paths]
    width = sum(frame.width for frame in frames)
    height = max(frame.height for frame in frames)
    strip = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    x = 0
    for frame in frames:
        strip.alpha_composite(frame, (x, height - frame.height))
        x += frame.width
    strip.save(out_path)


def make_preview(paths: list[Path], out_path: Path, columns: int) -> None:
    if not paths:
        return
    columns = max(1, columns)
    frames = [Image.open(path).convert("RGBA") for path in paths]
    cell_w = max(frame.width for frame in frames)
    cell_h = max(frame.height for frame in frames)
    rows = math.ceil(len(frames) / columns)
    preview = Image.new("RGBA", (cell_w * columns, cell_h * rows), (255, 255, 255, 255))
    for index, frame in enumerate(frames):
        x = (index % columns) * cell_w
        y = (index // columns) * cell_h
        cell = checkerboard((cell_w, cell_h))
        cell.alpha_composite(frame, ((cell_w - frame.width) // 2, cell_h - frame.height))
        preview.alpha_composite(cell, (x, y))
    preview.save(out_path)


def make_color_preview(paths: list[Path], out_path: Path, columns: int, color: tuple[int, int, int]) -> None:
    if not paths:
        return
    columns = max(1, columns)
    frames = [Image.open(path).convert("RGBA") for path in paths]
    cell_w = max(frame.width for frame in frames)
    cell_h = max(frame.height for frame in frames)
    rows = math.ceil(len(frames) / columns)
    preview = Image.new("RGB", (cell_w * columns, cell_h * rows), color)
    for index, frame in enumerate(frames):
        x = (index % columns) * cell_w
        y = (index // columns) * cell_h
        cell = Image.new("RGBA", (cell_w, cell_h), (*color, 255))
        cell.alpha_composite(frame, ((cell_w - frame.width) // 2, cell_h - frame.height))
        preview.paste(cell.convert("RGB"), (x, y))
    preview.save(out_path)


def make_raw_preview(paths: list[Path], out_path: Path, columns: int, cell_size: int = 128) -> None:
    if not paths:
        return
    columns = max(1, columns)
    rows = math.ceil(len(paths) / columns)
    preview = Image.new("RGB", (cell_size * columns, cell_size * rows), (255, 255, 255))
    for index, path in enumerate(paths):
        with Image.open(path) as source:
            frame = ImageOps.contain(source.convert("RGB"), (cell_size, cell_size), Image.Resampling.BILINEAR)
        x = (index % columns) * cell_size + (cell_size - frame.width) // 2
        y = (index // columns) * cell_size + (cell_size - frame.height) // 2
        preview.paste(frame, (x, y))
    preview.save(out_path)


def ffmpeg_executable() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        fail("ffmpeg is required for video extraction. Run `npm run sprite:keyframes:deps` or install ffmpeg in PATH.")


def video_clip_duration(video_start: float, video_end: float, video_seconds: float) -> float | None:
    if video_start < 0:
        fail("--video-start must be 0 or greater.")
    if video_end < 0:
        fail("--video-end must be 0 or greater.")
    if video_seconds < 0:
        fail("--video-seconds must be 0 or greater.")
    if video_end > 0:
        if video_end <= video_start:
            fail("--video-end must be greater than --video-start.")
        return video_end - video_start
    if video_seconds > 0:
        return video_seconds
    return None


def extract_video_frames(
    video: Path,
    frames_dir: Path,
    sample_fps: float,
    video_start: float,
    clip_duration: float | None,
) -> list[Path]:
    clear_pngs(frames_dir)
    frame_pattern = frames_dir / "frame_%05d.png"
    command = [
        ffmpeg_executable(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(video),
    ]
    if video_start > 0:
        command += ["-ss", f"{video_start:.4f}"]
    if clip_duration is not None and clip_duration > 0:
        command += ["-t", f"{clip_duration:.4f}"]
    if sample_fps > 0:
        command += ["-vf", f"fps={sample_fps}"]
    command += [str(frame_pattern)]
    subprocess.run(command, check=True)
    frames = sorted(frames_dir.glob("frame_*.png"))
    if not frames:
        fail(f"No frames were extracted from video: {video}")
    return frames


def frame_feature(
    path: Path,
    *,
    size: int,
    white_threshold: int,
    white_softness: float,
    chroma_tolerance: float,
    alpha_threshold: int,
    background_mode: str,
    edge_tolerance: float,
    edge_softness: float,
    hole_cleanup: bool,
    hole_min_area: int,
    hole_max_area: int,
    fringe_cleanup: bool,
    fringe_radius: int,
    fringe_strength: float,
    fringe_brightness: float,
    decontaminate: bool,
) -> np.ndarray:
    with Image.open(path) as source:
        cut = cut_white_background(
            source,
            threshold=white_threshold,
            softness=white_softness,
            chroma_tolerance=chroma_tolerance,
            alpha_cutoff=alpha_threshold,
            background_mode=background_mode,
            edge_tolerance=edge_tolerance,
            edge_softness=edge_softness,
            hole_cleanup=hole_cleanup,
            hole_min_area=hole_min_area,
            hole_max_area=hole_max_area,
            fringe_cleanup=fringe_cleanup,
            fringe_radius=fringe_radius,
            fringe_strength=fringe_strength,
            fringe_brightness=fringe_brightness,
            decontaminate=decontaminate,
        )

    bbox = alpha_bbox(cut, alpha_threshold)
    if bbox is None:
        with Image.open(path) as source:
            gray = ImageOps.contain(source.convert("L"), (size, size), Image.Resampling.BILINEAR)
        canvas = Image.new("L", (size, size), 0)
        canvas.paste(gray, ((size - gray.width) // 2, (size - gray.height) // 2))
        return np.asarray(canvas, dtype=np.float32).reshape(-1) / 255.0

    crop = cut.crop(bbox)
    fitted = ImageOps.contain(crop, (size, size), Image.Resampling.BILINEAR)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(fitted, ((size - fitted.width) // 2, size - fitted.height))

    arr = np.asarray(canvas, dtype=np.float32)
    alpha = arr[:, :, 3:4] / 255.0
    premultiplied = (arr[:, :, :3] / 255.0) * alpha
    return np.concatenate([premultiplied, alpha], axis=2).reshape(-1)


def feature_distance(left: np.ndarray, right: np.ndarray) -> float:
    return float(np.mean(np.abs(left - right)) * 255.0)


def evenly_pick(indices: list[int], count: int) -> list[int]:
    if count <= 0 or len(indices) <= count:
        return indices
    positions = np.linspace(0, len(indices) - 1, count)
    picked = sorted({indices[int(round(pos))] for pos in positions})
    cursor = 0
    while len(picked) < count and cursor < len(indices):
        if indices[cursor] not in picked:
            picked.append(indices[cursor])
        cursor += 1
    return sorted(picked[:count])


def diverse_pick(
    indices: list[int],
    count: int,
    features: list[np.ndarray],
    *,
    min_gap: int,
) -> list[int]:
    if count <= 0 or len(indices) <= count:
        return sorted(indices)

    remaining = set(indices)
    selected: list[int] = []
    if indices:
        selected.append(indices[0])
        remaining.discard(indices[0])
    if count > 1 and len(indices) > 1:
        selected.append(indices[-1])
        remaining.discard(indices[-1])

    min_gap = max(1, min_gap)
    while remaining and len(selected) < count:
        best_index: int | None = None
        best_score = -1.0
        for index in sorted(remaining):
            if any(abs(index - item) < min_gap for item in selected):
                continue
            pose_score = min(feature_distance(features[index], features[item]) for item in selected)
            temporal_score = min(abs(index - item) for item in selected) / max(1, len(features) - 1)
            score = pose_score + temporal_score * 4.0
            if score > best_score:
                best_score = score
                best_index = index

        if best_index is None:
            min_gap -= 1
            if min_gap <= 0:
                best_index = max(
                    remaining,
                    key=lambda item: min(feature_distance(features[item], features[picked]) for picked in selected),
                )
            else:
                continue

        selected.append(best_index)
        remaining.discard(best_index)

    return sorted(selected[:count])


def select_keyframes(
    frames: list[Path],
    *,
    sample_fps: float,
    time_offset_sec: float,
    diff_threshold: float,
    min_gap: int,
    max_keyframes: int,
    target_keyframes: int,
    selection_mode: str,
    white_threshold: int,
    white_softness: float,
    chroma_tolerance: float,
    background_mode: str,
    edge_tolerance: float,
    edge_softness: float,
    hole_cleanup: bool,
    hole_min_area: int,
    hole_max_area: int,
    fringe_cleanup: bool,
    fringe_radius: int,
    fringe_strength: float,
    fringe_brightness: float,
    decontaminate: bool,
    alpha_threshold: int,
) -> tuple[list[int], list[dict[str, Any]]]:
    features = [
        frame_feature(
            path,
            size=96,
            white_threshold=white_threshold,
            white_softness=white_softness,
            chroma_tolerance=chroma_tolerance,
            alpha_threshold=alpha_threshold,
            background_mode=background_mode,
            edge_tolerance=edge_tolerance,
            edge_softness=edge_softness,
            hole_cleanup=hole_cleanup,
            hole_min_area=hole_min_area,
            hole_max_area=hole_max_area,
            fringe_cleanup=fringe_cleanup,
            fringe_radius=fringe_radius,
            fringe_strength=fringe_strength,
            fringe_brightness=fringe_brightness,
            decontaminate=decontaminate,
        )
        for path in frames
    ]
    scores: list[float] = [0.0]
    for index in range(1, len(features)):
        scores.append(feature_distance(features[index], features[index - 1]))

    all_indices = list(range(len(frames)))
    min_gap = max(1, min_gap)

    if selection_mode == "even":
        count = target_keyframes if target_keyframes > 0 else min(len(frames), max_keyframes if max_keyframes > 0 else len(frames))
        selected = evenly_pick(all_indices, count)
    elif selection_mode == "diverse" and target_keyframes > 0:
        selected = diverse_pick(all_indices, target_keyframes, features, min_gap=min_gap)
    else:
        selected = [0]
        last_selected = 0
        for index in range(1, len(frames)):
            diff_from_selected = feature_distance(features[index], features[last_selected])
            if index - last_selected >= min_gap and diff_from_selected >= diff_threshold:
                selected.append(index)
                last_selected = index

        if len(frames) > 1 and selected[-1] != len(frames) - 1:
            selected.append(len(frames) - 1)

        if selection_mode == "diverse":
            selected = diverse_pick(all_indices, len(selected), features, min_gap=min_gap)

        if target_keyframes > 0:
            selected = diverse_pick(all_indices, target_keyframes, features, min_gap=min_gap)
        elif max_keyframes > 0 and len(selected) > max_keyframes:
            if selection_mode == "diverse":
                selected = diverse_pick(selected, max_keyframes, features, min_gap=min_gap)
            else:
                selected = evenly_pick(selected, max_keyframes)

    # sample_fps<=0 = 原生 fps 抽帧（无时间基准），时间戳字段置 None
    details = [
        {
            "index": index,
            "source_frame": frames[index].name,
            "time_sec": round(time_offset_sec + index / sample_fps, 4) if sample_fps > 0 else None,
            "segment_time_sec": round(index / sample_fps, 4) if sample_fps > 0 else None,
            "diff_score": round(scores[index], 4),
            "selection_mode": selection_mode,
        }
        for index in selected
    ]
    return selected, details


def process_character(args: argparse.Namespace, manifest: dict[str, Any]) -> None:
    character = require_file(args.character, "character")
    if character is None:
        return

    out_dir = args.out
    with Image.open(character) as source:
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

    cropped, bbox = crop_to_alpha(cut, args.padding, args.alpha_threshold)
    transparent_path = out_dir / "character_transparent.png"
    cropped.save(transparent_path)

    normalized_path = out_dir / "character_frame.png"
    frame_size = parse_frame_size(args.frame_size)
    normalized, info = normalize_images(
        [("character", cut)],
        frame_size=frame_size,
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
    normalized[0][1].save(normalized_path)

    manifest["character"] = {
        "source": str(character),
        "transparent": str(transparent_path),
        "normalized": str(normalized_path),
        "crop_bbox": list(bbox) if bbox else None,
        "normalization": info,
        "stats": normalized[0][2],
    }


def keep_largest_component(image: Image.Image, alpha_threshold: int) -> Image.Image:
    """只保留 alpha 最大连通域（4 邻域 BFS），游离残渣/飞白全清。
    注意：衣袖/武器与主体在画面上断开的素材勿开（会被当残渣误杀）。"""
    arr = np.array(image)
    mask = arr[:, :, 3] > alpha_threshold
    if not mask.any():
        return image
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    current = 0
    best_label, best_area = 0, 0
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


def matte_and_finalize(
    frames: list[Path],
    selected: list[int],
    selected_details: list[dict[str, Any]],
    args: argparse.Namespace,
) -> dict[str, Any]:
    """选中帧 → 抠图 → 归一对齐 → keyframes/预览产物。返回写 manifest 的公共字段。
    video 模式与 frames-dir 手动选帧模式共用。"""
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
        if args.largest_component_only:
            cut = keep_largest_component(cut, args.alpha_threshold)
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

    strip_path = args.out / "keyframes_strip.png"
    preview_path = args.out / "keyframes_preview.png"
    dark_preview_path = args.out / "keyframes_preview_dark.png"
    make_strip(key_paths, strip_path)
    make_preview(key_paths, preview_path, args.preview_columns)
    make_color_preview(key_paths, dark_preview_path, args.preview_columns, (42, 48, 50))
    return {
        "selected_keyframe_count": len(selected_details),
        "normalization": normalization_info,
        "keyframes": selected_details,
        "strip": str(strip_path),
        "preview": str(preview_path),
        "dark_preview": str(dark_preview_path),
    }


def process_frames_dir(args: argparse.Namespace, manifest: dict[str, Any]) -> None:
    """--frames-dir 模式：直接处理已抽好的帧目录，按 --select-indices 手动选帧（跳过抽帧与自动选帧）。"""
    frames = sorted(args.frames_dir.glob("*.png"))
    if not frames:
        fail(f"frames-dir 里没有 PNG: {args.frames_dir}")
    if not args.select_indices.strip():
        fail("--frames-dir 模式必须提供 --select-indices")
    try:
        selected = sorted({int(part) for part in args.select_indices.split(",") if part.strip() != ""})
    except ValueError:
        fail(f"--select-indices 解析失败: {args.select_indices}")
    bad = [index for index in selected if index < 0 or index >= len(frames)]
    if bad:
        fail(f"帧下标越界 {bad}（共 {len(frames)} 帧）")
    selected_details: list[dict[str, Any]] = [
        {"frame_index": index, "source": str(frames[index])} for index in selected
    ]
    common = matte_and_finalize(frames, selected, selected_details, args)
    manifest["frames_dir"] = {
        "source": str(args.frames_dir),
        "raw_frame_count": len(frames),
        "select_indices": selected,
        **common,
    }


def process_video(args: argparse.Namespace, manifest: dict[str, Any]) -> None:
    video = require_file(args.video, "video")
    if video is None:
        return

    raw_dir = args.out / "raw_frames"
    clip_duration = video_clip_duration(args.video_start, args.video_end, args.video_seconds)
    clip_end = args.video_start + clip_duration if clip_duration is not None else None
    frames = extract_video_frames(video, raw_dir, args.sample_fps, args.video_start, clip_duration)
    raw_preview_path = args.out / "raw_frames_preview.png"
    make_raw_preview(frames, raw_preview_path, args.preview_columns)
    selected, selected_details = select_keyframes(
        frames,
        sample_fps=args.sample_fps,
        time_offset_sec=args.video_start,
        diff_threshold=args.diff_threshold,
        min_gap=args.min_gap,
        max_keyframes=args.max_keyframes,
        target_keyframes=args.target_keyframes,
        selection_mode=args.selection_mode,
        white_threshold=args.white_threshold,
        white_softness=args.white_softness,
        chroma_tolerance=args.chroma_tolerance,
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
        alpha_threshold=args.alpha_threshold,
    )

    common = matte_and_finalize(frames, selected, selected_details, args)

    if not args.keep_raw_frames:
        for frame in raw_dir.glob("*.png"):
            frame.unlink()

    manifest["video"] = {
        "source": str(video),
        "sample_fps": args.sample_fps,
        "video_start": args.video_start,
        "video_end": clip_end,
        "video_seconds": args.video_seconds,
        "clip_duration": clip_duration,
        "raw_frame_count": len(frames),
        "diff_threshold": args.diff_threshold,
        "min_gap": args.min_gap,
        "selection_mode": args.selection_mode,
        "raw_preview": str(raw_preview_path),
        "raw_frames_dir": str(raw_dir) if args.keep_raw_frames else None,
        **common,
    }


def main() -> None:
    args = parse_args()
    if args.character is None and args.video is None and args.frames_dir is None:
        fail("Pass at least --character, --video or --frames-dir.")
    if args.video is not None:
        video_clip_duration(args.video_start, args.video_end, args.video_seconds)

    args.out = args.out.resolve()
    prepare_dir(args.out)

    manifest: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tool": "tools/sprite-keyframe-tool.py",
        "settings": {
            "white_threshold": args.white_threshold,
            "white_softness": args.white_softness,
            "chroma_tolerance": args.chroma_tolerance,
            "alpha_threshold": args.alpha_threshold,
            "background_mode": args.background_mode,
            "edge_tolerance": args.edge_tolerance,
            "edge_softness": args.edge_softness,
            "hole_cleanup": not args.no_hole_cleanup,
            "hole_min_area": args.hole_min_area,
            "hole_max_area": args.hole_max_area,
            "fringe_cleanup": not args.no_fringe_cleanup,
            "fringe_radius": args.fringe_radius,
            "fringe_strength": args.fringe_strength,
            "fringe_brightness": args.fringe_brightness,
            "edge_contract": args.edge_contract,
            "selection_mode": args.selection_mode,
            "video_start": args.video_start,
            "video_end": args.video_end,
            "video_seconds": args.video_seconds,
            "frame_size": args.frame_size,
            "padding": args.padding,
            "allow_upscale": args.allow_upscale,
            "anchor_stabilize": not args.no_anchor_stabilize,
            "anchor_mode": args.anchor_mode,
            "stabilize_search_radius": args.stabilize_search_radius,
            "scale_stabilize": args.scale_stabilize,
            "visual_stabilize": args.visual_stabilize,
            "foot_contact_lock": not args.no_foot_contact_lock,
            "foot_contact_freeze_rows": args.foot_contact_freeze_rows,
        },
    }

    process_character(args, manifest)
    if args.frames_dir is not None:
        # 手动选帧模式优先：frames-dir 与 video 同传时忽略 video
        args.frames_dir = args.frames_dir.resolve()
        process_frames_dir(args, manifest)
    else:
        process_video(args, manifest)

    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"OK: wrote sprite prep outputs to {args.out}")
    print(f"OK: manifest {manifest_path}")


if __name__ == "__main__":
    main()
