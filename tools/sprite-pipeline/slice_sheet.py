# PartsRig 拆解图切件：对 image-2 生成的"部件分开摆放"拆解图做连通域分割。
# 用法：py -3 tools/sprite-pipeline/slice_sheet.py --src <拆解图> --out <目录>
# 背景色取四角中值；掩码做连通域标记；按面积过滤后输出各件 + 带局部网格的目录图（供人工标锚点）。
import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--src', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--bg-tolerance', type=float, default=28.0)
    p.add_argument('--min-area', type=int, default=4000)
    return p.parse_args()


def main():
    args = parse_args()
    im = Image.open(args.src).convert('RGBA')
    arr = np.asarray(im).astype(np.int16)
    h, w = arr.shape[:2]
    corners = np.array([arr[2, 2, :3], arr[2, w - 3, :3], arr[h - 3, 2, :3], arr[h - 3, w - 3, :3]])
    bg = np.median(corners, axis=0)
    dist = np.sqrt(((arr[:, :, :3] - bg) ** 2).sum(axis=2))
    # 背景 = 从画布边缘泛洪、颜色接近背景色的连通区域；部件内部与背景同色的像素不受影响
    bg_eligible = dist <= args.bg_tolerance
    bg_mask = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg_eligible[y, x] and not bg_mask[y, x]:
                bg_mask[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg_eligible[y, x] and not bg_mask[y, x]:
                bg_mask[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and bg_eligible[ny, nx] and not bg_mask[ny, nx]:
                bg_mask[ny, nx] = True
                q.append((ny, nx))
    fg = ~bg_mask

    # 连通域（BFS，8 邻接）
    labels = np.zeros((h, w), dtype=np.int32)
    cur = 0
    comps = []
    for sy in range(h):
        for sx in range(w):
            if not fg[sy, sx] or labels[sy, sx]:
                continue
            cur += 1
            q = deque([(sy, sx)])
            labels[sy, sx] = cur
            pixels = []
            while q:
                y, x = q.popleft()
                pixels.append((y, x))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and not labels[ny, nx]:
                            labels[ny, nx] = cur
                            q.append((ny, nx))
            comps.append((cur, pixels))

    big = [(cid, px) for cid, px in comps if len(px) >= args.min_area]
    big.sort(key=lambda c: -len(c[1]))
    print(f'[sheet] 连通域 {len(comps)} 个，达标 {len(big)} 个（面积阈值 {args.min_area}）')

    args.out.mkdir(parents=True, exist_ok=True)
    rgba = np.asarray(im).copy()
    # 前景全不透明；仅在前景/背景边界羽化 1px（防硬锯齿），部件内部颜色不参与判定
    from PIL import ImageFilter
    mask_img = Image.fromarray((fg * 255).astype(np.uint8), 'L')
    blurred = np.asarray(mask_img.filter(ImageFilter.GaussianBlur(1))).astype(np.uint8)
    rgba[:, :, 3] = np.where(fg, np.maximum(blurred, 128), blurred // 3).astype(np.uint8)
    rgba[:, :, 3] = np.where(fg & (blurred > 250), 255, rgba[:, :, 3])

    for i, (cid, pixels) in enumerate(big):
        ys = [p[0] for p in pixels]
        xs = [p[1] for p in pixels]
        y0, y1, x0, x1 = min(ys), max(ys) + 1, min(xs), max(xs) + 1
        piece = rgba[y0:y1, x0:x1].copy()
        mask = (labels[y0:y1, x0:x1] == cid)
        piece[:, :, 3] = np.where(mask, piece[:, :, 3], 0)
        out = Image.fromarray(piece, 'RGBA')
        out.save(args.out / f'piece_{i}.png')
        cy = sum(ys) / len(ys) / h
        cx = sum(xs) / len(xs) / w
        print(f'[sheet] piece_{i}: bbox=({x0},{y0},{x1},{y1}) 面积={len(pixels)} 质心=({cx:.2f},{cy:.2f})')

    # 目录图：每件贴棋盘底 + 50px 局部网格（人工标锚点用）
    cell_w = max((min(xs2[2] - xs2[0], 900)) for xs2 in [( 0,0,400,0 )]) if False else 460
    sheet = Image.new('RGB', (cell_w * len(big), 560), (250, 250, 250))
    for i in range(len(big)):
        piece = Image.open(args.out / f'piece_{i}.png')
        scale = min((cell_w - 20) / piece.width, 500 / piece.height, 1)
        thumb = piece.resize((max(1, int(piece.width * scale)), max(1, int(piece.height * scale))), Image.LANCZOS)
        tile = Image.new('RGBA', (cell_w, 560), (255, 255, 255, 255))
        dd = ImageDraw.Draw(tile)
        for yy in range(0, 560, 20):
            for xx in range(0, cell_w, 20):
                if (xx // 20 + yy // 20) % 2:
                    dd.rectangle([xx, yy, xx + 20, yy + 20], fill=(232, 232, 232, 255))
        tile.alpha_composite(thumb, (10, 30))
        dd = ImageDraw.Draw(tile)
        grid = max(1, round(100 * scale))
        for gx in range(0, thumb.width, grid):
            dd.line([(10 + gx, 30), (10 + gx, 30 + thumb.height)], fill=(255, 0, 0, 90))
            dd.text((10 + gx, 32 + thumb.height), str(round(gx / scale)), fill=(200, 0, 0))
        for gy in range(0, thumb.height, grid):
            dd.line([(10, 30 + gy), (10 + thumb.width, 30 + gy)], fill=(255, 0, 0, 90))
            dd.text((thumb.width + 12, 28 + gy), str(round(gy / scale)), fill=(200, 0, 0))
        dd.text((10, 8), f'piece_{i}  {piece.width}x{piece.height}', fill=(40, 40, 40))
        sheet.paste(tile.convert('RGB'), (cell_w * i, 0))
    sheet.save(args.out / 'pieces_catalog.png')
    print(f'[sheet] 目录图: {args.out / "pieces_catalog.png"}')


main()
