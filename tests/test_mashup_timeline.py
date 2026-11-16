"""Mashup timeline merge + catalog."""
import edit_builder

import mashup_timeline


def test_merge_user_wins_on_overlap():
    user = [{"type": "flash", "start": 1.0, "end": 1.2, "strength": 1.0}]
    extra = [{"type": "zoom_pulse", "start": 1.05, "end": 1.6, "strength": 0.07}]
    out = mashup_timeline.merge_timeline(user, extra, duration=30.0)
    assert len(out) == 1
    assert out[0]["type"] == "flash"


def test_catalog_matches_editor_limits():
    names = {e["type"] for e in mashup_timeline.effect_catalog()}
    assert names == set(edit_builder.EFFECT_LIMITS.keys())