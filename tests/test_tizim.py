"""«Tizim» sahifasi: bot holati, rejali ishlar, xatolar, voqealar, kategoriyalar;
GET keshi yozuvdan keyin tozalanishi."""

from datetime import datetime, timedelta

import settings
import store
from tests.conftest import add_user
from tests.test_muhim import app_module, client  # noqa: F401 (fixturalar)


def _exec(sql, *args):
    with store.conn() as c:
        c.execute(sql, args)


def _seed_bot(alive: bool = True):
    now = datetime.now(settings.TZ)
    seen = now - timedelta(seconds=30 if alive else 900)
    for k, v in (("started_at", (now - timedelta(hours=5)).isoformat(timespec="seconds")),
                 ("last_seen", seen.isoformat(timespec="seconds")),
                 ("commit", "abc1234"), ("python", "3.12.3"), ("ptb", "22.8"),
                 ("jobs", '[{"name": "kunlik-eslatma", "next": "2026-10-23T21:00:00+05:00"}]')):
        _exec("INSERT OR REPLACE INTO bot_status (key, value) VALUES (?, ?)", k, v)


def test_system_without_bot_tables_data_is_graceful(client):  # noqa: F811
    r = client.get("/api/system")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bot"]["known"] is False and body["bot"]["alive"] is False
    assert body["jobs"] == [] and body["errors"]["recent"] == []
    assert body["panel"]["python"] and "cpus" in body["server"]
    assert body["server"]["db"]["private"].get("missing") or body["server"]["db"]["private"].get("closed")


def test_system_reports_bot_jobs_errors_events(client, app_module):  # noqa: F811
    app_module.CACHE_TTL = 0
    _seed_bot(alive=True)
    add_user(1)
    _exec("INSERT INTO job_runs (name, started_at, duration_ms, ok, error) VALUES (?, ?, ?, ?, ?)",
          "kunlik-eslatma", datetime.now(settings.TZ).isoformat(timespec="seconds"), 42, 1, "")
    _exec("INSERT INTO job_runs (name, started_at, duration_ms, ok, error) VALUES (?, ?, ?, ?, ?)",
          "kurs-yangilash", datetime.now(settings.TZ).isoformat(timespec="seconds"), 0, 0, "TimeoutError")
    _exec("INSERT INTO bot_errors (kind, place, message, update_kind, user_id, day) VALUES (?, ?, ?, ?, ?, ?)",
          "KeyError", "bot.py:10", "'x'", "message", 1, store.today().isoformat())
    _exec("INSERT INTO events (user_id, name, detail, day) VALUES (?, ?, ?, ?)",
          1, "paywall_korsatildi", "csv", store.today().isoformat())
    _exec("INSERT INTO custom_categories (name, kind, ru, emoji) VALUES (?, ?, ?, ?)",
          "uy hayvonlari", "chiqim", "", "🐾")

    body = client.get("/api/system").json()
    bot = body["bot"]
    assert bot["known"] and bot["alive"] and bot["commit"] == "abc1234" and bot["uptime_s"] > 0
    assert bot["errors_24h"] == 1 and bot["last_error"]["kind"] == "KeyError"
    names = {j["name"]: j for j in body["jobs"]}
    assert names["kunlik-eslatma"]["next"].startswith("2026-10-23") and names["kunlik-eslatma"]["last"]["ok"] == 1
    assert names["kurs-yangilash"]["last"]["ok"] == 0 and names["kurs-yangilash"]["week"]["runs"] == 1
    assert body["errors"]["recent"][0]["place"] == "bot.py:10" and len(body["errors"]["days"]) == 14
    assert body["events"]["by_name"][0] == {"name": "paywall_korsatildi", "n7": 1, "n30": 1}
    assert body["events"]["recent"][0]["detail"] == "csv" and body["events"]["today"] == 1
    assert body["categories"][0]["name"] == "uy hayvonlari"
    assert body["tables"]["users"] == 1

    # Dashboard kartasi ham shu holatni ko'rsatadi.
    d = client.get("/api/dashboard").json()["bot"]
    assert d["alive"] and d["errors_24h"] == 1


def test_stale_heartbeat_means_not_alive(client, app_module):  # noqa: F811
    app_module.CACHE_TTL = 0
    _seed_bot(alive=False)
    bot = client.get("/api/system").json()["bot"]
    assert bot["known"] and not bot["alive"] and bot["stale_s"] >= 900


def test_category_update_writes_and_logs(client, app_module):  # noqa: F811
    app_module.CACHE_TTL = 0
    _exec("INSERT INTO custom_categories (name, kind) VALUES (?, ?)", "tamaki", "chiqim")
    cat_id = client.get("/api/system").json()["categories"][0]["id"]
    r = client.post(f"/api/categories/{cat_id}", json={"ru": "табак", "emoji": "🚬", "icon": "smoke"})
    assert r.status_code == 200
    cat = client.get("/api/system").json()["categories"][0]
    assert cat["ru"] == "табак" and cat["emoji"] == "🚬" and cat["icon"] == "smoke"
    assert store.list_log(1)[0]["action"] == "kategoriya tuzatildi"
    assert client.post("/api/categories/999", json={"ru": "x"}).status_code == 404


def test_get_cache_is_cleared_by_writes(client, app_module, monkeypatch):  # noqa: F811
    app_module.CACHE_TTL = 60
    app_module.cache_clear()
    calls = {"n": 0}
    real = store.system_status

    def counting(owner_ids):
        calls["n"] += 1
        return real(owner_ids)

    monkeypatch.setattr(store, "system_status", counting)
    client.get("/api/system")
    client.get("/api/system")
    assert calls["n"] == 1                      # ikkinchisi keshdan
    _exec("INSERT INTO custom_categories (name, kind) VALUES (?, ?)", "sport", "chiqim")
    with store.conn() as c:
        cat_id = c.execute("SELECT id FROM custom_categories WHERE name = 'sport'").fetchone()[0]
    client.post(f"/api/categories/{cat_id}", json={"ru": "спорт"})   # yozuv → kesh tozalanadi
    client.get("/api/system")
    assert calls["n"] == 2
    app_module.CACHE_TTL = 0
