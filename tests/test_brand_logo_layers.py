"""Walk-back through logo_ wrappers (brand burn) when stripping captions."""
import os

import pytest

app_module = pytest.importorskip("app")

_strip_burned_captions = app_module._strip_burned_captions
_strip_brand_logo = app_module._strip_brand_logo
_filename_has_brand_logo = app_module._filename_has_brand_logo
_clip_had_brand_logo = app_module._clip_had_brand_logo

CLEAN = "talk_clip_1.mp4"
HOOKED = f"hooked_99_{CLEAN}"
CAPTIONED = f"subtitled_88_{HOOKED}"
LOGO_CAPTIONED = f"logo_0_1730000000123_{CAPTIONED}"
LOGO_TS_CAPTIONED = f"logo_1730000000_{CAPTIONED}"


def _touch(directory, name):
    path = os.path.join(str(directory), name)
    with open(path, "wb") as f:
        f.write(b"x")
    return path


class TestStripBrandLogo:
    def test_peels_job_pipeline_logo_before_subtitled(self, tmp_path):
        _touch(tmp_path, CLEAN)
        _touch(tmp_path, HOOKED)
        _touch(tmp_path, CAPTIONED)
        _touch(tmp_path, LOGO_CAPTIONED)
        assert _strip_burned_captions(str(tmp_path), LOGO_CAPTIONED) == HOOKED

    def test_peels_editor_api_logo_before_subtitled(self, tmp_path):
        _touch(tmp_path, HOOKED)
        _touch(tmp_path, CAPTIONED)
        _touch(tmp_path, LOGO_TS_CAPTIONED)
        assert _strip_burned_captions(str(tmp_path), LOGO_TS_CAPTIONED) == HOOKED

    def test_strip_brand_logo_alone(self):
        assert _strip_brand_logo(LOGO_CAPTIONED) == CAPTIONED
        assert _strip_brand_logo(LOGO_TS_CAPTIONED) == CAPTIONED
        assert _strip_brand_logo(CLEAN) == CLEAN

    def test_detect_brand_on_filename_or_metadata(self):
        assert _filename_has_brand_logo(LOGO_CAPTIONED)
        assert _filename_has_brand_logo(LOGO_TS_CAPTIONED)
        assert not _filename_has_brand_logo(CAPTIONED)
        assert _clip_had_brand_logo({"active_layers": {"brand_logo": {"position": "bottom"}}})
        assert not _clip_had_brand_logo({})