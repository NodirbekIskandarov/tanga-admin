"""Muntazamlik: kunma-kun yozuv kiritayotganlar (2026-11).

Manba — entry_counts (faqat kunlik SON). Seriya, eng uzun seriya, 7/30 kunlik
faol kunlar, segmentlar, kunlik faollik grafigi, foydalanuvchi kalendari,
API va CSV.
"""

from __future__ import annotations

import csv
import io
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

import auth
import store
from tests.conftest import add_user

OWNER = 777
TODAY = store.today()


def ago(n: int) -> str:
    return (TODAY - timedelta(days=n)).isoformat()


def write(uid: int, *days_ago: int, n: int = 1) -> None:
    with store.conn() as c:
        for d in days_ago:
            c.execute("INSERT OR REPLACE INTO entry_counts (user_id, day, n) VALUES (?, ?, ?)",
                      (uid, ago(d), n))


def P(*days_ago: int):
    return store.activity_profile({TODAY - timedelta(days=d): 1 for d in days_ago}, TODAY)


# ---------------------------------------------------------------- profil --

def test_streak_counts_from_today_or_yesterday():
    assert P(0, 1, 2)["streak"] == 3                   # bugun ham yozgan
    assert P(1, 2, 3)["streak"] == 3                   # bugun hali yo'q — uzilmagan
    assert P(2, 3, 4)["streak"] == 0                   # kecha yozmagan — uzilgan
    assert P(0, 2, 3)["streak"] == 1
    assert P()["streak"] == 0 and P()["best"] == 0 and P()["last_day"] is None


def test_best_streak_and_active_days():
    p = P(0, 1, 5, 6, 7, 8, 20, 40)
    assert p["best"] == 4 and p["streak"] == 2
    assert (p["d7"], p["d30"], p["active_total"]) == (4, 7, 8)
    assert p["last_day"] == ago(0) and p["first_day"] == ago(40)
    assert len(p["strip"]) == store.STRIP_DAYS and p["strip"][-1] == 1 and p["strip"][-3] == 0


@pytest.mark.parametrize("days, want", [
    ((0, 1), {"faol", "seriya"}),
    ((0, 1, 2, 3), {"faol", "seriya", "muntazam"}),
    ((1, 2, 3, 4), {"faol", "seriya", "muntazam", "xavf"}),   # bugun hali yozmagan
    ((1, 2), {"faol", "seriya", "xavf"}),
    ((1,), {"faol"}),                                          # 1 kun — seriya emas
    ((8, 10, 12), {"faol", "tushgan"}),                        # oxirgi hafta yo'q
    ((8, 10), {"faol"}),                                       # oldin ham kam yozgan
    ((40, 41, 42), set()),                                     # 30 kundan eski
])
def test_segments(days, want):
    assert set(P(*days)["segments"]) == want


def test_future_dates_are_ignored():
    write(1, 0)
    with store.conn() as c:
        c.execute("INSERT INTO entry_counts (user_id, day, n) VALUES (1, ?, 5)",
                  ((TODAY + timedelta(days=3)).isoformat(),))
        days = store._entry_days(c)[1]
    assert list(days) == [TODAY]


# -------------------------------------------------------------- ro'yxat --

@pytest.fixture
def people():
    add_user(OWNER)                                     # ega — hisobga kirmaydi
    write(OWNER, 0, 1, 2, 3, 4, 5, 6)
    add_user(1, first_name="Ali", username="ali_k")
    write(1, 0, 1, 2, 3, 4)                            # 5 kunlik seriya, bugun yozgan
    add_user(2, first_name="Vali")
    write(2, 1, 2, 3)                                  # 3 kun, bugun hali yo'q — xavf
    add_user(3, first_name="Gani")
    write(3, 9, 11, 13)                                # tushib qolgan
    add_user(4, first_name="Yangi")
    write(4, 0)                                        # bugun birinchi marta
    add_user(5, first_name="Hech")                     # hech yozmagan


def test_regulars_segments_sort_and_owner_excluded(people):
    d = store.regulars({OWNER})
    assert [r["user_id"] for r in d["items"]] == [1, 2, 4, 3]       # seriya bo'yicha
    assert d["counts"] == {"faol": 4, "seriya": 2, "muntazam": 1, "xavf": 1, "tushgan": 1}
    assert [r["user_id"] for r in store.regulars({OWNER}, "xavf")["items"]] == [2]
    assert [r["user_id"] for r in store.regulars({OWNER}, "tushgan")["items"]] == [3]
    assert [r["user_id"] for r in store.regulars({OWNER}, "faol", "oxirgi")["items"]][:2] in ([1, 4], [4, 1])
    assert [r["user_id"] for r in store.regulars({OWNER}, "faol", search="ALI_k")["items"]] == [1]
    assert store.regulars({OWNER}, "nomalum", "nomalum")["segment"] == "faol"
    row = d["items"][0]
    assert (row["streak"], row["best"], row["d7"], row["wrote_today"]) == (5, 5, 5, True)
    assert row["state"] == "bepul" and row["first_name"] == "Ali" and row["username"] == "ali_k"


