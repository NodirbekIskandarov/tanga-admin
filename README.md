# Hisobchi AI — admin boshqaruv paneli

[Hisobchi AI](https://github.com/NodirbekIskandarov/hisobchim) botining alohida
web boshqaruv paneli. Bot bilan **bir xil** SQLite bazasini ishlatadi, o'zi
alohida jarayon sifatida ishlaydi.

Botdagi admin buyruqlari (`/admin`, `/berish`, `/bloklash`, …) olib tashlandi —
boshqaruvning hammasi shu panelga ko'chirildi.

---

## Nima qila oladi

| Bo'lim | Imkoniyat |
|---|---|
| **Umumiy holat** | Foydalanuvchilar soni va holati, konversiya, daromad, sof foyda, 30 kunlik o'sish grafigi, muddati tugayotganlar ro'yxati |
| **Foydalanuvchilar** | Qidiruv, holat bo'yicha filtr, 4 xil tartiblash, sahifalash, CSV eksport |
| **Foydalanuvchi kartasi** | Obuna berish/uzaytirish/bekor qilish, sinovni uzaytirish, bloklash, shaxsiy xabar yuborish, yozuvlari, AI sarfi, to'lovlar tarixi, hamma ma'lumotni o'chirish |
| **Obuna so'rovlari** | Botda tarif tanlagan foydalanuvchilar navbati — bir bosishda tasdiqlash yoki rad etish, foydalanuvchiga avtomatik xabar |
| **Moliya** | Daromad, AI tannarxi, sof foyda va marja; amal va model bo'yicha sarf; eng ko'p sarflaganlar; kunlik xarajat grafigi; to'lovlar CSV |
| **Ommaviy xabar** | Segment bo'yicha (hammasi / sinov / obunachi / muddati tugagan) Telegram xabar yuborish |
| **Amallar jurnali** | Har bir admin amali IP bilan qayd etiladi — o'chirib bo'lmaydi |

## Xavfsizlik

- Parol `scrypt` bilan saqlanadi (N=2¹⁵) — bazadan tiklab bo'lmaydi
- Sessiya HMAC-SHA256 bilan imzolangan cookie: `HttpOnly`, `Secure`, `SameSite=Lax`
- Har bir o'zgartiruvchi amalda CSRF tokeni tekshiriladi
- 5 ta xato urinishdan keyin 15 daqiqaga qulflanadi; xato login va xato parol
  bir xil javob beradi (hisob nomini taxmin qilishga yo'l qo'ymaydi)
- `noindex, nofollow` — qidiruv tizimlariga tushmaydi
- Xizmat `hisobchi` foydalanuvchisi ostida, `ProtectSystem=strict` bilan ishlaydi
- Faqat `127.0.0.1:8100` da tinglaydi — tashqariga Caddy orqali HTTPS bilan chiqadi

---

## O'rnatish

```bash
git clone https://github.com/NodirbekIskandarov/hisobchim-admin.git /opt/hisobchim-admin
cd /opt/hisobchim-admin
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt

cp .env.example .env
./.venv/bin/python manage.py kalit      # ADMIN_SECRET_KEY uchun
nano .env                                # kalitlarni to'ldiring
chmod 600 .env

# Birinchi admin hisobi — parol ekranga chiqadi, saqlab qo'ying
./.venv/bin/python manage.py admin-qoshish nodirbek "Nodirbek Iskandarov"

sudo cp deploy/hisobchim-admin.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hisobchim-admin
```

Caddy blogi:

```
hisobchim.niskandarov.uz {
    encode gzip
    reverse_proxy 127.0.0.1:8100
}
```

## Buyruqlar

```bash
python manage.py admin-qoshish <login> [ism]   # yangi admin, parol o'zi yaratiladi
python manage.py parol <login>                 # parolni yangilash
python manage.py royxat                        # adminlar ro'yxati
python manage.py kalit                         # ADMIN_SECRET_KEY yaratish
```

## Sozlamalar (`.env`)

| Kalit | Ma'nosi |
|---|---|
| `DB_PATH` | Bot bazasi yo'li (`/opt/hisobchi/hisobchi.db`) |
| `ADMIN_SECRET_KEY` | Sessiya imzosi. Almashtirilsa hamma seans tugaydi |
| `TELEGRAM_TOKEN` | Xabar yuborish uchun — bot bilan bir xil |
| `OWNER_IDS` | Bot egalari; panelda «ega» deb ko'rsatiladi, ommaviy xabarga kirmaydi |
| `USD_RATE` | Foyda hisobida dollarni so'mga o'girish kursi |
| `SESSION_HOURS` | Sessiya muddati (standart 12 soat) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | Login qulflash chegarasi |

## Muhim eslatma

Obuna tariflari **ikki joyda** takrorlangan:

- bot: `config.py` → `SUBSCRIPTION_PLANS`
- panel: `plans.py` → `SUBSCRIPTION_PLANS`

Tarif o'zgartirilsa — ikkalasini ham yangilash kerak. Sinov skripti mosligini
tekshiradi.
