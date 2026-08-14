"""Sozlamalar — .env faylidan o'qiladi."""

from __future__ import annotations

import os
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent


def _load_env() -> None:
    """.env ni o'qiydi. Tashqi kutubxonasiz — qatorlar KEY=VALUE ko'rinishida."""
    path = BASE_DIR / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # systemd EnvironmentFile bergan qiymat ustunroq turadi.
        os.environ.setdefault(key, value)


_load_env()

# Bot bilan BIR XIL baza fayli — admin panel o'sha ma'lumotni boshqaradi.
DB_PATH = os.getenv("DB_PATH", "/opt/tanga/tanga.db")

# Bazani shifrlash kaliti — bot loyihasidagi bilan AYNAN bir xil bo'lishi
# shart (ikkalasi bitta faylni ochadi). 64 ta o'n oltilik belgi.
# Bo'sh bo'lsa baza oddiy SQLite deb ochiladi.
DB_ENCRYPTION_KEY = os.getenv("DB_ENCRYPTION_KEY", "").strip().lower()


def db_key_pragma() -> str:
    """`PRAGMA key` qiymati. PRAGMA bog'langan parametrni qabul qilmaydi,
    shuning uchun hex ishlatiladi — qochirish muammosi bo'lmaydi."""
    key = DB_ENCRYPTION_KEY
    if len(key) != 64 or any(ch not in "0123456789abcdef" for ch in key):
        raise SystemExit(
            "DB_ENCRYPTION_KEY 64 ta o'n oltilik belgidan iborat bo'lishi kerak "
            f"(hozir {len(key)} ta)."
        )
    return f"\"x'{key}'\""


# Telegram xabar yuborish uchun (obuna tasdiqlandi, ommaviy xabar).
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "").strip()

# Sessiya cookie'sini imzolash kaliti. Almashtirilsa hamma seans tugaydi.
SECRET_KEY = os.getenv("ADMIN_SECRET_KEY", "").strip()

# HTTPS orqasida ishlaydi (Caddy) — cookie faqat shifrlangan ulanishda ketsin.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() in ("1", "true", "yes")
SESSION_HOURS = int(os.getenv("SESSION_HOURS", "12"))

# Login urinishlarini cheklash.
LOGIN_MAX_ATTEMPTS = int(os.getenv("LOGIN_MAX_ATTEMPTS", "5"))
LOGIN_LOCK_MINUTES = int(os.getenv("LOGIN_LOCK_MINUTES", "15"))

TZ = ZoneInfo(os.getenv("TIMEZONE", "Asia/Tashkent"))

# Foyda hisobini so'mda ko'rsatish uchun (AI xarajati dollarda keladi).
USD_RATE = float(os.getenv("USD_RATE", "12600"))

APP_NAME = os.getenv("APP_NAME", "Tanga — Admin")

# --------------------------------------------------------------------------- #
# «Sozlamalar» ekranida o'zgartiriladigan qiymatlar
#
# Boshlang'ich qiymat .env dan olinadi. Admin ularni panelda o'zgartirsa,
# `app_settings` jadvaliga yoziladi va bot ham o'sha jadvalni o'qiydi —
# narx va rekvizit ikki joyda alohida turmasin.
# --------------------------------------------------------------------------- #

DEFAULT_TRIAL_DAYS = int(os.getenv("TRIAL_DAYS", "7"))
DEFAULT_MONTHLY_BUDGET_USD = float(os.getenv("MONTHLY_BUDGET_USD", "50"))
DEFAULT_CARD_NUMBER = os.getenv("CARD_NUMBER", "").strip()
DEFAULT_CARD_HOLDER = os.getenv("CARD_HOLDER", "").strip()


def _stored() -> dict:
    # Kech import: store settings'ni import qiladi — modul yuklanish
    # paytida teskari import aylanma bog'liqlik hosil qilardi.
    try:
        import store
        return store.settings_all()
    except Exception:
        return {}


def trial_days() -> int:
    try:
        value = int(str(_stored().get("trial_days", "")).strip())
        return value if 1 <= value <= 365 else DEFAULT_TRIAL_DAYS
    except (TypeError, ValueError):
        return DEFAULT_TRIAL_DAYS


def ai_monthly_budget_usd() -> float:
    try:
        value = float(str(_stored().get("ai_monthly_budget_usd", "")).strip())
        return value if value > 0 else DEFAULT_MONTHLY_BUDGET_USD
    except (TypeError, ValueError):
        return DEFAULT_MONTHLY_BUDGET_USD


def card_number() -> str:
    return str(_stored().get("card_number", "") or DEFAULT_CARD_NUMBER)


def card_holder() -> str:
    return str(_stored().get("card_holder", "") or DEFAULT_CARD_HOLDER)


def missing() -> list[str]:
    problems = []
    if not SECRET_KEY or len(SECRET_KEY) < 32:
        problems.append("ADMIN_SECRET_KEY (kamida 32 belgi) yo'q")
    if not os.path.exists(DB_PATH):
        problems.append(f"Baza topilmadi: {DB_PATH}")
    return problems
