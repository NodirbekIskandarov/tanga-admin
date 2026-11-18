import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useRegularsQuery } from "../store/api";
import { setRegularFilters } from "../store/uiSlice";
import Fresh from "../components/Fresh";
import Icon from "../components/Icon";
import UserDrawer from "../components/UserDrawer";
import { Strip, lastSeen } from "../components/Activity";
import {
  Av, Card, Empty, ErrorBox, Kpi, Loading, Pager, Tag, Who,
} from "../components/common";
import { kunOy } from "../lib/format";

/**
 * Muntazam foydalanuvchilar — kim botdan kunma-kun foydalanyapti.
 *
 * «Faol kun» — kamida bitta yozuv kiritilgan kun. Manba — har kungi
 * yozuvlar SONI (entry_counts); yozuvlarning mazmuni bu yerga kelmaydi.
 * Egalar hisobga kirmaydi.
 */

const SORTS = [
  ["seriya", "Joriy seriya bo'yicha"],
  ["hafta", "Oxirgi 7 kun bo'yicha"],
  ["oy", "Oxirgi 30 kun bo'yicha"],
  ["rekord", "Eng uzun seriya bo'yicha"],
  ["oxirgi", "Oxirgi yozuv bo'yicha"],
  ["yozuv", "30 kundagi yozuvlar soni"],
];

const ORDER = ["faol", "seriya", "muntazam", "xavf", "tushgan"];

const SHORT = {
  faol: "Faol (30 kun)",
  seriya: "Seriyada",
  muntazam: "Muntazam",
  xavf: "Seriya uzilay deb turibdi",
  tushgan: "Tushib qolgan",
};

function explain(segment, rules) {
  const r = rules || {};
  switch (segment) {
    case "seriya":
      return `Kamida ${r.streak_min ?? 2} kun ketma-ket yozuv kiritayotganlar. ` +
        "Bugun hali yozmagan bo'lsa ham seriya kechagacha sanaladi.";
    case "muntazam":
      return `Oxirgi 7 kunning kamida ${r.regular_days ?? 4} kunida yozgan — odati shakllangan.`;
    case "xavf":
      return "Seriyasi bor, lekin bugun hali yozmagan: bugun yozmasa seriya uziladi. " +
        "Eslatma yoki shaxsiy xabar uchun eng to'g'ri payt.";
    case "tushgan":
      return `Oxirgi 7 kunda umuman yozmagan, lekin undan oldingi 3 haftada kamida ` +
        `${r.lapsed_before ?? 3} kun yozgan — muntazam edi, to'xtadi.`;
    default:
      return "Oxirgi 30 kunda kamida bitta yozuv kiritganlar.";
  }
}

/**
 * Kunlik faol foydalanuvchilar: pastda qaytib kelganlar, tepada shu kuni
 * birinchi marta yozganlar. Raqamlar ipuchada va jadvaldan ham ko'rinadi.
 */
