import { day, kunOy } from "../lib/format";

/**
 * Kunma-kun faollik ko'rinishlari. Manba — har kungi yozuvlar SONI
 * (entry_counts): yozuvlarning mazmuni panelga umuman kelmaydi.
 *
 * Rang yagona belgi emas: har katakda ipucha (sana va son) bor, ekran
 * o'quvchisi uchun esa butun chiziqqa bitta matnli tavsif beriladi.
 */

function level(n) {
  if (n == null) return "none";
  if (n <= 0) return "l0";
  if (n === 1) return "l1";
  if (n <= 3) return "l2";
  return "l3";
}

function count(n) {
  return n > 0 ? `${n} ta yozuv` : "yozuv yo'q";
}

/** Bugun yoki kecha bo'lsa so'z bilan, aks holda sana. */
export function lastSeen(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((now - d) / 86400000);
  if (diff === 0) return "bugun";
  if (diff === 1) return "kecha";
  if (diff > 1 && diff < 7) return `${diff} kun oldin`;
  return day(iso);
}

/** Ro'yxatdagi kichik chiziq: oxirgi N kun, eskisidan bugungacha. */
export function Strip({ values }) {
  const n = values?.length || 0;
  const active = (values || []).filter((v) => v > 0).length;
  const today = new Date();
  return (
    <span className="strip" role="img" aria-label={`Oxirgi ${n} kunda ${active} kun yozgan`}>
      {(values || []).map((v, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - (n - 1 - i));
        const iso = d.toISOString().slice(0, 10);
        return <i key={i} className={level(v)} title={`${kunOy(iso)}: ${count(v)}`} />;
      })}
    </span>
  );
}

const WEEKDAYS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

/**
 * 12 haftalik kalendar: ustun — hafta (dushanbadan), qator — hafta kuni.
 * Bugundan keyingi kunlar chizilmaydi.
 */
export function Calendar({ cells, weeks }) {
  if (!cells?.length) return null;
  const cols = [];
  for (let w = 0; w < weeks; w += 1) cols.push(cells.slice(w * 7, w * 7 + 7));
  const active = cells.filter((c) => c.n > 0).length;
  return (
    <div className="heat-wrap">
      <div className="heat" role="img"
           aria-label={`Oxirgi ${weeks} haftada ${active} kun yozuv kiritgan`}>
        <div className="heat-days" aria-hidden="true">
          {WEEKDAYS.map((w, i) => <span key={w}>{i % 2 === 0 ? w : ""}</span>)}
        </div>
        {cols.map((col) => (
          <div className="heat-col" key={col[0].day}>
            {col.map((c) => (
              <i key={c.day} className={level(c.n)}
                 title={c.n == null ? "" : `${day(c.day)}: ${count(c.n)}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>kam</span>
        <i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" />
        <span>ko'p</span>
      </div>
    </div>
  );
}

/** Seriya ko'rsatkichlari — kartada va yon panelda bir xil. */
export function streakText(a) {
  if (!a || !a.active_total) return "Hali yozuv kiritmagan";
  if (a.streak >= 2) {
    return a.wrote_today
      ? `${a.streak} kun ketma-ket, bugun ham yozgan`
      : `${a.streak} kun ketma-ket — bugun hali yozmagan`;
  }
  return a.wrote_today ? "Bugun yozgan" : `Oxirgi yozuv: ${lastSeen(a.last_day)}`;
}
