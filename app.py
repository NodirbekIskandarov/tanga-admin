"""Tanga — admin boshqaruv paneli (JSON API + React SPA).

Frontend alohida React ilovasi (frontend/), yig'ilgan fayllar static/dist
ichida turadi va shu yerdan beriladi. Barcha ma'lumot /api/* orqali
JSON ko'rinishida almashinadi.

Ishga tushirish:  uvicorn app:app --host 127.0.0.1 --port 8100
"""

from __future__ import annotations

import csv
import io
import logging
import mimetypes
import os
import time
from datetime import datetime
from pathlib import Path

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import (FileResponse, JSONResponse, Response,
                               StreamingResponse)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import auth
import plans
import settings
import store
import telegram

logging.basicConfig(
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s", level=logging.INFO)
log = logging.getLogger("admin")

app = FastAPI(title=settings.APP_NAME, docs_url=None, redoc_url=None, openapi_url=None)

DIST = settings.BASE_DIR / "static" / "dist"
OWNER_IDS = {int(x) for x in os.getenv("OWNER_IDS", "").replace(",", " ").split()
             if x.strip().isdigit()}


@app.on_event("startup")
def _startup() -> None:
    store.init()
    for problem in settings.missing():
        log.error("SOZLAMA XATOSI: %s", problem)
    if not (DIST / "index.html").exists():
        log.warning("Frontend yig'ilmagan: %s topilmadi. "
                    "frontend/ ichida `npm run build` bajaring.", DIST / "index.html")
    log.info("Admin panel tayyor. Baza: %s | Egalar: %s",
             settings.DB_PATH, OWNER_IDS or "yo'q")


# --------------------------------------------------------------------------- #
# Xavfsizlik sarlavhalari
#
# Caddy ham qo'yadi, lekin ilova o'zi ham qo'yishi kerak: proxy sozlamasi
# o'zgarsa yoki ilova boshqa joyda ishga tushsa himoya yo'qolib qolmasin.
# --------------------------------------------------------------------------- #

CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "   # React inline uslublari uchun
    "img-src 'self' data: blob:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "form-action 'self'; "
    "base-uri 'none'; "
    "object-src 'none'"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Content-Security-Policy", CSP)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy",
                                "geolocation=(), microphone=(), camera=()")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers.setdefault("Strict-Transport-Security",
                                    "max-age=31536000; includeSubDomains")
    return response


# --------------------------------------------------------------------------- #
# Autentifikatsiya
# --------------------------------------------------------------------------- #

def client_ip(request: Request) -> str:
    """Haqiqiy mijoz manzili.

    `X-Forwarded-For` ning BIRINCHI qiymatini olish mumkin emas. Caddy bu
    sarlavhani almashtirmaydi — oxiriga qo'shadi. Ya'ni mijoz o'zi
    `X-Forwarded-For: 1.2.3.4` yuborsa, Caddy uni
    `1.2.3.4, <haqiqiy-ip>` ga aylantiradi va birinchi qiymat hujumchi
    yozgan matn bo'ladi.

    Bu shunchaki noto'g'ri jurnal emas: `auth.py` kirish xatosida
    «KIRISH XATO: <ip>» deb yozadi va serverdagi `panel-admin` fail2ban
    jail'i aynan shu qatorni o'qiydi. Soxta qiymat bilan hujumchi
    istalgan manzilni — shu jumladan egasinikini — bloklatib yuborishi
    mumkin edi. Audit jurnaliga ham soxta IP tushardi.

    Bitta ishonchli proksi (Caddy) bor, shuning uchun kerakli qiymat —
    ro'yxatning OXIRGISI: uni proksining o'zi qo'ygan.
    """
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        parts = [p.strip() for p in fwd.split(",") if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else ""


def current_admin(request: Request) -> dict:
    data = auth.read_session(request.cookies.get(auth.COOKIE_NAME, ""))
    if not data:
        raise HTTPException(401, "Kirish kerak")
    return data


def writer(request: Request, session: dict = Depends(current_admin)) -> dict:
    """O'zgartiruvchi amallar uchun: sessiya + CSRF tokeni.

    SPA tokenni X-CSRF-Token sarlavhasida yuboradi. Boshqa sayt bunday
    sarlavhani qo'sha olmaydi (CORS oddiy so'rovga ruxsat bermaydi), shu
    bilan birga cookie SameSite=Strict — ikki qatlamli himoya.
    """
    token = request.headers.get("x-csrf-token", "")
    if not token or token != session.get("c"):
        raise HTTPException(403, "CSRF tokeni mos kelmadi. Sahifani yangilang.")
    return session


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        auth.COOKIE_NAME, token,
        max_age=settings.SESSION_HOURS * 3600,
        httponly=True, secure=settings.COOKIE_SECURE, samesite="strict", path="/")


