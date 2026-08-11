"""Hisobchi AI — admin boshqaruv paneli.

Ishga tushirish:  uvicorn app:app --host 127.0.0.1 --port 8100
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import os
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, Form, HTTPException, Query, Request
from fastapi.responses import (HTMLResponse, JSONResponse, RedirectResponse,
                               Response, StreamingResponse)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import auth
import plans
import settings
import store
import telegram

logging.basicConfig(
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s", level=logging.INFO)
log = logging.getLogger("admin")

app = FastAPI(title=settings.APP_NAME, docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=str(settings.BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(settings.BASE_DIR / "templates"))

OWNER_IDS = {int(x) for x in os.getenv("OWNER_IDS", "").replace(",", " ").split() if x.strip().isdigit()}


@app.on_event("startup")
def _startup() -> None:
    store.init()
    problems = settings.missing()
    for p in problems:
        log.error("SOZLAMA XATOSI: %s", p)
    log.info("Admin panel tayyor. Baza: %s | Egalar: %s", settings.DB_PATH, OWNER_IDS or "yo'q")


# --------------------------------------------------------------------------- #
# Yordamchilar
# --------------------------------------------------------------------------- #

def client_ip(request: Request) -> str:
    # Caddy orqasida ishlaydi — haqiqiy IP sarlavhada keladi.
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else ""))


def current_admin(request: Request) -> dict:
    """Har bir himoyalangan sahifa shu orqali tekshiriladi."""
    data = auth.read_session(request.cookies.get(auth.COOKIE_NAME, ""))
    if not data:
        raise HTTPException(401, "Kirish kerak")
    return data


def require_csrf(request: Request, session: dict, token: str) -> None:
    """O'zgartiruvchi amallar uchun — boshqa sayt sizning nomingizdan
    so'rov yubora olmasligi kerak."""
    if not token or token != session.get("c"):
        raise HTTPException(403, "CSRF tokeni mos kelmadi. Sahifani yangilang.")


@app.exception_handler(401)
async def _unauthorized(request: Request, exc):
    if request.url.path.startswith("/api/"):
        return JSONResponse({"error": "Kirish kerak"}, status_code=401)
    return RedirectResponse(f"/login?next={request.url.path}", status_code=303)


@app.exception_handler(403)
async def _forbidden(request: Request, exc):
    return HTMLResponse(
        f"<p style='font-family:system-ui;padding:40px'>{exc.detail}</p>", status_code=403)


def page(request: Request, session: dict, name: str, **ctx) -> HTMLResponse:
    base = {
        "request": request,
        "admin": session["u"],
        "csrf": session["c"],
        "app_name": settings.APP_NAME,
        "pending": store.pending_count(),
        "path": request.url.path,
    }
    base.update(ctx)
    return templates.TemplateResponse(name, base)


def _fmt_som(v) -> str:
    return f"{int(round(v or 0)):,}".replace(",", " ")


templates.env.filters["som"] = _fmt_som
templates.env.filters["usd"] = lambda v: f"${(v or 0):.4f}"
templates.env.filters["short_usd"] = lambda v: f"${(v or 0):.2f}"


def _fmt_dt(raw) -> str:
    if not raw:
        return "—"
    try:
        dt = datetime.fromisoformat(str(raw))
    except ValueError:
        return str(raw)[:16]
    return dt.strftime("%d.%m.%Y %H:%M")


def _fmt_d(raw) -> str:
    if not raw:
        return "—"
    return str(raw)[:10]


templates.env.filters["dt"] = _fmt_dt
templates.env.filters["d"] = _fmt_d


# --------------------------------------------------------------------------- #
# Kirish / chiqish
# --------------------------------------------------------------------------- #

@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request, next: str = "/", error: str = ""):
    if auth.read_session(request.cookies.get(auth.COOKIE_NAME, "")):
        return RedirectResponse(next or "/", status_code=303)
    return templates.TemplateResponse(
        "login.html",
        {"request": request, "app_name": settings.APP_NAME, "next": next, "error": error})


