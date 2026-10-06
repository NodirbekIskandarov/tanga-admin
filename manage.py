"""Admin hisoblari bilan ishlash uchun buyruqlar.

    python manage.py admin-qoshish <login> [ism]     — yangi admin (parol o'zi yaratiladi)
    python manage.py parol <login>                   — parolni yangilash
    python manage.py royxat                          — adminlar ro'yxati
    python manage.py kalit                           — ADMIN_SECRET_KEY yaratish
    python manage.py 2fa <login>                     — ikki bosqichli kirishni yoqish
    python manage.py 2fa-ochirish <login>            — ikki bosqichli kirishni o'chirish
"""

from __future__ import annotations

import secrets
import sys

import auth
import settings
import store


def _print_credentials(username: str, password: str) -> None:
    line = "─" * 46
    print()
    print(line)
    print("  ADMIN KIRISH MA'LUMOTLARI")
    print(line)
    print(f"  Login : {username}")
    print(f"  Parol : {password}")
    print(line)
    print("  Parolni xavfsiz joyda saqlang — u qayta ko'rsatilmaydi.")
    print("  Birinchi kirishdan keyin /parol sahifasida almashtiring.")
    print(line)
    print()


def cmd_add(args: list[str]) -> int:
    if not args:
        print("Foydalanish: python manage.py admin-qoshish <login> [ism]")
        return 1
    username = args[0].strip().lower()
    full_name = " ".join(args[1:])
    store.init()
    if store.get_admin(username):
        print(f"'{username}' allaqachon mavjud. Parolni yangilash: "
              f"python manage.py parol {username}")
        return 1
    password = auth.generate_password()
    h, s = auth.hash_password(password)
    # Parol terminalda ko'rsatiladi — birinchi kirishda almashtirish shart.
    store.create_admin(username, h, s, full_name, must_change=1)
    _print_credentials(username, password)
    return 0


def cmd_password(args: list[str]) -> int:
    if not args:
        print("Foydalanish: python manage.py parol <login>")
        return 1
    username = args[0].strip().lower()
    store.init()
    if not store.get_admin(username):
        print(f"'{username}' topilmadi.")
        return 1
    password = auth.generate_password()
    h, s = auth.hash_password(password)
    store.set_admin_password(username, h, s, must_change=1)
    _print_credentials(username, password)
    return 0


def cmd_list(_args: list[str]) -> int:
    store.init()
    rows = store.list_admins()
    if not rows:
        print("Admin yo'q.")
        return 0
    print(f"{'LOGIN':<18}{'ISM':<22}{'FAOL':<7}OXIRGI KIRISH")
    for r in rows:
        print(f"{r['username']:<18}{(r['full_name'] or '—'):<22}"
              f"{('ha' if r['is_active'] else 'yo`q'):<7}{r['last_login_at'] or '—'}")
    return 0


def cmd_key(_args: list[str]) -> int:
    print(secrets.token_urlsafe(48))
    return 0


def cmd_2fa(args: list[str]) -> int:
    """Ikki bosqichli kirishni yoqadi: sir va otpauth:// havolasi chiqadi.

    Havolani autentifikator ilovasiga qo'shing (yoki sirni qo'lda kiriting).
    Shundan keyin panelga kirishda parol bilan birga 6 xonali kod so'raladi.
    """
    if not args:
        print("Foydalanish: python manage.py 2fa <login>")
        return 1
    username = args[0].strip().lower()
    store.init()
    if not store.get_admin(username):
        print(f"'{username}' topilmadi.")
        return 1
    secret = auth.new_totp_secret()
    store.set_admin_totp(username, secret)
    line = "─" * 46
    print(f"\n{line}\n  IKKI BOSQICHLI KIRISH YOQILDI: {username}\n{line}")
    print(f"  Sir    : {secret}")
    print(f"  Havola : {auth.totp_uri(username, secret)}")
    print(f"{line}\n  Ilovaga qo'shing va shu ilovadagi kod bilan bir marta kirib\n"
          f"  ko'ring. O'chirish: python manage.py 2fa-ochirish {username}\n{line}\n")
    return 0


def cmd_2fa_off(args: list[str]) -> int:
    if not args:
        print("Foydalanish: python manage.py 2fa-ochirish <login>")
        return 1
    username = args[0].strip().lower()
    store.init()
    if not store.set_admin_totp(username, None):
        print(f"'{username}' topilmadi.")
        return 1
    print(f"'{username}' uchun ikki bosqichli kirish o'chirildi.")
    return 0


COMMANDS = {
    "admin-qoshish": cmd_add,
    "parol": cmd_password,
    "royxat": cmd_list,
    "kalit": cmd_key,
    "2fa": cmd_2fa,
    "2fa-ochirish": cmd_2fa_off,
}


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        return 1
    command = sys.argv[1]
    # "kalit" bazasiz ham ishlaydi — .env tayyorlashda kerak bo'ladi.
    if command != "kalit":
        problems = [p for p in settings.missing() if "Baza" in p]
        if problems:
            print("XATO:", "; ".join(problems))
            return 1
    return COMMANDS[command](sys.argv[2:])


if __name__ == "__main__":
    raise SystemExit(main())