@app.exception_handler(HTTPException)
async def _http_error(request: Request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


# --------------------------------------------------------------------------- #
# So'rov chegarasi — kirish sahifasiga qaratilgan hujumga qarshi
# --------------------------------------------------------------------------- #

_ip_hits: dict[str, list[float]] = {}
IP_LIMIT, IP_WINDOW = 240, 60


def _rate_limit(ip: str, limit: int = IP_LIMIT) -> None:
    now = time.time()
    hits = [t for t in _ip_hits.get(ip, []) if now - t < IP_WINDOW]
    if len(hits) >= limit:
        raise HTTPException(429, "Juda ko'p so'rov. Biroz kuting.")
    hits.append(now)
    _ip_hits[ip] = hits
    if len(_ip_hits) > 5000:
        for key in [k for k, v in _ip_hits.items() if not v or now - v[-1] > 300]:
            _ip_hits.pop(key, None)


# --------------------------------------------------------------------------- #
# Yordamchilar
# --------------------------------------------------------------------------- #

def _iso(value) -> str | None:
    if not value:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _plans() -> list[dict]:
    return [{**p, "discount": plans.discount_percent(p)} for p in plans.all_plans()]


# --------------------------------------------------------------------------- #
# Sessiya
# --------------------------------------------------------------------------- #

class LoginBody(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


@app.post("/api/login")
def api_login(request: Request, body: LoginBody):
    ip = client_ip(request)
    _rate_limit(ip, limit=30)
    try:
        token = auth.login(body.username, body.password, ip)
    except auth.LoginError as exc:
        raise HTTPException(401, str(exc))
    session = auth.read_session(token) or {}
    response = JSONResponse({"admin": session.get("u"), "csrf": session.get("c")})
    _set_session_cookie(response, token)
    return response


@app.post("/api/logout")
def api_logout(request: Request):
    data = auth.read_session(request.cookies.get(auth.COOKIE_NAME, ""))
    if data:
        store.log_action(data["u"], "chiqdi", ip=client_ip(request))
    response = JSONResponse({"ok": True})
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return response


@app.get("/api/session")
def api_session(session: dict = Depends(current_admin)):
    return {
        "admin": session["u"],
        "csrf": session["c"],
        "expires_at": session.get("exp"),
        "app_name": settings.APP_NAME,
        "pending": store.pending_count(),
        "proofs": store.proof_count(),
    }


class PasswordBody(BaseModel):
    current: str = Field(max_length=256)
    new1: str = Field(min_length=10, max_length=256)
    new2: str = Field(min_length=10, max_length=256)


@app.post("/api/password")
def api_password(request: Request, body: PasswordBody,
                 session: dict = Depends(writer)):
    row = store.get_admin(session["u"])
    if not row or not auth.verify_password(body.current, row["password_hash"],
                                           row["salt"]):
        raise HTTPException(400, "Joriy parol noto'g'ri.")
    if body.new1 != body.new2:
        raise HTTPException(400, "Yangi parollar mos kelmadi.")
    if body.new1 == body.current:
        raise HTTPException(400, "Yangi parol eskisidan farq qilsin.")
    h, s = auth.hash_password(body.new1)
    store.set_admin_password(session["u"], h, s)
    store.log_action(session["u"], "parol almashtirildi", ip=client_ip(request))
    return {"ok": True}


@app.get("/api/admins")
def api_admins(session: dict = Depends(current_admin)):
    return {"items": [dict(r) for r in store.list_admins()]}


# --------------------------------------------------------------------------- #
# Boshqaruv paneli
# --------------------------------------------------------------------------- #

@app.get("/api/dashboard")
def api_dashboard(session: dict = Depends(current_admin)):
    ov = store.overview(OWNER_IDS)
    expiring = []
    for u in store.expiring_soon(7, OWNER_IDS)[:10]:
        expiring.append({
            "user_id": u["user_id"], "first_name": u["first_name"],
            "username": u["username"], "state": u["state"],
            "days_left": u["days_left"], "expires_at": _iso(u["expires_at"]),
        })
    return {
        "overview": ov,
        "series": store.daily_series(30),
        "expiring": expiring,
        "payments": store.recent_payments(8),
        "requests": store.list_requests("ochiq", 5),
        "stats": store.stats(OWNER_IDS),
        "activity": store.activity_counts(OWNER_IDS),
        "log": [dict(r) for r in store.list_log(8, 0)],
        "usd_rate": settings.USD_RATE,
    }


# --------------------------------------------------------------------------- #
# Foydalanuvchilar
# --------------------------------------------------------------------------- #

@app.get("/api/users")
def api_users(session: dict = Depends(current_admin),
              q: str = Query("", max_length=64),
              holat: str = Query("", max_length=20),
              tarif: str = Query("", max_length=10),
              faollik: str = Query("", max_length=10),
              tartib: str = Query("yangi", max_length=20),
              sahifa: int = Query(1, ge=1, le=10_000)):
    per = 40
    rows, total = store.list_users(
        q, holat, OWNER_IDS, tartib, per, (sahifa - 1) * per,
        plan=tarif, activity=faollik)
    return {
        "items": rows, "total": total, "page": sahifa,
        "pages": max(1, (total + per - 1) // per),
        "plans": _plans(),
        "activity": store.activity_counts(OWNER_IDS),
    }


@app.get("/api/users/{user_id}")
def api_user(user_id: int, session: dict = Depends(current_admin)):
    user = store.get_user(user_id, OWNER_IDS)
    if not user:
        raise HTTPException(404, "Foydalanuvchi topilmadi")
    return {"user": user, "plans": _plans()}


@app.get("/api/users/{user_id}/transactions")
def api_user_transactions(request: Request, user_id: int,
                          session: dict = Depends(current_admin)):
    """Foydalanuvchi yozuvlari IZOHLARI bilan.

    Izohlar shaxsiy ma'lumot, shuning uchun ular foydalanuvchi kartasi
    bilan birga yuklanmaydi — alohida so'raladi va har bir so'rov
    jurnalga yoziladi: kim, qachon, kimning yozuvlarini ochgani
    ko'rinib tursin.
    """
    if not store.get_user(user_id, OWNER_IDS):
        raise HTTPException(404, "Foydalanuvchi topilmadi")
    rows = store.user_transactions(user_id)
    store.log_action(session["u"], "yozuvlarni ko'rdi", target=str(user_id),
                     details=f"{len(rows)} ta yozuv izohi bilan",
                     ip=client_ip(request))
    return {"items": rows}


class UserAction(BaseModel):
    amal: str = Field(max_length=20)
    plan_code: str = Field("", max_length=10)
    kun: int = Field(0, ge=0, le=3650)
    matn: str = Field("", max_length=3000)


@app.post("/api/users/{user_id}/action")
async def api_user_action(request: Request, user_id: int, body: UserAction,
                          session: dict = Depends(writer)):
    admin, ip = session["u"], client_ip(request)

    if body.amal == "obuna":
        plan = plans.by_code(body.plan_code)
        days = plan["days"] if plan else max(1, body.kun)
        amount = plan["price"] if plan else 0
        until = store.grant_subscription(user_id, days)
        store.add_payment(user_id, body.plan_code or "qolda", amount, days, admin)
        store.log_action(admin, "obuna berildi", user_id,
                         plans.label(body.plan_code) if plan else f"{days} kun", ip)
        await telegram.send_message(
            user_id,
            f"🎉 <b>Obunangiz faollashtirildi!</b>\n\n"
            f"Muddat: <b>{until.strftime('%d.%m.%Y')}</b> gacha\n\n"
            f"Rahmat! Holatni ko'rish: /holat")
        return {"message": f"Obuna berildi — {until.strftime('%d.%m.%Y')} gacha."}

    if body.amal == "sinov":
        until = store.extend_trial(user_id, max(1, body.kun))
        store.log_action(admin, "sinov uzaytirildi", user_id, f"{body.kun} kun", ip)
        await telegram.send_message(
            user_id, f"🎁 Bepul sinov muddatingiz uzaytirildi — "
                     f"<b>{until.strftime('%d.%m.%Y')}</b> gacha.")
        return {"message": f"Sinov {until.strftime('%d.%m.%Y')} gacha uzaytirildi."}

    if body.amal == "bekor":
        store.set_subscription_until(user_id, None)
        store.log_action(admin, "obuna bekor qilindi", user_id, ip=ip)
        return {"message": "Obuna bekor qilindi."}

    if body.amal in ("bloklash", "ochish"):
        blocked = body.amal == "bloklash"
        store.set_blocked(user_id, blocked)
        store.log_action(admin, body.amal, user_id, ip=ip)
        return {"message": "Bloklandi." if blocked else "Blokdan chiqarildi."}

    if body.amal == "xabar":
        text = body.matn.strip()
        if not text:
            raise HTTPException(400, "Xabar matni bo'sh.")
        ok, info = await telegram.send_message(user_id, text)
        store.log_action(admin, "shaxsiy xabar", user_id, text[:120], ip)
        if not ok:
            raise HTTPException(502, f"Yuborilmadi: {info}")
        return {"message": "Xabar yuborildi."}

    if body.amal == "ochirish":
        stats = store.delete_user_data(user_id)
        store.log_action(admin, "MA'LUMOT O'CHIRILDI", user_id,
                         f"{stats['transactions']} yozuv, {stats['usage']} sarf", ip)
        return {"message": "Ma'lumot o'chirildi.", "deleted": True}

    raise HTTPException(400, "Noma'lum amal.")


# --------------------------------------------------------------------------- #
# Obuna so'rovlari
# --------------------------------------------------------------------------- #

@app.get("/api/requests")
def api_requests(session: dict = Depends(current_admin),
                 holat: str = Query("ochiq", max_length=20)):
    return {
        "items": store.list_requests(holat, 200),
        "overview": store.overview(OWNER_IDS),
    }


@app.get("/api/requests/{req_id}/proof")
async def api_request_proof(req_id: int, session: dict = Depends(current_admin)):
    req = store.get_request(req_id)
    if not req or not req.get("proof_file_id"):
        raise HTTPException(404, "Chek biriktirilmagan")
    result = await telegram.fetch_file(req["proof_file_id"])
    if not result:
        raise HTTPException(502, "Chekni Telegramdan olib bo'lmadi")
    content, mime = result
    return Response(content=content, media_type=mime, headers={
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": f'inline; filename="chek-{req_id}"',
    })


class RequestDecision(BaseModel):
    qaror: str = Field(max_length=10)
    sabab: str = Field("", max_length=200)


@app.post("/api/requests/{req_id}/decide")
async def api_request_decide(request: Request, req_id: int, body: RequestDecision,
                             session: dict = Depends(writer)):
    admin, ip = session["u"], client_ip(request)
    req = store.get_request(req_id)
    if not req:
        raise HTTPException(404, "So'rov topilmadi")
    if req["status"] not in ("kutilmoqda", "tekshiruvda"):
        raise HTTPException(409, "Bu so'rov allaqachon hal qilingan.")

    plan = plans.by_code(req["plan_code"])
    if body.qaror == "tasdiq":
        if not plan:
            raise HTTPException(400, "Tarif topilmadi")
        until = store.grant_subscription(req["user_id"], plan["days"])
        store.add_payment(req["user_id"], plan["code"], plan["price"],
                          plan["days"], admin)
        store.decide_request(req_id, "tasdiqlandi", admin)
        store.log_action(admin, "so'rov tasdiqlandi", req["user_id"], plan["label"], ip)
        await telegram.send_message(
            req["user_id"],
            f"🎉 <b>Obunangiz faollashtirildi!</b>\n\n"
            f"Tarif: {plan['label']}\n"
            f"Muddat: <b>{until.strftime('%d.%m.%Y')}</b> gacha\n\n"
            f"Rahmat! Holatni ko'rish: /holat")
        return {"message": "Tasdiqlandi va foydalanuvchiga xabar berildi."}

    reason = body.sabab.strip()
    store.decide_request(req_id, "rad etildi", admin, reason)
    store.log_action(admin, "so'rov rad etildi", req["user_id"],
                     f"{plans.label(req['plan_code'])} | {reason}"[:200], ip)
    tail = f"\n\n<b>Sabab:</b> {reason}" if reason else ""
    await telegram.send_message(
        req["user_id"],
        f"❌ <b>To'lov tasdiqlanmadi</b>{tail}\n\n"
        f"To'lovni qayta tekshirib, chekni yana yuboring yoki administrator "
        f"bilan bog'laning. Tariflar: /obuna")
    return {"message": "Rad etildi."}


# --------------------------------------------------------------------------- #
# Statistika
# --------------------------------------------------------------------------- #

@app.get("/api/stats")
def api_stats(session: dict = Depends(current_admin),
              davr: str = Query("oylik", max_length=10)):
    if davr not in ("kunlik", "oylik", "yillik"):
        davr = "oylik"
    return {
        "overview": store.overview(OWNER_IDS),
        "stats": store.stats(OWNER_IDS),
        "revenue": store.revenue_series(davr),
        "usd_rate": settings.USD_RATE,
    }


# --------------------------------------------------------------------------- #
# Sozlamalar
#
# Bu yerda o'zgargan qiymatni bot ham o'qiydi (bitta `app_settings`
# jadvali), shuning uchun narx va rekvizit ikki joyda ajralib qolmaydi.
# --------------------------------------------------------------------------- #

class SettingsBody(BaseModel):
    plan_price_1m: int = Field(0, ge=0, le=100_000_000)
    plan_price_3m: int = Field(0, ge=0, le=100_000_000)
    plan_price_6m: int = Field(0, ge=0, le=100_000_000)
    plan_price_12m: int = Field(0, ge=0, le=100_000_000)
    card_number: str = Field("", max_length=32)
    card_holder: str = Field("", max_length=64)
    trial_days: int = Field(7, ge=1, le=365)
    ai_monthly_budget_usd: float = Field(50, gt=0, le=100_000)


@app.get("/api/settings")
def api_settings(session: dict = Depends(current_admin)):
    return {
        "plans": _plans(),
        "bot": {
            "card_number": settings.card_number(),
            "card_holder": settings.card_holder(),
            "trial_days": settings.trial_days(),
            "ai_monthly_budget_usd": settings.ai_monthly_budget_usd(),
        },
        "usd_rate": settings.USD_RATE,
    }


@app.post("/api/settings")
def api_settings_save(request: Request, body: SettingsBody,
                      session: dict = Depends(writer)):
    admin = session["u"]
    before = {p["code"]: p["price"] for p in plans.all_plans()}
    values = {
        "plan_price_1m": body.plan_price_1m,
        "plan_price_3m": body.plan_price_3m,
        "plan_price_6m": body.plan_price_6m,
        "plan_price_12m": body.plan_price_12m,
        "card_number": body.card_number.strip(),
        "card_holder": body.card_holder.strip(),
        "trial_days": body.trial_days,
        "ai_monthly_budget_usd": body.ai_monthly_budget_usd,
    }
    # Narx nolga tushib qolmasin: 0 kelsa «o'zgartirilmadi» degani.
    for code in ("1m", "3m", "6m", "12m"):
        if not values[f"plan_price_{code}"]:
            values[f"plan_price_{code}"] = before[code]

    store.settings_save(values, admin)
    changed = [f"{code}: {before[code]} → {values[f'plan_price_{code}']}"
               for code in ("1m", "3m", "6m", "12m")
               if before[code] != values[f"plan_price_{code}"]]
    store.log_action(admin, "sozlamalar o'zgartirildi", "",
                     "; ".join(changed)[:200] or "rekvizit/limit",
                     client_ip(request))
    return {"message": "Sozlamalar saqlandi.", **api_settings(session)}


# --------------------------------------------------------------------------- #
# Moliya
# --------------------------------------------------------------------------- #

@app.get("/api/cashflow")
def api_cashflow(session: dict = Depends(current_admin),
                 davr: str = Query("kun", max_length=8),
                 nuqta: int = Query(0, ge=0, le=90)):
    """Daromad va sarf — kun, hafta yoki oy kesimida.

    `davr` — 'kun' | 'hafta' | 'oy'; `nuqta` — grafikdagi ustunlar soni
    (0 bo'lsa davrning odatiy qiymati). Ikkalasini ham `store.cashflow`
    chegaralaydi — noto'g'ri qiymat xato emas, odatiy holatga tushadi.

    Boshqaruv paneli va «Moliya» ekrani shu bitta manbadan oziqlanadi.
    Alohida yo'l — chunki u alohida yuklanadi va xatosi qolgan ekranni
    yiqitmasligi kerak: bloki o'zi «qayta urinish» tugmasini ko'rsatadi.
    """
    return store.cashflow(davr, nuqta)


@app.get("/api/finance")
def api_finance(session: dict = Depends(current_admin),
                kun: int = Query(30, ge=7, le=365)):
    ov = store.overview(OWNER_IDS)
    payers = max(1, ov["users_total"] - ov["states"]["ega"])
    per_user = ov["cost_month"] / payers
    return {
        "overview": ov,
        "breakdown": store.cost_breakdown(kun),
        "spenders": store.top_spenders(15, kun),
        "series": store.daily_series(min(kun, 90)),
        "payments": store.recent_payments(25),
        "plans": _plans(),
        "usd_rate": settings.USD_RATE,
        "cost_month_som": ov["cost_month"] * settings.USD_RATE,
        "per_user_usd": per_user,
        "per_user_som": per_user * settings.USD_RATE,
        "days": kun,
    }


# --------------------------------------------------------------------------- #
# Ommaviy xabar
# --------------------------------------------------------------------------- #

SEGMENTS = {
    "hammasi": "Hammaga",
    "obunachi": "Faol obunachilar",
    "sinov": "Sinovdagilar",
    "tugagan": "Muddati tugaganlar",
}

# Bot tillari. Xabar bitta tilda yoziladi, shuning uchun uni faqat o'sha
# tilni tanlagan odamlarga yuborish mantiqiy — «hammasi» ham bor.
LANGS = {
    "": "Hamma til",
    "uz": "O'zbek lotin",
    "uzc": "O'zbek kirill",
    "ru": "Rus",
}


def _audience(segment: str, lang: str) -> list[int]:
    return store.all_user_ids("" if segment == "hammasi" else segment,
                              OWNER_IDS, lang=lang)


@app.get("/api/broadcast")
def api_broadcast_info(session: dict = Depends(current_admin)):
    counts = {key: len(_audience(key, "")) for key in SEGMENTS}
    by_lang = {
        code: {seg: len(_audience(seg, code)) for seg in SEGMENTS}
        for code in LANGS
    }
    return {
        "segments": SEGMENTS, "counts": counts,
        "langs": LANGS, "byLang": by_lang,
        "langCounts": store.lang_counts(OWNER_IDS),
    }


class BroadcastBody(BaseModel):
    segment: str = Field(max_length=20)
    matn: str = Field(min_length=1, max_length=3500)
    til: str = Field("", max_length=5)
    tasdiq: bool = False


@app.post("/api/broadcast")
async def api_broadcast(request: Request, body: BroadcastBody,
                        session: dict = Depends(writer)):
    if body.segment not in SEGMENTS:
        raise HTTPException(400, "Noma'lum segment")
    if body.til not in LANGS:
        raise HTTPException(400, "Noma'lum til")
    if not body.tasdiq:
        raise HTTPException(400, "Yuborishni tasdiqlang")
    text = body.matn.strip()
    ids = _audience(body.segment, body.til)
    result = await telegram.broadcast(ids, text)
    target = SEGMENTS[body.segment]
    if body.til:
        target += f" · {LANGS[body.til]}"
    store.log_action(session["u"], "ommaviy xabar", target,
                     f"{result['ok']} yuborildi, {result['failed']} xato | "
                     f"{text[:100]}", client_ip(request))
    return {"message": f"{result['ok']} ta yuborildi, "
                       f"{result['failed']} ta yuborilmadi.", **result}


# --------------------------------------------------------------------------- #
# Jurnal
# --------------------------------------------------------------------------- #

@app.get("/api/log")
def api_log(session: dict = Depends(current_admin),
            sahifa: int = Query(1, ge=1, le=10_000)):
    per = 100
    total = store.count_log()
    return {
        "items": [dict(r) for r in store.list_log(per, (sahifa - 1) * per)],
        "total": total, "page": sahifa, "pages": max(1, (total + per - 1) // per),
    }


# --------------------------------------------------------------------------- #
# Eksport
# --------------------------------------------------------------------------- #

def _csv_response(name: str, header: list[str], rows) -> StreamingResponse:
    buf = io.StringIO()
    writer_ = csv.writer(buf)
    writer_.writerow(header)
    for row in rows:
        writer_.writerow(row)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8-sig")), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/export/users.csv")
def api_export_users(request: Request, session: dict = Depends(current_admin)):
    rows, _ = store.list_users(owner_ids=OWNER_IDS, limit=10 ** 9)
    store.log_action(session["u"], "eksport", "foydalanuvchilar", ip=client_ip(request))
    return _csv_response(
        "foydalanuvchilar.csv",
        ["user_id", "ism", "username", "holat", "qolgan_kun", "royxatdan_otgan",
         "oxirgi_faollik", "yozuvlar", "ai_xarajat_usd"],
        ([r["user_id"], r["first_name"], r["username"] or "", r["state"],
          r["days_left"] if r["days_left"] is not None else "", r["created_at"],
          r["last_seen_at"] or "", r["tx_count"], f"{r['cost_usd']:.4f}"]
         for r in rows))


@app.get("/api/export/payments.csv")
def api_export_payments(request: Request, session: dict = Depends(current_admin)):
    rows = store.recent_payments(10 ** 9)
    store.log_action(session["u"], "eksport", "tolovlar", ip=client_ip(request))
    return _csv_response(
        "tolovlar.csv",
        ["sana", "user_id", "ism", "tarif", "summa", "kun", "usul", "kim"],
        ([r["created_at"], r["user_id"], r["first_name"] or "",
          plans.label(r["plan_code"]), r["amount"], r["days"], r["method"],
          r["created_by"]] for r in rows))


@app.get("/salomatlik")
def health():
    try:
        with store.conn() as c:
            c.execute("SELECT 1").fetchone()
        return {"holat": "ok"}
    except Exception as exc:
        return JSONResponse({"holat": "xato", "sabab": str(exc)}, status_code=500)


# --------------------------------------------------------------------------- #
# React ilovasi
#
# Barcha API yo'llaridan KEYIN ro'yxatga olinadi, aks holda "/" ostidagi
# ushlagich /api/* so'rovlarini ham tutib qolardi.
# --------------------------------------------------------------------------- #

# Python `.woff2` ni bilmaydi — ro'yxatga qo'shmasak StaticFiles noto'g'ri
# turdagi javob beradi.
mimetypes.add_type("font/woff2", ".woff2")

if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets")), name="assets")

# Shriftlar o'zimizda turadi (CSP `font-src 'self'`). Ular papka ichida
# bo'lgani uchun quyidagi SPA ushlagichiga tushib ketmasin — alohida
# ulanadi va uzoq muddatga keshlanadi: fayl nomi o'zgarmaydi, lekin
# mazmuni ham o'zgarmaydi.
if (DIST / "fonts").exists():
    app.mount(
        "/fonts",
        StaticFiles(directory=str(DIST / "fonts")),
        name="fonts",
    )


@app.get("/{full_path:path}")
def spa(full_path: str):
    """SPA marshrutlash: brauzerdagi har qanday yo'l index.html ga tushadi."""
    if full_path.startswith(("api/", "salomatlik")):
        raise HTTPException(404, "Topilmadi")

    # Yig'ilgan statik fayl (favicon va h.k.) bo'lsa — o'shani beramiz.
    if full_path and "/" not in full_path:
        candidate = DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)

    index = DIST / "index.html"
    if not index.exists():
        return JSONResponse(
            {"detail": "Frontend yig'ilmagan. frontend/ ichida `npm run build`."},
            status_code=503)
    return FileResponse(index, headers={"Cache-Control": "no-store"})
