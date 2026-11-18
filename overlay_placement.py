from __future__ import annotations

"""Face-aware placement for hooks and brand logos from a prompt or manual coords.

Supports multiple people: each overlay (hook vs logo) can target a different
face via prompt (left / right / person 2) or an explicit face id.
"""
import os
import re
from typing import Literal

import hook_placement

Mode = Literal["avoid_faces", "above_face", "on_face", "below_face", "track_face"]

MARGIN = 0.02
SAFE_TOP = 0.06
SAFE_BOTTOM = 0.88
TRACK_MERGE_X = 0.12


def mode_from_prompt(prompt: str | None) -> Mode:
    """Map natural language to a placement mode (keyword-based, no LLM)."""
    p = (prompt or "").strip().lower()
    if not p:
        return "above_face"
    if re.search(r"\b(avoid|away from|clear of|off)\b.*\bface", p) or "don't cover" in p:
        return "avoid_faces"
    if re.search(r"\b(on|over|stick on|cover)\b.*\bface", p) or "on their face" in p:
        return "on_face"
    if re.search(r"\b(below|under)\b.*\b(face|chin)", p):
        return "below_face"
    if re.search(r"\b(above|on top|over head|forehead|top of)\b", p):
        return "above_face"
    if re.search(r"\b(track|follow|stick to|attached|stuck on)\b", p):
        return "track_face"
    if "face" in p or "person" in p or "speaker" in p:
        return "above_face"
    return "above_face"


def _face_area(box: tuple[float, float, float, float]) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _label_for_index(index: int, total: int) -> str:
    if total <= 1:
        return "person 1"
    if total == 2:
        return "left" if index == 0 else "right"
    if index == 0:
        return "left"
    if index == total - 1:
        return "right"
    return f"person {index + 1}"


def _norm_box(x0: float, y0: float, x1: float, y1: float) -> tuple[float, float, float, float]:
    x0, x1 = sorted((max(0.0, min(1.0, float(x0))), max(0.0, min(1.0, float(x1)))))
    y0, y1 = sorted((max(0.0, min(1.0, float(y0))), max(0.0, min(1.0, float(y1)))))
    if x1 - x0 < 0.04:
        x1 = min(1.0, x0 + 0.04)
    if y1 - y0 < 0.04:
        y1 = min(1.0, y0 + 0.04)
    return x0, y0, x1, y1


def _face_from_box(face_id: int, label: str, box: tuple[float, float, float, float], **extra) -> dict:
    x0, y0, x1, y1 = box
    return {
        "id": face_id,
        "label": label,
        "x0": round(x0, 4),
        "y0": round(y0, 4),
        "x1": round(x1, 4),
        "y1": round(y1, 4),
        "center_x": round((x0 + x1) / 2, 4),
        "center_y": round((y0 + y1) / 2, 4),
        "area": round(_face_area(box), 4),
        **extra,
    }


def merge_face_overrides(people: list[dict], overrides: list[dict] | None) -> list[dict]:
    """Apply user-dragged focus brackets onto detected faces (by id)."""
    if not overrides:
        return people
    by_id = {}
    for o in overrides:
        try:
            fid = int(o["id"])
        except (KeyError, TypeError, ValueError):
            continue
        by_id[fid] = _norm_box(o["x0"], o["y0"], o["x1"], o["y1"])
    if not by_id:
        return people
    out = []
    for f in people:
        if f["id"] not in by_id:
            out.append(f)
            continue
        box = by_id[f["id"]]
        out.append(_face_from_box(
            f["id"], f.get("label") or f"person {f['id'] + 1}", box,
            detections=f.get("detections", 0)))
    return out


def list_faces(frames) -> list[dict]:
    """Cluster detections across sampled frames; sort left-to-right."""
    tracks: list[dict] = []
    for faces in frames or []:
        for raw in faces or []:
            hb = hook_placement.head_box(raw)
            cx = (hb[0] + hb[2]) / 2
            matched = False
            for t in tracks:
                tcx = (t["box"][0] + t["box"][2]) / 2
                if abs(cx - tcx) <= TRACK_MERGE_X:
                    n = t["n"]
                    t["box"] = tuple((t["box"][i] * n + hb[i]) / (n + 1) for i in range(4))
                    t["n"] = n + 1
                    matched = True
                    break
            if not matched:
                tracks.append({"box": hb, "n": 1})
    if not tracks:
        return []
    tracks.sort(key=lambda t: (t["box"][0] + t["box"][2]) / 2)
    out = []
    for i, t in enumerate(tracks):
        box = t["box"]
        out.append({
            "id": i,
            "label": _label_for_index(i, len(tracks)),
            "x0": round(box[0], 4),
            "y0": round(box[1], 4),
            "x1": round(box[2], 4),
            "y1": round(box[3], 4),
            "center_x": round((box[0] + box[2]) / 2, 4),
            "center_y": round((box[1] + box[3]) / 2, 4),
            "detections": t["n"],
            "area": round(_face_area(box), 4),
        })
    return out