@app.post("/login")
def login_submit(request: Request, username: str = Form(""), password: str = Form(""),
                 next: str = Form("/")):
    try:
        token = auth.login(username, password, client_ip(request))
    except auth.LoginError as exc:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "app_name": settings.APP_NAME, "next": next,
             "error": str(exc)},
            status_code=401)

    response = RedirectResponse(next or "/", status_code=303)
    response.set_cookie(
        auth.COOKIE_NAME, token,
        max_age=settings.SESSION_HOURS * 3600,
        httponly=True, secure=settings.COOKIE_SECURE, samesite="lax", path="/")
    return response


@app.get("/logout")
def logout(request: Request):
    data = auth.read_session(request.cookies.get(auth.COOKIE_NAME, ""))
    if data:
        store.log_action(data["u"], "chiqdi", ip=client_ip(request))
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return response


@app.get("/parol", response_class=HTMLResponse)
def password_form(request: Request, session: dict = Depends(current_admin),
                  message: str = "", error: str = ""):
    return page(request, session, "password.html",
                admins=store.list_admins(), message=message, error=error)


@app.post("/parol")
def password_change(request: Request, session: dict = Depends(current_admin),
                    csrf: str = Form(""), current: str = Form(""),
                    new1: str = Form(""), new2: str = Form("")):
    require_csrf(request, session, csrf)
    row = store.get_admin(session["u"])
    error = ""
    if not row or not auth.verify_password(current, row["password_hash"], row["salt"]):
        error = "Joriy parol noto'g'ri."
    elif len(new1) < 10:
        error = "Yangi parol kamida 10 belgidan iborat bo'lsin."
    elif new1 != new2:
        error = "Yangi parollar mos kelmadi."

    if error:
        return page(request, session, "password.html",
                    admins=store.list_admins(), message="", error=error)

    h, s = auth.hash_password(new1)
    store.set_admin_password(session["u"], h, s)
    store.log_action(session["u"], "parol almashtirildi", ip=client_ip(request))
    return page(request, session, "password.html", admins=store.list_admins(),
                message="Parol almashtirildi.", error="")


# --------------------------------------------------------------------------- #
# Boshqaruv paneli
# --------------------------------------------------------------------------- #

@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request, session: dict = Depends(current_admin)):
    ov = store.overview(OWNER_IDS)
    series = store.daily_series(30)
    return page(
        request, session, "dashboard.html",
        ov=ov,
        series_json=json.dumps(series),
        expiring=store.expiring_soon(7, OWNER_IDS)[:10],
        payments=store.recent_payments(8),
        requests=store.list_requests("kutilmoqda", 5),
        usd_rate=settings.USD_RATE,
    )


# --------------------------------------------------------------------------- #
# Foydalanuvchilar
# --------------------------------------------------------------------------- #

