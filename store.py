"""Bazaga murojaat qatlami.

Bot bilan bir xil SQLite faylini ishlatadi. Bot jadvallariga TEGMAYDI —
faqat o'qiydi va boshqaruv uchun kerakli ustunlarni yangilaydi. Admin'ning
o'z jadvallari (`admin_users`, `admin_log`, `subscription_requests`,
`payments`) shu yerda yaratiladi.
"""

from __future__ import annotations

import json
import os
import platform
import sqlite3
import threading
from contextlib import contextmanager
from datetime import date, datetime, timedelta

import settings

# --------------------------------------------------------------------------- #
# Admin uchun qo'shimcha jadvallar
# --------------------------------------------------------------------------- #

ADMIN_SCHEMA = """
-- Kunlik yozuvlar SONI va o'chirish navbati. Ikkalasini ham odatda bot
-- yaratadi (db.py dagi SCHEMA ga qarang), lekin panel botdan oldin
-- ishga tushishi mumkin — shuning uchun bu yerda ham bor. Ikkalasida
-- ham ta'rif AYNAN bir xil bo'lishi shart.
--
-- Diqqat: bu jadvalda faqat SON bor. Foydalanuvchining summasi,
-- kategoriyasi va izohi shaxsiy bazada va bu ilovada uning kaliti yo'q.
CREATE TABLE IF NOT EXISTS entry_counts (
    user_id INTEGER NOT NULL,
    day     TEXT    NOT NULL,
    n       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_entry_day ON entry_counts(day);

CREATE TABLE IF NOT EXISTS private_erase_queue (
    user_id  INTEGER PRIMARY KEY,
    asked_at TEXT NOT NULL DEFAULT (datetime('now')),
    done_at  TEXT
);

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
    created_by TEXT    NOT NULL DEFAULT '',
    -- Xato yoki takroriy yozuv: daromadga kirmaydi, yozuv tarix uchun qoladi.
    -- Bu pulni qaytarish EMAS — obuna to'lovi qaytarilmaydi (shartlar, 4-band).
    voided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_time ON payments(created_at DESC);

-- Admin panelda o'zgartiriladigan sozlamalar: tarif narxlari, karta
-- rekvizitlari, sinov muddati, AI limiti. Bot ham SHU jadvalni o'qiydi —
-- narx ikki joyda alohida turmasin va desinxron bo'lib qolmasin.
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT NOT NULL DEFAULT ''
);
"""


def _open(path: str, timeout: int):
    """Bazaga ulanadi. Kalit sozlangan bo'lsa — SQLCipher orqali.

    Bot loyihasidagi db._open bilan bir xil mantiq: ikkala jarayon ham
    AYNAN bitta faylni ochadi, shuning uchun kalit ham bir xil bo'lishi
    shart.
    """
    if not settings.DB_ENCRYPTION_KEY:
        c = sqlite3.connect(path, timeout=timeout)
        c.row_factory = sqlite3.Row
        return c

    from sqlcipher3 import dbapi2 as sqlcipher

    c = sqlcipher.connect(path, timeout=timeout)
    c.execute(f"PRAGMA key = {settings.db_key_pragma()}")
    # Row sinfi modulga bog'liq — sqlite3.Row bu yerda ishlamaydi.
    c.row_factory = sqlcipher.Row
    return c


# Ulanishni ochish/yopish bitta qulf ostida. Sabab (2026-10-22): panel
# qotib qoldi — py-spy ikki ishchi oqimni ko'rsatdi, biri SQLCipher
# ulanishini ochayotgan (`_open`), ikkinchisi yopayotgan (`c.close()`),
# ikkalasi ham mutex kutib turibdi. SQLCipher kalit/provayder mutexlari
# ulanish ochilayotganda va yopilayotganda olinadi; bir vaqtda ikki oqimdan
# chaqirilganda deadlock bo'ldi. So'rovlarning o'zi qulfdan tashqarida
# bajariladi — faqat ochish va yopish ketma-ket.
_OPEN_LOCK = threading.Lock()


@contextmanager
def conn():
    with _OPEN_LOCK:
        c = _open(settings.DB_PATH, timeout=15)
        c.execute("PRAGMA journal_mode = WAL")
        c.execute("PRAGMA busy_timeout = 15000")
    try:
        yield c
        c.commit()
    finally:
        with _OPEN_LOCK:
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


# Panelning o'z jadvallariga keyin qo'shilgan ustunlar.
ADMIN_COLUMN_MIGRATIONS = [
    # Ikki bosqichli kirish (TOTP) siri, base32. Bo'sh — 2FA yoqilmagan.
    ("admin_users", "totp_secret",
     "ALTER TABLE admin_users ADD COLUMN totp_secret TEXT"),
    ("payments", "voided_at",
     "ALTER TABLE payments ADD COLUMN voided_at TEXT"),
]


def init() -> None:
    with conn() as c:
        c.executescript(ADMIN_SCHEMA)
        for table, column, sql in COLUMN_MIGRATIONS + ADMIN_COLUMN_MIGRATIONS:
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


