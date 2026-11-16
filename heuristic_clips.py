"""Pick clips on music / sparse-speech sources without Gemini (beats + scenes).

Used when ``get_visual_clips`` cannot run (no API key or blocked region). Anchors
on audio energy peaks, then scene cuts, then even spacing across the timeline.
"""
from __future__ import annotations

import math
import os

import clip_selection
import punch_in


def _targets(duration: float) -> tuple[int, int, float, float, float]:
    def _env_int(name, default):
        try:
            return max(1, int(os.environ.get(name, "")))
        except ValueError:
            return default

    v_min = _env_int("CLIP_TARGET_MIN", 3)
    v_max = max(v_min, _env_int("CLIP_TARGET_MAX", 15))
    min_secs, max_secs = clip_selection.clip_duration_bounds()
    target_len = min(max_secs, max(min_secs, min(45.0, duration * 0.12)))
    return v_min, v_max, min_secs, max_secs, target_len


def _scene_anchors(video_path: str) -> list[float]:
    import scene_detection

    try:
        scenes, _fps = scene_detection.detect_scenes(video_path)
    except Exception:
        return []
    anchors = []
    for s0, s1 in scenes or []:
        try:
            t0 = float(s0.get_seconds())
            t1 = float(s1.get_seconds())
        except Exception:
            continue
        if t1 - t0 >= 1.5:
            anchors.append(round((t0 + t1) * 0.5, 3))
    return anchors


def _uniform_anchors(duration: float, count: int) -> list[float]:
    count = max(1, count)
    step = duration / (count + 1)
    return [round(step * (i + 1), 3) for i in range(count)]


def _merge_anchors(
    beats: list[float],
    scenes: list[float],
    duration: float,
    *,
    min_gap: float,
    need: int,
) -> list[float]:
    pool = sorted(set(float(x) for x in (beats or []) + (scenes or []) if x >= 0))
    if len(pool) < need:
        pool.extend(_uniform_anchors(duration, need - len(pool)))
    pool.sort()
    chosen: list[float] = []
    for t in pool:
        if any(abs(t - c) < min_gap for c in chosen):
            continue
        chosen.append(t)
        if len(chosen) >= need * 3:
            break
    if len(chosen) < need:
        for t in _uniform_anchors(duration, need):
            if not any(abs(t - c) < min_gap * 0.5 for c in chosen):
                chosen.append(t)
    return sorted(chosen)[: max(need * 2, need)]


def _window(anchor: float, duration: float, target_len: float, min_secs: float, max_secs: float) -> tuple[float, float]:
    length = min(max_secs, max(min_secs, target_len))
    if duration <= length:
        return 0.0, round(duration, 3)
    half = length / 2.0
    start = max(0.0, anchor - half)
    end = min(duration, start + length)
    if end - start < min_secs:
        start = max(0.0, end - min_secs)
    if end - start > max_secs:
        end = start + max_secs
    return round(start, 3), round(end, 3)


def _default_copy(base_title: str, index: int, language: str) -> dict:
    title = f"{base_title} — highlight {index}"[:100]
    hook = "This part hits different 🔥"
    desc = f"Best moment from {base_title}."
    if language and language.lower().startswith("zh"):
        title = f"{base_title} 精華 {index}"[:100]
        hook = "這段太炸了 🔥"
        desc = f"{base_title} 精彩片段。"
    return {
        "video_title_for_youtube_short": title,
        "video_description_for_tiktok": desc,
        "video_description_for_instagram": desc,
        "viral_hook_text": hook,
    }


def _llm_titles(base_title: str, windows: list[tuple[float, float]], language: str) -> list[dict] | None:
    import llm_backend
    from pydantic import BaseModel

    if not llm_backend.active() or not windows:
        return None

    class Line(BaseModel):
        video_title_for_youtube_short: str
        viral_hook_text: str

    class Pack(BaseModel):
        clips: list[Line]

    lines = [f"{i + 1}. {s:.1f}-{e:.1f}s" for i, (s, e) in enumerate(windows)]
    prompt = (
        f"Music/silent video \"{base_title}\". Write short TikTok/Reels copy for "
        f"these {len(windows)} time ranges (energy/visual peaks, no speech). "
        f"Language: {language}.\n" + "\n".join(lines))
    try:
        data, _ = llm_backend.generate_json(prompt, Pack)
        rows = data.get("clips") or []
        if len(rows) != len(windows):
            return None
        return rows
    except Exception:
        return None


def get_heuristic_visual_clips(
    video_path: str,
    duration: float,
    *,
    video_title: str = "Clip",
    language: str = "en",
) -> dict | None:
    """Same shape as ``get_visual_clips`` when picks exist."""
    duration = float(duration or 0)
    if duration <= 0:
        return None

    v_min, v_max, min_secs, max_secs, target_len = _targets(duration)
    beats = punch_in.emphasis_times(video_path, duration)
    scenes = _scene_anchors(video_path)
    min_gap = max(8.0, min_secs * 0.6)
    anchors = _merge_anchors(beats, scenes, duration, min_gap=min_gap, need=v_min)

    windows = []
    scores = []
    for i, anchor in enumerate(anchors):
        start, end = _window(anchor, duration, target_len, min_secs, max_secs)
        if end - start < min_secs - 0.01:
            continue
        beat_bonus = 15 if any(abs(anchor - b) < 0.5 for b in beats) else 0
        scene_bonus = 10 if any(abs(anchor - s) < 1.0 for s in scenes) else 0
        score = 60 + beat_bonus + scene_bonus + min(20, int((end - start) / max_secs * 20))
        windows.append((start, end))
        scores.append(score)

    if not windows:
        start, end = _window(duration * 0.5, duration, target_len, min_secs, max_secs)
        windows = [(start, end)]
        scores = [70]

    shorts = []
    llm_rows = _llm_titles(video_title, windows, language)
    for i, ((start, end), score) in enumerate(zip(windows, scores)):
        meta = (llm_rows[i] if llm_rows else _default_copy(video_title, i + 1, language))
        shorts.append({
            "start": start,
            "end": end,
            "predicted_score": score,
            **meta,
        })

    shorts = clip_selection.dedupe_overlapping(shorts)
    if len(shorts) < v_min and duration >= min_secs:
        used = {(round(s["start"], 1), round(s["end"], 1)) for s in shorts}
        for t in _uniform_anchors(duration, v_min + 2):
            start, end = _window(t, duration, target_len, min_secs, max_secs)
            key = (round(start, 1), round(end, 1))
            if key in used:
                continue
            shorts.append({
                "start": start,
                "end": end,
                "predicted_score": 65,
                **_default_copy(video_title, len(shorts) + 1, language),
            })
            used.add(key)
            if len(shorts) >= v_min:
                break
    shorts = clip_selection.trim_to_best(shorts, v_max)

    if not shorts:
        return None

    print(f"🎵 Heuristic picker: {len(beats)} beat(s), {len(scenes)} scene anchor(s) "
          f"→ {len(shorts)} clip(s) (no Gemini).")
    return {"shorts": shorts, "picker": "heuristic"}