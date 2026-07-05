# 视频拆帧管线（人机分工版）· 编排脚本
# 设计见 docs/superpowers/specs/2026-07-05-video-sprite-pipeline-design.md
#
# 用法：py -3 tools/sprite-pipeline/split_action.py --clips docs/visual/staging/characters/dps-video/clips
#       [--action idle] [--fps 12] [--max-frames 10] [--game-height 240]
#
# 每个 <动作>.mp4：读时长 → 拆帧率=播放 fps（超红线自动降 fps 保帧数，时间仍 1:1）→
# 调 sprite-keyframe-tool（均匀选帧 + 白底抠图 + 站地锚点/脚尖硬锁默认）→
# game_keyframes（帧高钳制）→ 汇总预览页（游戏背景/棋盘格/深色底，按实际 fps 播放）。
import argparse
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TOOL = REPO / "tools" / "sprite-keyframe-tool.py"
UI_MODULE = REPO / "tools" / "sprite-keyframe-ui.py"


def parse_args():
    p = argparse.ArgumentParser(description="按播放 fps 均匀拆帧并产出游戏规格序列帧。")
    p.add_argument("--clips", type=Path, required=True, help="剪好的动作视频目录，文件名=动作键")
    p.add_argument("--action", default=None, help="只处理指定动作（缺省=目录下全部视频）")
    p.add_argument("--fps", type=int, default=18, help="目标播放 fps（=拆帧率上限）；红线「宁短勿卡」：18fps 下循环单元 ≤0.56s 才吃得满")
    p.add_argument("--max-frames", type=int, default=10, help="每动作帧数红线")
    p.add_argument("--game-height", type=int, default=240, help="游戏帧高上限（显存红线）")
    p.add_argument("--play-fps", type=int, default=0,
                   help="快放模式：>0 时解耦拆帧率与播放 fps——按 max-frames 均匀取帧盖满全片，按此 fps 播放（动作加速=时长×fps÷帧数）")
    p.add_argument("--out", type=Path, default=None, help="输出根目录，默认 temp/sprite-keyframes/pipeline/<角色>")
    return p.parse_args()


def ffmpeg_exe() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        sys.exit("ERROR: 找不到 ffmpeg，先跑 npm run sprite:keyframes:deps")