def set_admin_password(username: str, password_hash: str, salt: str,
                       must_change: int = 0) -> None:
    """Parolni yozadi. `must_change=1` — parol operator tomonidan
    berilgan (terminalda ko'rsatilgan): admin birinchi kirishda uni o'zi
    almashtirishi shart."""
    with conn() as c:
        c.execute(
            """UPDATE admin_users SET password_hash = ?, salt = ?, must_change = ?
               WHERE username = ?""",
            (password_hash, salt, must_change, username.strip().lower()),
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


def set_admin_totp(username: str, secret: str | None) -> bool:
    """Ikki bosqichli kirishni yoqadi (sir) yoki o'chiradi (None)."""
    with conn() as c:
        return c.execute("UPDATE admin_users SET totp_secret = ? WHERE username = ?",
                         (secret, username.strip().lower())).rowcount > 0


def recent_failures(username: str, ip: str) -> int:
    """Shu login va SHU IP dan oxirgi qulflash oynasidagi ketma-ket
    muvaffaqiyatsiz urinishlar soni.

    Ilgari faqat login bo'yicha sanalardi: login nomini bilgan har kim
    5 ta xato urinish bilan haqiqiy adminni 15 daqiqaga kirolmaydigan
    qilib qo'ya olardi. Endi qulf faqat urinayotgan manzilga tushadi;
    ko'p manzildan keladigan hujumni fail2ban (`panel-admin` jail'i,
    «KIRISH XATO» qatori) firewall darajasida to'xtatadi.
    """
    since = (datetime.now(settings.TZ)
             - timedelta(minutes=settings.LOGIN_LOCK_MINUTES)).isoformat(timespec="seconds")
    with conn() as c:
        rows = c.execute(
            # id bo'yicha tartiblaymiz: bir soniya ichidagi urinishlarda
            # vaqt muhri bir xil bo'lib qolishi mumkin.
            """SELECT ok FROM login_attempts
               WHERE username = ? AND ip = ? AND created_at >= ?
               ORDER BY id DESC LIMIT 20""",
            (username.strip().lower(), ip, since),
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
# Sozlamalar
#
# Bu qiymatlarni admin panelda o'zgartirish mumkin. Bot ham shu jadvalni
# o'qiydi, shuning uchun narx bir joyda turadi.
# --------------------------------------------------------------------------- #

def settings_all() -> dict[str, str]:
    with conn() as c:
        return {r["key"]: r["value"]
                for r in c.execute("SELECT key, value FROM app_settings").fetchall()}


def settings_save(values: dict[str, str], admin: str) -> None:
    stamp = now_iso()
    with conn() as c:
        for key, value in values.items():
            c.execute(
                "INSERT INTO app_settings (key, value, updated_at, updated_by) "
                "VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET "
                "value = excluded.value, updated_at = excluded.updated_at, "
                "updated_by = excluded.updated_by",
                (key, str(value), stamp, admin),
            )


# --------------------------------------------------------------------------- #
# Foydalanuvchilar
# --------------------------------------------------------------------------- #

def access_state(row, owner_ids: set[int]) -> str:
    """Bot bilan bir xil mantiq: ega / bloklangan / obunachi / sinov / bepul.

    «bepul» — sinovi yoki obunasi tugagan, lekin botdan foydalanishda
    davom etadigan odam: bot 2026-10-03 dan beri hech kimni yopmaydi,
    Bepul darajaga o'tkazadi. Ilgari bu holat «tugagan» deb atalardi va
    panelda yo'qotilgan foydalanuvchidek (qizil) ko'rinardi.
    """
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
    return "bepul"


# Aloqa segmentlari — holatdan (obuna) farqli, odam BIZGA yetib boradimi
# va umuman boshlaganmi degan savolga javob. 87 foydalanuvchidan 39 tasi
# botni bloklagani (2026-10) holat filtrida umuman ko'rinmasdi.
SEGMENTLAR = {
    "yetib_boradi": "Xabar yetib boradi",
    "bloklagan": "Botni bloklagan",
    "rozilik_yoq": "Rozilik bermagan",
    "yozmagan": "Hech yozmagan",
}


def _in_segment(r: dict, segment: str) -> bool:
    if segment == "bloklagan":
        return bool(r.get("bot_blocked"))
    if segment == "rozilik_yoq":
        return not r.get("consented")
    if segment == "yozmagan":
        return r.get("tx_count", 0) == 0
    if segment == "yetib_boradi":
        return reachable(r)
    return True


def days_left(row) -> int | None:
    now = datetime.now(settings.TZ)
    for key in ("subscribed_until", "trial_ends_at"):
        dt = _parse(row[key])
        if dt and dt > now:
            return max(0, (dt - now).days)
    return None


def _days_since(raw) -> int | None:
    """Oxirgi faollikdan beri necha KUN o'tgani — kalendar bo'yicha.

    Ataylab o'tgan soatlar emas: odam «2 kun oldin» deganda ikkita
    sana orqaga tushishni tushunadi. Soat bilan hisoblansa kecha
    kechqurun kirgan odam bugun ertalab «bugun» deb ko'rinardi va
    kechagi 45 soat «1 kun» bo'lib qolardi.
    """
    seen = _parse(raw)
    if not seen:
        return None
    return max(0, (datetime.now(settings.TZ).date() - seen.date()).days)


def list_users(search: str = "", state: str = "", owner_ids: set[int] | None = None,
               sort: str = "yangi", limit: int = 50, offset: int = 0,
               plan: str = "", activity: str = "", segment: str = "",
               lang: str = "", source: str = "") -> tuple[list, int]:
    """Foydalanuvchilar ro'yxati. Holat, tarif, faollik, aloqa segmenti
    (SEGMENTLAR), til va reklama manbasi bo'yicha filtr Python tomonida —
    ular sana taqqoslashiga bog'liq va foydalanuvchilar soni kichik.

    `source="-"` — manbasiz (to'g'ridan-to'g'ri kelgan) odamlar."""
    owner_ids = owner_ids or set()
    if state == "tugagan":            # eski nom — saqlangan havola/filtr
        state = "bepul"
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
            "SELECT user_id, SUM(n) FROM entry_counts GROUP BY user_id").fetchall())
        costs = dict(c.execute(
            "SELECT user_id, ROUND(SUM(cost_usd), 4) FROM usage_log GROUP BY user_id"
        ).fetchall())
        # Oxirgi to'langan tarif — ro'yxatdagi «Tarif» ustuni uchun.
        last_plan = dict(c.execute(
            "SELECT user_id, plan_code FROM payments WHERE id IN "
            "(SELECT MAX(id) FROM payments WHERE voided_at IS NULL GROUP BY user_id)").fetchall())
        paid = dict(c.execute(
            "SELECT user_id, COUNT(*) FROM payments WHERE voided_at IS NULL "
            "GROUP BY user_id").fetchall())

    for r in rows:
        r["state"] = access_state(r, owner_ids)
        r["days_left"] = days_left(r)
        r["tx_count"] = counts.get(r["user_id"], 0)
        r["cost_usd"] = costs.get(r["user_id"], 0.0) or 0.0
        r["plan_code"] = last_plan.get(r["user_id"], "")
        r["paid_count"] = paid.get(r["user_id"], 0)
        # Muddat: obunachi uchun obuna tugashi, sinovda esa sinov tugashi.
        # Egada muddat yo'q — uning sinov sanasini ko'rsatish chalg'itadi.
        r["expires_at"] = (
            None if r["state"] == "ega"
            else r.get("subscribed_until") or r.get("trial_ends_at")
        )
        r["idle_days"] = _days_since(r.get("last_seen_at"))
        r["bot_blocked"] = bool(r.get("bot_blocked_at"))
        r["consented"] = bool(r.get("consent_at"))
        r["lang"] = r.get("lang") or "uz"
        r["source"] = r.get("source") or ""

    if state:
        rows = [r for r in rows if r["state"] == state]
    if segment:
        rows = [r for r in rows if _in_segment(r, segment)]
    if lang:
        rows = [r for r in rows if r["lang"] == lang]
    if source:
        wanted = "" if source == "-" else source
        rows = [r for r in rows if r["source"] == wanted]
    if plan:
        rows = [r for r in rows if r["plan_code"] == plan]
    if activity:
        limit_days = {"bugun": 0, "hafta": 7, "oy": 30}.get(activity)
        if limit_days is not None:
            rows = [r for r in rows
                    if r["idle_days"] is not None and r["idle_days"] <= limit_days]

    keys = {
        "yangi": lambda r: (r["created_at"] or ""),
        "faol": lambda r: (r["last_seen_at"] or ""),
        "yozuv": lambda r: r["tx_count"],
        "xarajat": lambda r: r["cost_usd"],
    }
    rows.sort(key=keys.get(sort, keys["yangi"]), reverse=True)

    return rows[offset:offset + limit], len(rows)


def audience_summary(owner_ids: set[int] | None = None) -> dict:
    """Ro'yxat ustidagi filtrlar uchun bitta o'tishda: aloqa segmentlari,
    reklama manbalari va tillar bo'yicha sonlar. Egalar sanalmaydi."""
    owner_ids = owner_ids or set()
    rows, _ = list_users(owner_ids=owner_ids, limit=10**9)
    rows = [r for r in rows if r["user_id"] not in owner_ids]
    sources: dict[str, int] = {}
    langs: dict[str, int] = {}
    for r in rows:
        sources[r["source"]] = sources.get(r["source"], 0) + 1
        langs[r["lang"]] = langs.get(r["lang"], 0) + 1
    return {
        "segments": {key: sum(1 for r in rows if _in_segment(r, key)) for key in SEGMENTLAR},
        "sources": [{"source": k, "count": n}
                    for k, n in sorted(sources.items(), key=lambda kv: (-kv[1], kv[0]))],
        "langs": langs,
    }


def segment_counts(owner_ids: set[int] | None = None) -> dict:
    return audience_summary(owner_ids)["segments"]


def activity_counts(owner_ids: set[int] | None = None) -> dict:
    """«Bugun faol — N · Oxirgi 7 kunda — N» qatori uchun."""
    with conn() as c:
        seen = [r[0] for r in c.execute("SELECT last_seen_at FROM users").fetchall()]
    days = [d for d in (_days_since(s) for s in seen) if d is not None]
    return {
        "today": sum(1 for d in days if d == 0),
        "week": sum(1 for d in days if d <= 7),
        "month": sum(1 for d in days if d <= 30),
    }


# Yozuvlarni o'qiydigan funksiya bu yerda ATAYLAB YO'Q.
#
# Ilgari `user_transactions()` bor edi: u summa, kategoriya va izohni
# qaytarardi, har chaqiruv jurnalga tushardi. Lekin jurnal — bu ko'rib
# bo'lgandan KEYINGI iz, ruxsat emas. Foydalanuvchining moliyasi
# egasidan boshqa hech kimga tegishli emas, shuning uchun himoya endi
# kodda emas, bazada: yozuvlar alohida faylda, alohida kalit bilan
# turadi va bu panelda o'sha kalit yo'q. `FROM transactions` deb yozsak
# ham "no such table" xatosi chiqadi — bu xato emas, mo'ljal.


