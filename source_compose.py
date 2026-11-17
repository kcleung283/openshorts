"""Download and merge multiple source URLs into one job video.

Supports several video URLs (concatenated in order), optional music via URL or
local file (mp3, mp4 with audio, etc.), and muting the original video audio
before mux. Used by main.py when ``--compose-spec`` is set.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Callable, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

MAX_VIDEO_URLS = 12

_COMBINED_BASENAME = "combined_source.mp4"


def parse_video_url_list(raw) -> List[str]:
    """Normalize dashboard/API input into a de-duplicated URL list."""
    if raw is None:
        return []
    if isinstance(raw, list):
        items = raw
    else:
        text = str(raw).strip()
        if not text:
            return []
        if text.startswith("["):
            try:
                parsed = json.loads(text)
                items = parsed if isinstance(parsed, list) else [text]
            except json.JSONDecodeError:
                items = [text]
        else:
            items = []
            for line in text.replace(",", "\n").splitlines():
                line = line.strip()
                if line:
                    items.append(line)
    out: List[str] = []
    seen = set()
    for u in items:
        u = str(u).strip()
        if not u or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out[:MAX_VIDEO_URLS]


def combined_source_path(output_dir: str) -> str:
    return os.path.join(output_dir, _COMBINED_BASENAME)


def load_compose_spec(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        spec = json.load(f)
    if not isinstance(spec, dict):
        raise ValueError("compose spec must be a JSON object")
    return spec


def _run_ffmpeg(args: List[str]) -> None:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", *args]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed ({result.returncode}): {(result.stderr or result.stdout or '')[:400]}")


def _abs(path: str) -> str:
    return os.path.abspath(os.path.normpath(path))


def _record_compose_part(output_dir: str, *, index: int, title: str, part_path: str, stage: str) -> None:
    """Dashboard can poll Live Analysis previews while compose downloads."""
    prog = os.path.join(output_dir, ".compose_progress.json")
    parts: List[dict] = []
    if os.path.isfile(prog):
        try:
            with open(prog, encoding="utf-8") as f:
                parts = list((json.load(f) or {}).get("parts") or [])
        except (json.JSONDecodeError, OSError):
            parts = []
    parts = [p for p in parts if p.get("index") != index]
    parts.append({
        "index": index,
        "title": title,
        "stage": stage,
        "file": os.path.basename(_abs(part_path)),
    })
    parts.sort(key=lambda p: int(p.get("index") or 0))
    with open(prog, "w", encoding="utf-8") as f:
        json.dump({"parts": parts}, f)


def _strip_audio(path: str, output_dir: str, index: int) -> str:
    src = _abs(path)
    if not os.path.isfile(src):
        raise RuntimeError(f"Cannot mute missing compose part: {src}")
    out = _abs(os.path.join(output_dir, f".compose_part_{index}_muted.mp4"))
    _run_ffmpeg(["-y", "-i", src, "-an", "-c:v", "copy", out])
    return out


def _probe_video_size(path: str) -> Tuple[int, int]:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", _abs(path)],
            capture_output=True, text=True, timeout=30, check=False,
        )
        w, h = (out.stdout or "").strip().split(",", 1)
        return max(1, int(w)), max(1, int(h))
    except (ValueError, subprocess.SubprocessError):
        return 1920, 1080


def _compose_canvas(spec: dict, paths: Sequence[str]) -> Tuple[int, int]:
    """One letterboxed frame size for every segment before concat."""
    fmt = (spec.get("output_format") or "auto").strip().lower()
    if fmt == "vertical":
        return 1080, 1920
    if fmt == "square":
        return 1080, 1080
    if fmt == "horizontal":
        return 1920, 1080
    if paths:
        ws, hs = zip(*(_probe_video_size(p) for p in paths))
        mw, mh = max(ws), max(hs)
        if mh > mw:
            return min(mw, 1080), min(mh, 1920)
        return min(mw, 1920), min(mh, 1080)
    return 1920, 1080


def _sizes_uniform(paths: Sequence[str]) -> bool:
    sizes = {_probe_video_size(p) for p in paths}
    return len(sizes) <= 1


def _normalize_part_video(path: str, output_dir: str, index: int, width: int, height: int) -> str:
    """Scale/pad to a shared canvas so concat does not distort mixed aspect ratios."""
    src = _abs(path)
    out = _abs(os.path.join(output_dir, f".compose_part_{index}_norm.mp4"))
    w, h = _probe_video_size(src)
    if w == width and h == height:
        return src
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
    )
    _run_ffmpeg([
        "-y", "-i", src, "-vf", vf,
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out,
    ])
    return out


def _concat_videos(paths: Sequence[str], output_dir: str) -> str:
    if len(paths) == 1:
        return _abs(paths[0])
    list_path = _abs(os.path.join(output_dir, ".compose_concat.txt"))
    with open(list_path, "w", encoding="utf-8") as f:
        for p in paths:
            # Absolute paths: concat demuxer resolves relatives to the list
            # file's directory, which doubled output/job/... when paths carried
            # the job folder prefix.
            ap = _abs(p)
            if not os.path.isfile(ap):
                raise RuntimeError(f"Missing compose segment for concat: {ap}")
            safe = ap.replace("'", "'\\''")
            f.write(f"file '{safe}'\n")
    out = _abs(os.path.join(output_dir, ".compose_concat.mp4"))
    _run_ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list_path, "-c", "copy", out])
    return out


def _normalize_audio_file(path: str, output_dir: str) -> str:
    """Turn a local mp3/m4a/wav or video (mp4/mov) into AAC for muxing (-vn)."""
    out = os.path.join(output_dir, ".compose_music_normalized.m4a")
    _run_ffmpeg(["-y", "-i", path, "-vn", "-c:a", "aac", "-b:a", "192k", out])
    return out


def _resolve_music_track(spec: dict, output_dir: str) -> Optional[str]:
    music_path = (spec.get("music_path") or "").strip()
    music_url = (spec.get("music_url") or "").strip()
    if music_path and os.path.isfile(music_path):
        return _normalize_audio_file(music_path, output_dir)
    if music_url:
        return _download_audio_track(music_url, output_dir)
    return None


def _download_audio_track(url: str, output_dir: str) -> str:
    import yt_dlp

    import ssrf_guard

    out_tpl = os.path.join(output_dir, ".compose_music.%(ext)s")
    opts = {
        "outtmpl": out_tpl,
        "format": "bestaudio/best",
        "overwrites": True,
        "quiet": True,
        "noplaylist": True,
    }
    with ssrf_guard.guarded():
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            path = ydl.prepare_filename(info)
    if not path or not os.path.isfile(path):
        raise RuntimeError(f"Could not download music URL: {url[:120]}")
    normalized = os.path.join(output_dir, ".compose_music.m4a")
    _run_ffmpeg(["-y", "-i", path, "-vn", "-c:a", "aac", "-b:a", "192k", normalized])
    return normalized


def _mux_video_audio(video_path: str, audio_path: str, out_path: str) -> None:
    _run_ffmpeg([
        "-y", "-i", video_path, "-i", audio_path,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", out_path,
    ])


def build_combined_source(
    spec: dict,
    output_dir: str,
    download_fn: Callable[..., Tuple[str, str]],
    *,
    allow_paid: bool = True,
    on_audio=None,
) -> Tuple[str, str]:
    """Return ``(combined_path, title_slug)``."""
    output_dir = _abs(output_dir)
    os.makedirs(output_dir, exist_ok=True)
    video_urls = parse_video_url_list(spec.get("video_urls") or [])
    local_paths = [
        p for p in (spec.get("local_video_paths") or []) if p and os.path.isfile(p)]
    music_url = (spec.get("music_url") or "").strip() or None
    music_path = (spec.get("music_path") or "").strip() or None
    mute_video = bool(spec.get("mute_video"))
    has_music = bool(music_url or (music_path and os.path.isfile(music_path)))

    if not video_urls and not local_paths:
        raise ValueError("compose spec needs at least one video URL or local file")

    if (len(video_urls) == 1 and not local_paths and not has_music and not mute_video):
        path, title = download_fn(
            video_urls[0], output_dir, on_audio=on_audio, allow_paid=allow_paid)
        return path, title

    if (len(local_paths) == 1 and not video_urls and not has_music and not mute_video):
        return local_paths[0], os.path.splitext(os.path.basename(local_paths[0]))[0]

    part_paths: List[str] = []
    titles: List[str] = []
    idx = 0
    for raw in local_paths:
        path = raw
        titles.append(os.path.splitext(os.path.basename(raw))[0])
        if mute_video:
            path = _strip_audio(path, output_dir, idx)
        path = _abs(path)
        _record_compose_part(output_dir, index=idx, title=titles[-1], part_path=path,
                            stage="muted" if mute_video else "video")
        part_paths.append(path)
        idx += 1

    first_url = idx == 0
    for url in video_urls:
        cb = on_audio if (first_url and not mute_video) else None
        path, title = download_fn(url, output_dir, on_audio=cb, allow_paid=allow_paid)
        path = _abs(path)
        first_url = False
        titles.append(title)
        if mute_video:
            path = _strip_audio(path, output_dir, idx)
        _record_compose_part(output_dir, index=idx, title=title, part_path=path,
                            stage="muted" if mute_video else "video")
        part_paths.append(path)
        idx += 1

    if len(part_paths) > 1:
        tw, th = _compose_canvas(spec, part_paths)
        reason = "mixed dimensions" if not _sizes_uniform(part_paths) else "shared canvas"
        print(f"📐 Normalizing {len(part_paths)} compose segment(s) to {tw}×{th} ({reason})")
        part_paths = [
            _normalize_part_video(p, output_dir, i, tw, th)
            for i, p in enumerate(part_paths)
        ]
        merged = _concat_videos(part_paths, output_dir)
    else:
        merged = part_paths[0]
    final = combined_source_path(output_dir)

    audio_track = _resolve_music_track(spec, output_dir)
    if audio_track:
        _mux_video_audio(merged, audio_track, final)
        if merged != final and os.path.isfile(merged):
            try:
                os.remove(merged)
            except OSError:
                pass
    elif merged != final:
        shutil.move(merged, final)
    else:
        shutil.copyfile(merged, final)

    slug = " + ".join(titles)[:120] if titles else "combined"
    safe_slug = "".join(c if c.isalnum() or c in " -_" else "_" for c in slug).strip() or "combined"
    n = len(local_paths) + len(video_urls)
    print(f"🎬 Combined {n} source(s) → {os.path.basename(final)}"
          + (f" (music: {'upload' if music_path else urlparse(music_url).netloc})"
             if has_music else "")
          + (" — original audio muted" if mute_video else ""))
    return final, safe_slug