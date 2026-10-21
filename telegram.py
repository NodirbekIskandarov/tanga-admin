"""Telegram Bot API — admin paneldan xabar yuborish uchun.

Bot jarayoniga tegmaydi: xabarlar to'g'ridan-to'g'ri HTTP orqali ketadi,
shuning uchun bot qayta ishga tushirilishi shart emas.
"""

from __future__ import annotations

import asyncio
import html
import logging
import mimetypes

import httpx

import settings

log = logging.getLogger("admin.telegram")

API = "https://api.telegram.org/bot{token}/{method}"

# Telegram cheklovi: sekundiga ~30 xabar. Ehtiyot uchun sekinroq yuboramiz.
SEND_DELAY = 0.06


async def send(user_id: int, text: str, parse_mode: str = "HTML") -> tuple[bool, str, int]:
    """Xabar yuboradi. Qaytaradi: (yetdimi, izoh, Telegram xato kodi).

    Kod 403 — odam botni bloklagan. Chaqiruvchi uni bazada belgilaydi
    (`store.mark_bot_blocked`), shunda bot ham, panel ham unga qayta
    urinmaydi — botdagi notify.send bilan bir xil qoida.
    """
    if not settings.TELEGRAM_TOKEN:
        return False, "TELEGRAM_TOKEN sozlanmagan", 0
    url = API.format(token=settings.TELEGRAM_TOKEN, method="sendMessage")
    payload = {"chat_id": user_id, "text": text, "parse_mode": parse_mode,
               "disable_web_page_preview": True}
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(url, json=payload)
            data = r.json()
        except Exception as exc:                  # tarmoq uzilishi va h.k.
            log.warning("Xabar yuborilmadi (%s): %s", user_id, exc)
            return False, str(exc), 0
        if data.get("ok"):
            return True, "yuborildi", 0
        code = int(data.get("error_code") or 0)
        description = str(data.get("description", "noma'lum xato"))

        if code == 429 and attempt < 2:
            # Telegram tezlik chegarasi: aytilgan vaqt kutilib qayta uriladi.
            # Ilgari 429 oddiy xato sanalardi va ommaviy xabarning katta
            # qismi («22 yuborildi, 16 xato») yetib bormasdi.
            wait = int((data.get("parameters") or {}).get("retry_after") or 1)
            log.warning("Telegram 429: %s s kutilmoqda", wait)
            await asyncio.sleep(min(wait, 30) + 0.5)
            continue
        if (code == 400 and "parse entities" in description.lower()
                and payload.get("parse_mode") and attempt < 2):
            # Matnda yopilmagan teg yoki «<» bor: xabar yo'qolmasin —
            # belgilar qochirilib oddiy matn sifatida yuboriladi.
            payload = {**payload, "text": html.escape(text)}
            continue
        return False, description, code
    return False, "qayta urinishlar tugadi", 0


async def send_video(user_id: int, video, caption: str = "",
                     parse_mode: str = "HTML") -> tuple[bool, str, int, str]:
    """Video yuboradi. Qaytaradi: (yetdimi, izoh, Telegram xato kodi, file_id).

    `video` — Telegram `file_id` (matn) yoki (fayl nomi, baytlar). Baytlar
    bir marta yuklanadi (50 MB gacha), javobdagi `file_id` keyingi
    yuborishlarda qayta ishlatiladi — ommaviy xabarda har bir odamga
    faylni qayta yuklash shart emas (telegram.broadcast).
    """
    if not settings.TELEGRAM_TOKEN:
        return False, "TELEGRAM_TOKEN sozlanmagan", 0, ""
    url = API.format(token=settings.TELEGRAM_TOKEN, method="sendVideo")
    fields = {"chat_id": str(user_id), "supports_streaming": "true"}
    if caption:
        fields.update(caption=caption, parse_mode=parse_mode)
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=180) as client:
                if isinstance(video, str):
                    r = await client.post(url, data={**fields, "video": video})
                else:
                    name, data = video
                    mime = mimetypes.guess_type(name)[0] or "video/mp4"
                    r = await client.post(url, data=fields,
                                          files={"video": (name, data, mime)})
            payload = r.json()
        except Exception as exc:
            log.warning("Video yuborilmadi (%s): %s", user_id, exc)
            return False, str(exc), 0, ""
        if payload.get("ok"):
            file_id = str(((payload.get("result") or {}).get("video") or {}).get("file_id") or "")
            return True, "yuborildi", 0, file_id
        code = int(payload.get("error_code") or 0)
        description = str(payload.get("description", "noma'lum xato"))
        if code == 429 and attempt < 2:
            wait = int((payload.get("parameters") or {}).get("retry_after") or 1)
            log.warning("Telegram 429: %s s kutilmoqda", wait)
            await asyncio.sleep(min(wait, 30) + 0.5)
            continue
        if (code == 400 and "parse entities" in description.lower()
                and fields.get("parse_mode") and attempt < 2):
            fields = {**fields, "caption": html.escape(caption)}
            continue
        return False, description, code, ""
    return False, "qayta urinishlar tugadi", 0, ""


