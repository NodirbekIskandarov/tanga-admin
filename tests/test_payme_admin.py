"""Obuna faqat Payme orqali: panel kuzatadi, tasdiqlamaydi.

Payme buyurtmalari (bot yozadigan payment_orders), botning Payme holati
(bot_status, kalitsiz), daromad usul bo'yicha va sandbox (payme_test)
yozuvlarining daromadga hech qayerda kirmasligi.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

import settings
import store
from tests.conftest import add_user
from tests.test_muhim import app_module, client  # noqa: F401  (fixture)

STATUS = {"env": "prod", "prod": True, "enabled": True, "ready": True, "merchant": True,
          "key": True, "test_key": True, "checkout": "https://checkout.paycom.uz",
          "endpoint": "https://app.tangabot.uz/payme/endpoint", "fiscal": False,
          "order_ttl_hours": 24}


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _order(oid, user_id=1, state="paid", provider="payme", amount=19_000, plan="1m",
           performed: datetime | None = None, created: datetime | None = None, reason=None):
    now = datetime.now(settings.TZ)
    created = created or now
    with store.conn() as c:
        c.execute(
            """INSERT INTO payment_orders (order_id, user_id, plan, days, amount, provider,
                   provider_txn_id, state, create_time, perform_time, cancel_time, cancel_reason,
                   created_at, updated_at)
               VALUES (?, ?, ?, 30, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (oid, user_id, plan, amount, provider, f"txn-{oid}" if state != "pending" else None,
             state, _ms(created), _ms(performed or now) if state in ("paid", "refunded") else None,
             _ms(now) if state in ("cancelled", "refunded") else None, reason,
             created.isoformat(timespec="seconds"), now.isoformat(timespec="seconds")))


def _payment(method, amount, voided=False):
    with store.conn() as c:
        c.execute("INSERT INTO payments (user_id, plan_code, amount, days, method, created_by, "
                  "created_at, voided_at) VALUES (1, '1m', ?, 30, ?, 'payme', ?, ?)",
                  (amount, method, datetime.now(settings.TZ).isoformat(timespec="seconds"),
                   "2026-11-03T11:36:21+05:00" if voided else None))


def _status(data=STATUS):
    with store.conn() as c:
        c.execute("INSERT OR REPLACE INTO bot_status (key, value) VALUES ('payme', ?)",
                  (json.dumps(data),))


# ---------------------------------------------------------- daromad --

def test_sandbox_payments_never_count_as_revenue():
    add_user(1)
    _payment("payme", 19_000)
    _payment("qolda", 6_900)
    _payment("payme_test", 99_000)                 # bekor qilinmagan sandbox ham
    _payment("payme", 5_000, voided=True)
    ov = store.overview({777})
    assert ov["revenue_all"] == ov["revenue_month"] == 25_900
    assert store.revenue_series("oylik")["nowTotal"] == 25_900
    by = {m["method"]: m for m in store.revenue_by_method()}
    assert set(by) == {"payme", "qolda"}
    assert (by["payme"]["total"], by["payme"]["month"], by["payme"]["n"]) == (19_000, 19_000, 1)


# ------------------------------------------------------------ Payme --

def test_payme_page_lists_orders_and_summary(client):
    add_user(1)
    add_user(2, username="ali")
    now = datetime.now(settings.TZ)
    _order("100000000001", 1, "paid")
    _order("100000000002", 2, "paid", amount=149_000, plan="12m",
           performed=now - timedelta(days=40), created=now - timedelta(days=40))
    _order("100000000003", 2, "created")
    _order("100000000004", 1, "pending")
    _order("100000000005", 1, "cancelled", reason=4)
    _order("100000000006", 1, "paid", provider="payme_test")
    _status()

    r = client.get("/api/payme")
    assert r.status_code == 200
    data = r.json()
    ids = [o["order_id"] for o in data["items"]]
    assert "100000000006" not in ids and len(ids) == 5
    sm = data["summary"]
    assert sm["by_state"]["paid"] == {"count": 2, "amount": 168_000}
    assert sm["paid_today"] == {"count": 1, "amount": 19_000}
    assert sm["paid_month"]["count"] == 1
    assert sm["by_state"]["created"]["count"] == 1 and sm["test_count"] == 1
    assert (sm["links_30"], sm["paid_30"], sm["conversion_30"]) == (4, 1, 25)
    assert sm["status"]["prod"] is True and "key" in sm["status"]

    paid = client.get("/api/payme?holat=paid").json()["items"]
    assert {o["order_id"] for o in paid} == {"100000000001", "100000000002"}
    cancelled = client.get("/api/payme?holat=cancelled").json()["items"][0]
    assert cancelled["cancel_reason"] == 4 and cancelled["cancel_time_at"]
    test = client.get("/api/payme?test=true").json()["items"]
    assert [o["order_id"] for o in test] == ["100000000006"] and test[0]["test"] is True


def test_payme_status_on_system_and_dashboard(client):
    add_user(1)
    _status({**STATUS, "prod": False, "env": "test"})
    assert client.get("/api/system").json()["payme"]["env"] == "test"
    dash = client.get("/api/dashboard").json()
    assert dash["payme"]["status"]["prod"] is False
    assert "requests" not in dash and "pending" not in dash["overview"]


def test_user_card_shows_payme_orders_and_methods(client):
    add_user(1)
    _order("100000000011", 1, "paid")
    _order("100000000012", 1, "refunded", provider="payme_test", reason=5)
    _payment("payme", 19_000)
    u = client.get("/api/users/1").json()["user"]
    orders = {o["order_id"]: o for o in u["payme_orders"]}
    assert orders["100000000011"]["state"] == "paid" and not orders["100000000011"]["test"]
    assert orders["100000000012"]["test"] is True
    assert u["payments"][0]["method"] == "payme"


def test_payme_page_without_orders_table(client, monkeypatch):
    with store.conn() as c:
        c.execute("DROP TABLE payment_orders")
    data = client.get("/api/payme").json()
    assert data["items"] == [] and data["summary"]["known"] is False


# ------------------------------------------- qo'lda tasdiq yo'q --

def test_manual_approval_is_gone(client):
    add_user(1)
    rid = store.add_request(1, "1m", 19_000)
    assert client.post(f"/api/requests/{rid}/decide", json={"qaror": "tasdiq"}).status_code in (404, 405)
    assert client.get("/api/requests").status_code == 404
    assert client.get(f"/api/requests/{rid}/proof").status_code == 404
    assert not hasattr(store, "approve_request") and not hasattr(store, "decide_request")
    session = client.get("/api/session").json()
    assert "pending" not in session and "proofs" not in session
    assert "card_number" not in client.get("/api/settings").json()["bot"]
