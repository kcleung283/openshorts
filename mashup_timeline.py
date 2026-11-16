"""User-defined effect timelines for self-host mashups (reuses edit_builder caps)."""
from __future__ import annotations

import json
import os
import subprocess
from typing import Any

import edit_builder
import punch_in
from ffmpeg_utils import QUALITY, video_encode_args

DEFAULT_BEAT_EFFECT = "zoom_pulse"
DEFAULT_BEAT_SECONDS = 0.55
JOIN_TOLERANCE = 0.35


def effect_catalog() -> list[dict]:
    """UI/API list of allowed effect types and strength limits."""
    out = []
    for name, lim in edit_builder.EFFECT_LIMITS.items():
        out.append({
            "type": name,
            "zoom": bool(lim["zoom"]),
            "max_strength": lim["max_strength"],
            "default_strength": lim["default_strength"],
        })
    return out


def probe_video(path: str) -> dict:
    """Duration, fps, width, height via ffprobe."""
    dur = 0.0
    try:
        raw = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            timeout=60,
        ).decode().strip()
        dur = float(raw)
    except Exception:
        pass
    w, h, fps = 1080, 1920, 30.0
    try:
        res = subprocess.check_output(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height,r_frame_rate",
             "-of", "json", path],
            timeout=60,
        ).decode()
        data = json.loads(res)
        st = (data.get("streams") or [{}])[0]
        w = int(st.get("width") or w)
        h = int(st.get("height") or h)
        r = str(st.get("r_frame_rate") or "30/1")
        if "/" in r:
            num, den = r.split("/", 1)
            fps = float(num) / max(float(den), 1.0)
        else:
            fps = float(r)
    except Exception:
        pass
    return {"duration": dur, "width": w, "height": h, "fps": fps}


def clip_durations(paths: list[str]) -> list[float]:
    return [probe_video(p)["duration"] for p in paths]


def join_timestamps(paths: list[str]) -> list[float]:
    """Seconds where stitched clips meet (excluding t=0)."""
    if len(paths) < 2:
        return []
    acc = 0.0
    joins = []
    for i, p in enumerate(paths):
        d = probe_video(p)["duration"]
        if i > 0:
            joins.append(round(acc, 3))
        acc += d
    return joins


def beats_from_audio(
    audio_path: str,
    *,
    duration: float | None = None,
    effect_type: str = DEFAULT_BEAT_EFFECT,
    strength: float | None = None,
    effect_seconds: float = DEFAULT_BEAT_SECONDS,
    max_beats: int | None = None,
) -> list[dict]:
    """Turn audio emphasis peaks into editable timeline rows (suggestions only)."""
    lim = edit_builder.EFFECT_LIMITS.get(effect_type)
    if not lim:
        effect_type = DEFAULT_BEAT_EFFECT
        lim = edit_builder.EFFECT_LIMITS[effect_type]
    dur = duration if duration and duration > 0 else probe_video(audio_path)["duration"]
    if dur <= 0:
        dur = 600.0
    times = punch_in.emphasis_times(audio_path, dur)
    if max_beats is not None and max_beats > 0:
        times = times[:max_beats]
    st = strength if strength and strength > 0 else lim["default_strength"]
    st = min(st, lim["max_strength"])
    span = max(edit_builder.MIN_EFFECT_SECONDS, min(effect_seconds, edit_builder.MAX_ZOOM_SECONDS))
    rows = []
    for t in times:
        rows.append({
            "type": effect_type,
            "start": round(float(t), 3),
            "end": round(float(t) + span, 3),
            "strength": st,
            "source": "beat",
        })
    return rows


def merge_timeline(
    user: list[dict] | None,
    extras: list[dict] | None,
    duration: float,
) -> list[dict]:
    """Combine user picks with suggestions; user rows win on overlap."""
    base = list(user or [])
    normalized = edit_builder.normalize_edits(base, duration, has_captions=False)
    taken = [(e["start"], e["end"]) for e in normalized]
    for row in extras or []:
        if not isinstance(row, dict):
            continue
        try:
            start = float(row.get("start", 0))
            end = float(row.get("end", start + DEFAULT_BEAT_SECONDS))
        except (TypeError, ValueError):
            continue
        overlap = any(not (end <= s or start >= e) for s, e in taken)
        if overlap:
            continue
        merged = edit_builder.normalize_edits([row], duration, has_captions=False)
        if not merged:
            continue
        normalized.extend(merged)
        taken.append((merged[0]["start"], merged[0]["end"]))
    normalized.sort(key=lambda e: (e["start"], e["end"]))
    return normalized[: edit_builder.MAX_EDITS]


def timeline_at_joins(
    paths: list[str],
    *,
    effect_type: str = "zoom_pulse",
    strength: float | None = None,
    effect_seconds: float = 0.5,
) -> list[dict]:
    lim = edit_builder.EFFECT_LIMITS.get(effect_type) or edit_builder.EFFECT_LIMITS[DEFAULT_BEAT_EFFECT]
    st = strength if strength and strength > 0 else lim["default_strength"]
    st = min(st, lim["max_strength"])
    span = max(edit_builder.MIN_EFFECT_SECONDS, effect_seconds)
    rows = []
    for t in join_timestamps(paths):
        rows.append({
            "type": effect_type,
            "start": t,
            "end": round(t + span, 3),
            "strength": st,
            "source": "join",
        })
    return rows


def apply_timeline(
    input_path: str,
    output_path: str,
    timeline: list[dict],
    *,
    has_captions: bool = False,
) -> dict[str, Any]:
    """Re-encode with edit_builder filters when timeline is non-empty."""
    meta = probe_video(input_path)
    duration = meta["duration"]
    applied = edit_builder.normalize_edits(timeline, duration, has_captions=has_captions)
    if not applied:
        if os.path.abspath(input_path) != os.path.abspath(output_path):
            subprocess.run(
                ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                 "-i", input_path, "-c", "copy", output_path],
                check=True, timeout=3600,
            )
        return {"applied": [], "skipped": True}

    vf, cleaned = edit_builder.build_filter_string(
        applied, duration, meta["fps"], meta["width"], meta["height"],
        has_captions=has_captions,
    )
    if not vf:
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
             "-i", input_path, "-c", "copy", output_path],
            check=True, timeout=3600,
        )
        return {"applied": [], "skipped": True}

    if "setsar=" not in vf:
        vf = f"{vf},setsar=1"

    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-i", input_path, "-vf", vf, *video_encode_args(QUALITY),
         "-c:a", "copy", "-movflags", "+faststart", output_path],
        check=True, timeout=3600,
    )
    return {"applied": cleaned, "skipped": False, "filter": vf}