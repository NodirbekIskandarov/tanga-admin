"""Gemini va ovozga o'tish: panel eski Claude qatorlarini O'ZGARTIRMAY
ko'rsatadi, yangi amal nomlari (ovoz) o'qiladigan yorliq bilan chiqadi."""

from pathlib import Path

import store

ROOT = Path(__file__).resolve().parents[1]


def _log(operation, model, cost, user=1):
    with store.conn() as c:
        c.execute(
            "INSERT INTO usage_log (user_id, day, operation, model, input_tokens, "
            "output_tokens, cost_usd) VALUES (?, ?, ?, ?, 100, 20, ?)",
            (user, store.today().isoformat(), operation, model, cost))


def test_old_claude_rows_and_new_gemini_rows_live_side_by_side():
    _log("matn", "claude-haiku-4-5", 0.004)           # o'tmish yozuvi — saqlangan narx
    _log("matn", "gemini-3.5-flash-lite", 0.0007)
    _log("ovoz", "gemini-3.5-flash-lite", 0.0011)
    _log("chek", "gemini-3.8-flash", 0.015)

    data = store.cost_breakdown(30)
    models = {m["model"]: m for m in data["by_model"]}
    assert set(models) == {"claude-haiku-4-5", "gemini-3.5-flash-lite", "gemini-3.8-flash"}
    assert models["claude-haiku-4-5"]["cost"] == 0.004          # eski narx o'zgarmagan
    ops = {o["operation"]: o for o in data["by_operation"]}
    assert set(ops) == {"matn", "ovoz", "chek"}
    assert ops["ovoz"]["calls"] == 1 and ops["matn"]["calls"] == 2


def test_user_card_shows_voice_usage():
    _log("ovoz", "gemini-3.5-flash-lite", 0.001, user=5)
    with store.conn() as c:
        c.execute("INSERT INTO users (user_id, first_name) VALUES (5, 'Ali')")
    usage = store.get_user(5)["usage"]
    assert [u["operation"] for u in usage] == ["ovoz"]


def test_frontend_labels_every_operation():
    js = (ROOT / "frontend" / "src" / "lib" / "format.js").read_text(encoding="utf-8")
    for key, label in (("matn", "Matnli yozuv"), ("chek", "Chek"),
                       ("savol", "AI savol"), ("ovoz", "Ovozli yozuv")):
        assert f'{key}: "{label}"' in js
    for page in ("Finance.jsx", "UserDetail.jsx"):
        source = (ROOT / "frontend" / "src" / "pages" / page).read_text(encoding="utf-8")
        assert "amalNomi(" in source and "{r.operation}</b>" not in source
