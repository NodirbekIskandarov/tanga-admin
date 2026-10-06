"""QA hisoboti, 3-bo'lim — admin paneli.

M3  Parol almashganda / admin o'chirilganda eski sessiya bekor.
M4  Daromad haqiqiy tushgan summadan; sovg'a — daromad emas; xato yozuv
    daromaddan chiqadi; pul QAYTARILMAYDI (obuna to'lovi qaytarilmaydi).
M5  Ommaviy xabar fonda; Telegram 429 kutiladi; HTML xatosida xabar yo'qolmaydi.
Past: CSV Excel formula in'ektsiyasi; tasdiqlashda so'rovdagi narx.
"""

from __future__ import annotations

import asyncio
import html
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import auth
import plans
import settings
import store
import telegram
from tests.conftest import add_user

PASSWORD = "test-parol-123"


@pytest.fixture
def app_module(monkeypatch):
    import app as module
    monkeypatch.setattr(module, "OWNER_IDS", {777})
    monkeypatch.setattr(module, "_broadcast_job", None, raising=False)
    getattr(auth, "_last_totp_step", {}).clear()
    return module


@pytest.fixture
def client(app_module, monkeypatch):
    sent = []

    async def fake_send(user_id, text, parse_mode="HTML"):
        sent.append((user_id, text))
        return True, "yuborildi", 0

    async def no_sleep(_):
        return None

    monkeypatch.setattr(telegram, "send", fake_send)
    monkeypatch.setattr(telegram.asyncio, "sleep", no_sleep)
    h, salt = auth.hash_password(PASSWORD)
    store.create_admin("nodir", h, salt)
    token = auth.make_session("nodir", auth.password_version(store.get_admin("nodir"))) if hasattr(auth, "password_version") else auth.make_session("nodir")
    c = TestClient(app_module.app, base_url="https://testserver")
    c.cookies.set(auth.COOKIE_NAME, token)
    c.headers["X-CSRF-Token"] = auth.read_session(token)["c"]
    c.sent = sent
    return c


def _payments() -> list[dict]:
    with store.conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM payments ORDER BY id")]


def _revenue() -> int:
    return store.overview({777})["revenue_all"]


# ---------------------------------------------------------------- M3 --

def test_session_dies_after_password_change(client):
    assert client.get("/api/session").status_code == 200
    h, salt = auth.hash_password("boshqa-parol-456")
    store.set_admin_password("nodir", h, salt)
    assert client.get("/api/session").status_code == 401


def test_deactivated_admin_session_is_rejected(client):
    with store.conn() as c:
        c.execute("UPDATE admin_users SET is_active = 0 WHERE username = 'nodir'")
    assert client.get("/api/session").status_code == 401


def test_password_endpoint_keeps_current_session(client):
    old_csrf = client.get("/api/session").json()["csrf"]
    r = client.post("/api/password", json={"current": PASSWORD, "new1": "yangi-parol-789",
                                           "new2": "yangi-parol-789"})
    assert r.status_code == 200, r.text
    r2 = client.get("/api/session")
    assert r2.status_code == 200                       # yangi cookie berilgan
    assert r2.json()["csrf"] != old_csrf


def test_session_from_other_admin_version_is_rejected(client):
    forged = auth.make_session("nodir", "eski-versiya")
    client.cookies.set(auth.COOKIE_NAME, forged)
    assert client.get("/api/session").status_code == 401


# ---------------------------------------------------------------- M4 --

def test_manual_grant_records_only_given_amount(client):
    add_user(1)
    r = client.post("/api/users/1/action",
                    json={"amal": "obuna", "plan_code": "1m", "summa": 19_000})
    assert r.status_code == 200, r.text
    assert [(p["amount"], p["method"]) for p in _payments()] == [(19_000, "qolda")]
    assert _revenue() == 19_000


def test_gift_subscription_is_not_revenue(client):
    add_user(1)
    for body in ({"amal": "obuna", "plan_code": "12m", "summa": 0},
                 {"amal": "obuna", "plan_code": "12m"}):          # summa berilmasa ham
        assert client.post("/api/users/1/action", json=body).status_code == 200
    assert [(p["amount"], p["method"]) for p in _payments()] == [(0, "sovga")] * 2
    assert _revenue() == 0


def test_cancel_keeps_payment_money_is_not_refunded(client):
    add_user(1)
    client.post("/api/users/1/action",
                json={"amal": "obuna", "plan_code": "1m", "summa": 19_000})
    # «qaytarish» maydoni yuborilsa ham e'tiborsiz: pul qaytarilmaydi.
    r = client.post("/api/users/1/action", json={"amal": "bekor", "qaytarish": True})
    assert r.status_code == 200
    assert "qaytarildi" not in r.json()["message"]
    assert _revenue() == 19_000 and _payments()[0]["voided_at"] is None


def test_void_removes_mistaken_entry_from_revenue(client):
    add_user(1)
    for _ in range(2):                                   # takroriy bosish
        client.post("/api/users/1/action",
                    json={"amal": "obuna", "plan_code": "1m", "summa": 19_000})
    assert _revenue() == 38_000
    first = _payments()[0]["id"]
    assert client.post(f"/api/payments/{first}/void").status_code == 200
    assert _revenue() == 19_000
    assert client.post(f"/api/payments/{first}/void").status_code == 404   # ikki marta emas
    voided = {p["id"]: p["voided_at"] for p in store.get_user(1)["payments"]}
    assert voided[first] is not None                      # tarixda ko'rinadi
    assert store.get_user(1)["paid_total"] == 19_000


