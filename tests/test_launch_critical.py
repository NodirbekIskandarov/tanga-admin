"""Launchdan oldingi kritik tuzatishlar (QA hisoboti, 2026-10-05).

M2  Login qulfi login+IP bo'yicha; ixtiyoriy ikki bosqichli kirish (TOTP).
K1  Kishi boshiga AI limiti admin «Sozlamalar» da.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import auth
import settings
import store


@pytest.fixture
def admin():
    h, s = auth.hash_password("to'g'ri-parol-123")
    store.create_admin("nodir", h, s, "Nodir")
    getattr(auth, "_last_totp_step", {}).clear()
    return "nodir"


# ------------------------------------------------------------ M2 qulf --

def test_failures_lock_only_the_attacking_ip(admin):
    for _ in range(settings.LOGIN_MAX_ATTEMPTS):
        with pytest.raises(auth.LoginError):
            auth.login(admin, "xato", "6.6.6.6")
    with pytest.raises(auth.LoginError, match="Juda ko'p"):
        auth.login(admin, "to'g'ri-parol-123", "6.6.6.6")
    # Haqiqiy admin boshqa manzildan kira oladi.
    assert auth.read_session(auth.login(admin, "to'g'ri-parol-123", "1.2.3.4"))


# ------------------------------------------------------------ M2 TOTP --

def test_totp_matches_rfc6238_vector():
    # RFC 6238, 2-ilova: sir "12345678901234567890", T=59 -> 94287082 (8 xona).
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert auth.totp_code(secret, 59 // 30) == "287082"


def test_login_with_totp(admin, monkeypatch):
    secret = auth.new_totp_secret()
    store.set_admin_totp(admin, secret)
    now = 1_790_000_000.0
    monkeypatch.setattr(auth.time, "time", lambda: now)
    good = auth.totp_code(secret, int(now // 30))

    with pytest.raises(auth.TotpRequired):
        auth.login(admin, "to'g'ri-parol-123", "1.2.3.4")             # kod so'raladi
    with pytest.raises(auth.TotpRequired, match="noto'g'ri"):
        auth.login(admin, "to'g'ri-parol-123", "1.2.3.4", "000000")
    assert auth.read_session(auth.login(admin, "to'g'ri-parol-123", "1.2.3.4", good))
    with pytest.raises(auth.TotpRequired):                             # qayta ishlatish
        auth.login(admin, "to'g'ri-parol-123", "1.2.3.4", good)


def test_wrong_password_never_reveals_totp(admin):
    store.set_admin_totp(admin, auth.new_totp_secret())
    with pytest.raises(auth.LoginError) as exc:
        auth.login(admin, "xato", "1.2.3.4")
    assert not isinstance(exc.value, auth.TotpRequired)


def test_login_endpoint_signals_totp(admin):
    import app as app_module
    store.set_admin_totp(admin, auth.new_totp_secret())
    client = TestClient(app_module.app, base_url="https://testserver")
    r = client.post("/api/login", json={"username": admin,
                                        "password": "to'g'ri-parol-123"})
    assert r.status_code == 401 and r.json()["totp"] is True


def test_admin_without_totp_logs_in_as_before(admin):
    assert auth.read_session(auth.login(admin, "to'g'ri-parol-123", "1.2.3.4"))


# ------------------------------------------------------- K1 sozlamasi --

def test_user_budget_setting_roundtrip_including_zero(admin):
    import app as app_module
    token = auth.make_session(admin)
    client = TestClient(app_module.app, base_url="https://testserver")
    client.cookies.set(auth.COOKIE_NAME, token)
    client.headers["X-CSRF-Token"] = auth.read_session(token)["c"]

    assert client.get("/api/settings").json()["bot"]["ai_user_monthly_budget_usd"] == 0.5
    body = {"card_number": "", "card_holder": "", "trial_days": 7,
            "ai_monthly_budget_usd": 50, "ai_user_monthly_budget_usd": 0}
    r = client.post("/api/settings", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["bot"]["ai_user_monthly_budget_usd"] == 0      # 0 — o'chiq
    assert store.settings_all()["ai_user_monthly_budget_usd"] == "0.0"