def get_user(user_id: int, owner_ids: set[int] | None = None) -> dict | None:
    owner_ids = owner_ids or set()
    with conn() as c:
        row = c.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        if not row:
            return None
        u = dict(row)
        u["state"] = access_state(row, owner_ids)
        u["days_left"] = days_left(row)
        # Faqat SON. Yozuvlarning o'zi shaxsiy bazada va bu panel uni
        # ocholmaydi. Son esa moliyaviy mazmun emas: «340 ta yozuv»
        # odamning nimaga pul sarflaganini aytmaydi, lekin obuna va
        # limit haqida qaror qabul qilish uchun yetadi.
        u["tx_count"] = int(c.execute(
            "SELECT COALESCE(SUM(n), 0) FROM entry_counts WHERE user_id = ?",
            (user_id,)).fetchone()[0])
        u["usage"] = [dict(r) for r in c.execute(
            """SELECT operation, COUNT(*) AS calls, ROUND(SUM(cost_usd), 4) AS cost
               FROM usage_log WHERE user_id = ? GROUP BY operation ORDER BY cost DESC""",
            (user_id,)).fetchall()]
        u["cost_usd"] = round(sum(x["cost"] or 0 for x in u["usage"]), 4)
        u["payments"] = [dict(r) for r in c.execute(
            "SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 10",
            (user_id,)).fetchall()]
        u["requests"] = [dict(r) for r in c.execute(
            "SELECT * FROM subscription_requests WHERE user_id = ? ORDER BY id DESC LIMIT 10",
            (user_id,)).fetchall()]
        u["paid_total"] = int(c.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM payments "
            "WHERE user_id = ? AND voided_at IS NULL",
            (user_id,)).fetchone()[0])
        u["bot_blocked"] = bool(u.get("bot_blocked_at"))
        u["consented"] = bool(u.get("consent_at"))
        # Taklif zanjiri: kim chaqirgan va o'zi nechtani chaqirgan.
        u["referrer"] = None
        u["referrals"] = 0
        if _has_column(c, "users", "referred_by"):
            if u.get("referred_by"):
                ref = c.execute(
                    "SELECT user_id, first_name, username FROM users WHERE user_id = ?",
                    (u["referred_by"],)).fetchone()
                u["referrer"] = (dict(ref) if ref
                                 else {"user_id": u["referred_by"], "first_name": "",
                                       "username": None})
            u["referrals"] = int(c.execute(
                "SELECT COUNT(*) FROM users WHERE referred_by = ?",
                (user_id,)).fetchone()[0])
        # Bot yozgan hodisalar (start, paywall, sinov tugadi...) — odam
        # nega to'xtaganini tushunish uchun. Moliyaviy mazmun yo'q.
        u["events"] = []
        if _has_table(c, "events"):
            u["events"] = [dict(r) for r in c.execute(
                "SELECT name, detail, day, created_at FROM events "
                "WHERE user_id = ? ORDER BY id DESC LIMIT 20", (user_id,)).fetchall()]
    return u


def reachable(row: dict) -> bool:
    """Ommaviy xabar olishi mumkinmi — botdagi `/xabar_yubor` qoidasi bilan
    bir xil: admin bloklamagan, odam botni bloklamagan (Telegram 403) va
    shartlarga rozilik bergan.

    Ilgari panel «hammasi» segmentiga bloklanganlarga, botni
    bloklaganlarga va rozilik bermaganlarga ham yuborardi. Rozilik
    bermagan odamga xabar yuborish — uning ma'lumotini roziliksiz
    ishlatish degani.
    """
    return (not row.get("blocked")
            and not row.get("bot_blocked_at")
            and bool(row.get("consent_at")))


def all_user_ids(state: str = "", owner_ids: set[int] | None = None,
                 lang: str = "") -> list[int]:
    """Ommaviy xabar uchun qabul qiluvchilar (faqat `reachable`).

    `lang` berilsa faqat o'sha tilni tanlagan odamlar qoladi — xabar
    o'zbekcha yozilgan bo'lsa ruschani tanlaganga yuborishdan ma'no yo'q.
    Egalar kirmaydi — botdagi /xabar_yubor dagidek.
    """
    owner_ids = owner_ids or set()
    rows, _ = list_users(state=state, owner_ids=owner_ids, limit=10**9)
    rows = [r for r in rows if reachable(r) and r["user_id"] not in owner_ids]
    if lang:
        rows = [r for r in rows if (r.get("lang") or "uz") == lang]
    return [r["user_id"] for r in rows]


def mark_bot_blocked(user_ids: list[int]) -> None:
    """Telegram 403 bergan odamlar — bot ham ularga avtomatik yozmaydi.
    Odam botga yana yozsa bot belgini o'zi olib tashlaydi."""
    if not user_ids:
        return
    with conn() as c:
        if not _has_column(c, "users", "bot_blocked_at"):
            return
        c.executemany("UPDATE users SET bot_blocked_at = ? WHERE user_id = ?",
                      [(now_iso(), uid) for uid in user_ids])


def lang_counts(owner_ids: set[int] | None = None) -> dict[str, int]:
    rows, _ = list_users(owner_ids=owner_ids, limit=10**9)
    counts: dict[str, int] = {}
    for r in rows:
        key = r.get("lang") or "uz"
        counts[key] = counts.get(key, 0) + 1
    return counts


def _extend_subscription(c, user_id: int, days: int) -> datetime:
    """Obunani ochiq ulanish ichida uzaytiradi (tranzaksiya chaqiruvchida).

    `warned_stage` nolga qaytariladi: yangi muddat uchun «3 kun / 1 kun
    qoldi» ogohlantirishlari qaytadan yuborilishi kerak. Ilgari u eski
    qiymatda qolardi va bot ikkinchi obunada ogohlantirishni «allaqachon
    yuborilgan» deb o'tkazib yuborardi. Bot ham xuddi shunday qiladi
    (db.grant_subscription).
    """
    now = datetime.now(settings.TZ)
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
    if _has_column(c, "users", "warned_stage"):
        c.execute("UPDATE users SET warned_stage = 0 WHERE user_id = ?", (user_id,))
    return until


def grant_subscription(user_id: int, days: int) -> datetime:
    """Obunani uzaytiradi — mavjud muddat ustiga qo'shiladi (bot bilan bir xil)."""
    with conn() as c:
        return _extend_subscription(c, user_id, days)


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
    """Foydalanuvchining butun izini o'chiradi. Qaytarib bo'lmaydi.

    Moliyaviy yozuvlar shaxsiy bazada va bu panel ularga yeta olmaydi —
    kaliti yo'q. Shuning uchun ular navbatga qo'yiladi va botning
    vazifasi (har 10 daqiqada) o'chiradi. Panel darrov o'chira olmasligi
    kamchilik emas: aynan shu narsa "panel yozuvlarga tega olmaydi"
    degan kafolatning boshqa tomoni.
    """
    with conn() as c:
        tx = int(c.execute(
            "SELECT COALESCE(SUM(n), 0) FROM entry_counts WHERE user_id = ?",
            (user_id,)).fetchone()[0])
        us = c.execute("DELETE FROM usage_log WHERE user_id = ?", (user_id,)).rowcount
        c.execute("DELETE FROM subscription_requests WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM entry_counts WHERE user_id = ?", (user_id,))
        # Hodisalar (start, paywall, ...) ham iz — botdagi erase_user ularni
        # o'chiradi. Jadvalni bot yaratadi, shuning uchun bor-yo'qligi
        # tekshiriladi.
        if _has_table(c, "events"):
            c.execute("DELETE FROM events WHERE user_id = ?", (user_id,))
        c.execute(
            "INSERT INTO private_erase_queue (user_id) VALUES (?) "
            "ON CONFLICT(user_id) DO UPDATE SET done_at = NULL",
            (user_id,))
    return {"transactions": tx, "usage": us, "shaxsiy_navbatda": True}


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
        rows = [dict(r) for r in c.execute(sql, params).fetchall()]
        # Chekni ko'rayotgan admin uchun kontekst: bu odam ilgari to'laganmi
        # va botdan qanchalik foydalanadi. Ikkalasi ham qaror uchun muhim.
        counts = dict(c.execute(
            "SELECT user_id, SUM(n) FROM entry_counts GROUP BY user_id").fetchall())
        paid = dict(c.execute(
            "SELECT user_id, COUNT(*) FROM payments WHERE voided_at IS NULL "
            "GROUP BY user_id").fetchall())
        rejected = dict(c.execute(
            "SELECT user_id, COUNT(*) FROM subscription_requests "
            "WHERE status = 'rad etildi' GROUP BY user_id").fetchall())
        first_seen = dict(c.execute(
            "SELECT user_id, created_at FROM users").fetchall())

    for r in rows:
        uid = r["user_id"]
        r["tx_count"] = counts.get(uid, 0)
        r["paid_count"] = paid.get(uid, 0)
        r["rejected_count"] = rejected.get(uid, 0)
        joined = _parse(first_seen.get(uid))
        r["member_days"] = (
            max(0, (datetime.now(settings.TZ) - joined).days) if joined else None
        )
    return rows


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