def video_duration(path: Path) -> float:
    # imageio-ffmpeg 不带 ffprobe，用 ffmpeg -i 的 stderr 解析 Duration
    proc = subprocess.run([ffmpeg_exe(), "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", proc.stderr)
    if not m:
        sys.exit(f"ERROR: 读不到视频时长: {path}")
    h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600 + mi * 60 + s


def pick_fps(duration: float, fps_cap: int, max_frames: int) -> tuple[int, int]:
    """拆帧率=播放 fps；时长超红线时降 fps 保帧数（时间仍 1:1）。返回 (fps, 帧数)。"""
    fps = fps_cap
    if round(duration * fps) > max_frames:
        fps = int(max_frames / duration)
        print(f"[pipeline] 时长 {duration:.2f}s × {fps_cap}fps 超红线 {max_frames} 帧 → 降为 {fps}fps")
    if fps < 5:
        print(f"[pipeline] 警告：fps={fps} 偏低，动画会显卡顿——建议把循环单元剪短到 {max_frames / 5:.1f}s 以内")
    frames = max(2, round(duration * fps))
    return fps, min(frames, max_frames)


def load_ui_module():
    spec = importlib.util.spec_from_file_location("sprite_keyframe_ui", UI_MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def process_clip(video: Path, out_root: Path, args) -> dict | None:
    action = video.stem
    duration = video_duration(video)
    if args.play_fps > 0 and round(duration * args.play_fps) > args.max_frames:
        # 快放模式：帧数顶满预算、均匀盖满全片，播放 fps 独立 → 动作加速
        frames = args.max_frames
        sample_fps = frames / duration
        play_fps = args.play_fps
        speed = duration * play_fps / frames
        print(f"[pipeline] {action}: 快放模式 {frames} 帧盖满 {duration:.2f}s，@{play_fps}fps 播放，动作加速 ×{speed:.1f}")
    else:
        fps, frames = pick_fps(duration, args.play_fps or args.fps, args.max_frames)
        sample_fps = fps
        play_fps = fps
        print(f"[pipeline] {action}: {duration:.2f}s → {frames} 帧 @ {fps}fps")
    out_dir = out_root / action

    cmd = [
        sys.executable, str(TOOL),
        "--video", str(video),
        "--out", str(out_dir),
        "--video-seconds", "0",  # 工具默认只采前 1 秒（网页版起止秒的兼容默认），显式采到结尾
        "--sample-fps", f"{sample_fps:.4f}",
        "--selection-mode", "even",
        "--target-keyframes", str(frames),
        "--min-gap", "1",
        "--max-keyframes", "0",
    ]
    result = subprocess.run(cmd)
    if result.returncode != 0:
        print(f"[pipeline] ERROR: {action} 拆帧失败（见上方输出），跳过")
        return None

    keys = sorted((out_dir / "keyframes").glob("key_*.png"))
    if len(keys) < frames:
        print(f"[pipeline] ERROR: {action} 有效帧 {len(keys)} < 目标 {frames}——检查视频白底质量，跳过")
        return None

    ui = load_ui_module()
    game_dir = out_dir / "game_keyframes"
    ui.build_game_preview_frames(keys, game_dir, 6, args.game_height)
    finals = sorted(game_dir.glob("*.png"))
    for i, f in enumerate(finals):
        f.rename(game_dir / f"{action}_{i}.png")
    print(f"[pipeline] {action}: game_keyframes {len(finals)} 帧就绪 → {game_dir}")
    return {"action": action, "frames": len(finals), "fps": play_fps, "dir": f"{action}/game_keyframes"}


PREVIEW_TEMPLATE = """<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>视频拆帧管线 · 预览</title>
<style>
  body {{ font-family: system-ui, sans-serif; background: #fafafa; margin: 24px; }}
  h2 {{ font-size: 15px; margin: 20px 0 8px; }}
  .row {{ display: flex; gap: 24px; flex-wrap: wrap; }}
  .cell {{ text-align: center; }}
  .label {{ font-size: 12px; color: #666; margin-top: 4px; }}
  .stage {{ width: 200px; height: 160px; display: flex; align-items: flex-end; justify-content: center; border: 1px solid #ddd; }}
  .checker {{ background: repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%) 0 0 / 16px 16px; }}
  .dark {{ background: #3a3a3a; }}
  .game {{ background-image: url('{bg}'); background-size: auto 1920px; background-position: 42% 76%; }}
  .sprite {{ height: 120px; }}
</style></head><body>
<h1 style="font-size:18px">视频拆帧管线 · 游戏显示高度 120px</h1>
<div id="root"></div>
<script>
const ANIMS = {anims};
const root = document.getElementById('root');
for (const a of ANIMS) {{
  const h = document.createElement('h2');
  h.textContent = `${{a.action}} · ${{a.frames}}帧 @ ${{a.fps}}fps`;
  root.appendChild(h);
  const row = document.createElement('div'); row.className = 'row';
  for (const bg of ['game', 'checker', 'dark']) {{
    const cell = document.createElement('div'); cell.className = 'cell';
    const stage = document.createElement('div'); stage.className = 'stage ' + bg;
    const img = document.createElement('img'); img.className = 'sprite';
    stage.appendChild(img); cell.appendChild(stage);
    const label = document.createElement('div'); label.className = 'label'; label.textContent = bg;
    cell.appendChild(label); row.appendChild(cell);
    let i = 0;
    setInterval(() => {{ img.src = `${{a.dir}}/${{a.action}}_${{i}}.png`; i = (i + 1) % a.frames; }}, 1000 / a.fps);
  }}
  root.appendChild(row);
}}
</script></body></html>
"""


def write_preview(out_root: Path, entries: list[dict]) -> Path:
    bg = REPO / "assets" / "resources" / "art" / "bg" / "main.png"
    rel_bg = Path(bg).resolve()
    try:
        depth = len(out_root.resolve().relative_to(REPO).parts)
        rel = "../" * depth + "assets/resources/art/bg/main.png"
    except ValueError:
        rel = rel_bg.as_uri()
    page = out_root / "preview.html"
    page.write_text(PREVIEW_TEMPLATE.format(bg=rel, anims=json.dumps(entries, ensure_ascii=False)), encoding="utf-8")
    return page


def main():
    args = parse_args()
    if not args.clips.is_dir():
        sys.exit(f"ERROR: clips 目录不存在: {args.clips}")
    videos = sorted(p for p in args.clips.iterdir() if p.suffix.lower() in {".mp4", ".mov", ".webm"})
    if args.action:
        videos = [v for v in videos if v.stem == args.action]
    if not videos:
        sys.exit("ERROR: 没有找到要处理的视频")

    character = args.clips.parent.name.removesuffix("-video")
    out_root = args.out or (REPO / "temp" / "sprite-keyframes" / "pipeline" / character)
    entries = [e for v in videos if (e := process_clip(v, out_root, args))]
    if not entries:
        sys.exit("ERROR: 全部动作处理失败")
    page = write_preview(out_root, entries)
    print(f"[pipeline] 完成 {len(entries)}/{len(videos)} 个动作，预览页: {page}")


main()
