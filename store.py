"""Bazaga murojaat qatlami.

Bot bilan bir xil SQLite faylini ishlatadi. Bot jadvallariga TEGMAYDI —
faqat o'qiydi va boshqaruv uchun kerakli ustunlarni yangilaydi. Admin'ning
o'z jadvallari (`admin_users`, `admin_log`, `subscription_requests`,
`payments`) shu yerda yaratiladi.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta

import settings

# --------------------------------------------------------------------------- #
# Admin uchun qo'shimcha jadvallar
# --------------------------------------------------------------------------- #

ADMIN_SCHEMA = """
CREATE TABLE IF NOT EXISTS admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    salt          TEXT    NOT NULL,
    full_name     TEXT    NOT NULL DEFAULT '',
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT,
    must_change   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    admin      TEXT    NOT NULL,
    action     TEXT    NOT NULL,
    target     TEXT    NOT NULL DEFAULT '',
    details    TEXT    NOT NULL DEFAULT '',
    ip         TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_adminlog_time ON admin_log(created_at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL,
    ip         TEXT NOT NULL DEFAULT '',
    ok         INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_time ON login_attempts(username, created_at DESC);

-- Foydalanuvchi botda tarif tanlaganda shu yerga tushadi, admin panelda
-- ko'rinadi va shu yerdan tasdiqlanadi.
CREATE TABLE IF NOT EXISTS subscription_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    plan_code   TEXT    NOT NULL,
    price       INTEGER NOT NULL DEFAULT 0,
    status      TEXT    NOT NULL DEFAULT 'kutilmoqda',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    decided_at  TEXT,
    decided_by  TEXT    NOT NULL DEFAULT '',
    note        TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_req_status ON subscription_requests(status, created_at DESC);

-- Tasdiqlangan to'lovlar — daromad hisoboti shu jadvaldan chiqadi.
CREATE TABLE IF NOT EXISTS payments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    plan_code  TEXT    NOT NULL DEFAULT '',
    amount     INTEGER NOT NULL DEFAULT 0,
    days       INTEGER NOT NULL DEFAULT 0,
    method     TEXT    NOT NULL DEFAULT 'qolda',
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    created_by TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pay_time ON payments(created_at DESC);
"""


@contextmanager
def conn():
    c = sqlite3.connect(settings.DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode = WAL")
    c.execute("PRAGMA busy_timeout = 15000")
    try:
        yield c
        c.commit()
    finally:
        c.close()


# Keyin qo'shilgan ustunlar: (jadval, ustun, SQL). Bot loyihasidagi
# db.TABLE_MIGRATIONS bilan mos bo'lishi kerak — ikkala jarayon ham
# ishga tushganda bir xil sxemani kutadi.
COLUMN_MIGRATIONS = [
    ("subscription_requests", "proof_file_id",
     "ALTER TABLE subscription_requests ADD COLUMN proof_file_id TEXT"),
    ("subscription_requests", "proof_at",
     "ALTER TABLE subscription_requests ADD COLUMN proof_at TEXT"),
    ("subscription_requests", "proof_kind",
     "ALTER TABLE subscription_requests ADD COLUMN proof_kind TEXT NOT NULL DEFAULT 'rasm'"),
]


def init() -> None:
    with conn() as c:
        c.executescript(ADMIN_SCHEMA)
        for table, column, sql in COLUMN_MIGRATIONS:
            cols = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
            if cols and column not in cols:
                c.execute(sql)


def now_iso() -> str:
    return datetime.now(settings.TZ).isoformat(timespec="seconds")


def today() -> date:
    return datetime.now(settings.TZ).date()


def _parse(raw) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=settings.TZ)


# --------------------------------------------------------------------------- #
# Admin hisoblari
# --------------------------------------------------------------------------- #

def get_admin(username: str):
    with conn() as c:
        return c.execute(
            "SELECT * FROM admin_users WHERE username = ? AND is_active = 1",
            (username.strip().lower(),),
        ).fetchone()


def create_admin(username: str, password_hash: str, salt: str,
                 full_name: str = "", must_change: int = 0) -> int:
    with conn() as c:
        cur = c.execute(
            """INSERT INTO admin_users
               (username, password_hash, salt, full_name, must_change, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (username.strip().lower(), password_hash, salt, full_name, must_change,
             now_iso()),
        )
        return int(cur.lastrowid)


def set_admin_password(username: str, password_hash: str, salt: str) -> None:
    with conn() as c:
        c.execute(
            """UPDATE admin_users SET password_hash = ?, salt = ?, must_change = 0
               WHERE username = ?""",
            (password_hash, salt, username.strip().lower()),
        )


def touch_admin_login(username: str) -> None:
    with conn() as c:
        c.execute("UPDATE admin_users SET last_login_at = ? WHERE username = ?",
                  (now_iso(), username.strip().lower()))


def list_admins() -> list:
    with conn() as c:
        return c.execute(
            "SELECT username, full_name, is_active, created_at, last_login_at "
            "FROM admin_users ORDER BY username"
        ).fetchall()


# --------------------------------------------------------------------------- #
# Login urinishlari
# --------------------------------------------------------------------------- #

def record_login(username: str, ip: str, ok: bool) -> None:
    with conn() as c:
        c.execute(
            "INSERT INTO login_attempts (username, ip, ok, created_at) VALUES (?,?,?,?)",
            (username.strip().lower(), ip, 1 if ok else 0, now_iso()))


def recent_failures(username: str) -> int:
    """Oxirgi qulflash oynasidagi ketma-ket muvaffaqiyatsiz urinishlar soni."""
    since = (datetime.now(settings.TZ)
             - timedelta(minutes=settings.LOGIN_LOCK_MINUTES)).isoformat(timespec="seconds")
    with conn() as c:
        rows = c.execute(
            # id bo'yicha tartiblaymiz: bir soniya ichidagi urinishlarda
            # vaqt muhri bir xil bo'lib qolishi mumkin.
            """SELECT ok FROM login_attempts
               WHERE username = ? AND created_at >= ?
               ORDER BY id DESC LIMIT 20""",
            (username.strip().lower(), since),
        ).fetchall()
    count = 0
    for r in rows:
        if r["ok"]:
            break
        count += 1
    return count


# --------------------------------------------------------------------------- #
# Jurnal
# --------------------------------------------------------------------------- #

def log_action(admin: str, action: str, target: str = "", details: str = "",
               ip: str = "") -> None:
    with conn() as c:
        c.execute(
            "INSERT INTO admin_log (admin, action, target, details, ip, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (admin, action, str(target), details, ip, now_iso()),
        )


def list_log(limit: int = 200, offset: int = 0) -> list:
    with conn() as c:
        return c.execute(
            "SELECT * FROM admin_log ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()


def count_log() -> int:
    with conn() as c:
        return int(c.execute("SELECT COUNT(*) FROM admin_log").fetchone()[0])


# --------------------------------------------------------------------------- #
# Foydalanuvchilar
# --------------------------------------------------------------------------- #

def access_state(row, owner_ids: set[int]) -> str:
    """Bot bilan bir xil mantiq: ega / bloklangan / obunachi / sinov / tugagan."""
    if row["user_id"] in owner_ids:
        return "ega"
    if row["blocked"]:
        return "bloklangan"
    now = datetime.now(settings.TZ)
    sub = _parse(row["subscribed_until"])
    if sub and sub > now:
        return "obunachi"
    trial = _parse(row["trial_ends_at"])
    if trial and trial > now:
        return "sinov"
    return "tugagan"


def days_left(row) -> int | None:
    now = datetime.now(settings.TZ)
    for key in ("subscribed_until", "trial_ends_at"):
        dt = _parse(row[key])
        if dt and dt > now:
            return max(0, (dt - now).days)
    return None


def list_users(search: str = "", state: str = "", owner_ids: set[int] | None = None,
               sort: str = "yangi", limit: int = 50, offset: int = 0) -> tuple[list, int]:
    """Foydalanuvchilar ro'yxati. Holat bo'yicha filtr Python tomonida —
    u sana taqqoslashiga bog'liq va foydalanuvchilar soni kichik."""
    owner_ids = owner_ids or set()
    where, params = [], []
    if search.strip():
        needle = f"%{search.strip().lower()}%"
        where.append("(LOWER(COALESCE(first_name,'')) LIKE ? "
                     "OR LOWER(COALESCE(username,'')) LIKE ? "
                     "OR CAST(user_id AS TEXT) LIKE ?)")
        params += [needle, needle, needle]

    sql = "SELECT * FROM users"
    if where:
        sql += " WHERE " + " AND ".join(where)

    with conn() as c:
        rows = [dict(r) for r in c.execute(sql, params).fetchall()]
        counts = dict(c.execute(
            "SELECT user_id, COUNT(*) FROM transactions GROUP BY user_id").fetchall())
        costs = dict(c.execute(
            "SELECT user_id, ROUND(SUM(cost_usd), 4) FROM usage_log GROUP BY user_id"
        ).fetchall())

    for r in rows:
        r["state"] = access_state(r, owner_ids)
        r["days_left"] = days_left(r)
        r["tx_count"] = counts.get(r["user_id"], 0)
        r["cost_usd"] = costs.get(r["user_id"], 0.0) or 0.0

    if state:
        rows = [r for r in rows if r["state"] == state]

    keys = {
        "yangi": lambda r: (r["created_at"] or ""),
        "faol": lambda r: (r["last_seen_at"] or ""),
        "yozuv": lambda r: r["tx_count"],
        "xarajat": lambda r: r["cost_usd"],
    }
    rows.sort(key=keys.get(sort, keys["yangi"]), reverse=True)

    return rows[offset:offset + limit], len(rows)


def get_user(user_id: int, owner_ids: set[int] | None = None) -> dict | None:
    owner_ids = owner_ids or set()
    with conn() as c:
        row = c.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        if not row:
            return None
        u = dict(row)
        u["state"] = access_state(row, owner_ids)
        u["days_left"] = days_left(row)
        u["tx_count"] = int(c.execute(
            "SELECT COUNT(*) FROM transactions WHERE user_id = ?", (user_id,)).fetchone()[0])
        u["usage"] = [dict(r) for r in c.execute(
            """SELECT operation, COUNT(*) AS calls, ROUND(SUM(cost_usd), 4) AS cost
               FROM usage_log WHERE user_id = ? GROUP BY operation ORDER BY cost DESC""",
            (user_id,)).fetchall()]
        u["cost_usd"] = round(sum(x["cost"] or 0 for x in u["usage"]), 4)
        u["recent_tx"] = [dict(r) for r in c.execute(
            """SELECT id, occurred_on, kind, amount, currency, category, note
               FROM transactions WHERE user_id = ?
               ORDER BY occurred_on DESC, id DESC LIMIT 15""", (user_id,)).fetchall()]
        u["payments"] = [dict(r) for r in c.execute(
            "SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 10",
            (user_id,)).fetchall()]
        u["requests"] = [dict(r) for r in c.execute(
            "SELECT * FROM subscription_requests WHERE user_id = ? ORDER BY id DESC LIMIT 10",
            (user_id,)).fetchall()]
        u["paid_total"] = int(c.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE user_id = ?",
            (user_id,)).fetchone()[0])
    return u


def all_user_ids(state: str = "", owner_ids: set[int] | None = None) -> list[int]:
    rows, _ = list_users(state=state, owner_ids=owner_ids, limit=10**9)
    return [r["user_id"] for r in rows]


def grant_subscription(user_id: int, days: int) -> datetime:
    """Obunani uzaytiradi — mavjud muddat ustiga qo'shiladi (bot bilan bir xil)."""
    now = datetime.now(settings.TZ)
    with conn() as c:
        row = c.execute("SELECT subscribed_until FROM users WHERE user_id = ?",
                        (user_id,)).fetchone()
        base = now
        if row:
            cur = _parse(row["subscribed_until"])
            if cur and cur > now:
                base = cur
        until = base + timedelta(days=days)
        c.execute(
            """INSERT INTO users (user_id, subscribed_until) VALUES (?, ?)
               ON CONFLICT(user_id) DO UPDATE SET subscribed_until = excluded.subscribed_until""",
            (user_id, until.isoformat(timespec="seconds")),
        )
    return until


def set_subscription_until(user_id: int, until: datetime | None) -> None:
    with conn() as c:
        c.execute("UPDATE users SET subscribed_until = ? WHERE user_id = ?",
                  (until.isoformat(timespec="seconds") if until else None, user_id))


def extend_trial(user_id: int, days: int) -> datetime:
    now = datetime.now(settings.TZ)
    with conn() as c:
        row = c.execute("SELECT trial_ends_at FROM users WHERE user_id = ?",
                        (user_id,)).fetchone()
        base = now
        if row:
            cur = _parse(row["trial_ends_at"])
            if cur and cur > now:
                base = cur
        until = base + timedelta(days=days)
        c.execute("UPDATE users SET trial_ends_at = ? WHERE user_id = ?",
                  (until.isoformat(timespec="seconds"), user_id))
    return until


def set_blocked(user_id: int, blocked: bool) -> None:
    with conn() as c:
        c.execute("UPDATE users SET blocked = ? WHERE user_id = ?",
                  (1 if blocked else 0, user_id))


def delete_user_data(user_id: int) -> dict:
    """Foydalanuvchining butun izini o'chiradi. Qaytarib bo'lmaydi."""
    with conn() as c:
        tx = c.execute("DELETE FROM transactions WHERE user_id = ?", (user_id,)).rowcount
        us = c.execute("DELETE FROM usage_log WHERE user_id = ?", (user_id,)).rowcount
        c.execute("DELETE FROM subscription_requests WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
    return {"transactions": tx, "usage": us}


# --------------------------------------------------------------------------- #
# Obuna so'rovlari
# --------------------------------------------------------------------------- #

def add_request(user_id: int, plan_code: str, price: int) -> int:
    with conn() as c:
        cur = c.execute(
            "INSERT INTO subscription_requests (user_id, plan_code, price, created_at) "
            "VALUES (?,?,?,?)",
            (user_id, plan_code, price, now_iso()))
        return int(cur.lastrowid)


def list_requests(status: str = "", limit: int = 100) -> list:
    """status: '' — hammasi, 'ochiq' — hal qilinmaganlar, yoki aniq holat."""
    sql = ("SELECT r.*, u.first_name, u.username FROM subscription_requests r "
           "LEFT JOIN users u ON u.user_id = r.user_id")
    params: list = []
    if status == "ochiq":
        sql += " WHERE r.status IN ('kutilmoqda', 'tekshiruvda')"
    elif status:
        sql += " WHERE r.status = ?"
        params.append(status)
    # Cheki kelganlar tepada — ular darhol javob kutmoqda.
    sql += (" ORDER BY CASE r.status WHEN 'tekshiruvda' THEN 0 "
            "WHEN 'kutilmoqda' THEN 1 ELSE 2 END, r.id DESC LIMIT ?")
    params.append(limit)
    with conn() as c:
        return [dict(r) for r in c.execute(sql, params).fetchall()]


def pending_count() -> int:
    """Javob kutayotgan so'rovlar — cheki kelganlar ham, hali kelmaganlar ham."""
    with conn() as c:
        return int(c.execute(
            "SELECT COUNT(*) FROM subscription_requests "
            "WHERE status IN ('kutilmoqda', 'tekshiruvda')"
        ).fetchone()[0])


def proof_count() -> int:
    """Cheki kelgan, darhol javob kutayotgan so'rovlar."""
    with conn() as c:
        return int(c.execute(
            "SELECT COUNT(*) FROM subscription_requests WHERE status = 'tekshiruvda'"
        ).fetchone()[0])


def get_request(req_id: int) -> dict | None:
    with conn() as c:
        row = c.execute("SELECT * FROM subscription_requests WHERE id = ?",
                        (req_id,)).fetchone()
        return dict(row) if row else None


def decide_request(req_id: int, status: str, admin: str, note: str = "") -> None:
    with conn() as c:
        c.execute(
            """UPDATE subscription_requests
               SET status = ?, decided_at = ?, decided_by = ?, note = ?
               WHERE id = ?""",
            (status, now_iso(), admin, note, req_id))


def add_payment(user_id: int, plan_code: str, amount: int, days: int,
                admin: str, method: str = "qolda") -> None:
    with conn() as c:
        c.execute(
            """INSERT INTO payments
               (user_id, plan_code, amount, days, method, created_by, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (user_id, plan_code, amount, days, method, admin, now_iso()))


# --------------------------------------------------------------------------- #
# Statistika
# --------------------------------------------------------------------------- #

def overview(owner_ids: set[int]) -> dict:
    now = datetime.now(settings.TZ)
    with conn() as c:
        users = [dict(r) for r in c.execute("SELECT * FROM users").fetchall()]
        tx_total = int(c.execute("SELECT COUNT(*) FROM transactions").fetchone()[0])
        tx_today = int(c.execute(
            "SELECT COUNT(*) FROM transactions WHERE occurred_on = ?",
            (today().isoformat(),)).fetchone()[0])
        cost_all = float(c.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM usage_log").fetchone()[0])
        cost_month = float(c.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM usage_log WHERE day >= ?",
            (today().replace(day=1).isoformat(),)).fetchone()[0])
        calls_today = int(c.execute(
            "SELECT COUNT(*) FROM usage_log WHERE day = ?",
            (today().isoformat(),)).fetchone()[0])
        revenue_all = int(c.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM payments").fetchone()[0])
        revenue_month = int(c.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE created_at >= ?",
            (today().replace(day=1).isoformat(),)).fetchone()[0])

    states = {"ega": 0, "obunachi": 0, "sinov": 0, "tugagan": 0, "bloklangan": 0}
    active_7 = 0
    for u in users:
        states[access_state(u, owner_ids)] += 1
        seen = _parse(u["last_seen_at"])
        if seen and (now - seen).days < 7:
            active_7 += 1

    payers = states["obunachi"]
    total_nonowner = max(1, len(users) - states["ega"])

    return {
        "users_total": len(users),
        "states": states,
        "active_7": active_7,
        "tx_total": tx_total,
        "tx_today": tx_today,
        "cost_all": round(cost_all, 4),
        "cost_month": round(cost_month, 4),
        "calls_today": calls_today,
        "revenue_all": revenue_all,
        "revenue_month": revenue_month,
        "profit_month": round(revenue_month - cost_month * settings.USD_RATE),
        "conversion": round(100 * payers / total_nonowner, 1),
        "pending": pending_count(),
    }


def daily_series(days: int = 30) -> dict:
    """Kunlik yangi foydalanuvchi, yozuv va AI xarajati — grafik uchun."""
    start = today() - timedelta(days=days - 1)
    labels = [(start + timedelta(days=i)).isoformat() for i in range(days)]
    users, txs, costs = {}, {}, {}
    with conn() as c:
        for r in c.execute(
                "SELECT substr(created_at,1,10) d, COUNT(*) n FROM users "
                "WHERE substr(created_at,1,10) >= ? GROUP BY d", (start.isoformat(),)):
            users[r["d"]] = r["n"]
        for r in c.execute(
                "SELECT occurred_on d, COUNT(*) n FROM transactions "
                "WHERE occurred_on >= ? GROUP BY d", (start.isoformat(),)):
            txs[r["d"]] = r["n"]
        for r in c.execute(
                "SELECT day d, ROUND(SUM(cost_usd),4) s FROM usage_log "
                "WHERE day >= ? GROUP BY d", (start.isoformat(),)):
            costs[r["d"]] = r["s"]
    return {
        "labels": labels,
        "users": [users.get(d, 0) for d in labels],
        "transactions": [txs.get(d, 0) for d in labels],
        "cost": [round(costs.get(d, 0) or 0, 4) for d in labels],
    }


def cost_breakdown(days: int = 30) -> dict:
    start = (today() - timedelta(days=days - 1)).isoformat()
    with conn() as c:
        by_op = [dict(r) for r in c.execute(
            """SELECT operation, COUNT(*) calls, ROUND(SUM(cost_usd),4) cost,
                      SUM(input_tokens) inp, SUM(output_tokens) outp,
                      SUM(cache_read) cread
               FROM usage_log WHERE day >= ? GROUP BY operation ORDER BY cost DESC""",
            (start,)).fetchall()]
        by_model = [dict(r) for r in c.execute(
            """SELECT model, COUNT(*) calls, ROUND(SUM(cost_usd),4) cost
               FROM usage_log WHERE day >= ? GROUP BY model ORDER BY cost DESC""",
            (start,)).fetchall()]
    return {"by_operation": by_op, "by_model": by_model}


def top_spenders(limit: int = 15, days: int = 30) -> list:
    start = (today() - timedelta(days=days - 1)).isoformat()
    with conn() as c:
        return [dict(r) for r in c.execute(
            """SELECT l.user_id, COUNT(*) calls, ROUND(SUM(l.cost_usd),4) cost,
                      u.first_name, u.username
               FROM usage_log l LEFT JOIN users u ON u.user_id = l.user_id
               WHERE l.day >= ? GROUP BY l.user_id ORDER BY cost DESC LIMIT ?""",
            (start, limit)).fetchall()]


def recent_payments(limit: int = 20) -> list:
    with conn() as c:
        return [dict(r) for r in c.execute(
            """SELECT p.*, u.first_name, u.username FROM payments p
               LEFT JOIN users u ON u.user_id = p.user_id
               ORDER BY p.id DESC LIMIT ?""", (limit,)).fetchall()]


def expiring_soon(days: int = 7, owner_ids: set[int] | None = None) -> list:
    """Yaqin kunlarda muddati tugaydiganlar — ularga oldindan yozish kerak."""
    owner_ids = owner_ids or set()
    now = datetime.now(settings.TZ)
    limit = now + timedelta(days=days)
    out = []
    with conn() as c:
        for r in c.execute("SELECT * FROM users WHERE blocked = 0").fetchall():
            if r["user_id"] in owner_ids:
                continue
            state = access_state(r, owner_ids)
            if state not in ("sinov", "obunachi"):
                continue
            key = "subscribed_until" if state == "obunachi" else "trial_ends_at"
            dt = _parse(r[key])
            if dt and now < dt <= limit:
                d = dict(r)
                d["state"] = state
                d["expires_at"] = dt
                d["days_left"] = max(0, (dt - now).days)
                out.append(d)
    out.sort(key=lambda x: x["expires_at"])
    return out
