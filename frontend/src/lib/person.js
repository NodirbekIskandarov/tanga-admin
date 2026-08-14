// Foydalanuvchini ro'yxatda ko'z bilan ajratish uchun kichik
// yordamchilar. Rasm yo'q — Telegram avatarini olib saqlash ortiqcha
// shaxsiy ma'lumot bo'lardi — shuning uchun bosh harflar ishlatiladi.

const TONES = ["brass", "ok", "grey", "warn"];

/** Ism yoki username dan ikkita bosh harf. */
export function initials(name, fallback = "?") {
  const clean = String(name || "").replace(/^@/, "").trim();
  if (!clean) return fallback;
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Barqaror rang. ID bo'yicha tanlanadi, shuning uchun bir odam har
 * doim bir xil rangda ko'rinadi va qatorni tez topish oson.
 */
export function tone(seed) {
  const n = Math.abs(Number(seed) || 0);
  return TONES[n % TONES.length];
}
