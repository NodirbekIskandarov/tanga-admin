"""Telegram Bot API — admin paneldan xabar yuborish uchun.

Bot jarayoniga tegmaydi: xabarlar to'g'ridan-to'g'ri HTTP orqali ketadi,
shuning uchun bot qayta ishga tushirilishi shart emas.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

import settings

log = logging.getLogger("admin.telegram")

API = "https://api.telegram.org/bot{token}/{method}"

# Telegram cheklovi: sekundiga ~30 xabar. Ehtiyot uchun sekinroq yuboramiz.
SEND_DELAY = 0.06


async def send_message(user_id: int, text: str, parse_mode: str = "HTML") -> tuple[bool, str]:
    if not settings.TELEGRAM_TOKEN:
        return False, "TELEGRAM_TOKEN sozlanmagan"
    url = API.format(token=settings.TELEGRAM_TOKEN, method="sendMessage")
    payload = {"chat_id": user_id, "text": text, "parse_mode": parse_mode,
               "disable_web_page_preview": True}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(url, json=payload)
        data = r.json()
        if data.get("ok"):
            return True, "yuborildi"
        return False, str(data.get("description", "noma'lum xato"))
    except Exception as exc:                      # tarmoq uzilishi va h.k.
        log.warning("Xabar yuborilmadi (%s): %s", user_id, exc)
        return False, str(exc)


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


async def broadcast(user_ids: list[int], text: str) -> dict:
    """Ketma-ket yuboradi va natijani sanaydi. Bloklagan foydalanuvchilar
    xatoga sabab bo'ladi — ular alohida sanaladi, jarayon to'xtamaydi."""
    ok, failed, errors = 0, 0, {}
    for uid in user_ids:
        success, msg = await send_message(uid, text)
        if success:
            ok += 1
        else:
            failed += 1
            errors[msg] = errors.get(msg, 0) + 1
        await asyncio.sleep(SEND_DELAY)
    return {"ok": ok, "failed": failed, "errors": errors}
