"""QA hisoboti, 4-bo'lim (past ustuvorlik) va M10 — admin paneli."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import auth
import manage
import store

ROOT = Path(__file__).resolve().parents[1]
PASSWORD = "to'g'ri-parol-123"


@pytest.fixture
def app_module():
    import app as module
    return module


def _client(app_module, username="nodir", must_change=0) -> TestClient:
    h, salt = auth.hash_password(PASSWORD)
    store.create_admin(username, h, salt, must_change=must_change)
    token = auth.make_session(username, auth.password_version(store.get_admin(username)))
    c = TestClient(app_module.app, base_url="https://testserver")
    c.cookies.set(auth.COOKIE_NAME, token)
    c.headers["X-CSRF-Token"] = auth.read_session(token)["c"]
    return c


# ------------------------------------------------ parolni majburan almashtirish --

def test_must_change_blocks_everything_until_password_changed(app_module):
    client = _client(app_module, must_change=1)
    assert client.get("/api/dashboard").status_code == 403
    assert client.get("/api/users").status_code == 403
    session = client.get("/api/session")
    assert session.status_code == 200 and session.json()["must_change"] is True
    assert client.get("/api/admins").status_code == 200       # parol sahifasi uchun kerak

    r = client.post("/api/password", json={"current": PASSWORD, "new1": "yangi-parol-789",
                                           "new2": "yangi-parol-789"})
    assert r.status_code == 200, r.text
    assert client.get("/api/dashboard").status_code == 200
    assert client.get("/api/session").json()["must_change"] is False


def test_login_reports_must_change(app_module):
    h, salt = auth.hash_password(PASSWORD)
    store.create_admin("yangi", h, salt, must_change=1)
    client = TestClient(app_module.app, base_url="https://testserver")
    r = client.post("/api/login", json={"username": "yangi", "password": PASSWORD})
    assert r.status_code == 200 and r.json()["must_change"] is True


def test_manage_commands_force_password_change(capsys):
    assert manage.cmd_add(["operator"]) == 0
    assert store.get_admin("operator")["must_change"] == 1
    store.set_admin_password("operator", *auth.hash_password("o'zimniki-12345"))
    assert store.get_admin("operator")["must_change"] == 0
    assert manage.cmd_password(["operator"]) == 0              # parolni tiklash — yana majburiy
    assert store.get_admin("operator")["must_change"] == 1
    capsys.readouterr()


# ------------------------------------------------------------- salomatlik --

def test_health_does_not_leak_error_details(app_module, monkeypatch):
    def broken():
        raise RuntimeError("unable to open /opt/tanga/tanga.db (maxfiy yo'l)")

    monkeypatch.setattr(store, "conn", broken)
    r = TestClient(app_module.app).get("/salomatlik")
    assert r.status_code == 500
    assert "tanga.db" not in r.text and "maxfiy" not in r.text
    assert r.json() == {"holat": "xato"}


def test_health_ok(app_module):
    assert TestClient(app_module.app).get("/salomatlik").json() == {"holat": "ok"}


# --------------------------------------------------------------- lifespan --

def test_startup_runs_through_lifespan(app_module):
    with TestClient(app_module.app) as client:                 # lifespan ishga tushadi
        assert client.get("/salomatlik").status_code == 200


# --------------------------------------------------------- f12 narxi sozlama --

def test_settings_can_save_founders_price_and_flag_unsold_plans(app_module):
    client = _client(app_module)
    got = {p["code"]: p for p in client.get("/api/settings").json()["plans"]}
    assert got["f12"]["public"] is True and got["12m"]["public"] is True
    assert got["3m"]["public"] is False and got["6m"]["public"] is False

    body = {"card_number": "", "card_holder": "", "trial_days": 7,
            "ai_monthly_budget_usd": 50, "ai_user_monthly_budget_usd": 0.5,
            "plan_price_f12": 89_000}
    r = client.post("/api/settings", json=body)
    assert r.status_code == 200, r.text
    assert store.settings_all()["plan_price_f12"] == "89000"
    assert {p["code"]: p["price"] for p in r.json()["plans"]}["f12"] == 89_000
    # Berilmagan (0) narx — «o'zgartirilmadi», nolga tushmaydi.
    client.post("/api/settings", json={**body, "plan_price_f12": 0})
    assert store.settings_all()["plan_price_f12"] == "89000"


# --------------------------------------------------------------- M10 unit --

def test_service_unit_hides_bot_secrets_from_the_panel():
    unit = (ROOT / "deploy" / "tanga-admin.service").read_text(encoding="utf-8")
    line = next(l for l in unit.splitlines() if l.startswith("InaccessiblePaths="))
    for secret in ("/opt/tanga/.env", "/opt/tanga/tanga_shaxsiy.db",
                   "/opt/tanga/tanga_shaxsiy.db-wal", "/opt/tanga/tanga_shaxsiy.db-shm"):
        assert f"-{secret} " in line + " ", secret
    assert "tanga.db " not in line.replace("tanga_shaxsiy.db", "")   # asosiy baza yopilmagan
    assert "NoNewPrivileges=true" in unit
