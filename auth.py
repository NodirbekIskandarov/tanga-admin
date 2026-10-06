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
import struct
import time
from urllib.parse import quote

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

COOKIE_NAME = "tanga_admin"


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

# --------------------------------------------------------------------------- #
# Ikki bosqichli kirish (TOTP, RFC 6238)
#
# Ixtiyoriy: `python manage.py 2fa <login>` bilan yoqiladi. Standart
# kutubxona bilan — tashqi bog'liqlik kerak emas. Google Authenticator,
# Aegis, 1Password va boshqalar bilan mos: SHA1, 30 soniya, 6 raqam.
# --------------------------------------------------------------------------- #

TOTP_STEP = 30
# Bitta kod bir marta ishlatiladi: {login: oxirgi qabul qilingan qadam}.
_last_totp_step: dict[str, int] = {}


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_code(secret: str, step: int) -> str:
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 1_000_000:06d}"


def verify_totp(username: str, secret: str, code: str,
                now: float | None = None) -> bool:
    """Kod to'g'rimi. Soat farqi uchun ±1 qadam; ishlatilgan kod qayta
    qabul qilinmaydi (kim ko'rib qolgan bo'lsa ham u bilan qayta kira
    olmasin)."""
    digits = "".join(ch for ch in (code or "") if ch.isdigit())
    if len(digits) != 6:
        return False
    step = int((now if now is not None else time.time()) // TOTP_STEP)
    for candidate in (step - 1, step, step + 1):
        if hmac.compare_digest(totp_code(secret, candidate), digits):
            if candidate <= _last_totp_step.get(username, -1):
                return False
            _last_totp_step[username] = candidate
            return True
    return False


def totp_uri(username: str, secret: str) -> str:
    """Autentifikator ilovasi qo'shadigan manzil (QR kod shu matndan)."""
    issuer = quote(settings.APP_NAME)
    return (f"otpauth://totp/{issuer}:{quote(username)}?secret={secret}"
            f"&issuer={issuer}&digits=6&period={TOTP_STEP}")


class LoginError(Exception):
    pass


class TotpRequired(LoginError):
    """Parol to'g'ri, lekin ikki bosqichli kod kerak yoki u noto'g'ri."""


def login(username: str, password: str, ip: str, code: str = "") -> str:
    username = (username or "").strip().lower()

    if store.recent_failures(username, ip) >= settings.LOGIN_MAX_ATTEMPTS:
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

    secret = row["totp_secret"] if "totp_secret" in row.keys() else None
    if secret:
        if not (code or "").strip():
            # Xato emas — birinchi qadam: interfeys kod maydonini ochadi.
            raise TotpRequired("Autentifikator ilovasidagi 6 xonali kodni kiriting.")
        if not verify_totp(username, secret, code):
            store.record_login(username, ip, False)
            log.warning("KIRISH XATO: %s", ip)
            raise TotpRequired("Kod noto'g'ri yoki eskirgan.")

    store.record_login(username, ip, True)
    store.touch_admin_login(username)
    store.log_action(username, "kirdi", ip=ip)
    return make_session(username)