def _map_face_index_h_to_v(h_idx: int, h_faces: list[dict], v_faces: list[dict]) -> int:
    """Match a person chosen on a horizontal analysis frame to the vertical clip."""
    if not v_faces:
        return h_idx
    h_idx = max(0, min(h_idx, len(h_faces) - 1))
    if len(h_faces) == len(v_faces) == 2:
        h_order = sorted(range(len(h_faces)), key=lambda i: h_faces[i]["center_x"])
        v_order = sorted(range(len(v_faces)), key=lambda i: v_faces[i]["center_y"])
        try:
            slot = h_order.index(h_idx)
            return v_order[slot]
        except ValueError:
            pass
    return min(h_idx, len(v_faces) - 1)


def _face_tuple(face: dict) -> tuple[float, float, float, float]:
    return (face["x0"], face["y0"], face["x1"], face["y1"])


def map_center_analysis_to_deliverable(
    ax: float,
    ay: float,
    h_face: dict,
    v_face: dict,
    w_frac: float,
    h_frac: float,
) -> tuple[float, float]:
    """Preserve offset from face centre when moving from horizontal analysis to 9:16."""
    hcx, hcy = h_face["center_x"], h_face["center_y"]
    vcx, vcy = v_face["center_x"], v_face["center_y"]
    ox, oy = ax - hcx, ay - hcy
    return _clamp_center(vcx + ox, vcy + oy, w_frac, h_frac)


def _primary_face(frames):
    """Largest mean head box across sampled frames (legacy single-face)."""
    faces = list_faces(frames)
    if not faces:
        return None
    best = max(faces, key=lambda f: f["detections"] * f["area"])
    return (best["x0"], best["y0"], best["x1"], best["y1"])


def face_index_from_prompt(prompt: str | None, faces: list[dict]) -> int:
    """Pick which detected person a role-specific prompt refers to."""
    if not faces:
        return 0
    n = len(faces)
    p = (prompt or "").strip().lower()
    if not p:
        return 0
    if re.search(r"\b(smallest|tiny)\b", p):
        return min(range(n), key=lambda i: faces[i]["area"])
    if re.search(r"\b(largest|biggest|main)\b", p):
        return max(range(n), key=lambda i: faces[i]["detections"] * faces[i]["area"])
    if re.search(r"\bleft\b", p):
        return 0
    if re.search(r"\bright\b", p):
        return n - 1
    if re.search(r"\b(center|middle)\b", p):
        return n // 2
    m = re.search(r"\b(?:person|face|speaker|guy|woman|man)\s*#?\s*(\d+)\b", p)
    if m:
        return max(0, min(int(m.group(1)) - 1, n - 1))
    if re.search(r"\bfirst\b|\b1st\b", p):
        return 0
    if re.search(r"\bsecond\b|\b2nd\b", p):
        return min(1, n - 1)
    if re.search(r"\bthird\b|\b3rd\b", p):
        return min(2, n - 1)
    return 0


def _face_box(faces: list[dict], index: int) -> tuple[float, float, float, float] | None:
    if not faces or index < 0 or index >= len(faces):
        return None
    f = faces[index]
    return (f["x0"], f["y0"], f["x1"], f["y1"])


def _clamp_center(cx: float, cy: float, w_frac: float, h_frac: float) -> tuple[float, float]:
    half_w, half_h = w_frac / 2, h_frac / 2
    cx = min(1.0 - half_w, max(half_w, cx))
    cy = min(SAFE_BOTTOM - half_h, max(SAFE_TOP + half_h, cy))
    return round(cx, 4), round(cy, 4)


