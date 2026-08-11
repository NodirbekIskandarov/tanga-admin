"""Hisobchi AI — admin boshqaruv paneli (JSON API + React SPA).

Frontend alohida React ilovasi (frontend/), yig'ilgan fayllar static/dist
ichida turadi va shu yerdan beriladi. Barcha ma'lumot /api/* orqali
JSON ko'rinishida almashinadi.

Ishga tushirish:  uvicorn app:app --host 127.0.0.1 --port 8100
"""

from __future__ import annotations

import csv
import io
import logging
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
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (
        request.client.host if request.client else "")


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
    return [
        {**p,
         "monthly": plans.SUBSCRIPTION_PLANS and round(p["price"] / p["months"]),
         "discount": round(100 * (1 - (p["price"] / p["months"]) /
                                  plans.SUBSCRIPTION_PLANS[0]["price"]))
         if p["months"] > 1 else 0}
        for p in plans.SUBSCRIPTION_PLANS
    ]


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
        "usd_rate": settings.USD_RATE,
    }


# --------------------------------------------------------------------------- #
# Foydalanuvchilar
# --------------------------------------------------------------------------- #

@app.get("/api/users")
def api_users(session: dict = Depends(current_admin),
              q: str = Query("", max_length=64),
              holat: str = Query("", max_length=20),
              tartib: str = Query("yangi", max_length=20),
              sahifa: int = Query(1, ge=1, le=10_000)):
    per = 40
    rows, total = store.list_users(q, holat, OWNER_IDS, tartib, per, (sahifa - 1) * per)
    return {
        "items": rows, "total": total, "page": sahifa,
        "pages": max(1, (total + per - 1) // per),
        "plans": _plans(),
    }


@app.get("/api/users/{user_id}")
def api_user(user_id: int, session: dict = Depends(current_admin)):
    user = store.get_user(user_id, OWNER_IDS)
    if not user:
        raise HTTPException(404, "Foydalanuvchi topilmadi")
    return {"user": user, "plans": _plans()}


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
    return {"items": store.list_requests(holat, 200)}


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
# Moliya
# --------------------------------------------------------------------------- #

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
    "hammasi": "Hamma foydalanuvchi",
    "sinov": "Bepul sinovdagilar",
    "obunachi": "Obunachilar",
    "tugagan": "Muddati tugaganlar",
}


@app.get("/api/broadcast")
def api_broadcast_info(session: dict = Depends(current_admin)):
    counts = {key: len(store.all_user_ids("" if key == "hammasi" else key, OWNER_IDS))
              for key in SEGMENTS}
    return {"segments": SEGMENTS, "counts": counts}


class BroadcastBody(BaseModel):
    segment: str = Field(max_length=20)
    matn: str = Field(min_length=1, max_length=3500)
    tasdiq: bool = False


@app.post("/api/broadcast")
async def api_broadcast(request: Request, body: BroadcastBody,
                        session: dict = Depends(writer)):
    if body.segment not in SEGMENTS:
        raise HTTPException(400, "Noma'lum segment")
    if not body.tasdiq:
        raise HTTPException(400, "Yuborishni tasdiqlang")
    text = body.matn.strip()
    ids = store.all_user_ids("" if body.segment == "hammasi" else body.segment,
                             OWNER_IDS)
    result = await telegram.broadcast(ids, text)
    store.log_action(session["u"], "ommaviy xabar", SEGMENTS[body.segment],
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

if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets")), name="assets")


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
