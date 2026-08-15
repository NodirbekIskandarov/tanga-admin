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

const OYLAR = ["yanvar", "fevral", "mart", "aprel", "may", "iyun",
               "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const OYLAR_QISQA = ["yan", "fev", "mar", "apr", "may", "iyn",
                     "iyl", "avg", "sen", "okt", "noy", "dek"];

/** 'YYYY-MM-DD' → {yil, oy, kun}; noto'g'ri qiymatda oy `NaN` bo'ladi. */
function bolaklar(raw) {
  const [yil, oy, kun] = String(raw || "").split("-").map(Number);
  return { yil, oy, kun };
}

/** «avgust» — o'tgan yildagi oy bo'lsa «avgust 2025». */
export function oyNomi(raw) {
  const { yil, oy } = bolaklar(raw);
  if (!OYLAR[oy - 1]) return String(raw || "—");
  return yil === new Date().getFullYear()
    ? OYLAR[oy - 1]
    : `${OYLAR[oy - 1]} ${yil}`;
}

/**
 * Grafik o'qi uchun qisqa oy nomi — «avg».
 *
 * Yanvarga yil qo'shiladi («yan 27»): 12 oylik oynada yil qayerda
 * almashganini boshqa hech narsa ko'rsatmaydi.
 */
export function oyQisqa(raw) {
  const { yil, oy } = bolaklar(raw);
  if (!OYLAR_QISQA[oy - 1]) return String(raw || "—");
  const nom = OYLAR_QISQA[oy - 1];
  return oy === 1 ? `${nom} ${String(yil).slice(2)}` : nom;
}

/** Sana oralig'i: «12–18 avgust», oy oshsa «28 iyul – 3 avgust». */
export function oraliq(start, end) {
  const a = bolaklar(start);
  const b = bolaklar(end);
  if (!OYLAR[a.oy - 1] || !OYLAR[b.oy - 1]) return String(start || "—");
  if (a.yil === b.yil && a.oy === b.oy) return `${a.kun}–${b.kun} ${OYLAR[b.oy - 1]}`;
  const bir = a.yil === b.yil ? OYLAR[a.oy - 1] : `${OYLAR[a.oy - 1]} ${a.yil}`;
  return `${a.kun} ${bir} – ${b.kun} ${oyNomi(end)}`;
}

/**
 * Davr nomi — jadval va ipuchalarda bir xil o'qilsin.
 *
 * Kun uchun sana («15.08»), hafta uchun oraliq («12–18 avgust»),
 * oy uchun oy nomi («avgust»).
 */
export function davrNomi(davr, start, end) {
  if (davr === "oy") return oyNomi(start);
  if (davr === "hafta") return oraliq(start, end || start);
  return kunOy(start);
}