_OPEN = "status IN ('kutilmoqda', 'tekshiruvda')"


def decide_request(req_id: int, status: str, admin: str, note: str = "") -> bool:
    """So'rov holatini yozadi — faqat hali HAL QILINMAGAN bo'lsa.

    Qaytaradi: yozildimi. False — so'rovni boshqa admin (yoki ikkinchi
    tab) allaqachon hal qilgan.
    """
    with conn() as c:
        cur = c.execute(
            f"""UPDATE subscription_requests
                SET status = ?, decided_at = ?, decided_by = ?, note = ?
                WHERE id = ? AND {_OPEN}""",
            (status, now_iso(), admin, note, req_id))
        return cur.rowcount > 0


def approve_request(req_id: int, plan: dict, admin: str) -> tuple[int, datetime] | None:
    """So'rovni tasdiqlaydi: holat, obuna va to'lov BITTA tranzaksiyada.

    Ilgari uch qadam alohida edi va holat tekshiruvi yozishdan oldin
    bo'lardi — ikki admin (yoki ikki tab) bir vaqtda bossa, ikkalasi ham
    tekshiruvdan o'tib, obuna ham, to'lov ham ikki marta yozilardi.
    Endi birinchi qadam — shartli UPDATE: uni faqat bitta so'rov yuta
    oladi, qolganlari None oladi.

    Qaytaradi: (user_id, yangi muddat) yoki None (allaqachon hal qilingan).
    """
    with conn() as c:
        cur = c.execute(
            f"""UPDATE subscription_requests
                SET status = 'tasdiqlandi', decided_at = ?, decided_by = ?, note = ''
                WHERE id = ? AND {_OPEN}""",
            (now_iso(), admin, req_id))
        if cur.rowcount == 0:
            return None
        req = c.execute(
            "SELECT user_id, price FROM subscription_requests WHERE id = ?",
            (req_id,)).fetchone()
        user_id = int(req["user_id"])
        # Daromad — foydalanuvchi KO'RGAN va to'lagan narx (so'rovdagi),
        # joriy narx emas: tarif narxi so'rov va tasdiq orasida o'zgargan
        # bo'lsa, daromad to'lanmagan summa bilan yozilmasin.
        price = int(req["price"] or 0) or plan["price"]
        until = _extend_subscription(c, user_id, plan["days"])
        c.execute(
            """INSERT INTO payments
               (user_id, plan_code, amount, days, method, created_by, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (user_id, plan["code"], price, plan["days"], "qolda", admin,
             now_iso()))
    return user_id, until


def add_payment(user_id: int, plan_code: str, amount: int, days: int,
                admin: str, method: str = "qolda") -> None:
    with conn() as c:
        c.execute(
            """INSERT INTO payments
               (user_id, plan_code, amount, days, method, created_by, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (user_id, plan_code, amount, days, method, admin, now_iso()))


def void_payment(payment_id: int) -> dict | None:
    """To'lov yozuvini «xato» deb belgilaydi — daromaddan chiqadi, yozuv
    tarix va jurnal uchun qoladi.

    Bu pulni QAYTARISH emas: obuna sotib olingach to'lov qaytarilmaydi.
    Bu faqat hisob tuzatish — masalan bir odamga bir kunda bir necha marta
    bosilgan «obuna berish» yoki tushmagan to'lovning yozuvi.
    Qaytadi: yozuv yoki None (topilmadi / allaqachon belgilangan).
    """
    with conn() as c:
        row = c.execute("SELECT * FROM payments WHERE id = ? AND voided_at IS NULL",
                        (payment_id,)).fetchone()
        if row is None:
            return None
        c.execute("UPDATE payments SET voided_at = ? WHERE id = ?",
                  (now_iso(), payment_id))
        return dict(row)


# --------------------------------------------------------------------------- #
# Statistika
# --------------------------------------------------------------------------- #

def _bucket_keys(scale: str, count: int) -> list[str]:
    """Oxirgi `count` ta oraliqning kaliti — yangisi oxirida."""
    now = datetime.now(settings.TZ)
    keys: list[str] = []
    if scale == "kunlik":
        for i in range(count - 1, -1, -1):
            keys.append((now - timedelta(days=i)).date().isoformat())
    elif scale == "yillik":
        for i in range(count - 1, -1, -1):
            keys.append(str(now.year - i))
    else:  # oylik
        year, month = now.year, now.month
        for _ in range(count):
            keys.append(f"{year:04d}-{month:02d}")
            month -= 1
            if month == 0:
                month, year = 12, year - 1
        keys.reverse()
    return keys


def _bucket_of(raw, scale: str) -> str | None:
    text = str(raw or "")
    if len(text) < 10:
        return None
    if scale == "kunlik":
        return text[:10]
    if scale == "yillik":
        return text[:4]
    return text[:7]


def revenue_series(scale: str = "oylik") -> dict:
    """Daromad: joriy va oldingi davr yonma-yon.

    Dizayndagi ustunlar juftligi shundan chiqadi — o'sish yoki
    pasayishni ko'z bilan solishtirish uchun.
    """
    count = {"kunlik": 14, "oylik": 12, "yillik": 4}.get(scale, 12)
    keys = _bucket_keys(scale, count * 2)
    with conn() as c:
        rows = c.execute("SELECT created_at, amount FROM payments "
                         "WHERE voided_at IS NULL").fetchall()

    sums: dict[str, int] = {}
    for created_at, amount in rows:
        key = _bucket_of(created_at, scale)
        if key:
            sums[key] = sums.get(key, 0) + int(amount or 0)

    current = keys[count:]
    previous = keys[:count]
    labels_uz = ["yan", "fev", "mar", "apr", "may", "iyn",
                 "iyl", "avg", "sen", "okt", "noy", "dek"]

    def label(key: str) -> str:
        if scale == "kunlik":
            return key[8:10] + "." + key[5:7]
        if scale == "yillik":
            return key
        return labels_uz[int(key[5:7]) - 1]

    return {
        "scale": scale,
        "items": [
            {"key": cur, "label": label(cur),
             "now": sums.get(cur, 0), "prev": sums.get(prev, 0)}
            for cur, prev in zip(current, previous)
        ],
        "nowTotal": sum(sums.get(k, 0) for k in current),
        "prevTotal": sum(sums.get(k, 0) for k in previous),
    }


def stats(owner_ids: set[int]) -> dict:
    """«Statistika» ekrani uchun ko'rsatkichlar."""
    now = datetime.now(settings.TZ)
    month_start = today().replace(day=1).isoformat()
    with conn() as c:
        users = [dict(r) for r in c.execute("SELECT * FROM users").fetchall()]
        new_30 = int(c.execute(
            "SELECT COUNT(*) FROM users WHERE created_at >= ?",
            ((now - timedelta(days=30)).date().isoformat(),)).fetchone()[0])
        pay_rows = c.execute(
            "SELECT plan_code, amount, user_id, created_at FROM payments "
            "WHERE voided_at IS NULL").fetchall()
        cost_month = float(c.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM usage_log WHERE day >= ?",
            (month_start,)).fetchone()[0])

    states = {"ega": 0, "obunachi": 0, "sinov": 0, "bepul": 0, "bloklangan": 0}
    for u in users:
        states[access_state(u, owner_ids)] += 1

    payments = [dict(zip(("plan_code", "amount", "user_id", "created_at"), r))
                for r in pay_rows]
    payer_ids = {p["user_id"] for p in payments}
    avg_check = round(sum(p["amount"] for p in payments) / len(payments)) if payments else 0

    # Sinovni boshlaganlardan nechtasi to'lovga o'tgan.
    trial_users = [u for u in users if u["user_id"] not in owner_ids]
    converted = sum(1 for u in trial_users if u["user_id"] in payer_ids)
    conversion = round(100 * converted / len(trial_users)) if trial_users else 0

    # Ketganlar: obunasi yoki sinovi tugagan va 30 kundan beri kirmagan.
    churned = 0
    for u in trial_users:
        if access_state(u, owner_ids) != "bepul":
            continue
        idle = _days_since(u["last_seen_at"])
        if idle is not None and idle >= 30:
            churned += 1
    base = max(1, states["obunachi"] + states["bepul"])

    by_plan: dict[str, int] = {}
    for p in payments:
        by_plan[p["plan_code"]] = by_plan.get(p["plan_code"], 0) + 1
    plan_total = max(1, sum(by_plan.values()))

    budget = settings.ai_monthly_budget_usd()
    return {
        "newUsers30": new_30,
        "churned": churned,
        "churnPercent": round(100 * churned / base, 1),
        "conversion": conversion,
        "convertedCount": converted,
        "trialTotal": len(trial_users),
        "avgCheck": avg_check,
        "plans": [
            {"code": p["code"], "label": p["label"], "price": p["price"],
             "count": by_plan.get(p["code"], 0),
             "percent": round(100 * by_plan.get(p["code"], 0) / plan_total)}
            for p in _plan_list()
        ],
        "ai": {
            "spentUsd": round(cost_month, 4),
            "spentSom": round(cost_month * settings.USD_RATE),
            "budgetUsd": budget,
            "budgetSom": round(budget * settings.USD_RATE),
            "percent": round(100 * cost_month / budget) if budget else 0,
            "daysLeft": (
                (now.replace(day=28) + timedelta(days=4)).replace(day=1) - now
            ).days,
        },
    }


