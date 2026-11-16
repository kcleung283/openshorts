"""Self-host history + schedule helpers."""
import json
import os

import self_host_extras


def test_schedule_interval_clamped(tmp_path, monkeypatch):
    monkeypatch.setattr(self_host_extras, "_SCHEDULE_FILE", str(tmp_path / "sched.json"))
    out = self_host_extras.update_schedule_settings({"interval_hours": 99, "enabled": True})
    assert out["interval_hours"] == 24


def test_youtube_timestamp_parse():
    from self_host_source import youtube_start_seconds

    assert youtube_start_seconds("https://youtu.be/x?t=10589s") == 10589.0


def test_enqueue_spacing(tmp_path, monkeypatch):
    monkeypatch.setattr(self_host_extras, "_SCHEDULE_FILE", str(tmp_path / "sched.json"))
    self_host_extras.update_schedule_settings({"enabled": True, "interval_hours": 2})
    a = self_host_extras.enqueue_clip("job-a", 0)
    b = self_host_extras.enqueue_clip("job-b", 1)
    assert a["post_at_local"] != b["post_at_local"]