async def send_message(user_id: int, text: str, parse_mode: str = "HTML") -> tuple[bool, str]:
    ok, info, _ = await send(user_id, text, parse_mode)
    return ok, info


async def fetch_file(file_id: str) -> tuple[bytes, str] | None:
    """Telegram serveridan faylni oladi (to'lov cheki rasmi).

    Rasm bizda saqlanmaydi — har safar Telegramdan olinadi. Shu tufayli
    serverda foydalanuvchilarning to'lov hujjatlari to'planib qolmaydi.
    """
    if not settings.TELEGRAM_TOKEN:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                API.format(token=settings.TELEGRAM_TOKEN, method="getFile"),
                params={"file_id": file_id})
            data = r.json()
            if not data.get("ok"):
                log.warning("getFile xatosi: %s", data.get("description"))
                return None
            path = data["result"]["file_path"]
            url = (f"https://api.telegram.org/file/bot"
                   f"{settings.TELEGRAM_TOKEN}/{path}")
            f = await client.get(url)
            if f.status_code != 200:
                return None
            ext = path.rsplit(".", 1)[-1].lower() if "." in path else "jpg"
            mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                    "webp": "image/webp", "pdf": "application/pdf"}.get(ext, "image/jpeg")
            return f.content, mime
    except Exception as exc:
        log.warning("Faylni olib bo'lmadi: %s", exc)
        return None


async def broadcast(user_ids: list[int], text: str,
                    progress: dict | None = None,
                    video: tuple[str, bytes] | None = None,
                    upload_chat: int | None = None) -> dict:
    """Ketma-ket yuboradi va natijani sanaydi. Bloklagan foydalanuvchilar
    xatoga sabab bo'ladi — ular alohida sanaladi (`blocked_ids`),
    jarayon to'xtamaydi.

    `progress` — berilsa, har bir xabardan keyin shu lug'at (ok, failed,
    errors) jonli yangilanadi: fon vazifasi paytida interfeys jarayonni
    ko'rsatib turadi.

    `video` — (fayl nomi, baytlar): matn video ostida izoh bo'ladi. Fayl
    avval `upload_chat` ga (ega — unga nusxa ham boradi) yuklanib
    `file_id` olinadi; ega bo'lmasa yoki unga yetmasa — birinchi
    yetib borgan qabul qiluvchiga. Qolganlarga `file_id` ketadi.
    """
    state = progress if progress is not None else {}
    state.update(ok=0, failed=0, errors={})
    blocked: list[int] = []

    def miss(uid: int, msg: str, code: int) -> None:
        state["failed"] += 1
        state["errors"][msg] = state["errors"].get(msg, 0) + 1
        if code == 403:
            blocked.append(uid)

    file_id = ""
    done: set[int] = set()                   # videoni allaqachon olganlar
    if video is not None:
        recipients = set(user_ids)
        targets = ([upload_chat] if upload_chat else []) + \
                  [u for u in user_ids if u != upload_chat]
        for uid in targets:
            ok, msg, code, fid = await send_video(uid, video, text)
            if ok and fid:
                file_id = fid
                if uid in recipients:
                    done.add(uid)
                    state["ok"] += 1
                break
            if uid == upload_chat:
                log.warning("Video egaga yuklanmadi (%s): %s", uid, msg)
            else:
                done.add(uid)
                miss(uid, msg, code)
            await asyncio.sleep(SEND_DELAY)
        if not file_id:
            state["error"] = "video Telegram'ga yuklanmadi"
            return {"ok": state["ok"], "failed": state["failed"],
                    "errors": state["errors"], "blocked_ids": blocked}

    for uid in user_ids:
        if uid in done:
            continue
        if file_id:
            success, msg, code, _ = await send_video(uid, file_id, text)
        else:
            success, msg, code = await send(uid, text)
        if success:
            state["ok"] += 1
        else:
            miss(uid, msg, code)
        await asyncio.sleep(SEND_DELAY)
    return {"ok": state["ok"], "failed": state["failed"],
            "errors": state["errors"], "blocked_ids": blocked}
