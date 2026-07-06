# PartsRig 五件组装校准：把拆解图切出的部件缩放/对位到原图角色坐标系（1166x1116，脚底 (491,1108)）。
# 用法：py -3 tools/sprite-pipeline/assemble_parts5.py
# 输出：parts5_final/<part>.png（已缩放到角色坐标系分辨率）+ parts_meta.json（bbox/pivot/rot）
#      + assemble_check.png（新组装 vs 原图 对比）。校准=改 CONFIG 数字重跑。
import json
from pathlib import Path

from PIL import Image

SRC = Path(r'F:\Cgame\temp\partsrig-demo\parts5')
OUT = Path(r'F:\Cgame\temp\partsrig-demo\parts5_final')
ORIGINAL = Path(r'F:\Cgame\temp\sprite-keyframes\pipeline\style-test4\character_transparent.png')
TOP_PAD = 90                   # 顶部余量：放大后的头不出界
CANVAS = (1166, 1116 + TOP_PAD)  # 角色坐标系画布（原图坐标 + 顶部余量）
FOOT = (491, 1108 + TOP_PAD)

# piece 文件名 → 部件；pivot_local=该件图内锚点；scale=缩放；char=锚点落到角色坐标系的位置（含 TOP_PAD）；
# rot=绑定基础旋转（度，烘进像素，identity 姿态时的画面角度修正）
CONFIG = {
    'body':   { 'file': 'piece_0.png', 'pivot_local': (165, 512), 'scale': 1.284, 'char': (491, 1108 + TOP_PAD), 'rot': 0 },
    'head':   { 'file': 'piece_1.png', 'pivot_local': (300, 380), 'scale': 1.32,  'char': (523, 470 + TOP_PAD),  'rot': 0 },
    'hair':   { 'file': 'piece_2.png', 'pivot_local': (255, 75),  'scale': 1.30,  'char': (351, 94 + TOP_PAD),   'rot': 0 },
    'arm':    { 'file': 'piece_4.png', 'pivot_local': (95, 25),   'scale': 1.2,   'char': (598, 545 + TOP_PAD),  'rot': -25 },
    'weapon': { 'file': 'piece_3.png', 'pivot_local': (170, 300), 'scale': 1.15,  'char': (690, 800 + TOP_PAD),  'rot': 30 },
}
Z_ORDER = ['hair', 'body', 'arm', 'head', 'weapon']   # 后→前


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    canvas = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
    meta = {}
    for part in Z_ORDER:
        c = CONFIG[part]
        im = Image.open(SRC / c['file']).convert('RGBA')
        w, h = round(im.width * c['scale']), round(im.height * c['scale'])
        im = im.resize((w, h), Image.LANCZOS)
        px, py = c['pivot_local'][0] * c['scale'], c['pivot_local'][1] * c['scale']
        if c['rot']:
            big = Image.new('RGBA', (w * 3, h * 3), (0, 0, 0, 0))
            big.alpha_composite(im, (w, h))
            big = big.rotate(-c['rot'], center=(w + px, h + py), resample=Image.BICUBIC)
            im = big
            px, py = w + px, h + py
        bbox = im.getbbox()
        trimmed = im.crop(bbox)
        trimmed.save(OUT / f'{part}.png')
        # 角色坐标系里的 bbox：pivot_char - pivot_in_trimmed
        ox = c['char'][0] - (px - bbox[0])
        oy = c['char'][1] - (py - bbox[1])
        meta[part] = {
            'bbox': [round(ox), round(oy), round(ox + trimmed.width), round(oy + trimmed.height)],
            'pivot': list(c['char']),
        }
        canvas.alpha_composite(trimmed, (round(ox), round(oy)))
    (OUT / 'parts_meta.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')

    orig = Image.open(ORIGINAL).convert('RGBA')
    sheet = Image.new('RGB', (CANVAS[0] * 2, CANVAS[1]), (236, 229, 211))
    tmp = Image.new('RGBA', CANVAS, (236, 229, 211, 255)); tmp.alpha_composite(canvas)
    sheet.paste(tmp.convert('RGB'), (0, 0))
    tmp = Image.new('RGBA', CANVAS, (236, 229, 211, 255)); tmp.alpha_composite(orig, (0, TOP_PAD))
    sheet.paste(tmp.convert('RGB'), (CANVAS[0], 0))
    sheet.save(OUT / 'assemble_check.png')
    print('[assemble] 完成 → assemble_check.png（左=新组装 右=原图）')


main()
