# PartsRig 八件组装校准（标准部件规范 v1）：拆解图切件 → 对位到角色坐标系。
# 用法：py -3 tools/sprite-pipeline/assemble_parts8.py ；校准=改 CONFIG 重跑。
# 输出：parts8_final/<part>.png + parts_meta.json + assemble_check.png（左=组装 右=参考图）
import json
from pathlib import Path

from PIL import Image

SRC = Path(r'F:\Cgame\temp\partsrig-demo\parts8')
OUT = Path(r'F:\Cgame\temp\partsrig-demo\parts8_final')
REFERENCE = Path(r'F:\Cgame\temp\sprite-keyframes\pipeline\style-test4\character_transparent.png')
TOP_PAD = 90
CANVAS = (1166, 1116 + TOP_PAD)
FOOT = (491, 1108 + TOP_PAD)

# 标准 8 件：piece 文件 → 部件；pivot_local=锚点（图内坐标）；char=锚点在角色坐标系的落点；rot=基础角（烘进像素）
CONFIG = {
    # 注意：泛洪抠图后面积变化，切件编号重排过（torso=0 head=1 tail=2 armF=3 sword=4 armB=5 legA=6 legB=7）
    'torso':    { 'file': 'piece_0.png', 'pivot_local': (215, 250), 'scale': 1.137, 'char': (523, 726),  'rot': 0 },   # 锚点=髋部（旋转轴），领口落 (523,470)、袍摆落 ~1010
    'head':     { 'file': 'piece_1.png', 'pivot_local': (275, 375), 'scale': 1.10,  'char': (523, 470),  'rot': 0 },
    'hairBack': { 'file': 'piece_2.png', 'pivot_local': (215, 65),  'scale': 1.15,  'char': (314, 124),  'rot': 0 },
    'armFront': { 'file': 'piece_3.png', 'pivot_local': (57, 45),   'scale': 1.2,   'char': (600, 490),  'rot': 0 },
    'armBack':  { 'file': 'piece_5.png', 'pivot_local': (120, 45),  'scale': 1.2,   'char': (448, 492),  'rot': 0 },
    'legFront': { 'file': 'piece_6.png', 'pivot_local': (75, 25),   'scale': 0.92,  'char': (590, 901),  'rot': 0, 'flip': True },   # 原画鞋尖朝左，镜像成朝右
    'legBack':  { 'file': 'piece_7.png', 'pivot_local': (70, 25),   'scale': 0.92,  'char': (420, 901),  'rot': 0, 'flip': True },
    'weapon':   { 'file': 'piece_4.png', 'pivot_local': (150, 95),  'scale': 0.9,   'char': (757, 702),  'rot': -6 },
}
Z_ORDER = ['hairBack', 'armBack', 'legBack', 'legFront', 'torso', 'head', 'armFront', 'weapon']
# 注意 char 坐标不含 TOP_PAD，写 meta 时统一加

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    canvas = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
    meta = {}
    for part in Z_ORDER:
        c = CONFIG[part]
        im = Image.open(SRC / c['file']).convert('RGBA')
        pivot_x = c['pivot_local'][0]
        if c.get('flip'):
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
            pivot_x = im.width - pivot_x
        w, h = round(im.width * c['scale']), round(im.height * c['scale'])
        im = im.resize((w, h), Image.LANCZOS)
        px, py = pivot_x * c['scale'], c['pivot_local'][1] * c['scale']
        if c['rot']:
            big = Image.new('RGBA', (w * 3, h * 3), (0, 0, 0, 0))
            big.alpha_composite(im, (w, h))
            big = big.rotate(-c['rot'], center=(w + px, h + py), resample=Image.BICUBIC)
            im = big
            px, py = w + px, h + py
        bbox = im.getbbox()
        trimmed = im.crop(bbox)
        trimmed.save(OUT / f'{part}.png')
        cx, cy = c['char'][0], c['char'][1] + TOP_PAD
        ox = cx - (px - bbox[0])
        oy = cy - (py - bbox[1])
        meta[part] = {'bbox': [round(ox), round(oy), round(ox + trimmed.width), round(oy + trimmed.height)],
                      'pivot': [cx, cy]}
        canvas.alpha_composite(trimmed, (round(ox), round(oy)))
    # rig 的 root 基准点：脚底中心（供烘焙器换算），挂在 torso 名下不合适，单独记录
    meta['_foot'] = {'pivot': list(FOOT)}
    (OUT / 'parts_meta.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')

    ref = Image.open(REFERENCE).convert('RGBA')
    sheet = Image.new('RGB', (CANVAS[0] * 2, CANVAS[1]), (236, 229, 211))
    tmp = Image.new('RGBA', CANVAS, (236, 229, 211, 255)); tmp.alpha_composite(canvas)
    sheet.paste(tmp.convert('RGB'), (0, 0))
    tmp = Image.new('RGBA', CANVAS, (236, 229, 211, 255)); tmp.alpha_composite(ref, (0, TOP_PAD))
    sheet.paste(tmp.convert('RGB'), (CANVAS[0], 0))
    sheet.save(OUT / 'assemble_check.png')
    print('[assemble8] 完成 → assemble_check.png（左=组装 右=参考图）')


main()
