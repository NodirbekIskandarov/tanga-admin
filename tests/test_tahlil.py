"""Foydalanuvchilar tahlili: «bepul» holati, aloqa segmentlari, til va
manba filtrlari, karta profili (taklif zanjiri, hodisalar), Umumiy holatdagi
aloqa sonlari, ommaviy xabar segmenti va CSV ustunlari.

Sabab: 2026-10 da 87 foydalanuvchidan 39 tasi botni bloklagan, 25 tasi
rozilik bermagan edi — panel buni ko'rsatmasdi; «tugagan» esa Bepul
darajada foydalanishda davom etayotganlarni yo'qotilgandek ko'rsatardi.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta

import settings
import store
from tests.conftest import add_user
from tests.test_muhim import app_module, client  # noqa: F401

OWNERS = {777}


def _shift(days: int) -> str:
    return (datetime.now(settings.TZ) + timedelta(days=days)).isoformat(timespec="seconds")


def _wrote(uid: int, n: int = 3, day: str = "2026-10-01") -> None:
    with store.conn() as c:
        c.execute("INSERT INTO entry_counts (user_id, day, n) VALUES (?, ?, ?)", (uid, day, n))


def _seed() -> None:
    add_user(1, trial_ends_at=_shift(-3))                    # bepul, yozgan, yetib boradi
    _wrote(1)
    add_user(2, trial_ends_at=_shift(5),
             bot_blocked_at="2026-10-10T12:00:00+05:00")     # sinovda, botni bloklagan
    _wrote(2)
    add_user(3, trial_ends_at=_shift(5), consent_at=None)    # rozilik bermagan, yozmagan
    add_user(4, trial_ends_at=_shift(5), lang="ru",
             source="instagram")                             # hech yozmagan, ru, instagram
    add_user(777, first_name="Ega")                          # ega — sonlarga kirmaydi
    _wrote(777)


# ------------------------------------------------------------- holat nomi --

def test_expired_trial_is_free_tier_not_lost():
    add_user(1, trial_ends_at=_shift(-3))
    assert store.get_user(1, OWNERS)["state"] == "bepul"
    # Eski filtr nomi hali ishlaydi — saqlangan havolalar buzilmasin.
    rows, _ = store.list_users(state="tugagan", owner_ids=OWNERS)
    assert [r["user_id"] for r in rows] == [1]


# ------------------------------------------------------------- segmentlar --

def test_segment_language_and_source_filters():
    _seed()

    def ids(**kw):
        rows, _ = store.list_users(owner_ids=OWNERS, limit=100, **kw)
        return sorted(r["user_id"] for r in rows)

    assert ids(segment="bloklagan") == [2]
    assert ids(segment="rozilik_yoq") == [3]
    assert ids(segment="yozmagan") == [3, 4]
    assert ids(segment="yetib_boradi") == [1, 4, 777]        # ro'yxatda ega ham bor
    assert ids(lang="ru") == [4]
    assert ids(source="instagram") == [4]
    assert ids(source="-") == [1, 2, 3, 777]                 # manbasiz kelganlar


def test_audience_summary_and_overview_churn_exclude_owners():
    _seed()
    s = store.audience_summary(OWNERS)
    assert s["segments"] == {"yetib_boradi": 2, "bloklagan": 1,
                             "rozilik_yoq": 1, "yozmagan": 2}
    assert s["sources"] == [{"source": "", "count": 3}, {"source": "instagram", "count": 1}]
    assert s["langs"] == {"uz": 3, "ru": 1}
    ov = store.overview(OWNERS)
    assert ov["churn"] == s["segments"]
    assert ov["states"]["bepul"] == 1 and ov["states"]["sinov"] == 3


# ------------------------------------------------------------------ karta --

def test_user_card_has_profile_referrals_and_events():
    add_user(10, first_name="Chaqirgan")
    add_user(11, referred_by=10, lang="ru", source="telegram_ads", streak=4,
             best_streak=9, last_entry_day="2026-10-18", reminder_hour=20,
             bonus_days=7, bot_blocked_at="2026-10-19T09:00:00+05:00")
    add_user(12, referred_by=10)
    with store.conn() as c:
        c.executemany(
            "INSERT INTO events (user_id, name, detail, day) VALUES (?, ?, ?, ?)",
            [(11, "start", "", "2026-10-01"), (11, "paywall_korsatildi", "receipts", "2026-10-05")])

    u = store.get_user(11, OWNERS)
    assert u["referrer"] == {"user_id": 10, "first_name": "Chaqirgan", "username": None}
    assert u["referrals"] == 0
    assert store.get_user(10, OWNERS)["referrals"] == 2
    assert u["bot_blocked"] and u["consented"]
    assert u["lang"] == "ru" and u["source"] == "telegram_ads" and u["streak"] == 4
    # Hodisalar — yangisi birinchi, moliyaviy mazmunsiz.
    assert [(e["name"], e["detail"]) for e in u["events"]] == \
        [("paywall_korsatildi", "receipts"), ("start", "")]


# -------------------------------------------------------------------- API --

def test_users_api_filters_and_summary(client):
    _seed()
    r = client.get("/api/users", params={"segment": "bloklagan"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [u["user_id"] for u in body["items"]] == [2]
    assert body["summary"]["segments"]["bloklagan"] == 1
    assert body["segment_labels"]["bloklagan"] == "Botni bloklagan"
    assert client.get("/api/users", params={"segment": "notogri"}).status_code == 400

    r = client.get("/api/users", params={"til": "ru", "manba": "instagram"})
    assert [u["user_id"] for u in r.json()["items"]] == [4]


def test_broadcast_free_tier_segment_reaches_only_reachable(client):
    _seed()
    body = client.get("/api/broadcast").json()
    assert "bepul" in body["segments"] and "tugagan" not in body["segments"]
    assert body["counts"]["bepul"] == 1                      # faqat 1-foydalanuvchi


def test_users_csv_has_contact_columns(client):
    _seed()
    r = client.get("/api/export/users.csv")
    assert r.status_code == 200
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0][9:] == ["til", "manba", "rozilik", "botni_bloklagan", "oxirgi_yozuv"]
    row = next(x for x in rows[1:] if x[0] == "2")
    assert row[11] == "ha" and row[12] == "2026-10-10T12:00:00+05:00"
    row4 = next(x for x in rows[1:] if x[0] == "4")
    assert row4[9] == "ru" and row4[10] == "instagram"