FUNNEL_STEPS = [
    ("start", "/start bosgan"),
    ("rozilik", "Shartlarga rozilik bergan"),
    ("yozuv", "Kamida 1 ta yozuv qilgan"),
    ("faol7", "7-kundan keyin ham yozgan"),
    ("tolov", "Pul to'lagan"),
]


def funnel(owner_ids: set[int], days: int | None = None) -> list[dict]:
    """Faollashtirish voronkasi: start -> rozilik -> 1-yozuv -> 7-kun -> to'lov.

    Faqat SONLAR: `users`, `entry_counts` (kunlik yozuvlar soni) va
    `payments`. `days` berilsa — faqat shu kunlar ichida boshlaganlar
    (reklama/o'zgarishdan keyingi guruhni alohida ko'rish uchun).

    «7-kundan keyin ham yozgan» — ro'yxatdan o'tgan kundan kamida 7 kun
    keyin yozuv kiritganlar. Hali 7 kun o'tmaganlar bu bosqichga yetolmaydi,
    shuning uchun yangi guruhda bu ulush tabiiy ravishda past.
    """
    since = (today() - timedelta(days=days)).isoformat() if days else None
    users, entry_days, paid = _funnel_data(owner_ids)
    group = [u for u in users
             if since is None or str(u["created_at"] or "")[:10] >= since]
    counts = _funnel_counts(group, entry_days, paid)
    top = max(1, counts["start"])
    return [{"key": k, "label": label, "count": counts[k],
             "percent": round(100 * counts[k] / top)}
            for k, label in FUNNEL_STEPS]


def funnel_by_source(owner_ids: set[int]) -> list[dict]:
    """Voronka reklama manbasi bo'yicha (K8): bot /start src_<kanal> ni
    `users.source` ga yozadi, do'st taklifi — «ref», bo'sh — to'g'ridan.

    Qaysi kanal odam olib kelyapti emas, qaysi kanal YOZUV qiladigan va
    TO'LAYDIGAN odam olib kelyapti — reklama byudjeti shunga qarab
    taqsimlanadi. Eng ko'p start bergan manba birinchi.
    """
    users, entry_days, paid = _funnel_data(owner_ids)
    groups: dict[str, list[dict]] = {}
    for u in users:
        groups.setdefault(u.get("source") or "", []).append(u)
    out = []
    for source, group in groups.items():
        counts = _funnel_counts(group, entry_days, paid)
        out.append({"source": source, **counts})
    out.sort(key=lambda r: (-r["start"], r["source"]))
    return out


def _funnel_data(owner_ids: set[int]) -> tuple[list[dict], dict[int, list[str]], set[int]]:
    with conn() as c:
        cols = "user_id, created_at, consent_at" + (
            ", source" if _has_column(c, "users", "source") else "")
        users = [dict(r) for r in c.execute(f"SELECT {cols} FROM users").fetchall()
                 if r["user_id"] not in owner_ids]
        entry_days: dict[int, list[str]] = {}
        for r in c.execute("SELECT user_id, day FROM entry_counts WHERE n > 0"):
            entry_days.setdefault(r[0], []).append(str(r[1]))
        paid = {r[0] for r in c.execute(
            "SELECT DISTINCT user_id FROM payments WHERE voided_at IS NULL")}
    return users, entry_days, paid


def _funnel_counts(group: list[dict], entry_days: dict[int, list[str]],
                   paid: set[int]) -> dict[str, int]:
    def active_after_week(u) -> bool:
        try:
            start = date.fromisoformat(str(u["created_at"])[:10])
        except ValueError:
            return False
        cutoff = (start + timedelta(days=7)).isoformat()
        return any(d >= cutoff for d in entry_days.get(u["user_id"], []))

    return {
        "start": len(group),
        "rozilik": sum(1 for u in group if u.get("consent_at")),
        "yozuv": sum(1 for u in group if entry_days.get(u["user_id"])),
        "faol7": sum(1 for u in group if active_after_week(u)),
        "tolov": sum(1 for u in group if u["user_id"] in paid),
    }


def _plan_list() -> list[dict]:
    import plans
    return plans.all_plans()


def overview(owner_ids: set[int]) -> dict:
    now = datetime.now(settings.TZ)
    with conn() as c:
        users = [dict(r) for r in c.execute("SELECT * FROM users").fetchall()]
        tx_total = int(c.execute(
            "SELECT COALESCE(SUM(n), 0) FROM entry_counts").fetchone()[0])
        tx_today = int(c.execute(
            "SELECT COALESCE(SUM(n), 0) FROM entry_counts WHERE day = ?",
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
            "SELECT COALESCE(SUM(amount), 0) FROM payments "
            "WHERE voided_at IS NULL").fetchone()[0])
        revenue_month = int(c.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM payments "
            "WHERE created_at >= ? AND voided_at IS NULL",
            (today().replace(day=1).isoformat(),)).fetchone()[0])

    states = {"ega": 0, "obunachi": 0, "sinov": 0, "bepul": 0, "bloklangan": 0}
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
        # Aloqa: yetib boradi / botni bloklagan / rozilik yo'q / hech yozmagan.
        "churn": segment_counts(owner_ids),
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
                "SELECT day d, SUM(n) n FROM entry_counts "
                "WHERE day >= ? GROUP BY d", (start.isoformat(),)):
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


