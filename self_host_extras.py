"""Self-host extras: local clip history, scheduled social posts, multi-clip mashups.

Cloud mode uses R2 + Upload-Post billing; when ``BILLING_ENABLED`` is off these
helpers back the dashboard History, Schedule, and Mashup tabs.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from jsonfile import write_json_atomic

import mashup_timeline

_DATA_DIR = os.environ.get("SELF_HOST_DATA_DIR", "data")
_HISTORY_FILE = os.path.join(_DATA_DIR, "local_history.json")
_SCHEDULE_FILE = os.path.join(_DATA_DIR, "post_schedule.json")
_MASHUP_DIR = os.path.join(_DATA_DIR, "mashups")
_READY_DIR = os.path.join(_DATA_DIR, "ready_to_post")
_LOCK = threading.Lock()
_SCHEDULE_TZ = "America/New_York"


def _ensure_dirs() -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    os.makedirs(_MASHUP_DIR, exist_ok=True)


def _load_json(path: str, default: Any) -> Any:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _save_json(path: str, data: Any) -> None:
    _ensure_dirs()
    write_json_atomic(path, data, indent=2)


# --- History -----------------------------------------------------------------

def history_index() -> dict:
    with _LOCK:
        return _load_json(_HISTORY_FILE, {"videos": [], "jobs": {}})


def record_completed_job(job_id: str, output_dir: str, clips: list, *, title: str | None = None) -> None:
    """Append completed clips to the local history table (one row per clip)."""
    if not job_id or not clips:
        return
    _ensure_dirs()
    now = datetime.now(timezone.utc).isoformat()
    with _LOCK:
        store = _load_json(_HISTORY_FILE, {"videos": [], "jobs": {}})
        videos = store.setdefault("videos", [])
        jobs = store.setdefault("jobs", {})
        base = title or f"Job {job_id[:8]}"
        jobs[job_id] = {
            "job_id": job_id,
            "title": base,
            "created_at": now,
            "clip_count": len(clips),
        }
        for i, clip in enumerate(clips):
            fname = clip.get("_server_file") or clip.get("filename")
            if not fname and clip.get("video_url"):
                fname = clip["video_url"].rstrip("/").split("/")[-1]
            if not fname:
                continue
            row_id = f"{job_id}:{i}"
            if any(v.get("id") == row_id for v in videos):
                continue
            videos.append({
                "id": row_id,
                "job_id": job_id,
                "clip_index": i,
                "title": (clip.get("video_title_for_youtube_short")
                          or clip.get("title") or f"Clip {i + 1}"),
                "created_at": now,
                "filename": os.path.basename(str(fname)),
                "view_url": clip.get("video_url") or f"/videos/{job_id}/{os.path.basename(fname)}",
                "download_url": clip.get("video_url") or f"/videos/{job_id}/{os.path.basename(fname)}",
            })
        store["videos"] = sorted(videos, key=lambda v: v.get("created_at") or "", reverse=True)
        _save_json(_HISTORY_FILE, store)


def rebuild_history_from_output(output_dir: str) -> int:
    """Scan ``OUTPUT_DIR`` for finished jobs missing from the index."""
    import glob

    count = 0
    if not os.path.isdir(output_dir):
        return 0
    for job_id in os.listdir(output_dir):
        job_path = os.path.join(output_dir, job_id)
        if not os.path.isdir(job_path) or job_id.startswith("."):
            continue
        metas = glob.glob(os.path.join(job_path, "*_metadata.json"))
        if not metas:
            continue
        try:
            with open(metas[0], encoding="utf-8") as f:
                data = json.load(f)
            shorts = data.get("shorts") or []
            base = os.path.basename(metas[0]).replace("_metadata.json", "")
            clips = []
            for i, _ in enumerate(shorts):
                pattern = os.path.join(job_path, f"{base}_clip_{i + 1}.mp4")
                alt = glob.glob(os.path.join(job_path, f"*clip*{i + 1}*.mp4"))
                found = pattern if os.path.exists(pattern) else (alt[0] if alt else None)
                if not found:
                    continue
                c = dict(shorts[i])
                c["video_url"] = f"/videos/{job_id}/{os.path.basename(found)}"
                c["_server_file"] = os.path.basename(found)
                clips.append(c)
            if clips:
                record_completed_job(job_id, job_path, clips, title=base)
                count += 1
        except Exception:
            continue
    return count


def history_response() -> dict:
    rebuild_history_from_output(os.environ.get("OUTPUT_DIR", "output"))
    return {"videos": history_index().get("videos") or []}


def projects_response() -> dict:
    jobs = history_index().get("jobs") or {}
    items = sorted(jobs.values(), key=lambda j: j.get("created_at") or "", reverse=True)
    return {"projects": items}


# --- Schedule (Upload-Post) --------------------------------------------------

def schedule_settings() -> dict:
    with _LOCK:
        return _load_json(_SCHEDULE_FILE, {
            "enabled": False,
            "interval_hours": 2,
            "timezone": _SCHEDULE_TZ,
            "platforms": ["youtube", "instagram"],
            "posting_backend": _default_posting_backend(),
            "queue": [],
            "last_post_at": None,
        })


def _default_posting_backend() -> str:
    if os.environ.get("UPLOAD_POST_API_KEY", "").strip():
        return "upload_post"
    return os.environ.get("SELF_HOST_POSTING_BACKEND", "manual").strip().lower() or "manual"


def update_schedule_settings(patch: dict) -> dict:
    with _LOCK:
        cur = schedule_settings()
        for k in ("enabled", "interval_hours", "timezone", "platforms", "posting_backend"):
            if k in patch and patch[k] is not None:
                cur[k] = patch[k]
        if "posting_backend" in patch:
            backend = str(patch["posting_backend"]).strip().lower()
            if backend in ("manual", "upload_post"):
                cur["posting_backend"] = backend
        if "interval_hours" in patch:
            try:
                cur["interval_hours"] = max(1, min(24, int(patch["interval_hours"])))
            except (TypeError, ValueError):
                pass
        if "platforms" in patch and isinstance(patch["platforms"], list):
            cur["platforms"] = [p for p in patch["platforms"] if p in ("youtube", "instagram", "tiktok")]
        _save_json(_SCHEDULE_FILE, cur)
        return cur


def enqueue_clip(job_id: str, clip_index: int, *, title: str | None = None) -> dict:
    cur = schedule_settings()
    if not cur.get("enabled"):
        raise ValueError("Schedule is disabled")
    hours = float(cur.get("interval_hours") or 2)
    tz = ZoneInfo(cur.get("timezone") or _SCHEDULE_TZ)
    now_local = datetime.now(tz)
    queue = list(cur.get("queue") or [])
    if queue:
        last = queue[-1].get("post_at_local")
        if last:
            try:
                base = datetime.fromisoformat(last)
                if base.tzinfo is None:
                    base = base.replace(tzinfo=tz)
            except ValueError:
                base = now_local
        else:
            base = now_local
    else:
        last_post = cur.get("last_post_at")
        if last_post:
            try:
                base = datetime.fromisoformat(last_post)
                if base.tzinfo is None:
                    base = base.replace(tzinfo=tz)
            except ValueError:
                base = now_local
        else:
            base = now_local
    next_local = base + timedelta(hours=hours)
    if next_local < now_local:
        next_local = now_local + timedelta(minutes=5)
    item = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "clip_index": int(clip_index),
        "title": title,
        "post_at_local": next_local.isoformat(),
        "post_at_utc": next_local.astimezone(timezone.utc).isoformat(),
        "status": "queued",
    }
    queue.append(item)
    cur["queue"] = queue
    _save_json(_SCHEDULE_FILE, cur)
    return item


def due_schedule_items(now_utc: datetime | None = None) -> list:
    now_utc = now_utc or datetime.now(timezone.utc)
    cur = schedule_settings()
    due = []
    for item in cur.get("queue") or []:
        if item.get("status") != "queued":
            continue
        try:
            when = datetime.fromisoformat(item["post_at_utc"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        if when <= now_utc:
            due.append(item)
    return due


def mark_schedule_item(item_id: str, status: str, *, error: str | None = None) -> None:
    with _LOCK:
        cur = schedule_settings()
        for item in cur.get("queue") or []:
            if item.get("id") == item_id:
                item["status"] = status
                if error:
                    item["error"] = error[:500]
        if status in ("posted", "ready"):
            cur["last_post_at"] = datetime.now(ZoneInfo(cur.get("timezone") or _SCHEDULE_TZ)).isoformat()
        _save_json(_SCHEDULE_FILE, cur)


def export_ready_to_post(
    item: dict,
    video_path: str,
    *,
    title: str,
    description: str,
    platforms: list[str],
) -> dict:
    """Copy clip + manifest for manual upload in YouTube Studio / Instagram."""
    import shutil

    _ensure_dirs()
    os.makedirs(_READY_DIR, exist_ok=True)
    folder = os.path.join(_READY_DIR, item.get("id") or str(uuid.uuid4()))
    os.makedirs(folder, exist_ok=True)
    dest_video = os.path.join(folder, "clip.mp4")
    shutil.copy2(video_path, dest_video)
    manifest = {
        "queue_item_id": item.get("id"),
        "job_id": item.get("job_id"),
        "clip_index": item.get("clip_index"),
        "title": title,
        "description": description,
        "platforms": platforms,
        "post_at_local": item.get("post_at_local"),
        "video_file": dest_video,
        "instructions": (
            "Upload clip.mp4 manually: YouTube → Create → Short; "
            "Instagram → professional account → Reel."
        ),
    }
    write_json_atomic(os.path.join(folder, "manifest.json"), manifest, indent=2)
    return {"folder": folder, "manifest": manifest}


# --- Mashup ------------------------------------------------------------------

_SAFE_ID = re.compile(r"^[a-f0-9\-]{36}$", re.I)


def _mashup_llm_plan(segments: list[dict], music_note: str) -> list[int]:
    """Order segment indices with the local LLM; fallback to input order."""
    import llm_backend
    from pydantic import BaseModel

    if not llm_backend.active() or len(segments) < 2:
        return list(range(len(segments)))

    class OrderModel(BaseModel):
        order: list[int]

    names = [f"{i}: {s.get('label', 'clip')}" for i, s in enumerate(segments)]
    prompt = (
        "Order these clips into one combined hype reel. "
        "Strongest hook first; align cuts where a music kick would land.\n"
        + "\n".join(names)
        + f"\nMusic mood: {music_note or 'energetic'}")
    try:
        data, _ = llm_backend.generate_json(prompt, OrderModel)
        order = data.get("order")
        if isinstance(order, list) and sorted(order) == list(range(len(segments))):
            return [int(x) for x in order]
    except Exception:
        pass
    return list(range(len(segments)))


def run_mashup(
    *,
    sources: list[dict],
    music_url: str | None,
    music_note: str = "",
    output_path: str,
    work_dir: str,
    timeline: list[dict] | None = None,
    auto_beats: bool = False,
    beats_from: str = "music",
    beat_effect: str | None = None,
    beat_strength: float | None = None,
    beat_duration: float | None = None,
    effects_at_joins: bool = False,
    join_effect: str | None = None,
) -> dict:
    """Concatenate job clips; optional music; user-chosen (or suggested) effect timeline."""
    os.makedirs(work_dir, exist_ok=True)
    paths = []
    labels = []
    for src in sources:
        st = src.get("type")
        if st == "job_clip":
            job_id = str(src.get("job_id") or "")
            idx = int(src.get("clip_index", 0))
            if not _SAFE_ID.match(job_id):
                raise ValueError(f"invalid job_id {job_id}")
            root = os.path.join(os.environ.get("OUTPUT_DIR", "output"), job_id)
            hits = [f for f in os.listdir(root) if f.endswith(".mp4") and f"clip_{idx + 1}" in f] if os.path.isdir(root) else []
            if not hits:
                raise FileNotFoundError(f"clip {idx} not found for job {job_id}")
            paths.append(os.path.join(root, hits[0]))
            labels.append(src.get("title") or hits[0])
        else:
            raise ValueError(f"unsupported source type {st}")
    order = _mashup_llm_plan([{"label": lb} for lb in labels], music_note)
    ordered = [paths[i] for i in order]
    list_path = os.path.join(work_dir, "concat.txt")
    with open(list_path, "w", encoding="utf-8") as f:
        for p in ordered:
            f.write(f"file '{p}'\n")
    merged = os.path.join(work_dir, "merged.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "concat", "-safe", "0", "-i", list_path, "-c", "copy", merged],
        check=True, timeout=3600,
    )
    music_local = None
    work_video = merged
    if music_url and music_url.strip():
        music_local = os.path.join(work_dir, "music.mp3")
        import httpx
        with httpx.Client(timeout=120, follow_redirects=True) as client:
            r = client.get(music_url.strip())
            r.raise_for_status()
            with open(music_local, "wb") as mf:
                mf.write(r.content)
        mixed = os.path.join(work_dir, "mixed.mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
             "-i", merged, "-i", music_local,
             "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[a]",
             "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", mixed],
            check=True, timeout=3600,
        )
        work_video = mixed

    wants_effects = bool(timeline) or auto_beats or effects_at_joins
    suggestions: list[dict] = []
    effect_type = beat_effect or mashup_timeline.DEFAULT_BEAT_EFFECT
    dur_span = beat_duration if beat_duration and beat_duration > 0 else mashup_timeline.DEFAULT_BEAT_SECONDS

    if auto_beats:
        beat_src = None
        if music_local and beats_from != "dialogue":
            beat_src = music_local
        elif beats_from == "dialogue" or not music_local:
            beat_src = work_video
        if beat_src and os.path.isfile(beat_src):
            probe = mashup_timeline.probe_video(work_video)
            suggestions.extend(mashup_timeline.beats_from_audio(
                beat_src,
                duration=probe["duration"],
                effect_type=effect_type,
                strength=beat_strength,
                effect_seconds=dur_span,
            ))

    if effects_at_joins:
        join_type = join_effect or effect_type
        suggestions.extend(mashup_timeline.timeline_at_joins(
            ordered, effect_type=join_type, strength=beat_strength, effect_seconds=dur_span,
        ))

    probe = mashup_timeline.probe_video(work_video)
    merged_timeline = mashup_timeline.merge_timeline(timeline, suggestions, probe["duration"])

    if wants_effects:
        effect_meta = mashup_timeline.apply_timeline(
            work_video, output_path, merged_timeline, has_captions=False,
        )
    else:
        if os.path.abspath(work_video) != os.path.abspath(output_path):
            os.replace(work_video, output_path)
        effect_meta = {"applied": [], "skipped": True}

    return {
        "order": order,
        "output": output_path,
        "segments": len(ordered),
        "timeline": merged_timeline,
        "suggestions_count": len(suggestions),
        "effects": effect_meta,
    }