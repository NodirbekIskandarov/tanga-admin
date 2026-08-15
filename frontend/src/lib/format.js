// Formatlash yordamchilari — butun ilova bo'ylab bir xil ko'rinish uchun.

export function som(value) {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString("ru-RU").replace(/ /g, " ");
}

export function usd(value, digits = 2) {
  return "$" + (Number(value) || 0).toFixed(digits);
}

export function dt(raw) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 16);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function day(raw) {
  if (!raw) return "—";
  return String(raw).slice(0, 10).split("-").reverse().join(".");
}

export function pct(value, digits = 0) {
  return `${(Number(value) || 0).toFixed(digits)}%`;
}

/**
 * Qisqartirilgan summa — grafik o'qi va tor joylar uchun.
 *
 * O'q yonida «1 250 000» to'liq yozilsa raqamlar bir-biriga tegib ketadi,
 * shuning uchun u yerda «1,3 mln» ko'rinadi. To'liq son doim yonidagi
 * ko'rsatkichda va jadval ko'rinishida bor — qisqartma yagona manba emas.
 */
export function qisqa(value) {
  const n = Math.round(Number(value) || 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const cut = (base, unit) => {
    const x = abs / base;
    // 10 dan katta bo'lsa kasr qismi ortiqcha: «12 mln» «12,3 mln» dan tiniq.
    const text = x >= 10 ? String(Math.round(x)) : x.toFixed(1).replace(".", ",");
    return `${sign}${text} ${unit}`;
  };
  if (abs >= 1e9) return cut(1e9, "mlrd");
  if (abs >= 1e6) return cut(1e6, "mln");
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e3)} ming`;
  return som(n);
}

/** Sanani «15.08» ko'rinishida — grafik va jadval ustunlari uchun. */
export function kunOy(raw) {
  const [, month, dayPart] = String(raw || "").split("-");
  return month && dayPart ? `${dayPart}.${month}` : String(raw || "—");
}

const HAFTA = ["dush", "sesh", "chor", "pay", "jum", "shan", "yak"];

/** Hafta kuni qisqartmasi — «shan». */
export function hafta(raw) {
  const d = new Date(`${String(raw).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return HAFTA[(d.getDay() + 6) % 7];
}