function DailyBars({ series }) {
  const max = Math.max(1, ...series.map((s) => s.active));
  return (
    <>
      <div className="sbars">
        {series.map((s, i) => (
          <div
            className="sbar"
            key={s.day}
            title={`${kunOy(s.day)}: ${s.active} kishi (${s.returning} qaytgan, ${s.new} yangi)`}
          >
            <div className="track">
              <span className="new" style={{ height: `${(100 * s.new) / max}%` }} />
              <span className="ret" style={{ height: `${(100 * s.returning) / max}%` }} />
            </div>
            <div className="lab">
              {(series.length - 1 - i) % 7 === 0 && <span>{kunOy(s.day)}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--success)" }} />qaytib kelgan</span>
        <span><i style={{ background: "var(--brass)" }} />shu kuni birinchi marta</span>
      </div>
    </>
  );
}

export default function Regulars() {
  const dispatch = useDispatch();
  const filters = useSelector((s) => s.ui.regularFilters);
  const { data, isLoading, isFetching, error, refetch, fulfilledTimeStamp } =
    useRegularsQuery(filters, { pollingInterval: 60000 });
  const [open, setOpen] = useState(null);
  const set = (patch) => dispatch(setRegularFilters(patch));

  if (isLoading) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={refetch} />;

  const sm = data.summary;
  const counts = data.counts;
  const seg = data.segment;


  return (
    <>
      <UserDrawer userId={open} onClose={() => setOpen(null)} />

      <div className="kpis">
        <Kpi label="Bugun yozganlar" value={sm.today} sub={`kecha ${sm.yesterday} kishi`} />
        <Kpi
          label="Seriyada"
          value={counts.seriya}
          sub={`7+ kunlik seriya: ${sm.streak7} · rekord ${sm.best_streak} kun`}
          tone="good"
        />
        <Kpi
          label="Muntazam"
          value={counts.muntazam}
          sub={`7 kundan ${data.rules.regular_days}+ kun yozganlar`}
          tone="brass"
        />
        <Kpi
          label="Yopishqoqlik"
          value={sm.stickiness == null ? "—" : `${String(sm.stickiness).replace(".", ",")}%`}
          sub={`kuniga o'rtacha ${String(sm.dau7).replace(".", ",")} / ${sm.mau} kishi`}
        />
      </div>
      <p className="hint" style={{ margin: "-12px 0 0" }}>
        Yopishqoqlik — oy davomida yozgan odamlarning o'rtacha har kuni qanchasi yozadi
        (kechagacha 7 kunlik o'rtacha ÷ 30 kunda kamida bir marta yozganlar). Bugun
        hali tugamagani uchun hisobga kirmaydi.
      </p>

      <Card title="Kunlik faol foydalanuvchilar — 30 kun">
        <div className="pad">
          <DailyBars series={data.series} />
        </div>
      </Card>

      <section className="finder">
        <div className="chips" role="tablist" aria-label="Segmentlar">
          {ORDER.map((k) => (
            <button key={k} role="tab" aria-selected={seg === k}
                    className={`chip ${seg === k ? "on" : ""}`} onClick={() => set({ segment: k })}>
              {SHORT[k]}
              <span className="chip-n">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: 0 }}>{explain(seg, data.rules)}</p>
        <div className="toolbar">
          <label className="field-search grow">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder="Ism, @username yoki ID"
              value={filters.q}
              maxLength={64}
              onChange={(e) => set({ q: e.target.value })}
            />
          </label>
          <select value={filters.tartib} onChange={(e) => set({ tartib: e.target.value })} aria-label="Tartib">
            {SORTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          <a className="btn" href={`/api/export/regulars.csv?segment=${encodeURIComponent(seg)}`}>CSV</a>
        </div>
        <div className="result-line">
          <span><b className="mono">{data.total}</b> kishi</span>
          <Fresh at={fulfilledTimeStamp} busy={isFetching} />
        </div>
      </section>

      {error && <ErrorBox error={error} onRetry={refetch} />}

      <Card className="flush">
        <div className="tbl-wrap only-wide">
          <table className="users-tbl">
            <thead>
              <tr>
                <th>Foydalanuvchi</th>
                <th>Holat</th>
                <th className="num">Seriya</th>
                <th className="num">Rekord</th>
                <th className="num">7 kun</th>
                <th className="num">30 kun</th>
                <th>Oxirgi {data.rules.strip_days} kun</th>
                <th>Oxirgi yozuv</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <Empty colSpan={8} title="Bu segmentda hech kim yo'q">
                  {filters.q ? "Qidiruvni o'zgartirib ko'ring." : "Boshqa segmentni tanlang."}
                </Empty>
              )}
              {data.items.map((r) => (
                <tr key={r.user_id} className="click" onClick={() => setOpen(r.user_id)}>
                  <td>
                    <Who
                      name={r.first_name || (r.username ? `@${r.username}` : "Nomsiz")}
                      meta={r.username ? `@${r.username}` : `ID ${r.user_id}`}
                      seed={r.user_id}
                    />
                  </td>
                  <td>
                    <span className="tags" style={{ flexWrap: "nowrap" }}>
                      <Tag kind={r.state}>{r.state}</Tag>
                      {r.bot_blocked && <Tag kind="bad">bloklagan</Tag>}
                    </span>
                  </td>
                  <td className="num">
                    <b>{r.streak}</b>
                    {r.streak > 0 && !r.wrote_today && (
                      <span className="muted" title="Bugun hali yozmagan"> ·</span>
                    )}
                  </td>
                  <td className="num muted">{r.best}</td>
                  <td className="num">{r.d7}/7</td>
                  <td className="num muted">{r.d30}/30</td>
                  <td><Strip values={r.strip} /></td>
                  <td className="muted nowrap">{lastSeen(r.last_day)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Telefon: jadval o'rniga kartochkalar. */}
        <ul className="ucards only-narrow">
          {data.items.length === 0 && <li className="empty-li">Bu segmentda hech kim yo'q.</li>}
          {data.items.map((r) => (
            <li key={r.user_id}>
              <button className="ucard" onClick={() => setOpen(r.user_id)}>
                <Av name={r.first_name || r.username || "?"} seed={r.user_id} size="md" />
                <span className="ucard-body">
                  <span className="ucard-top">
                    <b>{r.first_name || (r.username ? `@${r.username}` : "Nomsiz")}</b>
                    <span className="num">seriya {r.streak}{r.streak > 0 && !r.wrote_today ? " ·" : ""}</span>
                  </span>
                  <span className="meta">
                    7 kun: {r.d7}/7 · 30 kun: {r.d30}/30 · {lastSeen(r.last_day)}
                  </span>
                  <span className="tags">
                    <Tag kind={r.state}>{r.state}</Tag>
                    {r.bot_blocked && <Tag kind="bad">bloklagan</Tag>}
                    <Strip values={r.strip} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <Pager
          page={data.page}
          pages={data.pages}
          total={data.total}
          onChange={(p) => set({ sahifa: p })}
        />
      </Card>
    </>
  );
}
