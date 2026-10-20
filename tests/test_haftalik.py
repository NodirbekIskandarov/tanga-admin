"""Haftalik tarif (1w): bot bilan bir xil kod/muddat/narx, sozlamalardan
narxi o'zgaradi, tasdiqlanganda 7 kun beriladi."""

from __future__ import annotations

from datetime import datetime

import plans
import settings
import store
from tests.conftest import add_user
from tests.test_muhim import app_module, client  # noqa: F401


def test_weekly_plan_defaults():
    p = plans.by_code("1w")
    assert p["days"] == 7 and p["price"] == 6_900 and p["public"]
    assert plans.discount_percent(p) == 0            # haftasiga oylikdan qimmat


def test_weekly_price_is_editable_in_settings(client):
    current = {p["code"]: p["price"] for p in plans.all_plans()}
    body = {f"plan_price_{c}": v for c, v in current.items()}
    body.update({"plan_price_1w": 7_900, "card_number": "", "card_holder": "",
                 "trial_days": 7, "ai_monthly_budget_usd": 50,
                 "ai_user_monthly_budget_usd": 0.5})
    r = client.post("/api/settings", json=body)
    assert r.status_code == 200, r.text
    got = {p["code"]: p["price"] for p in r.json()["plans"]}
    assert got["1w"] == 7_900 and got["1m"] == current["1m"]


def test_approving_weekly_request_grants_seven_days():
    add_user(1)
    rid = store.add_request(1, "1w", 6_900)
    store.attach_payment_proof(rid, "CHEK", "rasm") if hasattr(store, "attach_payment_proof") else None
    assert store.approve_request(rid, plans.by_code("1w"), "admin") is not None
    until = datetime.fromisoformat(store.get_user(1, {777})["subscribed_until"])
    assert round((until - datetime.now(settings.TZ)).total_seconds() / 86400) == 7