def test_daily_series_and_summary(people):
    d = store.regulars({OWNER})
    s = {x["day"]: x for x in d["series"]}
    assert len(d["series"]) == 30 and d["series"][-1]["day"] == ago(0)
    assert (s[ago(0)]["active"], s[ago(0)]["new"], s[ago(0)]["returning"]) == (2, 1, 1)   # Ali qaytgan, Yangi yangi
    assert (s[ago(1)]["active"], s[ago(4)]["new"]) == (2, 1)                               # Ali 4 kun oldin boshlagan
    sm = d["summary"]
    assert (sm["today"], sm["yesterday"], sm["ever"], sm["best_streak"]) == (2, 2, 4, 5)
    # Kechagacha 7 kun: Ali 4 kun, Vali 3 kun → 7/7 = 1.0 o'rtacha; 30 kunda 3 kishi.
    assert (sm["dau7"], sm["mau"], sm["stickiness"]) == (1.0, 3, 33.3)


def test_empty_database_is_graceful():
    d = store.regulars({OWNER})
    assert d["items"] == [] and d["total"] == 0
    assert d["summary"]["stickiness"] is None and d["summary"]["best_streak"] == 0
    assert all(x["active"] == 0 for x in d["series"])


# ------------------------------------------------------------ kalendar --

def test_user_card_has_12_week_calendar():
    add_user(1)
    write(1, 0, 1, 2, n=3)
    a = store.get_user(1, {OWNER})["activity"]
    assert a["streak"] == 3 and a["weeks"] == store.CALENDAR_WEEKS
    cal = a["calendar"]
    assert len(cal) == 7 * store.CALENDAR_WEEKS
    from datetime import date
    assert date.fromisoformat(cal[0]["day"]).weekday() == 0                 # dushanbadan
    by_day = {x["day"]: x["n"] for x in cal}
    assert by_day[ago(0)] == 3 and by_day[ago(3)] == 0
    future = [x for x in cal if x["day"] > ago(0)]
    assert len(future) == 6 - TODAY.weekday() and all(x["n"] is None for x in future)
    assert "strip" not in a


# ----------------------------------------------------------------- API --

@pytest.fixture
def client(monkeypatch):
    import app as module
    monkeypatch.setattr(module, "OWNER_IDS", {OWNER})
    module.cache_clear()
    h, salt = auth.hash_password("test-parol-123")
    store.create_admin("nodir", h, salt)
    token = auth.make_session("nodir", auth.password_version(store.get_admin("nodir")))
    c = TestClient(module.app, base_url="https://testserver")
    c.cookies.set(auth.COOKIE_NAME, token)
    c.headers["X-CSRF-Token"] = auth.read_session(token)["c"]
    return c


def test_api_requires_login():
    import app as module
    anon = TestClient(module.app, base_url="https://testserver")
    assert anon.get("/api/regulars").status_code == 401
    assert anon.get("/api/export/regulars.csv").status_code == 401


def test_api_regulars(client, people):
    r = client.get("/api/regulars", params={"segment": "seriya"})
    assert r.status_code == 200
    d = r.json()
    assert [i["user_id"] for i in d["items"]] == [1, 2] and d["pages"] == 1
    assert d["segments"]["xavf"] and d["counts"]["faol"] == 4
    assert "first_name" in d["items"][0] and "strip" in d["items"][0]
    assert client.get("/api/regulars", params={"segment": "x"}).status_code == 400
    assert client.get("/api/regulars", params={"tartib": "x"}).status_code == 400


def test_api_user_includes_activity(client, people):
    a = client.get("/api/users/1").json()["user"]["activity"]
    assert a["streak"] == 5 and len(a["calendar"]) == 7 * store.CALENDAR_WEEKS


def test_csv_export_is_logged_and_complete(client, people):
    r = client.get("/api/export/regulars.csv", params={"segment": "faol"})
    assert r.status_code == 200 and "muntazamlik-faol.csv" in r.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0][:5] == ["user_id", "ism", "username", "holat", "joriy_seriya"]
    assert [int(x[0]) for x in rows[1:]] == [1, 2, 4, 3]
    assert rows[1][4] == "5" and rows[1][10] == "ha"
    with store.conn() as c:
        assert c.execute("SELECT COUNT(*) FROM admin_log WHERE action = 'eksport' "
                         "AND target = 'muntazamlik:faol'").fetchone()[0] == 1
