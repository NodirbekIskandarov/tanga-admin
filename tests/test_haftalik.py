"""Haftalik tarif (1w): bot bilan bir xil kod/muddat/narx, sozlamalardan
narxi o'zgaradi, tasdiqlanganda 7 kun beriladi."""

from __future__ import annotations


import plans
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


