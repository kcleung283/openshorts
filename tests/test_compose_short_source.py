"""Multi-source compose jobs must not apply per-file MIN_SOURCE_SECONDS."""
import asyncio
import os

import httpx
import pytest

app_module = pytest.importorskip("app")


def _post_compose(files, data=None):
    async def _do():
        transport = httpx.ASGITransport(app=app_module.app)
        async with httpx.AsyncClient(transport=transport,
                                     base_url="http://testserver") as client:
            return await client.post(
                "/api/process",
                files=files,
                data=data or {"acknowledged": "true"},
                headers={"X-Gemini-Key": "test-key"},
            )
    return asyncio.run(_do())


@pytest.fixture()
def dirs(tmp_path, monkeypatch):
    out_root = tmp_path / "output"
    up_root = tmp_path / "uploads"
    out_root.mkdir()
    up_root.mkdir()
    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(out_root))
    monkeypatch.setattr(app_module, "UPLOAD_DIR", str(up_root))
    return out_root, up_root


def test_short_compose_part_is_allowed(dirs, monkeypatch):
    monkeypatch.setattr(app_module, "_media_duration_seconds", lambda path: 27.0)
    resp = _post_compose(
        [
            ("compose_videos", ("a.mp4", b"bytes-a", "video/mp4")),
            ("compose_videos", ("b.mp4", b"bytes-b", "video/mp4")),
        ],
        data={"acknowledged": "true", "mute_source": "0"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "job_id" in body
    job_dir = os.path.join(dirs[0], body["job_id"])
    assert os.path.isfile(os.path.join(job_dir, ".compose.json"))