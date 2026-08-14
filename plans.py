"""Obuna tariflari.

Narxlar admin panelning «Sozlamalar» ekranida o'zgartiriladi va
`app_settings` jadvalida saqlanadi. Bot ham SHU jadvalni o'qiydi, ya'ni
narx bitta joyda turadi — ilgari ro'yxat ikki loyihada takrorlanardi va
desinxron bo'lib qolishi mumkin edi.

Quyidagi ro'yxat — boshlang'ich qiymat: jadval bo'sh bo'lsa yoki baza
o'qilmasa shu ishlatiladi.
"""

from __future__ import annotations

DEFAULT_PLANS = [
    {"code": "1m", "days": 30, "months": 1, "price": 37_000, "label": "Oylik"},
    {"code": "3m", "days": 90, "months": 3, "price": 99_000, "label": "3 oylik"},
    {"code": "6m", "days": 180, "months": 6, "price": 179_000, "label": "6 oylik"},
    {"code": "12m", "days": 365, "months": 12, "price": 289_000, "label": "Yillik"},
]

PRICE_KEY = "plan_price_{code}"


def _int(raw, fallback: int) -> int:
    """Foydalanuvchi «179 000» deb yozishi mumkin — bo'shliqlar tashlanadi."""
    try:
        cleaned = "".join(ch for ch in str(raw) if ch.isdigit())
        value = int(cleaned)
    except (TypeError, ValueError):
        return fallback
    return value if value > 0 else fallback


def all_plans() -> list[dict]:
    """Joriy narxlar bilan tariflar ro'yxati."""
    try:
        import store
        overrides = store.settings_all()
    except Exception:
        overrides = {}

    result = []
    for base in DEFAULT_PLANS:
        plan = dict(base)
        raw = overrides.get(PRICE_KEY.format(code=plan["code"]))
        if raw:
            plan["price"] = _int(raw, plan["price"])
        plan["monthly"] = round(plan["price"] / plan["months"])
        result.append(plan)
    return result


def by_code(code: str) -> dict | None:
    key = (code or "").strip()
    return next((p for p in all_plans() if p["code"] == key), None)


def label(code: str) -> str:
    p = by_code(code)
    return p["label"] if p else (code or "—")


def price(code: str) -> int:
    p = by_code(code)
    return p["price"] if p else 0


def discount_percent(plan: dict) -> int:
    """Oylik tarifga nisbatan necha foiz tejaladi."""
    base = all_plans()[0]["price"] * plan["months"]
    if base <= 0 or plan["price"] >= base:
        return 0
    return round(100 - (plan["price"] / base) * 100)
