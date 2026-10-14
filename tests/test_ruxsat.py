"""Ixtiyoriy kun va chegara darajasi bilan foydalanish ruxsati (amal «ruxsat»)."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

import settings
import store
from tests.conftest import add_user
from tests.test_muhim import _payments, _revenue, app_module, client  # noqa: F401


def _user(uid=1):
    return store.get_user(uid, {777})


def _until(raw) -> datetime:
    return datetime.fromisoformat(raw)


def _days_from_now(raw) -> int:
    delta = _until(raw) - datetime.now(settings.TZ)
    return round(delta.total_seconds() / 86400)


def _grant(client, uid=1, **body):
    return client.post(f"/api/users/{uid}/action", json={"amal": "ruxsat", **body})


# ------------------------------------------------------------------- PRO --

def test_pro_for_any_number_of_days_is_a_gift_by_default(client):
    add_user(1)
    r = _grant(client, kun=17, daraja="pro")
    assert r.status_code == 200, r.text
    u = _user()
    assert u["state"] == "obunachi"
    assert _days_from_now(u["subscribed_until"]) == 17
    assert [(p["amount"], p["method"], p["days"]) for p in _payments()] == [(0, "sovga", 17)]
    assert _revenue() == 0                                   # sovg'a — daromad emas
    assert any(uid == 1 and "17 kunlik PRO" in text for uid, text in client.sent)


def test_pro_with_amount_is_recorded_as_revenue(client):
    add_user(1)
    assert _grant(client, kun=45, daraja="pro", summa=30_000).status_code == 200
    assert [(p["amount"], p["method"]) for p in _payments()] == [(30_000, "qolda")]
    assert _revenue() == 30_000


def test_pro_days_stack_on_existing_subscription(client):
    add_user(1)
    _grant(client, kun=10, daraja="pro")
    _grant(client, kun=5, daraja="pro")
    assert _days_from_now(_user()["subscribed_until"]) == 15


def test_very_long_grant_is_allowed_up_to_ten_years(client):
    add_user(1)
    assert _grant(client, kun=3650, daraja="pro").status_code == 200
    assert _grant(client, kun=3651, daraja="pro").status_code == 422


# ------------------------------------------------------------ sinov chegarasi --

def test_trial_level_extends_trial_not_subscription(client):
    past = (datetime.now(settings.TZ) - timedelta(days=3)).isoformat(timespec="seconds")
    add_user(1, trial_ends_at=past, subscribed_until=None)
    assert _user()["state"] == "tugagan"
    r = _grant(client, kun=21, daraja="sinov")
    assert r.status_code == 200, r.text
    u = _user()
    assert u["state"] == "sinov"
    assert _days_from_now(u["trial_ends_at"]) == 21
    assert u["subscribed_until"] is None
    assert _payments() == [] and _revenue() == 0             # sinov — pul harakati emas


def test_trial_level_is_refused_when_subscription_is_active(client):
    add_user(1)
    _grant(client, kun=30, daraja="pro")
    before = _user()["trial_ends_at"]
    r = _grant(client, kun=7, daraja="sinov")
    assert r.status_code == 400 and "faol obuna" in r.json()["detail"]
    assert _user()["trial_ends_at"] == before                # hech narsa o'zgarmadi


# -------------------------------------------------------------- tekshiruvlar --

@pytest.mark.parametrize("body", [
    {"kun": 0, "daraja": "pro"},
    {"kun": 7, "daraja": ""},
    {"kun": 7, "daraja": "bepul"},
    {"kun": 7, "daraja": "PRO; DROP"},
])
def test_invalid_grant_is_rejected_and_changes_nothing(client, body):
    add_user(1)
    before = _user()
    assert _grant(client, **body).status_code == 400
    after = _user()
    assert (after["subscribed_until"], after["trial_ends_at"]) == \
        (before["subscribed_until"], before["trial_ends_at"])
    assert _payments() == [] and client.sent == []


def test_grant_is_written_to_the_audit_log(client):
    add_user(1)
    _grant(client, kun=9, daraja="pro")
    with store.conn() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT action, target, details FROM admin_log WHERE action = 'ruxsat berildi'")]
    assert rows and rows[0]["target"] == "1"
    assert "PRO chegarasi" in rows[0]["details"] and "9 kun" in rows[0]["details"]


def test_read_only_admin_cannot_grant(client, app_module, monkeypatch):
    """Faqat yozish huquqi bor admin: `writer` bog'liqligi o'zgarmagan."""
    import auth
    from tests.test_muhim import PASSWORD
    h, salt = auth.hash_password(PASSWORD)
    store.create_admin("kuzatuvchi", h, salt)
    add_user(1)
    # `writer` himoyasi mavjudligini tekshiramiz: endpoint unga bog'langan.
    import inspect
    src = inspect.getsource(app_module.api_user_action)
    assert "Depends(writer)" in src