# --------------------------------------------------------------------------- #
# Pul oqimi: kun · hafta · oy
#
# «Daromad va sarf» ikki xil ma'noda bo'lishi mumkin, shuning uchun panelda
# IKKALASI ham bor, lekin ATAYLAB alohida va aniq nomlangan:
#
#   1. Xizmat daromadi — Tanga'ning O'Z puli. Daromad: tasdiqlangan obuna
#      to'lovlari (`payments.amount`, so'm). Sarf: AI chaqiruvlari
#      (`usage_log.cost_usd`, dollar → so'mga USD_RATE bilan o'giriladi).
#      Server ijarasi kabi doimiy xarajatlar bazada yo'q — ular bu yerga
#      kirmaydi va shu sabab «sof natija» emas, «xizmat sofi» deb ataladi.
#
#   2. Foydalanuvchilar aylanmasi — odamlarning botga yozgan kirim/chiqim
#      yozuvlari yig'indisi (`transactions`). Bu Tanga'ning puli EMAS,
#      mahsulot qanchalik ishlatilayotganini ko'rsatadigan hajm. Ikkalasini
#      bir kartaga qo'shib yuborish eng katta xato bo'lardi — bir kunda
#      50 mln so'mlik aylanma «daromad» bo'lib ko'rinardi.
#
# Davrni foydalanuvchi tanlaydi: kun, hafta yoki oy. Uchalasida ham joriy
# davr oldingi davrning AYNAN shuncha kuni bilan solishtiriladi — 15-avgustda
# «shu oy» 1–15 avgust bo'ladi va 1–15 iyul bilan qiyoslanadi. To'liq iyul
# bilan solishtirish har oy boshida yolg'on pasayish ko'rsatardi.
#
# Barcha jamlash SQL tomonida (GROUP BY … SUM) bajariladi: 12 oylik grafik
# uchun Python'ga 12 qator keladi, 365 ta emas.
# --------------------------------------------------------------------------- #

KIND_KIRIM, KIND_CHIQIM = "kirim", "chiqim"

# Grafikdagi ustunlar soni: davr → (odatiy, eng kam, eng ko'p).
POINTS = {"kun": (14, 7, 90), "hafta": (8, 4, 26), "oy": (6, 3, 24)}


def _has_column(c, table: str, column: str) -> bool:
    return any(r[1] == column for r in c.execute(f"PRAGMA table_info({table})"))


def _has_table(c, table: str) -> bool:
    return c.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                     (table,)).fetchone() is not None


def _by_key(c, sql: str, params: tuple) -> dict[str, float]:
    """{davr_boshi: summa} — so'rov allaqachon GROUP BY qilgan bo'lishi kerak.

    Kalit — davrning birinchi kuni ('YYYY-MM-DD'): kunlik kesimda kunning
    o'zi, haftalikda dushanba, oylikda oyning 1-kuni. Sanasi buzuq yozuv
    kalitsiz qoladi va hisobga olinmaydi.
    """
    return {str(r[0]): float(r[1] or 0)
            for r in c.execute(sql, params).fetchall() if r[0] is not None}


def _range_sum(values: dict[str, float], start: date, end: date) -> float:
    total = 0.0
    cur = start
    while cur <= end:
        total += values.get(cur.isoformat(), 0.0)
        cur += timedelta(days=1)
    return total


def _delta(now: float, prev: float) -> float | None:
    """Foizdagi o'zgarish. Oldingi davr nol yoki manfiy bo'lsa foiz ma'nosiz
    (nolga bo'lish, yoki «-100 dan +50 ga» degan tushunarsiz raqam) — bunda
    None qaytadi va interfeys foiz o'rniga «yangi» yoki «—» ko'rsatadi."""
    if prev <= 0:
        return None
    return round(100 * (now - prev) / prev, 1)


def _flow(revenue: dict[str, float], expense: dict[str, float],
          span: tuple[date, date], prev: tuple[date, date]) -> dict:
    """Bitta davr: daromad, sarf, sof natija va oldingi davr bilan farq."""
    now_in = _range_sum(revenue, *span)
    now_out = _range_sum(expense, *span)
    prev_in = _range_sum(revenue, *prev)
    prev_out = _range_sum(expense, *prev)
    return {
        "start": span[0].isoformat(), "end": span[1].isoformat(),
        "prevStart": prev[0].isoformat(), "prevEnd": prev[1].isoformat(),
        "days": (span[1] - span[0]).days + 1,
        "revenue": round(now_in), "expense": round(now_out),
        "net": round(now_in - now_out),
        "prevRevenue": round(prev_in), "prevExpense": round(prev_out),
        "prevNet": round(prev_in - prev_out),
        "revenueDelta": _delta(now_in, prev_in),
        "expenseDelta": _delta(now_out, prev_out),
        "netDelta": _delta(now_in - now_out, prev_in - prev_out),
    }


def _add_months(first: date, count: int) -> date:
    """Oy boshiga oy qo'shish yoki ayirish — natija doim oyning 1-kuni."""
    index = first.year * 12 + first.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def _group(period: str):
    """Sana ustunini o'z davrining boshiga keltiruvchi SQL ifodasi.

    Guruhlash SQL tomonida bo'lgani uchun 12 oylik grafik ham 12 qator
    qaytaradi — 365 kunlik qatorni Python'da yig'ish kerak emas.
    """
    if period == "hafta":
        # `weekday 0` keyingi yakshanbaga siljitadi; undan 6 kun orqaga
        # qaytsak o'sha haftaning dushanbasi chiqadi. Bu ISO haftaga mos va
        # yil chegarasida strftime('%Y-%W') kabi adashmaydi.
        return lambda col: f"date({col}, 'weekday 0', '-6 days')"
    if period == "oy":
        return lambda col: f"date({col}, 'start of month')"
    return lambda col: col


def _span(period: str, end: date) -> tuple[tuple[date, date], tuple[date, date]]:
    """Joriy davr va u solishtiriladigan oldingi davr.

    Oldingi davrdan AYNAN shuncha kun olinadi. To'liq davr bilan
    solishtirish har davr boshida yolg'on pasayish ko'rsatardi: seshanba
    kuni 2 kunlik summa 7 kunlik summaga, 1-oktabrda esa bir kunlik summa
    to'liq sentabrga qarshi qo'yilardi.
    """
    if period == "hafta":
        start = end - timedelta(days=end.weekday())          # dushanba
        prev_start = start - timedelta(days=7)
        return ((start, end),
                (prev_start, prev_start + timedelta(days=(end - start).days)))
    if period == "oy":
        start = end.replace(day=1)
        prev_last = start - timedelta(days=1)                # o'tgan oyning oxiri
        prev_start = prev_last.replace(day=1)
        # Qisqa oydan oshib ketmasin: 31-martda solishtiruv 28-fevralda tugaydi.
        prev_end = min(prev_start + timedelta(days=(end - start).days), prev_last)
        return (start, end), (prev_start, prev_end)
    yesterday = end - timedelta(days=1)
    return (end, end), (yesterday, yesterday)


def _buckets(period: str, points: int, end: date) -> list[tuple[date, date, bool]]:
    """Grafik ustunlari: (boshi, oxiri, tugamaganmi) — eskisidan bugungacha.

    Oxirgi ustun odatda TUGAMAGAN davr (joriy hafta, joriy oy). Uning oxiri
    bugunga qisqartiriladi — hali kelmagan kunlar nolga qo'shilib, ustunni
    sun'iy pasaytirmasin; interfeys esa buni ochiq belgilaydi.
    """
    if period == "oy":
        starts = [_add_months(end.replace(day=1), -i)
                  for i in range(points - 1, -1, -1)]
        spans = [(s, _add_months(s, 1) - timedelta(days=1)) for s in starts]
    elif period == "hafta":
        monday = end - timedelta(days=end.weekday())
        starts = [monday - timedelta(days=7 * i) for i in range(points - 1, -1, -1)]
        spans = [(s, s + timedelta(days=6)) for s in starts]
    else:
        starts = [end - timedelta(days=i) for i in range(points - 1, -1, -1)]
        spans = [(s, s) for s in starts]
    return [(s, min(e, end), e > end) for s, e in spans]


