import time

import brand_watermark


def test_logo_filter_centers_and_positions():
    f_top = brand_watermark.logo_filter(1080, 1920, position="top", width_ratio=0.22)
    assert "overlay=x=(main_w-overlay_w)/2" in f_top
    assert "y=main_h*0.08" in f_top

    f_mid = brand_watermark.logo_filter(1080, 1920, position="middle")
    assert "y=(main_h-overlay_h)/2" in f_mid

    f_bottom = brand_watermark.logo_filter(1080, 1920, position="bottom")
    assert "y=main_h*0.82-overlay_h" in f_bottom


def test_save_settings_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("SELF_HOST_DATA_DIR", str(tmp_path))
    brand_watermark.save_settings({"position": "middle", "opacity": 0.5})
    loaded = brand_watermark.load_settings()
    assert loaded["position"] == "middle"
    assert loaded["opacity"] == 0.5


def test_logo_replace_bumps_revision(tmp_path, monkeypatch):
    monkeypatch.setenv("SELF_HOST_DATA_DIR", str(tmp_path))
    first = brand_watermark.store_logo_upload("a.png", b"bytes-v1")
    assert first["logo_filename"] == "logo.png"
    time.sleep(0.02)
    second = brand_watermark.store_logo_upload("b.png", b"bytes-v2-longer")
    assert second["logo_filename"] == "logo.png"
    assert second["logo_revision"] >= first["logo_revision"]
    logo_path = tmp_path / "brand" / "logo.png"
    assert logo_path.read_bytes() == b"bytes-v2-longer"


def test_clear_logo_removes_file_and_settings(tmp_path, monkeypatch):
    monkeypatch.setenv("SELF_HOST_DATA_DIR", str(tmp_path))
    brand_watermark.store_logo_upload("x.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 8)
    assert brand_watermark.load_settings().get("logo_filename")
    brand_watermark.clear_logo()
    assert brand_watermark.load_settings().get("logo_filename") is None
    assert brand_watermark.load_settings().get("logo_path") is None


def test_guess_ext_from_bytes_without_filename(tmp_path, monkeypatch):
    monkeypatch.setenv("SELF_HOST_DATA_DIR", str(tmp_path))
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    out = brand_watermark.store_logo_upload("photo", png)
    assert out["logo_filename"] == "logo.png"