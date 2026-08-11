"""Obuna tariflari.

DIQQAT: bu ro'yxat bot loyihasidagi `config.SUBSCRIPTION_PLANS` bilan
bir xil bo'lishi kerak. Tarif o'zgartirilsa — ikkala joyda ham.
"""

from __future__ import annotations

SUBSCRIPTION_PLANS = [
    {"code": "1m", "days": 30, "months": 1, "price": 37_000, "label": "Oylik"},
    {"code": "3m", "days": 90, "months": 3, "price": 99_000, "label": "3 oylik"},
    {"code": "6m", "days": 180, "months": 6, "price": 179_000, "label": "6 oylik"},
    {"code": "12m", "days": 365, "months": 12, "price": 289_000, "label": "Yillik"},
]

BY_CODE = {p["code"]: p for p in SUBSCRIPTION_PLANS}


def by_code(code: str) -> dict | None:
    return BY_CODE.get((code or "").strip())


def label(code: str) -> str:
    p = by_code(code)
    return p["label"] if p else (code or "—")


def price(code: str) -> int:
    p = by_code(code)
    return p["price"] if p else 0