def _collect(c, group, lo: str, hi: str) -> tuple[dict, dict]:
    """[lo; hi] oynasidagi ikki qator summa, `group` bergan kesimda.

    Qaytadi: to'lovlar va AI sarfi (so'mda) — ya'ni XIZMATNING o'z puli.

    Ilgari bu yerda foydalanuvchilarning kirim/chiqim yig'indisi ham bor
    edi. U olib tashlandi. Yig'indi "shaxssiz" ko'rinadi, lekin unday
    emas: xizmatda o'n besh chog'li odam bor va biror kuni bittasigina
    yozgan bo'lsa, o'sha kunning "umumiy chiqimi" aynan o'sha odamning
    chiqimi bo'ladi. Bundan tashqari endi buni hisoblab ham bo'lmaydi —
    yozuvlar alohida shifrlangan bazada va bu ilovada kalit yo'q.
    """
    # `payments.created_at` — mintaqali mahalliy ISO ('…T14:30:00+05:00'),
    # shuning uchun birinchi 10 belgi to'g'ridan-to'g'ri mahalliy sana.
    # SQLite'ning datetime() si buni UTC ga o'girib yuborardi.
    pay = _by_key(c,
        f"SELECT {group('substr(created_at, 1, 10)')} k, COALESCE(SUM(amount), 0) s "
        "FROM payments WHERE voided_at IS NULL "
        "AND substr(created_at, 1, 10) BETWEEN ? AND ? "
        "GROUP BY k", (lo, hi))
    ai_usd = _by_key(c,
        f"SELECT {group('day')} k, COALESCE(SUM(cost_usd), 0) s FROM usage_log "
        "WHERE day BETWEEN ? AND ? GROUP BY k", (lo, hi))

    ai_som = {k: v * settings.USD_RATE for k, v in ai_usd.items()}
    return pay, ai_som


def cashflow(period: str = "kun", points: int = 0) -> dict:
    """Tanlangan davrdagi daromad va sarf, shu davr kesimidagi grafik bilan.

    `period` — 'kun': bugun, kecha bilan solishtiriladi;
               'hafta': dushanbadan bugungacha, o'tgan haftaning aynan
                        shuncha kuni bilan;
               'oy': oy boshidan bugungacha, o'tgan oyning aynan shuncha
                     kuni bilan.
    `points` — grafikdagi ustunlar soni; davrga qarab chegaralanadi (POINTS).

    Sana chegaralari server mintaqasida (Asia/Tashkent) hisoblanadi —
    `today()` shu mintaqadan oladi, bazadagi kun ustunlari ham mahalliy
    sanada yoziladi (bot `usage_log.day` va `occurred_on` ni shunday yozadi,
    admin esa `payments.created_at` ni mintaqali ISO bilan).
    """
    period = period if period in POINTS else "kun"
    fallback, least, most = POINTS[period]
    points = max(least, min(int(points or fallback), most))

    end = today()
    span, prev = _span(period, end)
    chart = _buckets(period, points, end)
    labels = [s.isoformat() for s, _, _ in chart]

    with conn() as c:
        # Grafik: tanlangan davr kesimida guruhlangan.
        pay, ai_som = _collect(
            c, _group(period), chart[0][0].isoformat(), end.isoformat())

        # Ko'rsatkichlar kunlik aniqlikni talab qiladi: joriy oyning 1–15
        # kuni o'tgan oyning AYNAN 1–15 kuni bilan solishtiriladi, buni
        # tayyor oylik yig'indidan ajratib bo'lmaydi. Oyna kichik — eng
        # ko'pi ikki oy. Kunlik kesimda esa grafikning o'zi kunlik, shuning
        # uchun ikkinchi so'rov shart emas.
        if period == "kun":
            day_pay, day_ai = pay, ai_som
        else:
            day_pay, day_ai = _collect(
                c, lambda col: col, prev[0].isoformat(), end.isoformat())

    def line(values: dict[str, float]) -> list[int]:
        # Harakati bo'lmagan davr TASHLAB KETILMAYDI — nol bo'lib turadi,
        # aks holda grafik bo'sh davrlarni siqib, o'sish bordek ko'rsatardi.
        return [round(values.get(k, 0.0)) for k in labels]

    # `users` bo'limi ATAYLAB yo'q: u foydalanuvchilarning kirim/chiqim
    # yig'indisi edi. Izoh _collect() da.
    return {
        "period": period,
        "points": points,
        "today": end.isoformat(),
        "usd_rate": settings.USD_RATE,
        "service": _flow(day_pay, day_ai, span, prev),
        "series": {
            "labels": labels,
            "ends": [e.isoformat() for _, e, _ in chart],
            # Oxirgi davr odatda hali tugamagan — jadval buni ochiq aytadi.
            "partial": [unfinished for _, _, unfinished in chart],
            "service": {"revenue": line(pay), "expense": line(ai_som)},
        },
    }


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


# --------------------------------------------------------------------------- #
# Tizim — bot holati, rejali ishlar, xatolar, voqealar, referal, AI
# kategoriyalar, kurslar, server/baza. Bot `bot_status`, `job_runs`,
# `bot_errors` jadvallariga yozadi (tanga/db.py); bu yerda faqat o'qiladi.
# Shaxsiy baza (yozuvlar) ataylab yopiq — faqat uning hajmi "yopiq" deb
# ko'rsatiladi.
# --------------------------------------------------------------------------- #

PANEL_STARTED_AT = datetime.now(settings.TZ)
BOT_ALIVE_S = 180


def _parse_ts(raw) -> datetime | None:
    if not raw:
        return None
    try:
        d = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=settings.TZ)
    return d


def _git_commit(root) -> str:
    try:
        head = (root / ".git" / "HEAD").read_text(encoding="utf-8").strip()
        if head.startswith("ref: "):
            head = (root / ".git" / head[5:]).read_text(encoding="utf-8").strip()
        return head[:7]
    except OSError:
        return ""


def _file_size(path: str) -> dict:
    """{'size': bayt} yoki {'closed': True} (ataylab yopiq) yoki {'missing': True}."""
    try:
        return {"size": os.stat(path).st_size}
    except PermissionError:
        return {"closed": True}
    except OSError:
        return {"missing": True}


def server_metrics() -> dict:
    out: dict = {"cpus": os.cpu_count() or 1}
    try:
        out["load"] = [round(x, 2) for x in os.getloadavg()]
    except OSError:
        out["load"] = None
    try:
        info = {}
        with open("/proc/meminfo", encoding="utf-8") as f:
            for line in f:
                k, _, v = line.partition(":")
                info[k] = int(v.strip().split()[0]) * 1024
        out["mem_total"] = info.get("MemTotal")
        out["mem_available"] = info.get("MemAvailable")
    except (OSError, ValueError):
        out["mem_total"] = out["mem_available"] = None
    db_dir = os.path.dirname(settings.DB_PATH) or "/"
    try:
        st = os.statvfs(db_dir if os.path.isdir(db_dir) else "/")
        out["disk_total"] = st.f_frsize * st.f_blocks
        out["disk_free"] = st.f_frsize * st.f_bavail
    except OSError:
        out["disk_total"] = out["disk_free"] = None
    try:
        with open("/proc/uptime", encoding="utf-8") as f:
            out["uptime_s"] = int(float(f.read().split()[0]))
    except (OSError, ValueError):
        out["uptime_s"] = None
    main = settings.DB_PATH
    private = main.replace("tanga.db", "tanga_shaxsiy.db") if "tanga.db" in main else ""
    out["db"] = {
        "main": _file_size(main),
        "wal": _file_size(main + "-wal"),
        "private": _file_size(private) if private and private != main else {"missing": True},
    }
    return out


def bot_brief() -> dict:
    """Dashboard kartasi uchun: tirikmi, so'nggi heartbeat, 24 soatdagi xatolar."""
    now = datetime.now(settings.TZ)
    with conn() as c:
        if not _has_table(c, "bot_status"):
            return {"known": False, "alive": False, "errors_24h": 0, "last_error": None}
        status = {r["key"]: r["value"] for r in c.execute("SELECT key, value FROM bot_status")}
        errors_24h = 0
        last_error = None
        if _has_table(c, "bot_errors"):
            errors_24h = int(c.execute(
                "SELECT COUNT(*) FROM bot_errors WHERE created_at >= datetime('now', '-1 day')"
            ).fetchone()[0])
            row = c.execute(
                "SELECT kind, place, message, created_at FROM bot_errors ORDER BY id DESC LIMIT 1"
            ).fetchone()
            last_error = dict(row) if row else None
    seen = _parse_ts(status.get("last_seen"))
    started = _parse_ts(status.get("started_at"))
    stale = int((now - seen).total_seconds()) if seen else None
    return {
        "known": bool(status),
        "alive": stale is not None and stale <= BOT_ALIVE_S,
        "stale_s": stale,
        "last_seen": seen.isoformat() if seen else None,
        "started_at": started.isoformat() if started else None,
        "uptime_s": int((now - started).total_seconds()) if started else None,
        "commit": status.get("commit", ""),
        "errors_24h": errors_24h,
        "last_error": last_error,
    }


