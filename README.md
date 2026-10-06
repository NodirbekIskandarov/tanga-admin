# Tanga — admin boshqaruv paneli

[Tanga](https://github.com/NodirbekIskandarov/tanga) botining alohida
web boshqaruv paneli. Bot bilan **bir xil** SQLite bazasini ishlatadi, o'zi
alohida jarayon sifatida ishlaydi.

Botdagi admin buyruqlari (`/admin`, `/berish`, `/bloklash`, …) olib tashlandi —
boshqaruvning hammasi shu panelga ko'chirildi.

---

## Nima qila oladi

| Bo'lim | Imkoniyat |
|---|---|
| **Umumiy holat** | Kun · hafta · oy filtrida daromad/sarf (oldingi davrning aynan shuncha kuni bilan farqi foizda), foydalanuvchilar soni va holati, konversiya, sof foyda, 30 kunlik o'sish grafigi, muddati tugayotganlar ro'yxati |
| **Foydalanuvchilar** | Qidiruv, holat bo'yicha filtr, 4 xil tartiblash, sahifalash, CSV eksport |
| **Foydalanuvchi kartasi** | Obuna berish/uzaytirish/bekor qilish, sinovni uzaytirish, bloklash, shaxsiy xabar yuborish, yozuvlar SONI, AI sarfi, to'lovlar tarixi, hamma ma'lumotni o'chirish. Moliyaviy yozuvlarning o'zi ko'rinmaydi — ular alohida shifrlangan bazada, kaliti panelda yo'q |
| **Obuna so'rovlari** | Botda tarif tanlagan foydalanuvchilar navbati — to'lov chekini (rasm yoki PDF) ko'rib tasdiqlash yoki sabab bilan rad etish, foydalanuvchiga avtomatik xabar. Tasdiqlash bitta tranzaksiyada: ikki admin bir vaqtda bossa ham obuna va to'lov bir marta yoziladi |
| **Moliya** | Kun · hafta · oy kesimida pul oqimi (grafik va jadval ko'rinishida, 30 kun / 12 hafta / 12 oygacha tarix), daromad, AI tannarxi, sof foyda va marja; amal va model bo'yicha sarf; eng ko'p sarflaganlar; kunlik xarajat grafigi; to'lovlar CSV |
| **Ommaviy xabar** | Segment (hammasi / sinov / obunachi / muddati tugagan) va til bo'yicha Telegram xabar. Faqat bloklanmagan, botni bloklamagan va shartlarga rozilik berganlarga ketadi; Telegram 403 bergan odam belgilanadi va keyingi safar auditoriyaga tushmaydi |
| **Sozlamalar** | Tarif narxlari, karta rekvizitlari, sinov muddati, oylik AI chegarasi — `app_settings` jadvalida, bot ham shuni o'qiydi |
| **Amallar jurnali** | Har bir admin amali IP bilan qayd etiladi — o'chirib bo'lmaydi |

## Xavfsizlik

- Parol `scrypt` bilan saqlanadi (N=2¹⁵) — bazadan tiklab bo'lmaydi
- Sessiya HMAC-SHA256 bilan imzolangan cookie: `HttpOnly`, `Secure`, `SameSite=Strict`
- Har bir o'zgartiruvchi amalda CSRF tokeni tekshiriladi
- 5 ta xato urinishdan keyin shu login **va shu IP** 15 daqiqaga qulflanadi —
  begona odam haqiqiy adminni boshqa manzildan chiqarib yubora olmaydi; xato
  login va xato parol bir xil javob beradi (hisob nomini taxmin qilishga yo'l
  qo'ymaydi)
- Ixtiyoriy ikki bosqichli kirish (TOTP): `python manage.py 2fa <login>`
- `noindex, nofollow` — qidiruv tizimlariga tushmaydi
- Xizmat `tanga` foydalanuvchisi ostida, `ProtectSystem=strict` bilan ishlaydi
- Docker ko'prigining host manzilida (`172.30.0.1:8100`) tinglaydi — Caddy
  konteyneri shu orqali kiradi, tashqariga faqat HTTPS bilan chiqadi
- Mijoz IP'si `X-Forwarded-For` ning OXIRGI qiymatidan olinadi (Caddy qo'ygani) —
  soxta sarlavha bilan fail2ban orqali boshqa IP'ni bloklatib bo'lmaydi

---

## O'rnatish

```bash
git clone https://github.com/NodirbekIskandarov/tanga-admin.git /opt/tanga-admin
cd /opt/tanga-admin
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt

cp .env.example .env
./.venv/bin/python manage.py kalit      # ADMIN_SECRET_KEY uchun
nano .env                                # kalitlarni to'ldiring
chmod 600 .env

# Birinchi admin hisobi — parol ekranga chiqadi, saqlab qo'ying
./.venv/bin/python manage.py admin-qoshish nodirbek "Nodirbek Iskandarov"

sudo cp deploy/tanga-admin.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tanga-admin
```

Caddy blogi:

```
tanga.niskandarov.uz {
    encode gzip
    reverse_proxy 172.30.0.1:8100
}
```

## Buyruqlar

```bash
python manage.py admin-qoshish <login> [ism]   # yangi admin, parol o'zi yaratiladi
python manage.py parol <login>                 # parolni yangilash
python manage.py royxat                        # adminlar ro'yxati
python manage.py kalit                         # ADMIN_SECRET_KEY yaratish
python manage.py 2fa <login>                   # ikki bosqichli kirishni yoqish
python manage.py 2fa-ochirish <login>          # ... va o'chirish
```

## Sozlamalar (`.env`)

| Kalit | Ma'nosi |
|---|---|
| `DB_PATH` | Bot bazasi yo'li (`/opt/tanga/tanga.db`) |
| `ADMIN_SECRET_KEY` | Sessiya imzosi. Almashtirilsa hamma seans tugaydi |
| `TELEGRAM_TOKEN` | Xabar yuborish uchun — bot bilan bir xil |
| `OWNER_IDS` | Bot egalari; panelda «ega» deb ko'rsatiladi, ommaviy xabarga kirmaydi |
| `USD_RATE` | Foyda hisobida dollarni so'mga o'girish kursi |
| `SESSION_HOURS` | Sessiya muddati (standart 12 soat) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | Login qulflash chegarasi |

## «Daromad va sarf»

Moliya bloki faqat **xizmatning o'z pulini** ko'rsatadi: tasdiqlangan obuna
to'lovlari (`payments`) minus AI xarajati (`usage_log`, dollar `USD_RATE` bilan
so'mga o'giriladi).

Foydalanuvchilarning kirim/chiqim yig'indisi («aylanma») ATAYLAB yo'q: yozuvlar
alohida shifrlangan bazada va panelda uning kaliti yo'q. Bundan tashqari bir
kunda bitta odam yozgan bo'lsa, «umumiy chiqim» aynan o'sha odamning chiqimi
bo'lib qolardi.

Davr tanlagichi (**kun · hafta · oy**): har bir davr oldingi davrning **aynan
shuncha kuni** bilan solishtiriladi — 15-avgustda «shu oy» 1–15 avgust bo'ladi
va 1–15 iyul bilan qiyoslanadi, to'liq iyul bilan emas.

Server va domen kabi doimiy xarajatlar bazada saqlanmaydi, shuning uchun «sof
natija» faqat AI xarajati ayirilgan holat — to'liq foyda emas.

## Tariflar

Tarif narxlari **bitta joyda** — `app_settings` jadvalida (Sozlamalar ekrani).
Bot ham shu jadvalni o'qiydi. Kodda faqat boshlang'ich qiymatlar turadi:

- bot: `config.py` → `SUBSCRIPTION_PLANS`
- panel: `plans.py` → `DEFAULT_PLANS`

Yangi tarif KODI qo'shilsa (masalan `f12`), u ikkala ro'yxatga ham kiritilishi
shart — aks holda panel so'rovni «Tarif topilmadi» deb tasdiqlay olmaydi. Bot
repozitoriysidagi `tests/test_e2e_flow.py` panelning `plans.py` sini o'qib,
buni tekshiradi.

## Sinovlar

```bash
pip install -r requirements-dev.txt
pytest          # vaqtinchalik bazada, tarmoqsiz (Telegram soxtalashtiriladi)
```
