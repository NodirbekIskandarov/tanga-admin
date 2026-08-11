"""Parol saqlash va sessiya.

Parol `hashlib.scrypt` bilan saqlanadi (standart kutubxona, tashqi
bog'liqlik kerak emas). Sessiya — imzolangan cookie: server tomonda
holat saqlanmaydi, imzo buzilsa yoki muddati o'tsa qabul qilinmaydi.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import hmac
import json
import secrets
import time

import settings
import store

log = logging.getLogger("admin.auth")

# scrypt parametrlari — interaktiv login uchun yetarli darajada qimmat.
# 128 * N * r = 32 MB xotira kerak; OpenSSL'ning standart chegarasi aynan
# shuncha, shuning uchun maxmem'ni ochiq ko'rsatamiz.
_N, _R, _P, _DKLEN = 2 ** 15, 8, 1, 32
_MAXMEM = 96 * 1024 * 1024


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt.encode("utf-8"),
                        n=_N, r=_R, p=_P, dklen=_DKLEN, maxmem=_MAXMEM)
    return base64.b64encode(dk).decode(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    candidate, _ = hash_password(password, salt)
    return hmac.compare_digest(candidate, password_hash)


def generate_password(words: int = 4) -> str:
    """Eslab qolish oson, lekin taxmin qilish qiyin parol."""
    alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
    parts = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(words)]
    return "-".join(parts)


# --------------------------------------------------------------------------- #
# Sessiya cookie
# --------------------------------------------------------------------------- #

COOKIE_NAME = "hisobchim_admin"


def _sign(payload: bytes) -> str:
    return base64.urlsafe_b64encode(
        hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).digest()
    ).decode().rstrip("=")


def make_session(username: str) -> str:
    payload = {
        "u": username,
        "exp": int(time.time()) + settings.SESSION_HOURS * 3600,
        # CSRF tokeni sessiyaning ichida — alohida saqlash kerak emas.
        "c": secrets.token_urlsafe(16),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode()
    body = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    return f"{body}.{_sign(raw)}"


def read_session(token: str) -> dict | None:
    if not token or "." not in token:
        return None
    body, _, sig = token.rpartition(".")
    try:
        raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
    except Exception:
        return None
    if not hmac.compare_digest(_sign(raw), sig):
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if int(data.get("exp", 0)) < time.time():
        return None
    return data


# --------------------------------------------------------------------------- #
# Login
# --------------------------------------------------------------------------- #

class LoginError(Exception):
    pass


def login(username: str, password: str, ip: str) -> str:
    username = (username or "").strip().lower()

    if store.recent_failures(username) >= settings.LOGIN_MAX_ATTEMPTS:
        raise LoginError(
            f"Juda ko'p xato urinish. {settings.LOGIN_LOCK_MINUTES} daqiqadan keyin "
            f"qayta urinib ko'ring.")

    row = store.get_admin(username)
    if not row or not verify_password(password or "", row["password_hash"], row["salt"]):
        store.record_login(username, ip, False)
        # fail2ban shu qatorni o'qib IP'ni firewall darajasida bloklaydi.
        log.warning("KIRISH XATO: %s", ip)
        # Qaysi biri xato ekanini aytmaymiz — hisob nomini taxmin qilishga yo'l bermaydi.
        raise LoginError("Login yoki parol noto'g'ri.")

    store.record_login(username, ip, True)
    store.touch_admin_login(username)
    store.log_action(username, "kirdi", ip=ip)
    return make_session(username)