def center_for_mode(
    mode: Mode,
    face: tuple[float, float, float, float],
    w_frac: float,
    h_frac: float,
) -> tuple[float, float]:
    """Hook/logo centre (frame fractions) for the given face head box."""
    x0, y0, x1, y1 = face
    cx = (x0 + x1) / 2
    if mode == "on_face" or mode == "track_face":
        cy = (y0 + y1) / 2
    elif mode == "below_face":
        cy = y1 + MARGIN + h_frac / 2
    else:
        cy = y0 - MARGIN - h_frac / 2
    return _clamp_center(cx, cy, w_frac, h_frac)


def norm_center_to_px(
    cx: float, cy: float, elem_w: int, elem_h: int, vw: int, vh: int
) -> tuple[int, int]:
    x = int(round(cx * vw - elem_w / 2))
    y = int(round(cy * vh - elem_h / 2))
    x = max(0, min(x, max(vw - elem_w, 0)))
    y = max(0, min(y, max(vh - elem_h, 0)))
    return x, y


def estimate_hook_frac(text: str, font_scale: float = 1.0) -> tuple[float, float]:
    n = max(len((text or "").strip()), 4)
    w = min(0.92, max(0.35, n * 0.028 * font_scale))
    h = min(0.14, 0.075 * font_scale)
    return w, h


def _placement_for_face(
    mode: Mode,
    face: tuple[float, float, float, float],
    w_frac: float,
    h_frac: float,
) -> dict:
    cx, cy = center_for_mode(mode, face, w_frac, h_frac)
    return {"center_x": cx, "center_y": cy, "w_frac": w_frac, "h_frac": h_frac}


