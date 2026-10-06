"""Sinov muhiti: vaqtinchalik, shifrlanmagan baza va bot jadvallari.

`settings` modul yuklanganda muhitni o'qiydi, shuning uchun qiymatlar
HAMMA importdan oldin shu yerda qo'yiladi. Haqiqiy `.env` ga tegilmaydi:
`settings._load_env` mavjud o'zgaruvchini almashtirmaydi.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

for name, value in {
    "ADMIN_SECRET_KEY": "s" * 48,
    "TELEGRAM_TOKEN": "123:test",
    "DB_ENCRYPTION_KEY": "",
    "OWNER_IDS": "777",
    "TIMEZONE": "Asia/Tashkent",
    "COOKIE_SECURE": "false",
}.items():
    os.environ[name] = value

import pytest  # noqa: E402

import settings  # noqa: E402
import store  # noqa: E402

# Bot yaratadigan jadvallar (tanga/db.py) — panel ularga tayanadi, lekin
# o'zi yaratmaydi. Faqat panel ishlatadigan ustunlar.
BOT_SCHEMA = """
CREATE TABLE users (
    user_id          INTEGER PRIMARY KEY,
    first_name       TEXT    NOT NULL DEFAULT '',
    username         TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    trial_ends_at    TEXT,
    subscribed_until TEXT,
    blocked          INTEGER NOT NULL DEFAULT 0,
    last_seen_at     TEXT,
    warned_stage     INTEGER NOT NULL DEFAULT 0,
    lang             TEXT    NOT NULL DEFAULT 'uz',
    consent_at       TEXT,
    consent_version  TEXT    NOT NULL DEFAULT '',
    bot_blocked_at   TEXT,
    source           TEXT
);
CREATE TABLE usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    day TEXT NOT NULL, operation TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    name TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', day TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    path = tmp_path / "tanga.db"
    monkeypatch.setattr(settings, "DB_PATH", str(path))
    with store.conn() as c:
        c.executescript(BOT_SCHEMA)
    store.init()
    yield


def add_user(user_id: int, **cols) -> None:
    cols = {"first_name": f"U{user_id}", "consent_at": "2026-08-20T10:00:00+05:00",
            **cols}
    names = ", ".join(["user_id", *cols])
    marks = ", ".join("?" * (len(cols) + 1))
    with store.conn() as c:
        c.execute(f"INSERT INTO users ({names}) VALUES ({marks})",
                  (user_id, *cols.values()))