def test_void_does_not_leak_into_other_stats():
    add_user(1)
    store.add_payment(1, "1m", 19_000, 30, "admin")
    pid = store.recent_payments(1)[0]["id"]
    store.void_payment(pid)
    assert store.stats({777})["avgCheck"] == 0
    assert all(s["count"] == 0 for s in store.funnel({777}) if s["key"] == "tolov")
    assert store.revenue_series("oylik")["nowTotal"] == 0


def test_approve_uses_price_user_saw_not_current(app_module):
    add_user(1)
    rid = store.add_request(1, "1m", 15_000)             # foydalanuvchi shuni ko'rgan
    with store.conn() as c:
        c.execute("UPDATE subscription_requests SET status = 'tekshiruvda' WHERE id = ?", (rid,))
    assert plans.by_code("1m")["price"] != 15_000        # joriy narx boshqa
    assert store.approve_request(rid, plans.by_code("1m"), "admin") is not None
    assert _payments()[0]["amount"] == 15_000


# ---------------------------------------------------------------- M5 --

def test_broadcast_runs_in_background_and_reports_progress(client):
    for uid in (1, 2, 3):
        add_user(uid)
    r = client.post("/api/broadcast",
                    json={"segment": "hammasi", "matn": "Salom", "tasdiq": True})
    assert r.status_code == 200 and "boshlandi" in r.json()["message"]
    assert r.json()["job"]["total"] == 3
    job = client.get("/api/broadcast/job").json()["job"]
    assert job["done"] and job["ok"] == 3 and job["sent"] == 3
    assert sorted(uid for uid, _ in client.sent) == [1, 2, 3]
    assert store.list_log(1)[0]["action"] == "ommaviy xabar"


def test_second_broadcast_is_refused_while_running(client, app_module):
    add_user(1)
    app_module._broadcast_job = {"id": "x", "total": 5, "ok": 1, "failed": 0,
                                 "errors": {}, "done": False, "target": "Hammaga"}
    r = client.post("/api/broadcast",
                    json={"segment": "hammasi", "matn": "Salom", "tasdiq": True})
    assert r.status_code == 409


def test_broadcast_without_recipients_is_refused(client):
    r = client.post("/api/broadcast",
                    json={"segment": "hammasi", "matn": "Salom", "tasdiq": True})
    assert r.status_code == 400


class FakeHttp:
    """httpx.AsyncClient o'rniga: oldindan yozilgan javoblar ketma-ketligi."""

    def __init__(self, script):
        self.script, self.sent = list(script), []

    def __call__(self, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None):
        self.sent.append(json)
        data = self.script.pop(0)
        return SimpleNamespace(json=lambda: data)


def test_telegram_429_is_waited_and_retried(monkeypatch):
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    fake = FakeHttp([
        {"ok": False, "error_code": 429, "description": "Too Many Requests",
         "parameters": {"retry_after": 3}},
        {"ok": True}])
    monkeypatch.setattr(telegram.httpx, "AsyncClient", fake)
    monkeypatch.setattr(telegram.asyncio, "sleep", fake_sleep)
    ok, info, code = asyncio.run(telegram.send(1, "Salom"))
    assert ok and len(fake.sent) == 2
    assert slept and slept[0] >= 3


def test_telegram_html_error_resends_escaped(monkeypatch):
    fake = FakeHttp([
        {"ok": False, "error_code": 400,
         "description": "Bad Request: can't parse entities: Unsupported start tag"},
        {"ok": True}])
    monkeypatch.setattr(telegram.httpx, "AsyncClient", fake)
    ok, _, _ = asyncio.run(telegram.send(1, "summa <99 000"))
    assert ok
    assert fake.sent[1]["text"] == html.escape("summa <99 000")


def test_telegram_gives_up_after_retries(monkeypatch):
    async def no_sleep(_):
        return None

    err = {"ok": False, "error_code": 429, "description": "x", "parameters": {"retry_after": 1}}
    fake = FakeHttp([err, err, err])
    monkeypatch.setattr(telegram.httpx, "AsyncClient", fake)
    monkeypatch.setattr(telegram.asyncio, "sleep", no_sleep)
    ok, _, code = asyncio.run(telegram.send(1, "Salom"))
    assert not ok and code == 429 and len(fake.sent) == 3


# -------------------------------------------------------------- past --

def test_csv_cell_neutralizes_formulas(app_module):
    assert app_module._csv_cell("=HYPERLINK(\"http://x\")") == "'=HYPERLINK(\"http://x\")"
    for bad in ("+1", "-1", "@SUM(A1)"):
        assert app_module._csv_cell(bad).startswith("'")
    assert app_module._csv_cell("Akmal") == "Akmal"
    assert app_module._csv_cell(12000) == 12000


def test_users_csv_export_is_safe(client):
    add_user(1, first_name="=cmd|' /C calc'!A0")
    body = client.get("/api/export/users.csv").content.decode("utf-8-sig")
    assert "'=cmd" in body and ",=cmd" not in body