def suggest(
    video_path: str,
    prompt: str | None,
    *,
    window_start: float = 0.0,
    window_end: float | None = None,
    hook_text: str | None = None,
    hook_font_scale: float = 1.0,
    logo_width_ratio: float = 0.22,
    logo_aspect: float = 1.0,
    hook_prompt: str | None = None,
    logo_prompt: str | None = None,
    hook_face_id: int | None = None,
    logo_face_id: int | None = None,
    deliverable_path: str | None = None,
    hook_center: tuple[float, float] | None = None,
    logo_center: tuple[float, float] | None = None,
    target: str | None = "both",
    face_overrides: list[dict] | None = None,
) -> dict:
    """Return all faces plus hook/logo placements (possibly on different people).

    ``video_path`` is the analysis picture (usually the uncropped horizontal cut).
    When ``deliverable_path`` is set, also returns ``deliverable_hook`` /
    ``deliverable_logo`` centres to burn on the finished vertical file.
    """
    target = (target or "both").lower()
    if target == "hook":
        hook_prompt = (hook_prompt or prompt or "").strip()
        logo_prompt = ""
    elif target == "logo":
        logo_prompt = (logo_prompt or prompt or "").strip()
        hook_prompt = ""
    else:
        hook_prompt = (hook_prompt or prompt or "").strip()
        logo_prompt = (logo_prompt or prompt or "").strip()
    hook_mode = mode_from_prompt(hook_prompt) if hook_prompt else "above_face"
    logo_mode = mode_from_prompt(logo_prompt) if logo_prompt else "above_face"

    end = window_end if window_end else hook_placement.DEFAULT_WINDOW
    frames = hook_placement.detect_faces(video_path, window_start, end)
    people = merge_face_overrides(list_faces(frames), face_overrides)

    hook_w, hook_h = estimate_hook_frac(hook_text or "Hook", hook_font_scale)
    logo_w = logo_width_ratio
    logo_h = logo_width_ratio / max(logo_aspect, 0.2)

    out: dict = {
        "mode": hook_mode,
        "logo_mode": logo_mode,
        "prompt": prompt or "",
        "hook_prompt": hook_prompt,
        "logo_prompt": logo_prompt,
        "faces": people,
        "face": None,
        "hook": None,
        "logo": None,
        "hook_face_id": None,
        "logo_face_id": None,
        "deliverable_hook": None,
        "deliverable_logo": None,
        "analysis_space": "horizontal",
        "target": target,
    }
    if not people:
        return out

    want_hook = target in ("both", "hook") and (hook_prompt or target == "hook")
    want_logo = target in ("both", "logo") and (logo_prompt or target == "logo")
    hi = hook_face_id if hook_face_id is not None else (
        face_index_from_prompt(hook_prompt, people) if want_hook else 0)
    li = logo_face_id if logo_face_id is not None else (
        face_index_from_prompt(logo_prompt, people) if want_logo else 0)
    hi = max(0, min(hi, len(people) - 1))
    li = max(0, min(li, len(people) - 1))
    out["hook_face_id"] = hi
    out["logo_face_id"] = li

    hook_face = _face_box(people, hi)
    logo_face = _face_box(people, li)
    out["face"] = people[hi]

    if want_hook and hook_mode == "avoid_faces":
        try:
            import cv2
            cap = cv2.VideoCapture(video_path)
            vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1080)
            vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1920)
            cap.release()
        except Exception:
            vw, vh = 1080, 1920
        bands = hook_placement.caption_bands(None, 0.0, end, has_captions=True)
        y, _ = hook_placement.choose_y(hook_w, hook_h, frames or [], bands)
        if y is not None:
            cy = y + hook_h / 2
            hcx, hcy = _clamp_center(0.5, cy, hook_w, hook_h)
            out["hook"] = {
                "center_x": hcx, "center_y": hcy, "w_frac": hook_w, "h_frac": hook_h,
                "face_id": hi,
            }
    elif want_hook and hook_face:
        out["hook"] = {**_placement_for_face(hook_mode, hook_face, hook_w, hook_h), "face_id": hi}
    if want_hook and hook_center:
        hcx, hcy = _clamp_center(hook_center[0], hook_center[1], hook_w, hook_h)
        out["hook"] = {
            **(out.get("hook") or {}),
            "center_x": hcx,
            "center_y": hcy,
            "w_frac": hook_w,
            "h_frac": hook_h,
            "face_id": hi,
        }

    if want_logo and logo_mode == "avoid_faces":
        lcx, lcy = _clamp_center(0.5, 0.82, logo_w, logo_h)
        out["logo"] = {
            "center_x": lcx, "center_y": lcy, "w_frac": logo_w, "h_frac": logo_h,
            "face_id": li,
        }
    elif want_logo and logo_face:
        lm = logo_mode if logo_mode != "track_face" else "above_face"
        if logo_mode == "on_face":
            lm = "above_face"
        out["logo"] = {**_placement_for_face(lm, logo_face, logo_w, logo_h * 0.85), "face_id": li}
        if out.get("hook") and logo_face == hook_face:
            hcy = out["hook"]["center_y"]
            lcy = out["logo"]["center_y"]
            if lcy + logo_h / 2 > hcy - hook_h / 2 - MARGIN:
                out["logo"]["center_y"] = _clamp_center(
                    out["logo"]["center_x"],
                    logo_face[0] - MARGIN - logo_h / 2,
                    logo_w,
                    logo_h,
                )[1]
    if want_logo and logo_center:
        lcx, lcy = _clamp_center(logo_center[0], logo_center[1], logo_w, logo_h)
        out["logo"] = {
            **(out.get("logo") or {}),
            "center_x": lcx,
            "center_y": lcy,
            "w_frac": logo_w,
            "h_frac": logo_h,
            "face_id": li,
        }

    if deliverable_path and os.path.isfile(deliverable_path):
        v_frames = hook_placement.detect_faces(deliverable_path, window_start, end)
        v_people = list_faces(v_frames)
        v_hi = _map_face_index_h_to_v(hi, people, v_people)
        v_li = _map_face_index_h_to_v(li, people, v_people)
        if want_hook and out.get("hook"):
            hc = hook_center or (
                out["hook"]["center_x"], out["hook"]["center_y"])
            if v_people:
                h_ref = people[hi]
                v_ref = v_people[v_hi]
                dcx, dcy = map_center_analysis_to_deliverable(
                    hc[0], hc[1], h_ref, v_ref, hook_w, hook_h)
            else:
                dcx, dcy = hc[0], hc[1]
            out["deliverable_hook"] = {
                **out["hook"],
                "center_x": dcx,
                "center_y": dcy,
                "face_id": v_hi if v_people else hi,
            }
        if want_logo and out.get("logo"):
            lc = logo_center or (
                out["logo"]["center_x"], out["logo"]["center_y"])
            if v_people and logo_face:
                h_ref = people[li]
                v_ref = v_people[v_li]
                dcx, dcy = map_center_analysis_to_deliverable(
                    lc[0], lc[1], h_ref, v_ref, logo_w, logo_h)
            else:
                dcx, dcy = lc[0], lc[1]
            out["deliverable_logo"] = {
                **out["logo"],
                "center_x": dcx,
                "center_y": dcy,
                "face_id": v_li if v_people else li,
            }

    return out