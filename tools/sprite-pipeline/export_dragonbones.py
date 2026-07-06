# PartsRig → DragonBones 工程导出：自动绑骨（骨骼/插槽/贴图集）+ 现有动作转关键帧草稿。
# v2：12 件骨架（spec 2026-07-06），actions.json 由 npm run rig:dump 产出；旧 8 骨工程留档 dragonbones-v1-8bones/。
# 用法：py -3 tools/sprite-pipeline/export_dragonbones.py
# 产出 temp/partsrig-demo/dragonbones/{dps_ske.json, dps_tex.json, dps_tex.png}
# DragonBones Pro：文件 → 导入 → 选 dps_ske.json（贴图自动同目录找）。
# 坐标约定：DB 与我们的画布同为 y 向下、旋转顺时针正，锚点差值直接搬。
import json
import math
from pathlib import Path

from PIL import Image

BASE = Path(r'F:\Cgame\temp\partsrig-demo')
PARTS = BASE / 'parts12_final'
OUT = BASE / 'dragonbones'
NAME = 'dps'
FRAME_RATE = 30
Z_ORDER = ['hairBack', 'armBackUpper', 'armBackLower', 'robeBack', 'legBack',
           'legFront', 'robeFront', 'torso', 'head', 'armFrontUpper', 'armFrontLower', 'weapon']

meta_all = json.loads((PARTS / 'parts_meta.json').read_text(encoding='utf-8'))
foot = meta_all['_foot']['pivot']
meta = {k: v for k, v in meta_all.items() if not k.startswith('_')}
data = json.loads((BASE / 'actions.json').read_text(encoding='utf-8'))
ACTIONS, PARENTS = data['actions'], data['parents']

# ---- 贴图集（简单纵向 shelf 打包）----
imgs = {pid: Image.open(PARTS / f'{pid}.png').convert('RGBA') for pid in Z_ORDER}
pad = 4
shelf_w = max(im.width for im in imgs.values()) * 2 + pad * 3
x = y = pad
row_h = 0
rects = {}
for pid in Z_ORDER:
    im = imgs[pid]
    if x + im.width + pad > shelf_w:
        x = pad
        y += row_h + pad
        row_h = 0
    rects[pid] = (x, y, im.width, im.height)
    x += im.width + pad
    row_h = max(row_h, im.height)
atlas_h = y + row_h + pad
atlas = Image.new('RGBA', (shelf_w, atlas_h), (0, 0, 0, 0))
for pid, (rx, ry, _, _) in rects.items():
    atlas.paste(imgs[pid], (rx, ry))
OUT.mkdir(parents=True, exist_ok=True)
atlas.save(OUT / f'{NAME}_tex.png')

tex = {
    'name': NAME,
    'imagePath': f'{NAME}_tex.png',
    'width': shelf_w,
    'height': atlas_h,
    'SubTexture': [
        {'name': pid, 'x': rects[pid][0], 'y': rects[pid][1], 'width': rects[pid][2], 'height': rects[pid][3]}
        for pid in Z_ORDER
    ],
}
(OUT / f'{NAME}_tex.json').write_text(json.dumps(tex, ensure_ascii=False, indent=2), encoding='utf-8')

# ---- 骨骼：root 在脚底，父子位置 = 锚点差值（画布 y 向下 = DB y 向下）----
def pivot(pid):
    return meta[pid]['pivot']

bones = [{'name': 'root'}]
for pid in Z_ORDER:
    parent = PARENTS[pid]
    pp = foot if parent == 'root' else pivot(parent)
    p = pivot(pid)
    bones.append({
        'name': pid,
        'parent': 'root' if parent == 'root' else parent,
        'transform': {'x': round(p[0] - pp[0], 2), 'y': round(p[1] - pp[1], 2)},
    })

slots = [{'name': pid, 'parent': pid} for pid in Z_ORDER]   # 数组顺序 = 绘制顺序（后→前）

skin_slots = []
for pid in Z_ORDER:
    b = meta[pid]['bbox']
    p = pivot(pid)
    cx = (b[0] + b[2]) / 2 - p[0]
    cy = (b[1] + b[3]) / 2 - p[1]
    skin_slots.append({
        'name': pid,
        'display': [{'name': pid, 'transform': {'x': round(cx, 2), 'y': round(cy, 2)}}],
    })

