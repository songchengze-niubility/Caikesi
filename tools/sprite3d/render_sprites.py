# 3D 渲染序列帧管线 · 无头渲染
# 用法：blender -b -P tools/sprite3d/render_sprites.py -- --fbx <带动画.fbx> --name idle --frames 10 --out <目录>
# 可选：--height 240（帧高，显存红线）--no-loop（非循环动作，采样含首尾帧）
#       --ortho-scale N --cam-x N --cam-z N（跨动作共用取景，先渲一个动作记下打印值，其余动作显式传入）
#       --rot-z N（角色绕 Z 轴额外旋转角度，调整朝向用，默认 0）
# 输出：<out>/<name>_0.png … 透明背景，Workbench 平光渲染，对齐 assets/resources/art 序列帧命名约定。
import argparse
import math
import sys

import bpy
from mathutils import Matrix, Vector


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--fbx", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--frames", type=int, default=10)
    p.add_argument("--out", required=True)
    p.add_argument("--height", type=int, default=240)
    p.add_argument("--no-loop", action="store_true")
    p.add_argument("--ortho-scale", type=float, default=None)
    p.add_argument("--cam-x", type=float, default=None)
    p.add_argument("--cam-z", type=float, default=None)
    p.add_argument("--rot-z", type=float, default=0.0)
    p.add_argument("--res-x", type=int, default=None)
    p.add_argument("--toon", action="store_true")
    p.add_argument("--ink", action="store_true")  # 水墨 NPR：去饱和墨阶 + 宣纸肌理 + 湿墨边 + 破锋描边
    return p.parse_args(argv)


def build_ink_materials():
    """把每个材质改写成水墨 NPR：无光照（去手办感）→ 去饱和 → 墨阶对比 → 宣纸暖调 →
    纸张墨点肌理 → 边缘湿墨压暗 → Emission 输出。失败的单个节点不影响整体渲染。"""
    ink_dark = (0.10, 0.11, 0.13)      # 湿墨边/暗部墨色
    paper_tint = (0.90, 0.90, 0.82)    # 宣纸暖调
    for mat in list(bpy.data.materials):
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        img = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        if not out or not img:
            continue
        cur = img.outputs["Color"]

        hsv = nt.nodes.new("ShaderNodeHueSaturation")
        hsv.inputs["Saturation"].default_value = 0.68   # 轻水墨：淡化彩度但保留角色identity（青玉绿/蓝袍）
        hsv.inputs["Value"].default_value = 1.12
        nt.links.new(cur, hsv.inputs["Color"])
        cur = hsv.outputs["Color"]

        bc = nt.nodes.new("ShaderNodeBrightContrast")
        bc.inputs["Bright"].default_value = 0.05         # 整体提亮，避免糊成暗块
        bc.inputs["Contrast"].default_value = 0.06
        nt.links.new(cur, bc.inputs["Color"])
        cur = bc.outputs["Color"]

        tint = nt.nodes.new("ShaderNodeMixRGB")
        tint.blend_type = "MULTIPLY"
        tint.inputs["Fac"].default_value = 0.12
        tint.inputs["Color2"].default_value = (*paper_tint, 1.0)
        nt.links.new(cur, tint.inputs["Color1"])
        cur = tint.outputs["Color"]

        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 48.0
        noise.inputs["Detail"].default_value = 2.0
        mott = nt.nodes.new("ShaderNodeMixRGB")
        mott.blend_type = "MULTIPLY"
        mott.inputs["Fac"].default_value = 0.05          # 极轻纸张墨点肌理
        nt.links.new(cur, mott.inputs["Color1"])
        nt.links.new(noise.outputs["Fac"], mott.inputs["Color2"])
        cur = mott.outputs["Color"]

        # 边缘湿墨：面向相机=1、掠射边缘=0 → 取 (1-facing)^p，再乘强度上限，只压极窄一圈轮廓
        lw = nt.nodes.new("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.22
        sub = nt.nodes.new("ShaderNodeMath")
        sub.operation = "SUBTRACT"
        sub.inputs[0].default_value = 1.0
        nt.links.new(lw.outputs["Facing"], sub.inputs[1])
        powr = nt.nodes.new("ShaderNodeMath")
        powr.operation = "POWER"
        powr.inputs[1].default_value = 4.0               # 更陡，只在极掠射处出墨
        nt.links.new(sub.outputs["Value"], powr.inputs[0])
        rimstr = nt.nodes.new("ShaderNodeMath")
        rimstr.operation = "MULTIPLY"
        rimstr.inputs[1].default_value = 0.45            # 边缘墨强度上限，防止整体发黑
        nt.links.new(powr.outputs["Value"], rimstr.inputs[0])
        rim = nt.nodes.new("ShaderNodeMixRGB")
        rim.blend_type = "MIX"
        rim.inputs["Color2"].default_value = (*ink_dark, 1.0)
        nt.links.new(rimstr.outputs["Value"], rim.inputs["Fac"])
        nt.links.new(cur, rim.inputs["Color1"])
        cur = rim.outputs["Color"]

        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(cur, em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])


