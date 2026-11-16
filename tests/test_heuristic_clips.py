"""Music/silent heuristic clip picker (no Gemini)."""
import heuristic_clips


def test_heuristic_returns_clips_on_uniform_fallback(monkeypatch):
    monkeypatch.setattr(heuristic_clips.punch_in, "emphasis_times", lambda *a, **k: [])
    monkeypatch.setattr(heuristic_clips, "_scene_anchors", lambda *a, **k: [])
    out = heuristic_clips.get_heuristic_visual_clips(
        "dummy.mp4", 120.0, video_title="MV", language="en")
    assert out and len(out["shorts"]) >= 3
    for s in out["shorts"]:
        assert s["end"] - s["start"] >= 14.5
        assert "video_title_for_youtube_short" in s