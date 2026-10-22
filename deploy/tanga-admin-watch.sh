#!/bin/bash
# Admin panel salomatligini tekshiradi; ketma-ket ikki marta javob bermasa xizmatni qayta ishga tushiradi.
# Serverda: /usr/local/bin/tanga-admin-watch.sh, har 2 daqiqada tanga-admin-watch.timer orqali.
URL="http://172.30.0.1:8100/salomatlik"
ok() { curl -s -m 10 -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null | grep -q "^200$"; }
if ok; then exit 0; fi
sleep 8
if ok; then exit 0; fi
logger -t tanga-admin-watch "salomatlik javob bermadi — tanga-admin qayta ishga tushirilmoqda"
systemctl restart tanga-admin
