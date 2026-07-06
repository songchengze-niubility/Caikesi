# PartsRig 拆件：把整张角色立绘按多边形切成 hair/head/body/weapon 四件。
# 用法：py -3 tools/sprite-pipeline/slice_parts.py --src <透明底立绘> --out <目录>
# body 取补集（head/hair/weapon 之外的全部有效像素），保证零像素丢失；
# 产出：<part>.png（裁剪后）+ parts_meta.json（bbox/pivot 原图坐标）+ parts_check.png（重组自查图）。
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

# ---- 多边形定义（原图坐标，y 向下）。迭代调形状就改这里。----
# 优先级：weapon > head > hair > body(补集)
POLYGONS = {
    'weapon': [
        # 剑身+护手（拳右侧 x>=758）
        [(758, 650), (1160, 515), (1166, 585), (815, 800), (758, 795)],
        # 剑柄尾（拳左侧露出的一小段）
        [(628, 748), (695, 742), (700, 802), (634, 808)],
    ],
    'head': [
        # 头骨+脸+前发+发髻（不含马尾），上缘抬到画布顶收拢乱发丝，下缘沿下巴/前发梢
        [(348, 160), (350, 80), (350, 0), (760, 0), (778, 280),
         (748, 400), (706, 468), (640, 502), (560, 522), (470, 512), (432, 470),
         (404, 410), (398, 300), (372, 230)],
    ],
    'hair': [
        # 马尾+发带：扎发点向左下流淌的整片
        [(348, 160), (372, 230), (398, 300), (404, 410), (380, 470), (330, 540),
         (260, 620), (180, 690), (100, 745), (30, 770), (0, 740), (0, 0), (368, 0), (368, 70)],
    ],
}
PIVOTS = {          # 原图坐标系的部件锚点
    'hair': (370, 120),    # 扎发点
    'head': (520, 470),    # 脖颈
    'body': None,          # 自动：脚底中心（有效像素最底行中点）
    'weapon': (715, 765),  # 握把（拳心）
}
Z_ORDER = ['hair', 'body', 'head', 'weapon']


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--src', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    return p.parse_args()


def main():
    args = parse_args()
    src = Image.open(args.src).convert('RGBA')
    w, h = src.size
    alpha = src.getchannel('A')

    masks: dict[str, Image.Image] = {}
    claimed = Image.new('L', (w, h), 0)
    for part in ['weapon', 'head', 'hair']:            # 按优先级圈地
        m = Image.new('L', (w, h), 0)
        d = ImageDraw.Draw(m)
        for poly in POLYGONS[part]:
            d.polygon(poly, fill=255)
        # 去掉已被更高优先级占用的像素，再与 alpha 相交
        m = Image.composite(Image.new('L', (w, h), 0), m, claimed)
        m = Image.composite(m, Image.new('L', (w, h), 0), alpha.point(lambda a: 255 if a > 0 else 0))
        claimed = Image.composite(Image.new('L', (w, h), 255), claimed, m)
        masks[part] = m
    # body = 补集
    rest = Image.composite(Image.new('L', (w, h), 0), alpha.point(lambda a: 255 if a > 0 else 0), claimed)
    masks['body'] = rest

    args.out.mkdir(parents=True, exist_ok=True)
    meta = {}
    for part, m in masks.items():
        piece = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        piece.paste(src, (0, 0), m)
        bbox = piece.getbbox()
        if not bbox:
            raise SystemExit(f'{part} 切出来是空的，检查多边形')
        trimmed = piece.crop(bbox)
        trimmed.save(args.out / f'{part}.png')
        pivot = PIVOTS[part]
        if pivot is None:  # body：脚底中心
            a = trimmed.getchannel('A')
            bw, bh = trimmed.size
            bottom = [x for x in range(bw) if a.getpixel((x, bh - 1)) > 0] or [bw // 2]
            pivot = (bbox[0] + (bottom[0] + bottom[-1]) // 2, bbox[3])
        meta[part] = {'bbox': list(bbox), 'pivot': list(pivot)}
        print(f'[slice] {part}: bbox={bbox} pivot={pivot}')
    (args.out / 'parts_meta.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')

    # 自查图：原图 | 按 z 序重组 | 四件平铺（棋盘底）
    checker = Image.new('RGBA', (w, h), (255, 255, 255, 255))
    dd = ImageDraw.Draw(checker)
    for yy in range(0, h, 40):
        for xx in range(0, w, 40):
            if (xx // 40 + yy // 40) % 2:
                dd.rectangle([xx, yy, xx + 40, yy + 40], fill=(228, 228, 228, 255))
    recompose = checker.copy()
    for part in Z_ORDER:
        bbox = meta[part]['bbox']
        piece = Image.open(args.out / f'{part}.png')
        recompose.alpha_composite(piece, (bbox[0], bbox[1]))
    sheet = Image.new('RGB', (w * 3, h), (250, 250, 250))
    orig_on_checker = checker.copy()
    orig_on_checker.alpha_composite(src)
    sheet.paste(orig_on_checker.convert('RGB'), (0, 0))
    sheet.paste(recompose.convert('RGB'), (w, 0))
    spread = checker.copy()
    for i, part in enumerate(Z_ORDER):
        piece = Image.open(args.out / f'{part}.png')
        piece.thumbnail((w // 2 - 20, h // 2 - 20))
        spread.alpha_composite(piece, (10 + (i % 2) * (w // 2), 10 + (i // 2) * (h // 2)))
    sheet.paste(spread.convert('RGB'), (w * 2, 0))
    sheet.save(args.out / 'parts_check.png')
    print(f'[slice] 自查图: {args.out / "parts_check.png"}')


main()
