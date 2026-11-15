"""Self-host helpers: honour YouTube ?t= links and dashboard ranges without billing."""
from __future__ import annotations

import os
import re
from urllib.parse import parse_qs, urlparse

# Default stretch after ?t= when no end is given (minutes).
_DEFAULT_SEGMENT_MINUTES = 35.0


def _parse_yt_time_token(raw: str) -> float | None:
    """Parse YouTube ``t`` values: ``10589``, ``10589s``, ``1h2m3s``, ``2m30``."""
    tok = str(raw or "").strip().lower()
    if not tok:
        return None
    if tok.isdigit():
        return float(tok)
    if tok.endswith("s") and tok[:-1].isdigit():
        return float(tok[:-1])
    h = m = s = 0
    for part in re.finditer(r"(\d+)([hms])", tok):
        n, u = int(part.group(1)), part.group(2)
        if u == "h":
            h = n
        elif u == "m":
            m = n
        else:
            s = n
    if h or m or s:
        return float(h * 3600 + m * 60 + s)
    return None


def youtube_start_seconds(url: str) -> float | None:
    """Start offset embedded in a YouTube URL (?t= / &t= / #t=), or None."""
    if not url:
        return None
    parsed = urlparse(url)
    for key in ("t", "start"):
        vals = parse_qs(parsed.query).get(key)
        if vals:
            off = _parse_yt_time_token(vals[0])
            if off is not None:
                return max(0.0, off)
    frag = (parsed.fragment or "").strip()
    if frag.startswith("t="):
        off = _parse_yt_time_token(frag[2:])
        if off is not None:
            return max(0.0, off)
    return None


def _segment_minutes() -> float:
    raw = (os.environ.get("SELF_HOST_SEGMENT_MINUTES") or "").strip()
    if not raw:
        return _DEFAULT_SEGMENT_MINUTES
    try:
        return max(1.0, float(raw))
    except ValueError:
        return _DEFAULT_SEGMENT_MINUTES


def plan_self_host_partial(url, source_range, min_range_seconds: float) -> dict | None:
    """Return a ``partial`` dict for ``_apply_source_cut``, or None.

    ``source_range`` is ``(start_s, end_s)`` from the request, or None."""
    if source_range:
        start_raw, end_raw = source_range
        if start_raw not in (None, "") or end_raw not in (None, ""):
            try:
                start = float(start_raw or 0)
                seg = _segment_minutes()
                end = float(end_raw) if end_raw not in (None, "") else start + seg * 60.0
            except (TypeError, ValueError):
                return None
            start = max(0.0, start)
            if end <= start or end - start < min_range_seconds:
                return None
            minutes = (end - start) / 60.0
            return {
                "processed_minutes": minutes,
                "total_minutes": minutes,
                "start_seconds": round(start, 3),
                "end_seconds": round(end, 3),
                "chosen": True,
            }
    if url:
        start = youtube_start_seconds(url)
        if start is not None:
            seg = _segment_minutes()
            end = start + seg * 60.0
            return {
                "processed_minutes": seg,
                "total_minutes": seg,
                "start_seconds": round(start, 3),
                "end_seconds": round(end, 3),
                "chosen": True,
            }
    return None