# ---- 动作 → 关键帧草稿（线性过渡，进编辑器后自行润色曲线）----
def track_frames(track, duration_frames, value_key, transform=lambda v: v):
    times = track['times']
    values = track['values']
    frames = []
    for i, t in enumerate(times):
        f0 = round(t * duration_frames)
        f1 = round(times[i + 1] * duration_frames) if i + 1 < len(times) else duration_frames
        frames.append({'duration': max(f1 - f0, 0), value_key: transform(values[i]), 'tweenEasing': 0})
    if times and times[0] > 0:   # 起点补一帧保持首值
        head = {'duration': round(times[0] * duration_frames), value_key: transform(values[0]), 'tweenEasing': 0}
        frames.insert(0, head)
    return frames

animations = []
for aid, adef in ACTIONS.items():
    duration_frames = max(2, round(adef['duration'] * FRAME_RATE))
    bone_anims = []
    entries = list(adef.get('parts', {}).items())
    if adef.get('root'):
        entries.append(('root', adef['root']))
    for pid, anim in entries:
        entry = {'name': pid}
        if anim.get('rot'):
            entry['rotateFrame'] = track_frames(anim['rot'], duration_frames, 'rotate')
        if anim.get('x') or anim.get('y'):
            tx = anim.get('x', {'times': [0], 'values': [0]})
            ty = anim.get('y', {'times': [0], 'values': [0]})
            times = sorted({*tx['times'], *ty['times']})
            def sample(tr, t):
                ts, vs = tr['times'], tr['values']
                if t <= ts[0]:
                    return vs[0]
                if t >= ts[-1]:
                    return vs[-1]
                for i in range(len(ts) - 1):
                    if ts[i] <= t <= ts[i + 1]:
                        u = (t - ts[i]) / (ts[i + 1] - ts[i]) if ts[i + 1] > ts[i] else 1
                        u = 0.5 - 0.5 * math.cos(math.pi * u)
                        return vs[i] + (vs[i + 1] - vs[i]) * u
                return vs[-1]
            frames = []
            for i, t in enumerate(times):
                f0 = round(t * duration_frames)
                f1 = round(times[i + 1] * duration_frames) if i + 1 < len(times) else duration_frames
                frames.append({'duration': max(f1 - f0, 0),
                               'x': round(sample(tx, t), 2),
                               'y': round(-sample(ty, t), 2),   # 我们的动画 y 向上，DB y 向下
                               'tweenEasing': 0})
            entry['translateFrame'] = frames
        if anim.get('scaleX') or anim.get('scaleY'):
            sx = anim.get('scaleX', {'times': [0], 'values': [1]})
            sy = anim.get('scaleY', {'times': [0], 'values': [1]})
            times = sorted({*sx['times'], *sy['times']})
            frames = []
            for i, t in enumerate(times):
                f0 = round(t * duration_frames)
                f1 = round(times[i + 1] * duration_frames) if i + 1 < len(times) else duration_frames
                def sv(tr, tt):
                    ts, vs = tr['times'], tr['values']
                    if tt <= ts[0]: return vs[0]
                    if tt >= ts[-1]: return vs[-1]
                    for j in range(len(ts) - 1):
                        if ts[j] <= tt <= ts[j + 1]:
                            u = (tt - ts[j]) / (ts[j + 1] - ts[j]) if ts[j + 1] > ts[j] else 1
                            return vs[j] + (vs[j + 1] - vs[j]) * u
                    return vs[-1]
                frames.append({'duration': max(f1 - f0, 0), 'x': round(sv(sx, t), 3), 'y': round(sv(sy, t), 3), 'tweenEasing': 0})
            entry['scaleFrame'] = frames
        if len(entry) > 1:
            bone_anims.append(entry)
    animations.append({
        'name': aid,
        'duration': duration_frames,
        'playTimes': 0 if adef.get('loop') else 1,
        'bone': bone_anims,
    })

ske = {
    'frameRate': FRAME_RATE,
    'name': NAME,
    'version': '5.5',
    'compatibleVersion': '5.5',
    'armature': [{
        'type': 'Armature',
        'frameRate': FRAME_RATE,
        'name': NAME,
        'bone': bones,
        'slot': slots,
        'skin': [{'name': '', 'slot': skin_slots}],
        'animation': animations,
        'defaultActions': [{'gotoAndPlay': 'idle'}],
    }],
}
(OUT / f'{NAME}_ske.json').write_text(json.dumps(ske, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'[dragonbones] 导出完成 → {OUT}')
print('[dragonbones] DragonBones Pro：文件 → 导入 → 选 dps_ske.json')
