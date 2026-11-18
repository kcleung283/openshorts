import pytest

from brand_watermark import (
    PLACEMENT_LOGO_BASENAME_RE,
    resolve_job_placement_logo,
    store_job_placement_logo,
)


def test_placement_logo_basename_re():
    assert PLACEMENT_LOGO_BASENAME_RE.match("placement_logo_123.png")
    assert not PLACEMENT_LOGO_BASENAME_RE.match("logo_123.png")
    assert not PLACEMENT_LOGO_BASENAME_RE.match("../placement_logo_1.png")


def test_store_and_resolve_job_placement_logo(tmp_path):
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    name = store_job_placement_logo(str(tmp_path), "x.png", png)
    assert name.startswith("placement_logo_")
    assert name.endswith(".png")
    path = resolve_job_placement_logo(str(tmp_path), name)
    assert path.endswith(name)


def test_resolve_rejects_brand_style_name(tmp_path):
    with pytest.raises(ValueError):
        resolve_job_placement_logo(str(tmp_path), "logo.png")