def setup_ink_freestyle(scene):
    """破锋描边：近黑墨线 + 书法笔尖渐变粗细 + 柏林扰动，替代 toon 的均匀硬线。"""
    scene.render.use_freestyle = True
    vl = bpy.context.view_layer
    vl.use_freestyle = True
    fs = vl.freestyle_settings
    ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new("ink")
    for other in fs.linesets:
        if other.linestyle is None:
            other.linestyle = bpy.data.linestyles.new("ink")
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = True
    ls.linestyle.color = (0.10, 0.09, 0.11)
    ls.linestyle.thickness = 2.2
    try:
        ls.linestyle.caps = "ROUND"
        tmod = ls.linestyle.thickness_modifiers.new(name="calli", type="CALLIGRAPHY")
        tmod.orientation = 60.0
        tmod.thickness_min = 0.4
        tmod.thickness_max = 3.6
        gmod = ls.linestyle.geometry_modifiers.new(name="jitter", type="PERLIN_NOISE_1D")
        gmod.amplitude = 1.4
        gmod.frequency = 9.0
    except Exception as e:  # 破锋修饰器失败就退回均匀墨线，不中断渲染
        print(f"[render] freestyle 破锋修饰器跳过：{e}")


def sample_frames(action, count, loop):
    f0, f1 = action.frame_range
    span = f1 - f0
    if loop:
        # 循环动作首尾帧相同，均匀采样但不含终点
        return [f0 + span * i / count for i in range(count)]
    return [f0 + span * i / (count - 1) for i in range(count)]


def world_bbox(objs, depsgraph):
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for o in objs:
        ev = o.evaluated_get(depsgraph)
        for v in ev.to_mesh().vertices:
            w = ev.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
        ev.to_mesh_clear()
    return lo, hi


def main():
    args = parse_args()
    scene_frames = []

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=args.fbx)

    arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not arm or not meshes:
        raise SystemExit("FBX 缺少骨架或网格")
    action = arm.animation_data.action if arm.animation_data else None
    if not action:
        raise SystemExit("FBX 中没有动画 action")
    if args.rot_z:
        # 世界 Z 轴旋转（Mixamo 骨架自带烘焙旋转，局部轴会转歪）
        arm.matrix_world = Matrix.Rotation(math.radians(args.rot_z), 4, "Z") @ arm.matrix_world

    scene = bpy.context.scene
    frames = sample_frames(action, args.frames, not args.no_loop)
    print(f"[render] action={action.name} range={tuple(action.frame_range)} 采样={['%.1f' % f for f in frames]}")

    # 跨采样帧求包围盒，保证动作内取景稳定；跨动作稳定靠显式传 --ortho-scale/--cam-*
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for f in frames:
        scene.frame_set(int(f), subframe=f - int(f))
        depsgraph.update()
        l, h = world_bbox(meshes, depsgraph)
        lo = Vector(map(min, lo, l))
        hi = Vector(map(max, hi, h))

    center = (lo + hi) / 2
    size = hi - lo
    margin = 1.06
    ortho = args.ortho_scale if args.ortho_scale else max(size.y, size.z) * margin
    cam_x = args.cam_x if args.cam_x is not None else center.x
    cam_z = args.cam_z if args.cam_z is not None else center.z
    print(f"[render] 取景参数（跨动作复用请传参）: --ortho-scale {ortho:.4f} --cam-x {cam_x:.4f} --cam-z {cam_z:.4f}")

    # 侧视正交相机：位于 -Y 方向看向 +Y（FBX 导入后角色默认面朝 -Y，侧向由 --rot-z 调）
    cam_data = bpy.data.cameras.new("SpriteCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho
    cam = bpy.data.objects.new("SpriteCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (cam_x, center.y - 10, cam_z)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam

    if args.ink:
        # 水墨 NPR：Eevee + 水墨材质（无光照/去饱和/墨阶/宣纸肌理/湿墨边）+ 破锋描边
        try:
            scene.render.engine = "BLENDER_EEVEE_NEXT"
        except TypeError:
            scene.render.engine = "BLENDER_EEVEE"
        build_ink_materials()
        setup_ink_freestyle(scene)
    elif args.toon:
        # 卡通模式：Eevee + 无光照平涂材质 + Freestyle 墨线描边（往手绘插画方向拉）
        try:
            scene.render.engine = "BLENDER_EEVEE_NEXT"
        except TypeError:
            scene.render.engine = "BLENDER_EEVEE"
        for mat in bpy.data.materials:
            if not mat.use_nodes:
                continue
            nt = mat.node_tree
            out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
            img = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
            if not out or not img:
                continue
            em = nt.nodes.new("ShaderNodeEmission")
            nt.links.new(img.outputs["Color"], em.inputs["Color"])
            nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        scene.render.use_freestyle = True
        vl = bpy.context.view_layer
        vl.use_freestyle = True
        fs = vl.freestyle_settings
        # 开启 use_freestyle 会自动带一个无 linestyle 的默认 LineSet，复用它并确保每个 lineset 都有 linestyle
        ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new("ink")
        for other in fs.linesets:
            if other.linestyle is None:
                other.linestyle = bpy.data.linestyles.new("ink")
        ls.select_silhouette = True
        ls.select_border = True
        ls.select_crease = True
        ls.linestyle.color = (0.09, 0.08, 0.10)
        ls.linestyle.thickness = 1.6
    else:
        # Workbench 平光 + 贴图色
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "FLAT"
        scene.display.shading.color_type = "TEXTURE"
    scene.render.film_transparent = True
    aspect = max(size.x, size.y) / size.z if size.z else 1
    scene.render.resolution_y = args.height
    scene.render.resolution_x = args.res_x if args.res_x else max(int(args.height * aspect / 2) * 2, 32)
    print(f"[render] 分辨率: {scene.render.resolution_x}x{scene.render.resolution_y}（跨动作复用请传 --res-x）")
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    for i, f in enumerate(frames):
        scene.frame_set(int(f), subframe=f - int(f))
        scene.render.filepath = f"{args.out}/{args.name}_{i}.png"
        bpy.ops.render.render(write_still=True)
        scene_frames.append(scene.render.filepath)
    print(f"[render] 完成 {len(scene_frames)} 帧 → {args.out}")


main()
