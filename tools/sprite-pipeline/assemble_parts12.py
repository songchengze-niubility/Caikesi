# PartsRig 十二件组装校准（标准部件规范 v2）：拆解图切件 → 对位到角色坐标系。
# 用法：py -3 tools/sprite-pipeline/assemble_parts12.py ；校准=改 CONFIG 重跑。
# 输出：parts12_final/<part>.png + parts_meta.json + assemble_check.png（左=组装 右=参考图）
import json
from pathlib import Path

from PIL import Image

SRC = Path(r'F:\Cgame\temp\partsrig-demo\parts12')
OUT = Path(r'F:\Cgame\temp\partsrig-demo\parts12_final')
REFERENCE = Path(r'F:\Cgame\temp\sprite-keyframes\pipeline\style-test4\character_transparent.png')
TOP_PAD = 90
CANVAS = (1166, 1116 + TOP_PAD)
FOOT = (491, 1108 + TOP_PAD)

# 件名映射（pieces_catalog 指认，2026-07-06）：0=head 1=robeFront(带腰带裙) 2=robeBack(素面裙)
# 3=torso(自带双袖!) 4=hairBack 5=armFrontUpper 6=weapon 7=armBackUpper 8=legFront 9=legBack
# 10=armFrontLower(握拳) 11=armBackLower(张手)
# pivot_local=锚点（图内坐标）；char=锚点在角色坐标系的落点；rot=基础角（烘进像素）
CONFIG = {
    'torso':         { 'file': 'piece_3.png',  'pivot_local': (165, 185), 'scale': 1.30, 'char': (523, 700), 'rot': 0 },   # 锚=腰带中心（旋转轴），领口落 ~(523,470)
    'head':          { 'file': 'piece_0.png',  'pivot_local': (255, 390), 'scale': 1.12, 'char': (523, 470), 'rot': 0 },   # 锚=脖颈
    'hairBack':      { 'file': 'piece_4.png',  'pivot_local': (103, 29),  'scale': 1.30, 'char': (408, 168), 'rot': 0 },   # 锚=扎发点（发髻后）
    'robeFront':     { 'file': 'piece_1.png',  'pivot_local': (187, 28),  'scale': 1.00, 'char': (540, 700), 'rot': 0 },   # 锚=腰带前缘，下缘落 ~1010
    'robeBack':      { 'file': 'piece_2.png',  'pivot_local': (139, 18),  'scale': 0.95, 'char': (505, 695), 'rot': 0 },   # 锚=腰带后缘，略长
    'armFrontUpper': { 'file': 'piece_5.png',  'pivot_local': (55, 17),   'scale': 0.85, 'char': (610, 500), 'rot': 0 },   # 锚=肩口
    'armFrontLower': { 'file': 'piece_10.png', 'pivot_local': (14, 35),   'scale': 0.90, 'char': (660, 640), 'rot': 0 },   # 锚=肘（袖口内），拳落 ~(757,690)
    'armBackUpper':  { 'file': 'piece_7.png',  'pivot_local': (84, 16),   'scale': 0.80, 'char': (448, 492), 'rot': 0 },
    'armBackLower':  { 'file': 'piece_11.png', 'pivot_local': (18, 24),   'scale': 0.90, 'char': (430, 630), 'rot': 0 },
    'legFront':      { 'file': 'piece_8.png',  'pivot_local': (54, 20),   'scale': 1.15, 'char': (575, 925), 'rot': 0, 'flip': True },   # 鞋尖原画朝左，镜像成朝右
    'legBack':       { 'file': 'piece_9.png',  'pivot_local': (54, 20),   'scale': 1.15, 'char': (448, 925), 'rot': 0, 'flip': True },
    'weapon':        { 'file': 'piece_6.png',  'pivot_local': (50, 450),  'scale': 0.90, 'char': (748, 657), 'rot': 80 },  # 锚=握把
}
Z_ORDER = ['hairBack', 'armBackUpper', 'armBackLower', 'robeBack', 'legBack',
           'legFront', 'robeFront', 'torso', 'head', 'armFrontUpper', 'armFrontLower', 'weapon']
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
            # 余量按长边给：长条件大角度旋转（如竖剑转横）时 w*3 不够会裁掉端头
            m = max(w, h)
            big = Image.new('RGBA', (w + 2 * m, h + 2 * m), (0, 0, 0, 0))
            big.alpha_composite(im, (m, m))
            big = big.rotate(-c['rot'], center=(m + px, m + py), resample=Image.BICUBIC)
            im = big
            px, py = m + px, m + py
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
    print('[assemble12] 完成 → assemble_check.png（左=组装 右=参考图）')


main()


