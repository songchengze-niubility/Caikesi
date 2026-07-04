#!/usr/bin/env python3
"""Local web UI for tools/sprite-keyframe-tool.py."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import secrets
import shutil
import statistics
import subprocess
import sys
import webbrowser
from datetime import datetime
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "sprite-keyframe-tool.py"
HTML = ROOT / "tools" / "sprite-keyframe-ui.html"
OUT_ROOT = ROOT / "output" / "sprite-keyframes" / "ui"
PREVIEW_ROOT = ROOT / "temp" / "sprite-keyframes" / "ui-preview"
RESOURCES_ROOT = ROOT / "assets" / "resources"
MANIFEST_PATH = ROOT / "assets" / "scripts" / "art" / "ArtManifest.ts"
ALPHA_BBOX_THRESHOLD = 8


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local sprite keyframe web UI.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open the UI in the default browser.")
    return parser.parse_args()


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def safe_slug(text: str, fallback: str = "sprite-job") -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", text.strip()).strip(".-_")
    return slug[:48] or fallback


def safe_job_id(text: str) -> str:
    job_id = re.sub(r"[^a-zA-Z0-9._-]+", "-", text.strip()).strip(".-_")
    return job_id[:128]


def safe_filename(text: str, fallback: str) -> str:
    filename = re.sub(r"[^a-zA-Z0-9._-]+", "_", text.strip()).strip("._")
    return filename[:96] or fallback


def inside(base: Path, target: Path) -> bool:
    base_resolved = base.resolve()
    target_resolved = target.resolve()
    return target_resolved == base_resolved or base_resolved in target_resolved.parents


def served_url(base: Path, prefix: str, path: Path) -> str:
    relative = path.resolve().relative_to(base.resolve()).as_posix()
    return prefix + quote(relative)


def job_dir(job_id: str) -> Path | None:
    preview_dir = PREVIEW_ROOT / job_id
    output_dir = OUT_ROOT / job_id
    if inside(PREVIEW_ROOT, preview_dir) and preview_dir.exists():
        return preview_dir
    if inside(OUT_ROOT, output_dir) and output_dir.exists():
        return output_dir
    return None


def job_file_url(path: Path) -> str:
    if inside(PREVIEW_ROOT, path):
        return served_url(PREVIEW_ROOT, "/previews/", path)
    if inside(OUT_ROOT, path):
        return served_url(OUT_ROOT, "/outputs/", path)
    raise ValueError(f"文件不在可预览目录中：{path}")


def open_folder(path: Path) -> None:
    if sys.platform.startswith("win"):
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def form_value(fields: dict[str, str], name: str, default: str) -> str:
    value = fields.get(name, "").strip()
    return value if value else default


def safe_asset_part(text: str, fallback: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_-]+", "_", text.strip()).strip("_-")
    return value[:64] or fallback


def normalize_art_key(text: str) -> str:
    key = text.strip().replace("\\", "/").strip("/")
    if key.startswith("resources/"):
        key = key[len("resources/") :]
    if key.startswith("art/"):
        key = key[len("art/") :]
    if not key:
        raise ValueError("资源键不能为空。")
    if ".." in key.split("/"):
        raise ValueError("资源键不能包含 ..。")
    if not re.fullmatch(r"[a-zA-Z0-9_./-]+", key):
        raise ValueError("资源键只能包含英文、数字、下划线、短横线、点和斜杠。")
    return key


def bool_value(value: object) -> bool:
    return str(value).lower() in {"1", "true", "yes", "on"}


def ts_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def upsert_manifest_entry(key: str, entry: str) -> None:
    text = MANIFEST_PATH.read_text(encoding="utf-8")
    key_literal = re.escape(ts_string(key))
    pattern = re.compile(rf"^    {key_literal}:\s*\{{.*?\}},\r?$", re.MULTILINE)
    line = f"    {ts_string(key)}: {entry},"
    if pattern.search(text):
        text = pattern.sub(line, text)
    else:
        marker = "\n};"
        if marker not in text:
            raise ValueError("无法定位 ArtManifest 结尾。")
        text = text.replace(marker, "\n" + line + marker, 1)
    MANIFEST_PATH.write_text(text, encoding="utf-8", newline="")


def alpha_bbox(path: Path, threshold: int = ALPHA_BBOX_THRESHOLD) -> tuple[int, int, int, int] | None:
    with Image.open(path) as image:
        alpha = image.convert("RGBA").getchannel("A")
        mask = alpha.point(lambda value: 255 if value > threshold else 0)
        box = mask.getbbox()
    if box is None:
        return None
    left, top, right, bottom = box
    return left, top, right - left, bottom - top


def shared_alpha_bbox(paths: list[Path], threshold: int = ALPHA_BBOX_THRESHOLD) -> tuple[int, int, int, int]:
    min_x: int | None = None
    min_y: int | None = None
    max_x: int | None = None
    max_y: int | None = None
    fallback_size: tuple[int, int] | None = None
    for path in paths:
        with Image.open(path) as image:
            fallback_size = image.size
        box = alpha_bbox(path, threshold)
        if box is None:
            continue
        x, y, w, h = box
        right = x + w
        bottom = y + h
        min_x = x if min_x is None else min(min_x, x)
        min_y = y if min_y is None else min(min_y, y)
        max_x = right if max_x is None else max(max_x, right)
        max_y = bottom if max_y is None else max(max_y, bottom)
    if min_x is None or min_y is None or max_x is None or max_y is None:
        width, height = fallback_size or (1, 1)
        return 0, 0, width, height
    return min_x, min_y, max_x - min_x, max_y - min_y


def crop_sequence_to_shared_bbox(sources: list[Path], targets: list[Path]) -> dict[str, int]:
    if len(sources) != len(targets):
        raise ValueError("source/target frame count mismatch.")
    x, y, width, height = shared_alpha_bbox(sources)
    for source, target in zip(sources, targets):
        with Image.open(source) as image:
            cropped = image.convert("RGBA").crop((x, y, x + width, y + height))
            cropped.save(target)
    return {"x": x, "y": y, "width": width, "height": height}


def clear_pngs(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for path in folder.glob("*.png"):
        path.unlink()


def checkerboard(size: tuple[int, int], block: int = 16) -> Image.Image:
    width, height = size
    base = Image.new("RGBA", size, (238, 238, 238, 255))
    alt = Image.new("RGBA", (block, block), (204, 204, 204, 255))
    for y in range(0, height, block):
        for x in range(0, width, block):
            if ((x // block) + (y // block)) % 2:
                base.alpha_composite(alt, (x, y))
    return base


def make_sequence_strip(paths: list[Path], out_path: Path) -> None:
    if not paths:
        return
    frames = [Image.open(path).convert("RGBA") for path in paths]
    width = sum(frame.width for frame in frames)
    height = max(frame.height for frame in frames)
    strip = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    x = 0
    for frame in frames:
        strip.alpha_composite(frame, (x, height - frame.height))
        x += frame.width
    strip.save(out_path)


def make_sequence_preview(paths: list[Path], out_path: Path, columns: int, color: tuple[int, int, int] | None = None) -> None:
    if not paths:
        return
    columns = max(1, columns)
    frames = [Image.open(path).convert("RGBA") for path in paths]
    cell_w = max(frame.width for frame in frames)
    cell_h = max(frame.height for frame in frames)
    rows = (len(frames) + columns - 1) // columns
    if color is None:
        preview = Image.new("RGBA", (cell_w * columns, cell_h * rows), (255, 255, 255, 255))
    else:
        preview = Image.new("RGBA", (cell_w * columns, cell_h * rows), (*color, 255))
    for index, frame in enumerate(frames):
        x = (index % columns) * cell_w
        y = (index // columns) * cell_h
        cell = checkerboard((cell_w, cell_h)) if color is None else Image.new("RGBA", (cell_w, cell_h), (*color, 255))
        cell.alpha_composite(frame, ((cell_w - frame.width) // 2, cell_h - frame.height))
        preview.alpha_composite(cell, (x, y))
    preview.save(out_path)


def build_game_preview_frames(
    keyframes: list[Path],
    out_dir: Path,
    columns: int,
    target_height: int = 0,
) -> tuple[list[Path], dict[str, int], dict[str, object]]:
    clear_pngs(out_dir)
    targets = [out_dir / f"key_{index:03d}.png" for index in range(len(keyframes))]
    crop = crop_sequence_to_shared_bbox(keyframes, targets)
    scale = 1.0
    if target_height > 0 and crop["height"] > target_height:
        scale = target_height / crop["height"]
        for target in targets:
            with Image.open(target) as image:
                resized = image.convert("RGBA").resize(
                    (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                    Image.Resampling.LANCZOS,
                )
            resized.save(target)
    with Image.open(targets[0]) as image:
        output_size = {"width": image.width, "height": image.height}
    make_sequence_strip(targets, out_dir.parent / "game_keyframes_strip.png")
    make_sequence_preview(targets, out_dir.parent / "game_keyframes_preview.png", columns)
    make_sequence_preview(targets, out_dir.parent / "game_keyframes_preview_dark.png", columns, (42, 48, 50))
    scale_info: dict[str, object] = {
        "targetHeight": target_height,
        "scale": round(scale, 4),
        "outputSize": output_size,
    }
    return targets, crop, scale_info


def sequence_body_metrics(paths: list[Path], threshold: int = ALPHA_BBOX_THRESHOLD) -> dict[str, float] | None:
    """逐帧量身体指标，写进 ArtManifest 供游戏跨动作归一（均相对帧宽高 0-1 归一化）：
    bodyH = alpha bbox 高的中位数 / 帧高；footY = bbox 底边的中位数 / 帧高；
    anchorX = 脚接触行（bbox 底部最多 3 行）alpha 加权质心 X 的中位数 / 帧宽。
    取中位数是为了抗单帧异常（挥武器伸出、拖尾特效）。全透明序列返回 None。"""
    body_hs: list[float] = []
    foot_ys: list[float] = []
    anchor_xs: list[float] = []
    for path in paths:
        with Image.open(path) as image:
            alpha = image.convert("RGBA").getchannel("A")
        width, height = alpha.size
        if width <= 0 or height <= 0:
            continue
        mask = alpha.point(lambda v: 255 if v > threshold else 0)
        box = mask.getbbox()
        if box is None:
            continue
        left, top, right, bottom = box
        body_hs.append((bottom - top) / height)
        foot_ys.append(bottom / height)
        rows_top = max(top, bottom - 3)
        region = alpha.crop((left, rows_top, right, bottom))
        row_w = right - left
        total = 0.0
        weighted = 0.0
        for idx, val in enumerate(region.getdata()):
            if val > threshold:
                total += val
                weighted += val * (left + (idx % row_w) + 0.5)
        if total > 0:
            anchor_xs.append(weighted / total / width)
    if not body_hs:
        return None
    metrics: dict[str, float] = {
        "bodyH": round(statistics.median(body_hs), 4),
        "footY": round(statistics.median(foot_ys), 4),
    }
    if anchor_xs:
        metrics["anchorX"] = round(statistics.median(anchor_xs), 4)
    return metrics


def copy_sequence_frames(sources: list[Path], targets: list[Path]) -> None:
    if len(sources) != len(targets):
        raise ValueError("source/target frame count mismatch.")
    for source, target in zip(sources, targets):
        shutil.copyfile(source, target)


def patch_cocos_sprite_meta(meta_path: Path, width: int, height: int) -> bool:
    if not meta_path.exists():
        return False
    data = json.loads(meta_path.read_text(encoding="utf-8"))
    sprite_meta = None
    for sub_meta in data.get("subMetas", {}).values():
        if sub_meta.get("importer") == "sprite-frame":
            sprite_meta = sub_meta
            break
    if not sprite_meta:
        return False

    user_data = sprite_meta.setdefault("userData", {})
    half_w = width / 2
    half_h = height / 2
    user_data.update(
        {
            "trimThreshold": 1,
            "rotated": False,
            "offsetX": 0,
            "offsetY": 0,
            "trimX": 0,
            "trimY": 0,
            "width": width,
            "height": height,
            "rawWidth": width,
            "rawHeight": height,
            "trimType": "custom",
        }
    )
    user_data["vertices"] = {
        "rawPosition": [-half_w, -half_h, 0, half_w, -half_h, 0, -half_w, half_h, 0, half_w, half_h, 0],
        "indexes": [0, 1, 2, 2, 1, 3],
        "uv": [0, height, width, height, 0, 0, width, 0],
        "nuv": [0, 0, 1, 0, 0, 1, 1, 1],
        "minPos": [-half_w, -half_h, 0],
        "maxPos": [half_w, half_h, 0],
    }
    meta_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return True


def patch_existing_cocos_metas(files: list[Path]) -> int:
    patched = 0
    for path in files:
        with Image.open(path) as image:
            width, height = image.size
        if patch_cocos_sprite_meta(path.with_suffix(path.suffix + ".meta"), width, height):
            patched += 1
    return patched


def existing_art_dirs() -> list[dict[str, str]]:
    root = RESOURCES_ROOT / "art" / "char"
    if not root.exists():
        return []
    items: list[dict[str, str]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_dir():
            continue
        rel = path.relative_to(RESOURCES_ROOT / "art").as_posix()
        parts = rel.split("/")
        if len(parts) < 3:
            continue
        action = parts[-1]
        items.append(
            {
                "artKey": rel,
                "label": rel,
                "prefix": safe_asset_part(action, "frame"),
                "dir": str(path),
            }
        )
    return items


class SpriteUiHandler(BaseHTTPRequestHandler):
    server_version = "SpriteKeyframeUI/1.0"

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        print("[%s] %s" % (self.log_date_time_string(), format % args))

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, status: int, payload: dict) -> None:
        data = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, path: Path, content_type: str | None = None) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        mime = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            self.send_file(HTML, "text/html; charset=utf-8")
            return
        if parsed.path == "/healthz":
            self.send_json(200, {"ok": True})
            return
        if parsed.path == "/api/art-dirs":
            self.send_json(200, {"ok": True, "dirs": existing_art_dirs()})
            return
        if parsed.path.startswith("/outputs/"):
            relative = unquote(parsed.path[len("/outputs/") :])
            target = OUT_ROOT / relative
            if not inside(OUT_ROOT, target):
                self.send_error(403)
                return
            self.send_file(target)
            return
        if parsed.path.startswith("/previews/"):
            relative = unquote(parsed.path[len("/previews/") :])
            target = PREVIEW_ROOT / relative
            if not inside(PREVIEW_ROOT, target):
                self.send_error(403)
                return
            self.send_file(target)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/process":
            self.handle_process()
            return
        if parsed.path == "/api/open-output":
            self.handle_open_output()
            return
        if parsed.path == "/api/export-output":
            self.handle_export_output()
            return
        if parsed.path == "/api/import-art":
            self.handle_import_art()
            return
        if parsed.path == "/api/patch-metas":
            self.handle_patch_metas()
            return
        self.send_error(404)

    def read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length)

    def parse_multipart(self) -> tuple[dict[str, str], dict[str, tuple[str, bytes]]]:
        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("multipart/form-data"):
            raise ValueError("Expected multipart/form-data.")

        body = self.read_body()
        header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
        message = BytesParser(policy=default).parsebytes(header + body)

        fields: dict[str, str] = {}
        files: dict[str, tuple[str, bytes]] = {}
        for part in message.iter_parts():
            disposition = part.get("Content-Disposition", "")
            if "form-data" not in disposition:
                continue
            name = part.get_param("name", header="content-disposition")
            if not name:
                continue
            payload = part.get_payload(decode=True) or b""
            filename = part.get_filename()
            if filename:
                files[name] = (filename, payload)
            else:
                fields[name] = payload.decode("utf-8", errors="replace")
        return fields, files

    def save_upload(self, files: dict[str, tuple[str, bytes]], name: str, folder: Path) -> Path | None:
        item = files.get(name)
        if item is None:
            return None
        original_name, payload = item
        if not original_name or not payload:
            return None
        filename = safe_filename(original_name, f"{name}.bin")
        target = folder / filename
        target.write_bytes(payload)
        return target

    def handle_process(self) -> None:
        try:
            fields, files = self.parse_multipart()
            PREVIEW_ROOT.mkdir(parents=True, exist_ok=True)

            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            job_label = safe_slug(fields.get("job_name", ""), "sprite-job")
            job_id = f"{timestamp}-{job_label}-{secrets.token_hex(3)}"
            out_dir = PREVIEW_ROOT / job_id
            upload_dir = out_dir / "_input"
            upload_dir.mkdir(parents=True, exist_ok=True)

            character = self.save_upload(files, "character", upload_dir)
            video = self.save_upload(files, "video", upload_dir)
            if character is None and video is None:
                self.send_json(400, {"ok": False, "error": "至少选择一张小人图或一个参考视频。"})
                return

            command = [sys.executable, str(TOOL)]
            if character is not None:
                command += ["--character", str(character)]
            if video is not None:
                command += ["--video", str(video)]
            command += ["--out", str(out_dir)]

            option_defaults = {
                "sample_fps": "12",
                "video_start": "0",
                "video_end": "1",
                "video_seconds": "0",
                "diff_threshold": "12",
                "min_gap": "2",
                "max_keyframes": "24",
                "target_keyframes": "0",
                "selection_mode": "diverse",
                "white_threshold": "245",
                "white_softness": "28",
                "chroma_tolerance": "24",
                "alpha_threshold": "28",
                "background_mode": "auto",
                "edge_tolerance": "65",
                "edge_softness": "42",
                "hole_min_area": "120",
                "hole_max_area": "30000",
                "fringe_radius": "2",
                "fringe_strength": "0.85",
                "fringe_brightness": "155",
                "edge_contract": "1",
                "frame_size": "512",
                "padding": "8",
                "anchor_mode": "foot",
                "preview_columns": "6",
            }
            for name, default_value in option_defaults.items():
                command += [f"--{name.replace('_', '-')}", form_value(fields, name, default_value)]

            if fields.get("allow_upscale") == "on":
                command.append("--allow-upscale")
            if fields.get("keep_raw_frames") == "on":
                command.append("--keep-raw-frames")
            if fields.get("anchor_stabilize") != "on":
                command.append("--no-anchor-stabilize")
            if fields.get("scale_stabilize") == "on":
                command.append("--scale-stabilize")
            if fields.get("visual_stabilize") == "on":
                command.append("--visual-stabilize")
            if fields.get("foot_contact_lock") != "on":
                command.append("--no-foot-contact-lock")
            if fields.get("no_decontaminate") == "on":
                command.append("--no-decontaminate")
            if fields.get("hole_cleanup") != "on":
                command.append("--no-hole-cleanup")
            if fields.get("fringe_cleanup") != "on":
                command.append("--no-fringe-cleanup")

            result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            if result.returncode != 0:
                self.send_json(
                    500,
                    {
                        "ok": False,
                        "error": "处理失败。",
                        "stdout": result.stdout,
                        "stderr": result.stderr,
                    },
                )
                return

            manifest_path = out_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
            keyframes = sorted((out_dir / "keyframes").glob("*.png"))
            game_keyframes: list[Path] = []
            game_crop: dict[str, int] | None = None
            if keyframes:
                try:
                    preview_columns = int(form_value(fields, "preview_columns", "6"))
                except ValueError:
                    preview_columns = 6
                try:
                    game_target_height = max(0, int(form_value(fields, "game_target_height", "240")))
                except ValueError:
                    game_target_height = 240
                game_keyframes, game_crop, game_scale = build_game_preview_frames(
                    keyframes, out_dir / "game_keyframes", preview_columns, game_target_height
                )
                manifest["game_import"] = {
                    "cropMode": "shared-alpha-bbox",
                    "crop": game_crop,
                    "targetHeight": game_scale["targetHeight"],
                    "scale": game_scale["scale"],
                    "outputSize": game_scale["outputSize"],
                    "framesDir": str(out_dir / "game_keyframes"),
                    "note": "These frames match the PNGs copied by /api/import-art when available.",
                }
                manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
            files_payload = {
                "manifest": job_file_url(manifest_path) if manifest_path.exists() else None,
                "characterTransparent": job_file_url(out_dir / "character_transparent.png")
                if (out_dir / "character_transparent.png").exists()
                else None,
                "characterFrame": job_file_url(out_dir / "character_frame.png")
                if (out_dir / "character_frame.png").exists()
                else None,
                "strip": job_file_url(out_dir / "keyframes_strip.png") if (out_dir / "keyframes_strip.png").exists() else None,
                "preview": job_file_url(out_dir / "keyframes_preview.png")
                if (out_dir / "keyframes_preview.png").exists()
                else None,
                "rawPreview": job_file_url(out_dir / "raw_frames_preview.png")
                if (out_dir / "raw_frames_preview.png").exists()
                else None,
                "darkPreview": job_file_url(out_dir / "keyframes_preview_dark.png")
                if (out_dir / "keyframes_preview_dark.png").exists()
                else None,
                "gameStrip": job_file_url(out_dir / "game_keyframes_strip.png")
                if (out_dir / "game_keyframes_strip.png").exists()
                else None,
                "gamePreview": job_file_url(out_dir / "game_keyframes_preview.png")
                if (out_dir / "game_keyframes_preview.png").exists()
                else None,
                "gameDarkPreview": job_file_url(out_dir / "game_keyframes_preview_dark.png")
                if (out_dir / "game_keyframes_preview_dark.png").exists()
                else None,
                "keyframes": [job_file_url(path) for path in keyframes],
                "gameKeyframes": [job_file_url(path) for path in game_keyframes],
            }

            self.send_json(
                200,
                {
                    "ok": True,
                    "jobId": job_id,
                    "previewDir": str(out_dir),
                    "outputDir": None,
                    "exported": False,
                    "manifest": manifest,
                    "files": files_payload,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                },
            )
        except Exception as exc:  # noqa: BLE001
            self.send_json(500, {"ok": False, "error": str(exc)})

    def handle_open_output(self) -> None:
        try:
            payload = json.loads(self.read_body().decode("utf-8"))
            job_id = safe_job_id(str(payload.get("jobId", "")))
            if not job_id:
                self.send_json(400, {"ok": False, "error": "缺少 jobId。"})
                return
            folder = OUT_ROOT / job_id
            if not inside(OUT_ROOT, folder) or not folder.exists():
                self.send_json(404, {"ok": False, "error": "输出目录不存在。"})
                return
            open_folder(folder)
            self.send_json(200, {"ok": True})
        except Exception as exc:  # noqa: BLE001
            self.send_json(500, {"ok": False, "error": str(exc)})

    def handle_export_output(self) -> None:
        try:
            payload = json.loads(self.read_body().decode("utf-8"))
            job_id = safe_job_id(str(payload.get("jobId", "")))
            if not job_id:
                self.send_json(400, {"ok": False, "error": "缺少 jobId。"})
                return

            source_dir = job_dir(job_id)
            if source_dir is None:
                self.send_json(404, {"ok": False, "error": "找不到这次预览结果。"})
                return

            OUT_ROOT.mkdir(parents=True, exist_ok=True)
            target_dir = OUT_ROOT / job_id
            if not inside(OUT_ROOT, target_dir):
                self.send_json(403, {"ok": False, "error": "目标输出目录非法。"})
                return
            if source_dir.resolve() == target_dir.resolve():
                self.send_json(200, {"ok": True, "jobId": job_id, "outputDir": str(target_dir)})
                return
            if target_dir.exists():
                shutil.rmtree(target_dir)
            shutil.copytree(source_dir, target_dir)
            self.send_json(
                200,
                {
                    "ok": True,
                    "jobId": job_id,
                    "outputDir": str(target_dir),
                },
            )
        except Exception as exc:  # noqa: BLE001
            self.send_json(500, {"ok": False, "error": str(exc)})

    def handle_import_art(self) -> None:
        try:
            payload = json.loads(self.read_body().decode("utf-8"))
            job_id = safe_job_id(str(payload.get("jobId", "")))
            if not job_id:
                self.send_json(400, {"ok": False, "error": "缺少 jobId。"})
                return

            job_dir_path = job_dir(job_id)
            if job_dir_path is None:
                self.send_json(404, {"ok": False, "error": "找不到这次生成结果。"})
                return

            keyframes_dir = job_dir_path / "keyframes"
            keyframes = sorted(keyframes_dir.glob("*.png"))
            game_keyframes_dir = job_dir_path / "game_keyframes"
            game_keyframes = sorted(game_keyframes_dir.glob("*.png"))
            source_frames = game_keyframes if game_keyframes and len(game_keyframes) == len(keyframes) else keyframes
            source_mode = "game-preview" if source_frames == game_keyframes else "keyframes"
            if not source_frames:
                self.send_json(400, {"ok": False, "error": "这次生成结果里没有 keyframes。"})
                return

            art_key = normalize_art_key(str(payload.get("artKey", "")))
            default_prefix = art_key.split("/")[-1] or "frame"
            prefix = safe_asset_part(str(payload.get("prefix", "")), default_prefix)
            fps = int(payload.get("fps", 12))
            if fps <= 0 or fps > 60:
                raise ValueError("fps 需要在 1 到 60 之间。")
            loop = bool_value(payload.get("loop", False))
            pingpong = bool_value(payload.get("pingpong", False))
            blend = float(payload.get("blend", 0) or 0)
            if blend < 0 or blend > 0.9:
                raise ValueError("blend 需要在 0 到 0.9 之间。")
            overwrite = bool_value(payload.get("overwrite", False))
            dry_run = bool_value(payload.get("dryRun", False))

            relative_dir = f"art/{art_key}"
            target_dir = RESOURCES_ROOT / relative_dir
            if not inside(RESOURCES_ROOT, target_dir):
                self.send_json(403, {"ok": False, "error": "目标资源目录非法。"})
                return
            target_dir.mkdir(parents=True, exist_ok=True)

            target_files = [target_dir / f"{prefix}_{index}.png" for index in range(len(source_frames))]
            existing = [path for path in target_files if path.exists()]
            if dry_run:
                self.send_json(
                    200,
                    {
                        "ok": True,
                        "dryRun": True,
                        "artKey": art_key,
                        "dir": str(target_dir),
                        "manifestDir": relative_dir,
                        "prefix": prefix,
                        "frames": len(source_frames),
                        "fps": fps,
                        "loop": loop,
                        "pingpong": pingpong,
                        "blend": blend,
                        "cropMode": "shared-alpha-bbox",
                        "sourceMode": source_mode,
                        "existing": [str(path) for path in existing],
                        "files": [str(path) for path in target_files],
                    },
                )
                return
            if existing and not overwrite:
                self.send_json(
                    409,
                    {
                        "ok": False,
                        "error": "目标目录已有同名帧。勾选覆盖后再导入。",
                        "existing": [str(path) for path in existing[:8]],
                    },
                )
                return

            if overwrite:
                for path in target_dir.glob(f"{prefix}_*.png"):
                    path.unlink()

            if source_mode == "game-preview":
                copy_sequence_frames(source_frames, target_files)
                manifest_path = job_dir_path / "manifest.json"
                manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
                crop = manifest.get("game_import", {}).get("crop")
                if not isinstance(crop, dict):
                    with Image.open(source_frames[0]) as image:
                        width, height = image.size
                    crop = {"x": 0, "y": 0, "width": width, "height": height}
            else:
                crop = crop_sequence_to_shared_bbox(source_frames, target_files)
            patched_metas = patch_existing_cocos_metas(target_files)
            # 帧数变少时清掉没有对应 PNG 的孤儿 .meta（帧按路径加载不依赖 uuid，删除安全）
            orphan_metas = 0
            for meta in target_dir.glob(f"{prefix}_*.png.meta"):
                if not meta.with_suffix("").exists():
                    meta.unlink()
                    orphan_metas += 1

            # 身体基准指标：游戏侧据此跨动作归一（身体缩放/脚点对齐），详见 ArtManifest 注释
            metrics = sequence_body_metrics(target_files)
            metrics_ts = ""
            if metrics:
                parts = [f"bodyH: {metrics['bodyH']:g}"]
                if "anchorX" in metrics:
                    parts.append(f"anchorX: {metrics['anchorX']:g}")
                parts.append(f"footY: {metrics['footY']:g}")
                metrics_ts = ", " + ", ".join(parts)

            entry = (
                f"{{ type: 'frames', dir: {ts_string(relative_dir)}, "
                f"prefix: {ts_string(prefix)}, frames: {len(source_frames)}, fps: {fps}, loop: {str(loop).lower()}"
                f"{', pingpong: true' if pingpong else ''}"
                f"{f', blend: {blend:g}' if blend > 0 else ''}"
                f"{metrics_ts} }}"
            )
            upsert_manifest_entry(art_key, entry)

            self.send_json(
                200,
                {
                    "ok": True,
                    "artKey": art_key,
                    "dir": str(target_dir),
                    "manifestDir": relative_dir,
                    "prefix": prefix,
                    "frames": len(source_frames),
                    "fps": fps,
                    "loop": loop,
                    "pingpong": pingpong,
                    "blend": blend,
                    "cropMode": "shared-alpha-bbox",
                    "sourceMode": source_mode,
                    "crop": crop,
                    "patchedMetas": patched_metas,
                    "orphanMetasRemoved": orphan_metas,
                    "bodyMetrics": metrics,
                    "files": [str(path) for path in target_files],
                },
            )
        except Exception as exc:  # noqa: BLE001
            self.send_json(500, {"ok": False, "error": str(exc)})

    def handle_patch_metas(self) -> None:
        # 独立修补入口：把指定资源目录下全部帧的 sprite-frame .meta 改成全帧 custom。
        # 用途：新目录首次经 Cocos 编辑器导入后（默认 trimType=auto，SizeMode.CUSTOM 下会拉伸），
        # 不必重新覆盖导入，直接对目录跑一遍修补；配合 `npm run check:art` 的 meta 校验使用。
        try:
            payload = json.loads(self.read_body().decode("utf-8"))
            art_key = normalize_art_key(str(payload.get("artKey", "")))
            if not art_key:
                self.send_json(400, {"ok": False, "error": "缺少 artKey。"})
                return
            target_dir = RESOURCES_ROOT / f"art/{art_key}"
            if not inside(RESOURCES_ROOT, target_dir) or not target_dir.is_dir():
                self.send_json(404, {"ok": False, "error": f"资源目录不存在：art/{art_key}"})
                return
            pngs = sorted(target_dir.glob("*.png"))
            if not pngs:
                self.send_json(400, {"ok": False, "error": "目录里没有 PNG 帧。"})
                return
            patched = patch_existing_cocos_metas(pngs)
            missing = sum(1 for path in pngs if not path.with_suffix(path.suffix + ".meta").exists())
            self.send_json(
                200,
                {
                    "ok": True,
                    "artKey": art_key,
                    "dir": str(target_dir),
                    "frames": len(pngs),
                    "patchedMetas": patched,
                    "missingMetas": missing,
                    "hint": "missingMetas>0 表示这些帧还没经 Cocos 编辑器导入，导入后再跑一次。" if missing else "",
                },
            )
        except Exception as exc:  # noqa: BLE001
            self.send_json(500, {"ok": False, "error": str(exc)})


def run() -> None:
    args = parse_args()
    PREVIEW_ROOT.mkdir(parents=True, exist_ok=True)

    last_error: OSError | None = None
    for port in range(args.port, args.port + 20):
        try:
            server = ThreadingHTTPServer((args.host, port), SpriteUiHandler)
            break
        except OSError as exc:
            last_error = exc
    else:
        raise SystemExit(f"Could not bind {args.host}:{args.port}-{args.port + 19}: {last_error}")

    url = f"http://{args.host}:{server.server_address[1]}"
    print(f"Sprite keyframe UI: {url}")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping sprite keyframe UI.")


if __name__ == "__main__":
    run()
