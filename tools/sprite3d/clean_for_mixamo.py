# 3D 渲染序列帧管线 · 网格清理（Mixamo 前置）
# 用法：blender -b -P tools/sprite3d/clean_for_mixamo.py -- --in <src.fbx> --out <dst.fbx> [--target-tris 40000] [--tex-size 1024]
# 作用：合并全部网格为单一对象 + 减面到目标三角面数 + 贴图缩到指定尺寸，
#       产出 Mixamo 自动绑骨能吃得下的轻量 FBX（Mixamo 对面数/碎片数耐受度低）。
import argparse
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--out", dest="dst", required=True)
    p.add_argument("--target-tris", type=int, default=40000)
    p.add_argument("--tex-size", type=int, default=1024)
    return p.parse_args(argv)


def main():
    args = parse_args()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=args.src)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("FBX 中没有网格对象")

    # 合并为单一对象（Mixamo 对多网格碎片最易失败）
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = "Character"

    # 应用变换，防止导出后缩放/旋转不一致
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"[clean] 合并后三角面数: {tris}")
    if tris > args.target_tris:
        ratio = args.target_tris / tris
        mod = obj.modifiers.new("Decimate", "DECIMATE")
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
        tris_after = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        print(f"[clean] 减面 ratio={ratio:.3f} → {tris_after}")

    # 贴图缩尺寸（4k 贴图会把 FBX 撑到几十 MB，拖慢上传且无益于 120px 渲染）
    for img in bpy.data.images:
        if img.size[0] > args.tex_size or img.size[1] > args.tex_size:
            w, h = img.size
            scale = args.tex_size / max(w, h)
            img.scale(int(w * scale), int(h * scale))
            print(f"[clean] 贴图 {img.name}: {w}x{h} → {img.size[0]}x{img.size[1]}")

    bpy.ops.export_scene.fbx(
        filepath=args.dst,
        use_selection=False,
        path_mode="COPY",
        embed_textures=True,
        add_leaf_bones=False,
    )
    print(f"[clean] 已导出: {args.dst}")


main()