@app.get("/foydalanuvchilar", response_class=HTMLResponse)
def users_page(request: Request, session: dict = Depends(current_admin),
               q: str = "", holat: str = "", tartib: str = "yangi",
               sahifa: int = Query(1, ge=1)):
    per = 40
    rows, total = store.list_users(q, holat, OWNER_IDS, tartib, per, (sahifa - 1) * per)
    return page(request, session, "users.html",
                rows=rows, total=total, q=q, holat=holat, tartib=tartib,
                sahifa=sahifa, pages=max(1, (total + per - 1) // per),
                plans=plans.SUBSCRIPTION_PLANS)


@app.get("/foydalanuvchilar/{user_id}", response_class=HTMLResponse)
def user_page(request: Request, user_id: int, session: dict = Depends(current_admin),
              message: str = ""):
    u = store.get_user(user_id, OWNER_IDS)
    if not u:
        raise HTTPException(404, "Foydalanuvchi topilmadi")
    return page(request, session, "user.html", u=u,
                plans=plans.SUBSCRIPTION_PLANS, message=message)


@app.post("/foydalanuvchilar/{user_id}/amal")
async def user_action(request: Request, user_id: int,
                      session: dict = Depends(current_admin),
                      csrf: str = Form(""), amal: str = Form(""),
                      plan_code: str = Form(""), kun: int = Form(0),
                      matn: str = Form("")):
    require_csrf(request, session, csrf)
    admin, ip = session["u"], client_ip(request)
    message = ""

    if amal == "obuna":
        plan = plans.by_code(plan_code)
        days = plan["days"] if plan else max(1, kun)
        amount = plan["price"] if plan else 0
        until = store.grant_subscription(user_id, days)
        store.add_payment(user_id, plan_code or "qolda", amount, days, admin)
        store.log_action(admin, "obuna berildi", user_id,
                         f"{plans.label(plan_code) if plan else str(days) + ' kun'}", ip)
        await telegram.send_message(
            user_id,
            f"🎉 <b>Obunangiz faollashtirildi!</b>\n\n"
            f"Muddat: <b>{until.strftime('%d.%m.%Y')}</b> gacha\n\n"
            f"Rahmat! Holatni ko'rish: /holat")
        message = f"Obuna berildi — {until.strftime('%d.%m.%Y')} gacha."

    elif amal == "sinov":
        until = store.extend_trial(user_id, max(1, kun))
        store.log_action(admin, "sinov uzaytirildi", user_id, f"{kun} kun", ip)
        await telegram.send_message(
            user_id,
            f"🎁 Bepul sinov muddatingiz uzaytirildi — "
            f"<b>{until.strftime('%d.%m.%Y')}</b> gacha.")
        message = f"Sinov {until.strftime('%d.%m.%Y')} gacha uzaytirildi."

    elif amal == "bekor":
        store.set_subscription_until(user_id, None)
        store.log_action(admin, "obuna bekor qilindi", user_id, ip=ip)
        message = "Obuna bekor qilindi."

    elif amal in ("bloklash", "ochish"):
        blocked = amal == "bloklash"
        store.set_blocked(user_id, blocked)
        store.log_action(admin, amal, user_id, ip=ip)
        message = "Bloklandi." if blocked else "Blokdan chiqarildi."

    elif amal == "xabar":
        text = (matn or "").strip()
        if not text:
            message = "Xabar matni bo'sh."
        else:
            ok, info = await telegram.send_message(user_id, text)
            store.log_action(admin, "shaxsiy xabar", user_id, text[:120], ip)
            message = "Xabar yuborildi." if ok else f"Yuborilmadi: {info}"

    elif amal == "ochirish":
        stats = store.delete_user_data(user_id)
        store.log_action(admin, "MA'LUMOT O'CHIRILDI", user_id,
                         f"{stats['transactions']} yozuv, {stats['usage']} sarf", ip)
        return RedirectResponse("/foydalanuvchilar?message=ochirildi", status_code=303)

    else:
        message = "Noma'lum amal."

    return RedirectResponse(f"/foydalanuvchilar/{user_id}?message={message}", status_code=303)


# --------------------------------------------------------------------------- #
# Obuna so'rovlari
# --------------------------------------------------------------------------- #

@app.get("/sorovlar", response_class=HTMLResponse)
def requests_page(request: Request, session: dict = Depends(current_admin),
                  holat: str = "ochiq", message: str = ""):
    return page(request, session, "requests.html",
                rows=store.list_requests(holat, 200), holat=holat, message=message)


@app.get("/sorovlar/{req_id}/chek")
async def request_proof(req_id: int, session: dict = Depends(current_admin)):
    """To'lov chekini ko'rsatadi. Rasm Telegramdan olinadi, serverda saqlanmaydi."""
    req = store.get_request(req_id)
    if not req or not req.get("proof_file_id"):
        raise HTTPException(404, "Chek biriktirilmagan")
    result = await telegram.fetch_file(req["proof_file_id"])
    if not result:
        raise HTTPException(502, "Chekni Telegramdan olib bo'lmadi")
    content, mime = result
    return Response(content=content, media_type=mime,
                    headers={"Cache-Control": "private, max-age=300"})


@app.post("/sorovlar/{req_id}")
async def request_decide(request: Request, req_id: int,
                         session: dict = Depends(current_admin),
                         csrf: str = Form(""), qaror: str = Form(""),
                         sabab: str = Form("")):
    require_csrf(request, session, csrf)
    admin, ip = session["u"], client_ip(request)
    req = store.get_request(req_id)
    if not req:
        raise HTTPException(404, "So'rov topilmadi")
    if req["status"] not in ("kutilmoqda", "tekshiruvda"):
        return RedirectResponse("/sorovlar?message=Bu so'rov allaqachon hal qilingan",
                                status_code=303)

    plan = plans.by_code(req["plan_code"])
    if qaror == "tasdiq" and plan:
        until = store.grant_subscription(req["user_id"], plan["days"])
        store.add_payment(req["user_id"], plan["code"], plan["price"], plan["days"], admin)
        store.decide_request(req_id, "tasdiqlandi", admin)
        store.log_action(admin, "so'rov tasdiqlandi", req["user_id"], plan["label"], ip)
        await telegram.send_message(
            req["user_id"],
            f"🎉 <b>Obunangiz faollashtirildi!</b>\n\n"
            f"Tarif: {plan['label']}\n"
            f"Muddat: <b>{until.strftime('%d.%m.%Y')}</b> gacha\n\n"
            f"Rahmat! Holatni ko'rish: /holat")
        msg = "Tasdiqlandi va foydalanuvchiga xabar berildi."
    else:
        reason = (sabab or "").strip()
        store.decide_request(req_id, "rad etildi", admin, reason)
        store.log_action(admin, "so'rov rad etildi", req["user_id"],
                         f"{plans.label(req['plan_code'])} | {reason}"[:200], ip)
        tail = f"\n\n<b>Sabab:</b> {reason}" if reason else ""
        await telegram.send_message(
            req["user_id"],
            f"❌ <b>To'lov tasdiqlanmadi</b>{tail}\n\n"
            f"To'lovni qayta tekshirib, chekni yana yuboring yoki "
            f"administrator bilan bog'laning. Tariflar: /obuna")
        msg = "Rad etildi."

    return RedirectResponse(f"/sorovlar?message={msg}", status_code=303)


# --------------------------------------------------------------------------- #
# Moliya
# --------------------------------------------------------------------------- #

@app.get("/moliya", response_class=HTMLResponse)
def finance_page(request: Request, session: dict = Depends(current_admin),
                 kun: int = Query(30, ge=7, le=365)):
    ov = store.overview(OWNER_IDS)
    breakdown = store.cost_breakdown(kun)
    series = store.daily_series(min(kun, 90))
    spenders = store.top_spenders(15, kun)

    cost_month_som = ov["cost_month"] * settings.USD_RATE
    per_user = (ov["cost_month"] / max(1, ov["users_total"] - ov["states"]["ega"]))

    return page(request, session, "finance.html",
                ov=ov, breakdown=breakdown, spenders=spenders,
                series_json=json.dumps(series), kun=kun,
                usd_rate=settings.USD_RATE,
                cost_month_som=cost_month_som,
                per_user_usd=per_user,
                per_user_som=per_user * settings.USD_RATE,
                payments=store.recent_payments(25),
                plans=plans.SUBSCRIPTION_PLANS)


# --------------------------------------------------------------------------- #
# Ommaviy xabar
# --------------------------------------------------------------------------- #

SEGMENTS = {
    "hammasi": "Hamma foydalanuvchi",
    "sinov": "Bepul sinovdagilar",
    "obunachi": "Obunachilar",
    "tugagan": "Muddati tugaganlar",
}


@app.get("/xabar", response_class=HTMLResponse)
def broadcast_page(request: Request, session: dict = Depends(current_admin),
                   message: str = ""):
    counts = {}
    for key in SEGMENTS:
        state = "" if key == "hammasi" else key
        counts[key] = len(store.all_user_ids(state, OWNER_IDS))
    return page(request, session, "broadcast.html",
                segments=SEGMENTS, counts=counts, message=message)


@app.post("/xabar")
async def broadcast_send(request: Request, session: dict = Depends(current_admin),
                         csrf: str = Form(""), segment: str = Form("hammasi"),
                         matn: str = Form(""), tasdiq: str = Form("")):
    require_csrf(request, session, csrf)
    text = (matn or "").strip()
    if not text:
        return RedirectResponse("/xabar?message=Matn bo'sh", status_code=303)
    if tasdiq != "ha":
        return RedirectResponse("/xabar?message=Yuborishni tasdiqlang", status_code=303)

    state = "" if segment == "hammasi" else segment
    ids = store.all_user_ids(state, OWNER_IDS)
    result = await telegram.broadcast(ids, text)
    store.log_action(session["u"], "ommaviy xabar", SEGMENTS.get(segment, segment),
                     f"{result['ok']} yuborildi, {result['failed']} xato | {text[:100]}",
                     client_ip(request))
    msg = f"{result['ok']} ta yuborildi, {result['failed']} ta yuborilmadi."
    return RedirectResponse(f"/xabar?message={msg}", status_code=303)


# --------------------------------------------------------------------------- #
# Jurnal
# --------------------------------------------------------------------------- #

@app.get("/jurnal", response_class=HTMLResponse)
def log_page(request: Request, session: dict = Depends(current_admin),
             sahifa: int = Query(1, ge=1)):
    per = 100
    total = store.count_log()
    return page(request, session, "log.html",
                rows=store.list_log(per, (sahifa - 1) * per),
                sahifa=sahifa, pages=max(1, (total + per - 1) // per), total=total)


# --------------------------------------------------------------------------- #
# Eksport
# --------------------------------------------------------------------------- #

@app.get("/eksport/foydalanuvchilar.csv")
def export_users(request: Request, session: dict = Depends(current_admin)):
    rows, _ = store.list_users(owner_ids=OWNER_IDS, limit=10 ** 9)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["user_id", "ism", "username", "holat", "qolgan_kun", "royxatdan_otgan",
                "oxirgi_faollik", "yozuvlar", "ai_xarajat_usd"])
    for r in rows:
        w.writerow([r["user_id"], r["first_name"], r["username"] or "", r["state"],
                    r["days_left"] if r["days_left"] is not None else "",
                    r["created_at"], r["last_seen_at"] or "",
                    r["tx_count"], f"{r['cost_usd']:.4f}"])
    store.log_action(session["u"], "eksport", "foydalanuvchilar", ip=client_ip(request))
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8-sig")), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=foydalanuvchilar.csv"})


@app.get("/eksport/tolovlar.csv")
def export_payments(request: Request, session: dict = Depends(current_admin)):
    rows = store.recent_payments(10 ** 9)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["sana", "user_id", "ism", "tarif", "summa", "kun", "usul", "kim"])
    for r in rows:
        w.writerow([r["created_at"], r["user_id"], r["first_name"] or "",
                    plans.label(r["plan_code"]), r["amount"], r["days"],
                    r["method"], r["created_by"]])
    store.log_action(session["u"], "eksport", "tolovlar", ip=client_ip(request))
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8-sig")), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=tolovlar.csv"})


@app.get("/salomatlik")
def health():
    """Xizmat tirikligini tekshirish uchun — kirish talab qilinmaydi."""
    try:
        with store.conn() as c:
            c.execute("SELECT 1").fetchone()
        return {"holat": "ok"}
    except Exception as exc:
        return JSONResponse({"holat": "xato", "sabab": str(exc)}, status_code=500)
