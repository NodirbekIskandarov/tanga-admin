import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useStatsQuery } from "../store/api";
import { setStatsRange } from "../store/uiSlice";
import Fresh from "../components/Fresh";
import { Card, ErrorBox, Kpi, Loading, Seg } from "../components/common";
import { som, usd } from "../lib/format";

const RANGES = [
  ["kunlik", "Kunlik"],
  ["oylik", "Oylik"],
  ["yillik", "Yillik"],
];

/**
 * Daromad ustunlari: har bir oraliq uchun joriy va oldingi davr yonma-yon.
 *
 * Nega canvas emas: ustunlar soni kichik va balandlik foizda beriladi —
 * oddiy div'lar mavzuni ham, o'lchamni ham o'zi kuzatadi.
 */
function RevenueBars({ items }) {
  const max = Math.max(1, ...items.flatMap((b) => [b.now, b.prev]));
  return (
    <>
      <div className="vbars">
        {items.map((b) => (
          <div className="vbar" key={b.key} title={`${b.label}: ${som(b.now)} so'm`}>
            <div className="track">
              <span className="prev" style={{ height: `${(100 * b.prev) / max}%` }} />
              <span className="now" style={{ height: `${(100 * b.now) / max}%` }} />
            </div>
            <div className="lab">{b.label}</div>
          </div>
        ))}
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--brass)" }} />bu davr</span>
        <span><i style={{ background: "var(--border-strong)" }} />oldingi davr</span>
      </div>
    </>
  );
}

/**
 * Faollashtirish voronkasi: har bosqich /start bosganlarga nisbatan foizda.
 * Ikki ko'rsatkich: hammasi va oxirgi 30 kunda boshlaganlar — o'zgarish
 * yoki reklamadan keyingi guruh eski foydalanuvchilar bilan aralashmasin.
 */
