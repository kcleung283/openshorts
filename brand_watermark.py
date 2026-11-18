"""Optional user logo overlay (PNG/JPG/WebP) — separate from billing free-plan wm_."""
from __future__ import annotations

import json
import os
import subprocess
from typing import Literal

from jsonfile import write_json_atomic

import gpu_decode
from ffmpeg_utils import METADATA_SCRUB, QUALITY, video_encode_args

def _data_dir() -> str:
    return os.path.abspath(os.environ.get("SELF_HOST_DATA_DIR", "data"))


def _settings_path() -> str:
    return os.path.join(_data_dir(), "brand_watermark.json")


def _logo_dir() -> str:
    return os.path.join(_data_dir(), "brand")
_ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

Position = Literal["top", "middle", "bottom"]

# overlay y expressions (logo top-left; subtract overlay_h for bottom/middle centering)
_Y_OVERLAY = {
    "top": "main_h*0.08",
    "middle": "(main_h-overlay_h)/2",
    "bottom": "main_h*0.82-overlay_h",
}
DEFAULT_WIDTH_RATIO = 0.22
DEFAULT_OPACITY = 0.92
DEFAULT_MARGIN = 0.05


def default_settings() -> dict:
    return {
        "position": "bottom",
        "opacity": DEFAULT_OPACITY,
        "width_ratio": DEFAULT_WIDTH_RATIO,
        "logo_filename": None,
    }


def load_settings() -> dict:
    try:
        with open(_settings_path(), encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    out = default_settings()
    for k in out:
        if k in data and data[k] is not None:
            out[k] = data[k]
    if out["position"] not in _Y_OVERLAY:
        out["position"] = "bottom"
    try:
        out["opacity"] = min(1.0, max(0.05, float(out["opacity"])))
    except (TypeError, ValueError):
        out["opacity"] = DEFAULT_OPACITY
    try:
        out["width_ratio"] = min(0.5, max(0.08, float(out["width_ratio"])))
    except (TypeError, ValueError):
        out["width_ratio"] = DEFAULT_WIDTH_RATIO
    logo = out.get("logo_filename")
    if logo and os.path.isfile(os.path.join(_logo_dir(), logo)):
        path = os.path.join(_logo_dir(), logo)
        out["logo_path"] = path
        try:
            out["logo_revision"] = int(os.path.getmtime(path) * 1000)
        except OSError:
            out["logo_revision"] = 0
    else:
        out["logo_path"] = None
        out["logo_revision"] = 0
    return out


def save_settings(patch: dict) -> dict:
    os.makedirs(_logo_dir(), exist_ok=True)
    cur = load_settings()
    for k in ("position", "opacity", "width_ratio", "logo_filename"):
        if k in patch:
            cur[k] = patch[k]
    write_json_atomic(_settings_path(), {k: cur[k] for k in default_settings()}, indent=2)
    return load_settings()


def clear_logo() -> dict:
    """Remove the stored logo file and unset logo_filename (fresh project)."""
    logo_dir = _logo_dir()
    if os.path.isdir(logo_dir):
        for name in os.listdir(logo_dir):
            if name.startswith("logo."):
                try:
                    os.remove(os.path.join(logo_dir, name))
                except OSError:
                    pass
    return save_settings({"logo_filename": None})


def _guess_image_ext(filename: str, data: bytes) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext in _ALLOWED_EXT:
        return ext
    head = data[:16]
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if head[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if head[:4] == b"RIFF" and len(data) > 12 and data[8:12] == b"WEBP":
        return ".webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    raise ValueError(f"Unsupported image type (use png, jpg, webp, gif): {ext or 'unknown'}")


def store_logo_upload(filename: str, data: bytes) -> dict:
    if not data:
        raise ValueError("Empty file")
    ext = _guess_image_ext(filename, data)
    logo_dir = _logo_dir()
    try:
        os.makedirs(logo_dir, exist_ok=True)
    except OSError as e:
        raise ValueError(f"Cannot create logo folder: {e}") from e
    safe = f"logo{ext}"
    path = os.path.join(logo_dir, safe)
    try:
        with open(path, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    except OSError as e:
        raise ValueError(f"Cannot write logo file: {e}") from e
    return save_settings({"logo_filename": safe})


def logo_filter(
    vw: int,
    vh: int,
    *,
    position: str = "bottom",
    width_ratio: float = DEFAULT_WIDTH_RATIO,
    opacity: float = DEFAULT_OPACITY,
    video="[0:v]",
    logo="[1:v]",
    out="",
    overlay_x: int | None = None,
    overlay_y: int | None = None,
) -> str:
    wm_w = max(64, int(vw * width_ratio))
    if overlay_x is not None and overlay_y is not None:
        x_expr, y_expr = str(int(overlay_x)), str(int(overlay_y))
    else:
        x_expr = "(main_w-overlay_w)/2"
        y_expr = _Y_OVERLAY.get(position, _Y_OVERLAY["bottom"])
    return (
        f"{logo}scale={wm_w}:-1,format=rgba,"
        f"colorchannelmixer=aa={opacity:.3f}[wm];"
        f"{video}[wm]overlay=x={x_expr}:y={y_expr}{out}"
    )


def logo_size_pixels(logo_path: str, vw: int, width_ratio: float) -> tuple[int, int]:
    wm_w = max(64, int(vw * width_ratio))
    try:
        from PIL import Image
        with Image.open(logo_path) as im:
            ow, oh = im.size
        if ow <= 0:
            return wm_w, wm_w
        wm_h = max(1, int(wm_w * oh / ow))
        return wm_w, wm_h
    except Exception:
        return wm_w, wm_w


def apply_brand_logo(
    video_path: str,
    logo_path: str,
    output_path: str,
    *,
    position: str = "bottom",
    width_ratio: float = DEFAULT_WIDTH_RATIO,
    opacity: float = DEFAULT_OPACITY,
    center_x: float | None = None,
    center_y: float | None = None,
) -> None:
    if not os.path.isfile(logo_path):
        raise FileNotFoundError("Logo file not found")
    probe = subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", video_path],
        timeout=60,
    ).decode().strip().split("x")
    vw, vh = int(probe[0]), int(probe[1])
    overlay_x = overlay_y = None
    if center_x is not None and center_y is not None:
        import overlay_placement
        lw, lh = logo_size_pixels(logo_path, vw, width_ratio)
        overlay_x, overlay_y = overlay_placement.norm_center_to_px(
            float(center_x), float(center_y), lw, lh, vw, vh)
        position = "custom"
    filt = logo_filter(
        vw, vh, position=position, width_ratio=width_ratio, opacity=opacity,
        overlay_x=overlay_x, overlay_y=overlay_y)
    tmp = output_path + ".brand_tmp.mp4"
    cmd = ["ffmpeg", "-y", "-i", video_path, "-i", logo_path,
           "-filter_complex", filt, *video_encode_args(QUALITY),
           "-c:a", "copy", *METADATA_SCRUB, "-movflags", "+faststart", tmp]
    result = gpu_decode.run(
        lambda on_gpu: gpu_decode.on_card(cmd, video_path) if on_gpu else cmd,
        lambda c: subprocess.run(c, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=1800),
        ok=lambda r: r.returncode == 0 and os.path.exists(tmp),
        path=video_path,
    )
    if result.returncode != 0 or not os.path.exists(tmp):
        err = (result.stderr or b"").decode(errors="ignore")[-400:]
        raise RuntimeError(err or "ffmpeg logo overlay failed")
    os.replace(tmp, output_path)