def system_status(owner_ids: set[int]) -> dict:
    now = datetime.now(settings.TZ)
    bot = bot_brief()
    with conn() as c:
        status = ({r["key"]: r["value"] for r in c.execute("SELECT key, value FROM bot_status")}
                  if _has_table(c, "bot_status") else {})

        # Rejali ishlar: bot heartbeat'dagi ro'yxat + oxirgi natija + 7 kunlik hisob.
        try:
            planned = json.loads(status.get("jobs") or "[]")
        except ValueError:
            planned = []
        last_runs: dict[str, dict] = {}
        week: dict[str, dict] = {}
        recent_runs: list[dict] = []
        if _has_table(c, "job_runs"):
            for r in c.execute(
                "SELECT name, started_at, duration_ms, ok, error FROM job_runs "
                "WHERE id IN (SELECT MAX(id) FROM job_runs GROUP BY name)"):
                last_runs[r["name"]] = dict(r)
            since = (now - timedelta(days=7)).isoformat(timespec="seconds")
            for r in c.execute(
                "SELECT name, COUNT(*) AS runs, SUM(ok) AS ok_runs, "
                "ROUND(AVG(duration_ms)) AS avg_ms FROM job_runs "
                "WHERE started_at >= ? GROUP BY name", (since,)):
                week[r["name"]] = dict(r)
            recent_runs = [dict(r) for r in c.execute(
                "SELECT name, started_at, duration_ms, ok, error FROM job_runs "
                "ORDER BY id DESC LIMIT 30")]
        names = {j.get("name") for j in planned} | set(last_runs) | set(week)
        jobs = []
        for name in sorted(n for n in names if n):
            nxt = next((j.get("next") for j in planned if j.get("name") == name), None)
            jobs.append({"name": name, "next": nxt, "last": last_runs.get(name),
                         "week": week.get(name)})

        # Xatolar: 24 soat, 14 kunlik taqsimot, oxirgi 50 ta.
        errors = {"days": [], "recent": [], "total_24h": bot["errors_24h"]}
        if _has_table(c, "bot_errors"):
            start = (today() - timedelta(days=13)).isoformat()
            by_day = {r["day"]: int(r["n"]) for r in c.execute(
                "SELECT day, COUNT(*) AS n FROM bot_errors WHERE day >= ? GROUP BY day", (start,))}
            errors["days"] = [{"day": (today() - timedelta(days=13 - i)).isoformat(),
                               "n": by_day.get((today() - timedelta(days=13 - i)).isoformat(), 0)}
                              for i in range(14)]
            errors["recent"] = [dict(r) for r in c.execute(
                "SELECT id, kind, place, message, update_kind, user_id, created_at "
                "FROM bot_errors ORDER BY id DESC LIMIT 50")]
            errors["by_kind"] = [dict(r) for r in c.execute(
                "SELECT kind, place, COUNT(*) AS n FROM bot_errors "
                "WHERE created_at >= datetime('now', '-7 day') "
                "GROUP BY kind, place ORDER BY n DESC LIMIT 10")]

        # Voqealar: tur bo'yicha 7/30 kun, oxirgi 50 ta.
        events = {"by_name": [], "recent": []}
        if _has_table(c, "events"):
            d7 = (today() - timedelta(days=6)).isoformat()
            d30 = (today() - timedelta(days=29)).isoformat()
            counts: dict[str, dict] = {}
            for r in c.execute(
                "SELECT name, SUM(day >= ?) AS n7, COUNT(*) AS n30 FROM events "
                "WHERE day >= ? GROUP BY name ORDER BY n30 DESC", (d7, d30)):
                counts[r["name"]] = {"name": r["name"], "n7": int(r["n7"] or 0), "n30": int(r["n30"])}
            events["by_name"] = list(counts.values())
            events["recent"] = [dict(r) for r in c.execute(
                "SELECT e.id, e.user_id, e.name, e.detail, e.created_at, "
                "u.first_name, u.username FROM events e "
                "LEFT JOIN users u ON u.user_id = e.user_id ORDER BY e.id DESC LIMIT 50")]
            events["today"] = int(c.execute(
                "SELECT COUNT(*) FROM events WHERE day = ?", (today().isoformat(),)).fetchone()[0])

        # Taklif (referal): kim nechta odam chaqirgan.
        referrals = {"available": False}
        if _has_column(c, "users", "referred_by"):
            referrals = {
                "available": True,
                "referred": int(c.execute(
                    "SELECT COUNT(*) FROM users WHERE referred_by IS NOT NULL").fetchone()[0]),
                "referrers": int(c.execute(
                    "SELECT COUNT(DISTINCT referred_by) FROM users "
                    "WHERE referred_by IS NOT NULL").fetchone()[0]),
                "bonus_days": (int(c.execute(
                    "SELECT COALESCE(SUM(bonus_days), 0) FROM users").fetchone()[0])
                    if _has_column(c, "users", "bonus_days") else None),
                "top": [dict(r) for r in c.execute(
                    "SELECT r.referred_by AS user_id, COUNT(*) AS n, u.first_name, u.username "
                    "FROM users r LEFT JOIN users u ON u.user_id = r.referred_by "
                    "WHERE r.referred_by IS NOT NULL GROUP BY r.referred_by "
                    "ORDER BY n DESC LIMIT 10")],
            }

        categories = []
        if _has_table(c, "custom_categories"):
            categories = [dict(r) for r in c.execute(
                "SELECT id, name, kind, ru, emoji, icon, created_at FROM custom_categories "
                "ORDER BY id DESC")]

        rates = {"latest": [], "series": []}
        if _has_table(c, "rates"):
            rates["latest"] = [dict(r) for r in c.execute(
                "SELECT currency, day, rate, source FROM rates r "
                "WHERE day = (SELECT MAX(day) FROM rates WHERE currency = r.currency) "
                "ORDER BY currency")]
            rates["series"] = [dict(r) for r in c.execute(
                "SELECT day, currency, rate FROM rates WHERE day >= ? ORDER BY day, currency",
                ((today() - timedelta(days=13)).isoformat(),))]

        tables = [dict(r) for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' "
            "ORDER BY name")]
        table_counts = {}
        for t in tables:
            try:
                table_counts[t["name"]] = int(c.execute(
                    f'SELECT COUNT(*) FROM "{t["name"]}"').fetchone()[0])
            except Exception:  # noqa: BLE001 - ko'rinish uchun, muhim emas
                table_counts[t["name"]] = None

    bot.update({
        "python": status.get("python", ""),
        "ptb": status.get("ptb", ""),
        "pid": status.get("pid", ""),
        "concurrent_updates": status.get("concurrent_updates", ""),
        "recent_runs": recent_runs,
    })
    return {
        "now": now.isoformat(timespec="seconds"),
        "bot": bot,
        "jobs": jobs,
        "errors": errors,
        "events": events,
        "referrals": referrals,
        "categories": categories,
        "rates": rates,
        "server": server_metrics(),
        "panel": {
            "commit": _git_commit(settings.BASE_DIR),
            "started_at": PANEL_STARTED_AT.isoformat(timespec="seconds"),
            "uptime_s": int((now - PANEL_STARTED_AT).total_seconds()),
            "python": platform.python_version(),
        },
        "tables": table_counts,
    }


def update_category(cat_id: int, ru: str, emoji: str, icon: str) -> bool:
    """AI yaratgan kategoriyaning ko'rinishini (ruscha nomi, emoji, ikonka) tuzatadi."""
    with conn() as c:
        if not _has_table(c, "custom_categories"):
            return False
        cur = c.execute(
            "UPDATE custom_categories SET ru = ?, emoji = ?, icon = ? WHERE id = ?",
            (ru.strip()[:60], emoji.strip()[:8], icon.strip()[:32], cat_id))
        return cur.rowcount > 0
