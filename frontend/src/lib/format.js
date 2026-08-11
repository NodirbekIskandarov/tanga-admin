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
