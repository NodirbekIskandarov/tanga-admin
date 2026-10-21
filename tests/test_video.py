"""Ommaviy xabar — reklama videosi bilan.

Fayl panelga xom bayt sifatida yuklanadi, Telegram'ga BIR MARTA (egaga)
yuklanib file_id olinadi, qolganlarga file_id ketadi. Ish tugagach
vaqtinchalik fayl o'chiriladi.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

import store
import telegram
from tests.conftest import add_user
from tests.test_muhim import app_module, client  # noqa: F401  (fixturalar)

MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64
OWNER = 777


@pytest.fixture
def video_env(app_module, monkeypatch, tmp_path):  # noqa: F811
    monkeypatch.setattr(app_module, "VIDEO_DIR", tmp_path / "videos")
    monkeypatch.setattr(app_module, "_pending_videos", {})
    return app_module


@pytest.fixture
def sent_videos(monkeypatch):
    """telegram.send_video o'rniga: (kimga, nima) yoziladi. Baytlar
    yuklansa file_id «FILE1» qaytadi; 403 foydalanuvchi bloklagan."""
    calls = []

    async def fake_send_video(user_id, video, caption="", parse_mode="HTML"):
        calls.append((user_id, video, caption))
        if user_id == 403:
            return False, "Forbidden: bot was blocked by the user", 403, ""
        return True, "yuborildi", 0, "FILE1"

    monkeypatch.setattr(telegram, "send_video", fake_send_video)
    return calls


def _upload(client, data=MP4, mime="video/mp4", name="reklama.mp4"):  # noqa: F811
    return client.post("/api/broadcast/video", content=data,
                       headers={"Content-Type": mime, "X-File-Name": name})


def _send(client, **extra):  # noqa: F811
    body = {"segment": "hammasi", "matn": "Reklama", "tasdiq": True, **extra}
    return client.post("/api/broadcast", json=body)


# ------------------------------------------------------------- yuklash --

def test_upload_rejects_non_video(client, video_env):  # noqa: F811
    assert _upload(client, mime="text/plain").status_code == 400
    assert _upload(client, data=b"salom dunyo " * 10).status_code == 400
    video_env.VIDEO_MAX_BYTES = 100
    try:
        assert _upload(client, data=MP4 + b"\x00" * 200).status_code == 413
    finally:
        video_env.VIDEO_MAX_BYTES = 50 * 1024 * 1024
    assert not video_env._pending_videos


def test_upload_saves_file_and_replaces_previous(client, video_env):  # noqa: F811
    first = _upload(client).json()
    assert first["video_id"] and first["name"] == "reklama.mp4"
    assert first["size"] == len(MP4) and first["caption_limit"] == 1024
    path_first = video_env._pending_videos[first["video_id"]]["path"]

    second = _upload(client, name="aksiya%20oktabr.mov", mime="video/quicktime").json()
    assert second["name"] == "aksiya oktabr.mov"
    assert first["video_id"] not in video_env._pending_videos
    assert not video_env.Path(path_first).exists()
    assert video_env.Path(video_env._pending_videos[second["video_id"]]["path"]).exists()
    assert store.list_log(1)[0]["action"] == "video yuklandi"

    client.delete(f"/api/broadcast/video/{second['video_id']}")
    assert not video_env._pending_videos and not list(video_env.VIDEO_DIR.iterdir())


# ------------------------------------------------------------ yuborish --

def test_video_is_uploaded_once_then_sent_by_file_id(client, video_env, sent_videos):  # noqa: F811
    for uid in (1, 2, 3):
        add_user(uid)
    video_id = _upload(client).json()["video_id"]
    r = _send(client, video_id=video_id)
    assert r.status_code == 200, r.text
    job = client.get("/api/broadcast/job").json()["job"]
    assert job["done"] and job["ok"] == 3 and job["failed"] == 0 and job["video"]

    # Avval egaga baytlar (unga nusxa), keyin hammaga file_id.
    assert sent_videos[0][0] == OWNER and sent_videos[0][1] == ("reklama.mp4", MP4)
    assert [(u, v) for u, v, _ in sent_videos[1:]] == [(1, "FILE1"), (2, "FILE1"), (3, "FILE1")]
    assert all(c == "Reklama" for _, _, c in sent_videos)
    assert client.sent == []                              # oddiy matn ketmadi
    # Fayl va yozuv tozalandi; jurnalda video belgisi.
    assert not video_env._pending_videos and not list(video_env.VIDEO_DIR.iterdir())
    log = store.list_log(1)[0]
    assert log["action"] == "ommaviy xabar" and "video" in log["details"]


def test_video_without_caption_is_allowed_but_empty_message_is_not(client, video_env, sent_videos):  # noqa: F811
    add_user(1)
    assert _send(client, matn="").status_code == 400
    video_id = _upload(client).json()["video_id"]
    assert _send(client, matn="", video_id=video_id).status_code == 200
    assert sent_videos[-1] == (1, "FILE1", "")


def test_caption_limit_applies_only_with_video(client, video_env, sent_videos):  # noqa: F811
    add_user(1)
    long_text = "a" * 1025
    video_id = _upload(client).json()["video_id"]
    r = _send(client, matn=long_text, video_id=video_id)
    assert r.status_code == 400 and "1024" in r.json()["detail"]
    assert _send(client, matn=long_text).status_code == 200


def test_unknown_video_id_is_refused(client, video_env):  # noqa: F811
    add_user(1)
    assert _send(client, video_id="yoq").status_code == 400


def test_blocked_user_counted_and_marked(client, video_env, sent_videos):  # noqa: F811
    add_user(1)
    add_user(403)
    video_id = _upload(client).json()["video_id"]
    _send(client, video_id=video_id)
    job = client.get("/api/broadcast/job").json()["job"]
    assert job["ok"] == 1 and job["failed"] == 1
    assert store.all_user_ids("", {OWNER}) == [1]


def test_falls_back_to_first_recipient_when_owner_unreachable(client, video_env, monkeypatch):  # noqa: F811
    calls = []

    async def fake(user_id, video, caption="", parse_mode="HTML"):
        calls.append((user_id, video))
        if user_id == OWNER:
            return False, "Forbidden: bot can't initiate conversation", 403, ""
        return True, "yuborildi", 0, "FILE2"

    monkeypatch.setattr(telegram, "send_video", fake)
    for uid in (1, 2):
        add_user(uid)
    video_id = _upload(client).json()["video_id"]
    _send(client, video_id=video_id)
    job = client.get("/api/broadcast/job").json()["job"]
    assert job["ok"] == 2 and job["failed"] == 0 and not job["error"]
    assert calls == [(OWNER, ("reklama.mp4", MP4)), (1, ("reklama.mp4", MP4)), (2, "FILE2")]
    # Ega qabul qiluvchi emas — uning xatosi sanoqqa kirmaydi, bloklanmaydi.
    assert store.all_user_ids("", {OWNER}) == [1, 2]


def test_upload_failure_ends_job_with_error(client, video_env, monkeypatch):  # noqa: F811
    async def fake(user_id, video, caption="", parse_mode="HTML"):
        return False, "Bad Request: file is too big", 400, ""

    monkeypatch.setattr(telegram, "send_video", fake)
    for uid in (1, 2):
        add_user(uid)
    video_id = _upload(client).json()["video_id"]
    _send(client, video_id=video_id)
    job = client.get("/api/broadcast/job").json()["job"]
    assert job["done"] and job["ok"] == 0 and job["failed"] == 2
    assert "yuklanmadi" in job["error"]
    assert not video_env._pending_videos


# ------------------------------------------------------- telegram.send_video --

class FakeHttp:
    def __init__(self, script):
        self.script, self.sent = list(script), []

    def __call__(self, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, data=None, files=None, json=None):
        self.sent.append({"data": data, "files": files})
        return SimpleNamespace(json=lambda: self.script.pop(0))


def test_send_video_uploads_bytes_waits_on_429_and_returns_file_id(monkeypatch):
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    fake = FakeHttp([
        {"ok": False, "error_code": 429, "description": "Too Many Requests",
         "parameters": {"retry_after": 2}},
        {"ok": True, "result": {"video": {"file_id": "ABC"}}}])
    monkeypatch.setattr(telegram.httpx, "AsyncClient", fake)
    monkeypatch.setattr(telegram.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(telegram.settings, "TELEGRAM_TOKEN", "t")
    ok, _, code, file_id = asyncio.run(
        telegram.send_video(1, ("reklama.mp4", MP4), "<b>Aksiya</b>"))
    assert ok and code == 0 and file_id == "ABC"
    assert slept == [2.5] and len(fake.sent) == 2
    name, data, mime = fake.sent[0]["files"]["video"]
    assert name == "reklama.mp4" and data == MP4 and mime == "video/mp4"
    assert fake.sent[0]["data"]["caption"] == "<b>Aksiya</b>"

    # file_id bilan: fayl yuklanmaydi, oddiy maydon ketadi.
    fake.script = [{"ok": True, "result": {"video": {"file_id": "ABC"}}}]
    ok, _, _, _ = asyncio.run(telegram.send_video(2, "ABC", "Aksiya"))
    assert ok and fake.sent[-1]["files"] is None and fake.sent[-1]["data"]["video"] == "ABC"


def test_send_video_html_error_resends_escaped_caption(monkeypatch):
    fake = FakeHttp([
        {"ok": False, "error_code": 400,
         "description": "Bad Request: can't parse entities: Unsupported start tag"},
        {"ok": True, "result": {"video": {"file_id": "ABC"}}}])
    monkeypatch.setattr(telegram.httpx, "AsyncClient", fake)
    monkeypatch.setattr(telegram.settings, "TELEGRAM_TOKEN", "t")
    ok, _, _, _ = asyncio.run(telegram.send_video(1, "ABC", "narx <99 000"))
    assert ok and fake.sent[1]["data"]["caption"] == "narx &lt;99 000"