function Funnel({ all, d30 }) {
  return (
    <>
      <div className="bars">
        {all.map((step, i) => (
          <div className="bar-row" key={step.key}>
            <span>{step.label}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${step.percent}%` }} />
            </span>
            <span className="bar-val">
              {step.count} · {step.percent}%
              <span className="muted"> · 30 kun: {d30[i].count} · {d30[i].percent}%</span>
            </span>
          </div>
        ))}
      </div>
      <p className="hint">
        Foiz — /start bosganlarga nisbatan. «7-kundan keyin ham yozgan» —
        ro'yxatdan o'tganidan kamida bir hafta keyin yozuv kiritganlar.
        Faqat sonlar: yozuvlarning mazmuni panelda yo'q.
      </p>
    </>
  );
}

/** Foiz — shu manbadan /start bosganlarga nisbatan. */
function pct(n, of) {
  return of ? `${Math.round((100 * n) / of)}%` : "—";
}

/**
 * Voronka reklama manbasi bo'yicha. Havola: t.me/<bot>?start=src_<kanal>;
 * «ref» — do'st taklifi; bo'sh — to'g'ridan-to'g'ri kelganlar.
 */
function Sources({ rows }) {
  const name = (s) => (s === "ref" ? "Do'st taklifi" : s || "To'g'ridan-to'g'ri");
  return (
    <>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Manba</th>
              <th className="num">Start</th>
              <th className="num">Rozilik</th>
              <th className="num">1-yozuv</th>
              <th className="num">7-kun</th>
              <th className="num">To'lov</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source || "-"}>
                <td className={r.source && r.source !== "ref" ? "mono" : ""}>{name(r.source)}</td>
                <td className="num">{r.start}</td>
                <td className="num">{r.rozilik} · {pct(r.rozilik, r.start)}</td>
                <td className="num">{r.yozuv} · {pct(r.yozuv, r.start)}</td>
                <td className="num">{r.faol7} · {pct(r.faol7, r.start)}</td>
                <td className="num">{r.tolov} · {pct(r.tolov, r.start)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint pad" style={{ marginTop: 0 }}>
        Har bir reklama uchun alohida havola bering:{" "}
        <span className="mono">t.me/hisobchi_tanga_bot?start=src_kanal_nomi</span>{" "}
        (lotin harf, raqam, «_»). Manba faqat botni birinchi marta ochganda yoziladi.
      </p>
    </>
  );
}

export default function Stats() {
  const dispatch = useDispatch();
  const range = useSelector((s) => s.ui.statsRange);
  const { data, isLoading, isFetching, error, refetch, fulfilledTimeStamp } =
    useStatsQuery(range, { pollingInterval: 60000 });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const s = data.stats;
  const ai = s.ai;
  const aiTone = ai.percent >= 90 ? "bad" : ai.percent >= 75 ? "warn" : "";

  return (
    <>
      <div className="page-head">
        <Fresh at={fulfilledTimeStamp} busy={isFetching} />
      </div>

      <div className="kpis">
        <Kpi label="Yangi foydalanuvchi" value={s.newUsers30} sub="oxirgi 30 kun" />
        <Kpi
          label="Ketganlar"
          value={s.churned}
          sub={`churn ${s.churnPercent}%`}
        />
        <Kpi
          label="Sinovdan to'lovga"
          value={`${s.conversion}%`}
          sub={`${s.trialTotal} sinovdan ${s.convertedCount} ta`}
          tone="good"
        />
        <Kpi label="O'rtacha chek" value={som(s.avgCheck)} sub="so'm" tone="brass" />
      </div>

      {data.funnel && (
        <Card title="Faollashtirish voronkasi">
          <div className="pad">
            <Funnel all={data.funnel.all} d30={data.funnel.d30} />
          </div>
        </Card>
      )}

      {data.funnel?.sources && (
        <Card title="Reklama kanallari">
          <Sources rows={data.funnel.sources} />
        </Card>
      )}

      <Card
        title="Daromad"
        action={
          <>
            <span className="spacer" />
            <Seg
              options={RANGES}
              value={range}
              onChange={(v) => dispatch(setStatsRange(v))}
            />
          </>
        }
      >
        <div className="pad">
          <RevenueBars items={data.revenue.items} />
          <p className="hint">
            Bu davr <span className="mono">{som(data.revenue.nowTotal)}</span> so'm,
            oldingi davr <span className="mono">{som(data.revenue.prevTotal)}</span> so'm.
          </p>
        </div>
      </Card>

      <div className="grid2">
        <Card title="Tarif bo'yicha taqsimot">
          <div className="pad">
            <div className="bars">
              {s.plans.map((p) => (
                <div className="bar-row" key={p.code}>
                  <span>{p.label} · {som(p.price)}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: `${p.percent}%` }} />
                  </span>
                  <span className="bar-val">{p.count} · {p.percent}%</span>
                </div>
              ))}
            </div>
            <p className="hint">
              Tasdiqlangan to'lovlar soni bo'yicha. Narxlar{" "}
              <Link to="/sozlamalar">Sozlamalar</Link> ekranida o'zgartiriladi.
            </p>
          </div>
        </Card>

        <Card title="AI sarfi">
          <div className="pad stack-sm">
            <div className="inline">
              <span className={`big ${aiTone}`}>{ai.percent}%</span>
              <span className="muted" style={{ fontSize: 13 }}>oylik limitdan</span>
            </div>
            <div className={`meter ${aiTone}`}>
              <span style={{ width: `${Math.min(100, ai.percent)}%` }} />
            </div>
            <div className="inline mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
              <span>{som(ai.spentSom)} so'm</span>
              <span className="spacer" />
              <span>limit {som(ai.budgetSom)}</span>
            </div>
            {ai.percent >= 75 ? (
              <div className={`note ${aiTone || "warn"}`}>
                <span className="grow">
                  Limitga {Math.max(0, 100 - ai.percent)}% qoldi — oy oxirigacha{" "}
                  {ai.daysLeft} kun.
                </span>
              </div>
            ) : (
              <p className="hint" style={{ margin: 0 }}>
                Shu oy {usd(ai.spentUsd)} sarflandi, limit {usd(ai.budgetUsd)}.
                Oy oxirigacha {ai.daysLeft} kun.
              </p>
            )}
            <Link className="more" to="/moliya">
              Batafsil: amal va model bo'yicha sarf →
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}
