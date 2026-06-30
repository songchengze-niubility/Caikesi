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
import subprocess
import sys
import webbrowser
from datetime import datetime
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "sprite-keyframe-tool.py"
HTML = ROOT / "tools" / "sprite-keyframe-ui.html"
OUT_ROOT = ROOT / "output" / "sprite-keyframes" / "ui"
RESOURCES_ROOT = ROOT / "assets" / "resources"
MANIFEST_PATH = ROOT / "assets" / "scripts" / "art" / "ArtManifest.ts"


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


def safe_filename(text: str, fallback: str) -> str:
    filename = re.sub(r"[^a-zA-Z0-9._-]+", "_", text.strip()).strip("._")
    return filename[:96] or fallback


def inside(base: Path, target: Path) -> bool:
    base_resolved = base.resolve()
    target_resolved = target.resolve()
    return target_resolved == base_resolved or base_resolved in target_resolved.parents


def output_url(path: Path) -> str:
    relative = path.resolve().relative_to(OUT_ROOT.resolve()).as_posix()
    return "/outputs/" + quote(relative)


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


class SpriteUiHandler(BaseHTTPRequestHandler):
    server_version = "SpriteKeyframeUI/1.0"

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        print("[%s] %s" % (self.log_date_time_string(), format % args))

    def send_json(self, status: int, payload: dict) -> None:
        data = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
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
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            self.send_file(HTML, "text/html; charset=utf-8")
            return
        if parsed.path == "/healthz":
            self.send_json(200, {"ok": True})
            return
        if parsed.path.startswith("/outputs/"):
            relative = unquote(parsed.path[len("/outputs/") :])
            target = OUT_ROOT / relative
            if not inside(OUT_ROOT, target):
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
        if parsed.path == "/api/import-art":
            self.handle_import_art()
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
            OUT_ROOT.mkdir(parents=True, exist_ok=True)

            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            job_label = safe_slug(fields.get("job_name", ""), "sprite-job")
            job_id = f"{timestamp}-{job_label}-{secrets.token_hex(3)}"
            out_dir = OUT_ROOT / job_id
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
                "video_seconds": "1",
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
                "frame_size": "512",
                "padding": "8",
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
            files_payload = {
                "manifest": output_url(manifest_path) if manifest_path.exists() else None,
                "characterTransparent": output_url(out_dir / "character_transparent.png")
                if (out_dir / "character_transparent.png").exists()
                else None,
                "characterFrame": output_url(out_dir / "character_frame.png")
                if (out_dir / "character_frame.png").exists()
                else None,
                "strip": output_url(out_dir / "keyframes_strip.png") if (out_dir / "keyframes_strip.png").exists() else None,
                "preview": output_url(out_dir / "keyframes_preview.png")
                if (out_dir / "keyframes_preview.png").exists()
                else None,
                "rawPreview": output_url(out_dir / "raw_frames_preview.png")
                if (out_dir / "raw_frames_preview.png").exists()
                else None,
                "darkPreview": output_url(out_dir / "keyframes_preview_dark.png")
                if (out_dir / "keyframes_preview_dark.png").exists()
                else None,
                "keyframes": [output_url(path) for path in keyframes],
            }

            self.send_json(
                200,
                {
                    "ok": True,
                    "jobId": job_id,
                    "outputDir": str(out_dir),
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
            job_id = safe_slug(str(payload.get("jobId", "")), "")
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

    def handle_import_art(self) -> None:
        try:
            payload = json.loads(self.read_body().decode("utf-8"))
            job_id = safe_slug(str(payload.get("jobId", "")), "")
            if not job_id:
                self.send_json(400, {"ok": False, "error": "缺少 jobId。"})
                return

            job_dir = OUT_ROOT / job_id
            if not inside(OUT_ROOT, job_dir) or not job_dir.exists():
                self.send_json(404, {"ok": False, "error": "找不到这次生成结果。"})
                return

            keyframes_dir = job_dir / "keyframes"
            keyframes = sorted(keyframes_dir.glob("*.png"))
            if not keyframes:
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

            target_files = [target_dir / f"{prefix}_{index}.png" for index in range(len(keyframes))]
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
                        "frames": len(keyframes),
                        "fps": fps,
                        "loop": loop,
                        "pingpong": pingpong,
                        "blend": blend,
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

            for source, target in zip(keyframes, target_files):
                shutil.copy2(source, target)

            entry = (
                f"{{ type: 'frames', dir: {ts_string(relative_dir)}, "
                f"prefix: {ts_string(prefix)}, frames: {len(keyframes)}, fps: {fps}, loop: {str(loop).lower()}"
                f"{', pingpong: true' if pingpong else ''}"
                f"{f', blend: {blend:g}' if blend > 0 else ''} }}"
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
                    "frames": len(keyframes),
                    "fps": fps,
                    "loop": loop,
                    "pingpong": pingpong,
                    "blend": blend,
                    "files": [str(path) for path in target_files],
                },
            )
        except Exception as exc:  # noqa: BLE001
            self.send_json(500, {"ok": False, "error": str(exc)})


def run() -> None:
    args = parse_args()
    OUT_ROOT.mkdir(parents=True, exist_ok=True)

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
