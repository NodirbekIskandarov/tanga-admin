"""Bosh sahifa: «bugun» xulosasi (store.today_brief) — kecha va 7 kunlik
o'rtacha bilan, Toshkent kuni bo'yicha, egalarsiz."""

from datetime import datetime, timedelta, timezone

import settings
import store
from tests.conftest import add_user

OWNER = 777


def _utc(local: datetime) -> str:
    """Toshkent vaqtidagi lahzani users.created_at formatiga (UTC) o'giradi."""
    return local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")  # noqa: UP017


def _today_at(hour: int, days_ago: int = 0) -> datetime:
    t = store.today() - timedelta(days=days_ago)
    return datetime(t.year, t.month, t.day, hour, 30, tzinfo=settings.TZ)


def _entry(uid, days_ago=0, n=1):
    with store.conn() as c:
        c.execute("INSERT INTO entry_counts (user_id, day, n) VALUES (?, ?, ?)",
                  (uid, (store.today() - timedelta(days=days_ago)).isoformat(), n))


def _event(uid, name, days_ago=0):
    with store.conn() as c:
        c.execute("INSERT INTO events (user_id, name, detail, day) VALUES (?, ?, '', ?)",
                  (uid, name, (store.today() - timedelta(days=days_ago)).isoformat()))


def _pay(uid, amount, days_ago=0, **cols):
    t = _today_at(12, days_ago).isoformat()
    cols = {"plan_code": "1m", "days": 30, "method": "payme", "created_at": t, **cols}
    names = ", ".join(["user_id", "amount", *cols])
    marks = ", ".join("?" * (len(cols) + 2))
    with store.conn() as c:
        c.execute(f"INSERT INTO payments ({names}) VALUES ({marks})", (uid, amount, *cols.values()))


def test_today_counts_new_consent_first_day_writers_and_active():
    add_user(1, created_at=_utc(_today_at(1)), source="instagram:bio")       # 01:30 bugun
    _entry(1)
    add_user(2, created_at=_utc(_today_at(9)), consent_at=None, source="organik")
    add_user(3, created_at=_utc(_today_at(10, 3)))                          # 3 kun oldin
    _entry(3)                                                              # bugun faol, yangi emas
    add_user(OWNER, created_at=_utc(_today_at(8)))
    _entry(OWNER)
    b = store.today_brief({OWNER})
    assert b["today"]["new"] == 2 and b["today"]["consent"] == 1
    assert b["today"]["wrote"] == 1 and b["today"]["active"] == 2


def test_day_boundary_is_tashkent():
    # 23:30 kecha (Toshkent) = shu kunning UTC 18:30 — kechaga tushadi.
    add_user(5, created_at=_utc(_today_at(23, 1)))
    b = store.today_brief(set())
    assert b["yesterday"]["new"] == 1 and b["today"]["new"] == 0


def test_blocks_from_events_and_old_method_without_double_count():
    add_user(10, created_at=_utc(_today_at(9, 2)), bot_blocked_at=_today_at(11).isoformat())
    _event(10, "bot_bloklandi")                                            # aniq usul
    add_user(11, created_at=_utc(_today_at(9, 5)), bot_blocked_at=_today_at(8).isoformat())
    add_user(OWNER, created_at=_utc(_today_at(9, 5)))
    _event(OWNER, "bot_bloklandi")
    b = store.today_brief({OWNER})
    assert b["today"]["blocked"] == 2                                      # 10 (hodisa) + 11 (eski)


def test_payments_exclude_voided_test_and_owners():
    add_user(20, created_at=_utc(_today_at(9, 10)))
    _pay(20, 19000)
    _pay(20, 6900, voided_at=_today_at(13).isoformat())
    _pay(20, 1000, method="payme_test")
    add_user(OWNER, created_at=_utc(_today_at(9, 10)))
    _pay(OWNER, 99000)
    _pay(20, 6900, days_ago=1)
    b = store.today_brief({OWNER})
    assert (b["today"]["paid"], b["today"]["paid_sum"]) == (1, 19000)
    assert (b["yesterday"]["paid"], b["yesterday"]["paid_sum"]) == (1, 6900)


def test_avg7_uses_previous_seven_days_only():
    for i in range(1, 8):
        add_user(100 + i, created_at=_utc(_today_at(10, i)))
    add_user(200, created_at=_utc(_today_at(10)))                          # bugungi o'rtachaga kirmaydi
    b = store.today_brief(set())
    assert b["avg7"]["new"] == 1.0 and b["today"]["new"] == 1


def test_sources_for_last_seven_days():
    add_user(30, created_at=_utc(_today_at(9)), source="instagram:oylik")
    _entry(30)
    add_user(31, created_at=_utc(_today_at(9, 2)), source="organik", bot_blocked_at=_today_at(9).isoformat())
    add_user(32, created_at=_utc(_today_at(9, 3)), source="telegram_ads:1")
    _event(32, "bot_bloklandi", 2)       # yangi usul: faqat hodisa, bot_blocked_at yo'q
    add_user(33, created_at=_utc(_today_at(9, 10)), source="organik")       # 7 kundan eski
    src = {r["source"]: r for r in store.today_brief(set())["sources"]}
    assert (src["instagram"]["new"], src["instagram"]["wrote"]) == (1, 1)
    assert (src["organik"]["new"], src["organik"]["blocked"]) == (1, 1)
    assert (src["telegram_ads"]["new"], src["telegram_ads"]["blocked"]) == (1, 1)
    assert src["boshqa"]["new"] == 0


def test_series_has_30_days_ending_today():
    b = store.today_brief(set())
    assert len(b["series"]["labels"]) == 30 and b["series"]["labels"][-1] == b["date"]
    assert set(b["series"]) == {"labels", "new", "active", "blocked", "wrote"}
