"""Multi-source compose helpers (source_compose.py)."""
import source_compose


def test_parse_video_url_list_newlines():
    raw = "https://a.test/1\nhttps://b.test/2\n"
    assert source_compose.parse_video_url_list(raw) == [
        "https://a.test/1",
        "https://b.test/2",
    ]


def test_parse_video_url_list_json_array():
    assert source_compose.parse_video_url_list(
        '["https://x.test/v", "https://y.test/v"]'
    ) == ["https://x.test/v", "https://y.test/v"]


def test_parse_dedupes_and_caps():
    items = [f"https://x.test/{i}" for i in range(20)]
    got = source_compose.parse_video_url_list("\n".join(items))
    assert len(got) == source_compose.MAX_VIDEO_URLS
    assert got[0] == "https://x.test/0"


def test_compose_spec_accepts_local_paths_key():
    spec = {"video_urls": [], "local_video_paths": ["/tmp/a.mp4"], "mute_video": False}
    assert spec.get("local_video_paths") == ["/tmp/a.mp4"]
    assert source_compose.parse_video_url_list(spec.get("video_urls")) == []


def test_compose_canvas_respects_output_format():
    assert source_compose._compose_canvas({"output_format": "vertical"}, []) == (1080, 1920)
    assert source_compose._compose_canvas({"output_format": "horizontal"}, []) == (1920, 1080)
    assert source_compose._compose_canvas({"output_format": "square"}, []) == (1080, 1080)


def test_concat_list_uses_absolute_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(source_compose, "_run_ffmpeg", lambda args: None)
    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    a.write_bytes(b"x")
    b.write_bytes(b"x")
    out = source_compose._concat_videos([str(a), str(b)], str(tmp_path))
    assert out == str((tmp_path / ".compose_concat.mp4").resolve())
    list_text = (tmp_path / ".compose_concat.txt").read_text(encoding="utf-8")
    assert str(a.resolve()) in list_text
    assert str(b.resolve()) in list_text