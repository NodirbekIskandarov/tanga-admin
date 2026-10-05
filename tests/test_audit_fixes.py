"""Audit (2026-10) topgan xatolar — qaytib kelmasligi uchun.

1. Ommaviy xabar bloklanganlarga, botni bloklaganlarga va rozilik
   bermaganlarga ham ketardi; 403 bergan odam belgilanmasdi.
2. Foydalanuvchi o'chirilganda `events` da izi qolardi.
3. So'rovni ikki marta tasdiqlash mumkin edi (obuna va to'lov ikki
   marta yozilardi).
4. Obuna berilganda `warned_stage` nolga qaytmasdi.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import auth
import plans
import store
import telegram
from tests.conftest import add_user

OWNER = 777


@pytest.fixture
def client(monkeypatch):
    import app as app_module
    sent = []

    async def fake_send(user_id, text, parse_mode="HTML"):
        sent.append((user_id, text))
        if user_id == 403:
            return False, "Forbidden: bot was blocked by the user", 403
        return True, "yuborildi", 0

    async def no_sleep(_):
        return None

    monkeypatch.setattr(telegram, "send", fake_send)
    monkeypatch.setattr(telegram.asyncio, "sleep", no_sleep)
    monkeypatch.setattr(app_module, "OWNER_IDS", {OWNER})

    token = auth.make_session("admin")
    csrf = auth.read_session(token)["c"]
    c = TestClient(app_module.app, base_url="https://testserver")
    c.cookies.set(auth.COOKIE_NAME, token)
    c.headers["X-CSRF-Token"] = csrf
    c.sent = sent
    return c


def _user(user_id: int) -> dict:
    with store.conn() as c:
        return dict(c.execute("SELECT * FROM users WHERE user_id = ?",
                              (user_id,)).fetchone())


# ------------------------------------------------ 1. Ommaviy xabar --

def test_audience_only_reachable_users():
    add_user(1)                                          # oddiy, rozi
    add_user(2, blocked=1)                               # admin bloklagan
    add_user(3, bot_blocked_at="2026-10-01T10:00:00+05:00")
    add_user(4, consent_at=None)                         # rozilik yo'q
    add_user(OWNER)                                      # ega
    assert store.all_user_ids("", {OWNER}) == [1]


def test_broadcast_marks_bot_blocked(client):
    add_user(1)
    add_user(403)
    r = client.post("/api/broadcast",
                    json={"segment": "hammasi", "matn": "Salom", "tasdiq": True})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] == 1 and "blocked_ids" not in r.json()
    assert _user(403)["bot_blocked_at"]
    # Keyingi safar u auditoriyaga tushmaydi.
    assert store.all_user_ids("", {OWNER}) == [1]


def test_broadcast_counts_exclude_unreachable(client):
    add_user(1)
    add_user(2, consent_at=None)
    counts = client.get("/api/broadcast").json()["counts"]
    assert counts["hammasi"] == 1


# ------------------------------------------------ 2. O'chirish --

def test_delete_user_removes_events():
    add_user(1)
    with store.conn() as c:
        c.execute("INSERT INTO events (user_id, name, day) VALUES (1, 'start', '2026-10-01')")
    store.delete_user_data(1)
    with store.conn() as c:
        assert c.execute("SELECT COUNT(*) FROM events WHERE user_id = 1").fetchone()[0] == 0
        assert c.execute("SELECT 1 FROM private_erase_queue WHERE user_id = 1").fetchone()


# ------------------------------------------------ 3. Tasdiqlash --

def _request(user_id=1, plan_code="1m", status="tekshiruvda") -> int:
    rid = store.add_request(user_id, plan_code, plans.price(plan_code))
    with store.conn() as c:
        c.execute("UPDATE subscription_requests SET status = ? WHERE id = ?",
                  (status, rid))
    return rid


def test_approve_is_one_shot():
    add_user(1)
    rid = _request()
    plan = plans.by_code("1m")
    first = store.approve_request(rid, plan, "admin")
    second = store.approve_request(rid, plan, "admin2")
    assert first is not None and second is None
    with store.conn() as c:
        assert c.execute("SELECT COUNT(*) FROM payments").fetchone()[0] == 1
    assert store.get_request(rid)["status"] == "tasdiqlandi"


def test_decide_endpoint_rejects_second_decision(client):
    add_user(1)
    rid = _request()
    assert client.post(f"/api/requests/{rid}/decide",
                       json={"qaror": "tasdiq"}).status_code == 200
    r = client.post(f"/api/requests/{rid}/decide", json={"qaror": "rad"})
    assert r.status_code == 409
    assert store.get_request(rid)["status"] == "tasdiqlandi"


def test_decide_request_does_not_overwrite_decided():
    add_user(1)
    rid = _request(status="tasdiqlandi")
    assert store.decide_request(rid, "rad etildi", "admin") is False
    assert store.get_request(rid)["status"] == "tasdiqlandi"


def test_reject_reason_is_html_escaped(client):
    add_user(1)
    rid = _request()
    client.post(f"/api/requests/{rid}/decide",
                json={"qaror": "rad", "sabab": "summa <99 000"})
    assert any("summa &lt;99 000" in text for _, text in client.sent)


# ------------------------------------------------ 4. warned_stage --

def test_grant_resets_warned_stage():
    add_user(1, warned_stage=1)
    store.grant_subscription(1, 30)
    assert _user(1)["warned_stage"] == 0


def test_approve_resets_warned_stage():
    add_user(1, warned_stage=3)
    store.approve_request(_request(), plans.by_code("1m"), "admin")
    assert _user(1)["warned_stage"] == 0
