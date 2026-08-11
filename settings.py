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
DB_PATH = os.getenv("DB_PATH", "/opt/hisobchi/hisobchi.db")

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

APP_NAME = os.getenv("APP_NAME", "Hisobchi AI — Admin")


def missing() -> list[str]:
    problems = []
    if not SECRET_KEY or len(SECRET_KEY) < 32:
        problems.append("ADMIN_SECRET_KEY (kamida 32 belgi) yo'q")
    if not os.path.exists(DB_PATH):
        problems.append(f"Baza topilmadi: {DB_PATH}")
    return problems
