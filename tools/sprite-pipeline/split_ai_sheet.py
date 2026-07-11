#!/usr/bin/env python3
"""Split a transparent AI 4x2 action sheet into ordered frame PNGs.

Use overlap + largest-component isolation for long connected weapons/hair that cross the
mathematical cell boundary. Do not enable that mode when intended pieces are disconnected.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from typing import Any

from PIL import Image


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def load_sprite_tool() -> Any:
    tool_path = Path(__file__).resolve().parents[1] / "sprite-keyframe-tool.py"
    spec = importlib.util.spec_from_file_location("cgame_sprite_keyframe_tool", tool_path)
    if spec is None or spec.loader is None:
        fail(f"无法加载序列帧工具: {tool_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Split a transparent AI action sheet in row-major order."
    )
    parser.add_argument("--sheet", type=Path, required=True, help="Transparent RGBA sheet.")
    parser.add_argument("--out", type=Path, required=True, help="Output raw_frames directory.")
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--rows", type=int, default=2)
    parser.add_argument(
        "--overlap-x",
        type=int,
        default=0,
        help="Horizontal pixels added to both sides of each logical cell.",
    )
    parser.add_argument("--alpha-threshold", type=int, default=12)
    parser.add_argument(
        "--largest-component-only",
        action="store_true",
        help="Keep the largest connected subject in each overlapped crop.",
    )
    return parser.parse_args()


def rounded_boundaries(length: int, count: int) -> list[int]:
    return [int(round(length * index / count)) for index in range(count + 1)]


def main() -> None:
    args = parse_args()
    if args.columns < 1 or args.rows < 1:
        fail("columns/rows 必须大于 0")
    if args.columns * args.rows != 8:
        fail(f"本项目要求恰好 8 帧，当前网格为 {args.columns}×{args.rows}")
    if args.overlap_x < 0:
        fail("overlap-x 不能为负数")
    if args.overlap_x > 0 and not args.largest_component_only:
        fail("使用 overlap-x 时必须显式启用 --largest-component-only，避免保留邻格残片")
    if not args.sheet.is_file():
        fail(f"找不到动作表: {args.sheet}")

    tool = load_sprite_tool()
    sheet = Image.open(args.sheet).convert("RGBA")
    width, height = sheet.size
    alpha = sheet.getchannel("A")
    corners = [
        alpha.getpixel((0, 0)),
        alpha.getpixel((width - 1, 0)),
        alpha.getpixel((0, height - 1)),
        alpha.getpixel((width - 1, height - 1)),
    ]
    if any(value > args.alpha_threshold for value in corners):
        fail("动作表四角不透明；先完成 chroma-key 去底，再运行切帧")

    args.out.mkdir(parents=True, exist_ok=True)
    for old in args.out.glob("frame_*.png"):
        old.unlink()

    xs = rounded_boundaries(width, args.columns)
    ys = rounded_boundaries(height, args.rows)
    records: list[dict[str, Any]] = []

    for row in range(args.rows):
        for column in range(args.columns):
            index = row * args.columns + column
            logical_left, logical_right = xs[column], xs[column + 1]
            crop_left = max(0, logical_left - args.overlap_x)
            crop_right = min(width, logical_right + args.overlap_x)
            crop_top, crop_bottom = ys[row], ys[row + 1]
            crop = sheet.crop((crop_left, crop_top, crop_right, crop_bottom))

            if args.largest_component_only:
                crop = tool.keep_largest_component(crop, args.alpha_threshold)

            bbox = tool.alpha_bbox(crop, args.alpha_threshold)
            if bbox is None:
                fail(f"第 {index} 格没有可见角色像素")
            left, top, right, bottom = bbox
            if left <= 0 or top <= 0 or right >= crop.width or bottom >= crop.height:
                fail(
                    f"第 {index} 格主体触碰裁切边界 {bbox} / {crop.size}；"
                    "增加 overlap-x、改人工 mask，或重生动作表"
                )

            anchor_x, anchor_y = tool.sideview_anchor_point(crop, bbox, args.alpha_threshold)
            global_anchor_x = crop_left + anchor_x
            if not (logical_left <= global_anchor_x <= logical_right):
                fail(
                    f"第 {index} 格选中的主体身体核落在逻辑格外 ({global_anchor_x:.1f})；"
                    "可能选中了邻格角色"
                )

            output = args.out / f"frame_{index:03d}.png"
            crop.save(output)
            records.append(
                {
                    "index": index,
                    "row": row,
                    "column": column,
                    "logical_box": [logical_left, crop_top, logical_right, crop_bottom],
                    "crop_box": [crop_left, crop_top, crop_right, crop_bottom],
                    "content_bbox": list(bbox),
                    "sideview_anchor": [round(anchor_x, 3), round(anchor_y, 3)],
                    "output": str(output),
                }
            )

    manifest = {
        "source": str(args.sheet.resolve()),
        "sheet_size": [width, height],
        "grid": [args.columns, args.rows],
        "order": "row-major",
        "overlap_x": args.overlap_x,
        "largest_component_only": args.largest_component_only,
        "alpha_threshold": args.alpha_threshold,
        "frames": records,
    }
    manifest_path = args.out / "split_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: split {len(records)} frames to {args.out}")
    print(f"OK: manifest {manifest_path}")


if __name__ == "__main__":
    main()
