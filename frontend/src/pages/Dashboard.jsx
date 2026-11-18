import { Link } from "react-router-dom";
import { useDashboardQuery } from "../store/api";
import Fresh from "../components/Fresh";
import Cashflow from "../components/Cashflow";
import Icon from "../components/Icon";
import { BarChart, Legend } from "../components/Chart";
import {
  Av, Bars, Card, Empty, ErrorBox, Kpi, Loading, Tag,
} from "../components/common";
import { day, dt, kunOy, som, usd, usulNomi } from "../lib/format";
import { PaymeStatusNote } from "./Payments";

const SOURCE_NAMES = {
  instagram: "Instagram",
  telegram_ads: "Telegram Ads",
  organik: "Organik (tegsiz)",
  boshqa: "Boshqa",
};

function share(n, d) {
  return d ? `${Math.round((100 * n) / d)}%` : "—";
}

/** Bugungi qiymat + kechaga nisbatan farq + oldingi 7 kun o'rtachasi. */
function Tile({ label, value, today, yesterday, avg, invert = false, sub, format = (v) => v }) {
  const diff = today - yesterday;
  const good = invert ? diff < 0 : diff > 0;
  const tone = diff === 0 ? "flat" : good ? "up" : "down";
  return (
    <div className="tile">
      <div className="tile-lbl">{label}</div>
      <div className="tile-val">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
      <div className="tile-cmp">
        <span className={`dlt ${tone}`}>
          {diff === 0 ? "kechagidek" : (
            <>
              <Icon name={diff > 0 ? "up" : "down"} size={12} />
              kechadan {format(Math.abs(diff))} {diff > 0 ? "ko'p" : "kam"}
            </>
          )}
        </span>
        <span className="avg">7 kun o'rtacha: {format(avg)}</span>
      </div>
    </div>
  );
}

/** Ogohlantirishlar: faqat e'tibor kerak bo'lganda ko'zga tashlanadi. */
function StatusStrip({ data }) {
  const bot = data.bot;
  const ai = data.stats.ai;
  const botTone = !bot?.known ? "warn" : bot.alive ? "ok" : "bad";
  return (
    <div className="status-strip">
      <Link className={`status ${botTone}`} to="/tizim">
        <span className="dot" />
        {!bot?.known
          ? "Bot holati noma'lum"
          : bot.alive
            ? <>Bot ishlayapti · 24 soatda {bot.errors_24h} xato</>
            : <>Bot javob bermayapti · {dt(bot.last_seen)}</>}
      </Link>
      <Link className={`status ${ai.percent >= 90 ? "bad" : ai.percent >= 75 ? "warn" : "ok"}`} to="/moliya">
        <span className="dot" />
        AI limitidan {ai.percent}%
      </Link>
      {data.payme?.paid_today?.count > 0 && (
        <Link className="status ok" to="/tolovlar">
          <span className="dot" />
          Bugun Payme: {data.payme.paid_today.count} ta · {som(data.payme.paid_today.amount)} so'm
        </Link>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading, isFetching, error, refetch, fulfilledTimeStamp } =
    useDashboardQuery(undefined, { pollingInterval: 20000 });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const { overview: ov, expiring, payments, stats, log } = data;
  const b = data.brief;
  const t = b.today;
  const y = b.yesterday;
  const a = b.avg7;
  const ai = stats.ai;
  const aiTone = ai.percent >= 90 ? "bad" : ai.percent >= 75 ? "warn" : "";
  const total = ov.users_total || 1;
  const churn = ov.churn || {};

  return (
    <>
      {/* To'lov faqat Payme orqali: u ishlamasa hech kim obuna bo'la olmaydi. */}
      <PaymeStatusNote status={data.payme?.status} compact />
      <StatusStrip data={data} />

      <section className="today">
        <div className="sec-head">
          <h2>Bugun</h2>
          <span className="muted">{kunOy(b.date)} · kecha va oldingi 7 kun o'rtachasi bilan</span>
          <span className="spacer" />
          <Fresh at={fulfilledTimeStamp} busy={isFetching} />
        </div>
        <div className="tiles">
          <Tile label="Yangi kelganlar" value={t.new} today={t.new} yesterday={y.new} avg={a.new} />
          <Tile label="Rozilik bergan" value={t.consent} today={t.consent} yesterday={y.consent}
                avg={a.consent} sub={`yangilarning ${share(t.consent, t.new)}`} />
          <Tile label="Birinchi kuni yozgan" value={t.wrote} today={t.wrote} yesterday={y.wrote}
                avg={a.wrote} sub={`yangilarning ${share(t.wrote, t.new)}`} />
          <Tile label="Faol (yozuv qilgan)" value={t.active} today={t.active} yesterday={y.active} avg={a.active} />
          <Tile label="Bloklagan" value={t.blocked} today={t.blocked} yesterday={y.blocked}
                avg={a.blocked} sub="yangi va eski foydalanuvchilar" invert />
          <Tile label="To'lovlar" value={som(t.paid_sum)} today={t.paid_sum} yesterday={y.paid_sum}
                avg={a.paid_sum} sub={`${t.paid} ta to'lov, so'm`} format={som} />
        </div>
      </section>

      <div className="grid2">
        <Card title="Manbalar — oxirgi 7 kun" action={<Link className="more" to="/statistika">Statistika →</Link>}>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Manba</th>
                  <th className="num">Keldi</th>
                  <th className="num">1-kuni yozdi</th>
                  <th className="num">Bloklagan</th>
                </tr>
              </thead>
              <tbody>
                {b.sources.every((s) => s.new === 0) && <Empty colSpan={4}>7 kunda yangi odam yo'q.</Empty>}
                {b.sources.filter((s) => s.new > 0).map((s) => (
                  <tr key={s.source}>
                    <td>{SOURCE_NAMES[s.source] || s.source}</td>
                    <td className="num">{s.new}</td>
                    <td className="num">{s.wrote} <span className="muted">· {share(s.wrote, s.new)}</span></td>
                    <td className="num">{s.blocked} <span className="muted">· {share(s.blocked, s.new)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint pad" style={{ margin: 0 }}>Faqat shu 7 kunda kelganlar: «Bloklagan» — ulardan nechtasi botni bloklagani.</p>
        </Card>

        <Card title="Oxirgi 30 kun">
          <div className="pad">
            <BarChart
              labels={b.series.labels}
              series={[
                { data: b.series.new, color: "--brass" },
                { data: b.series.active, color: "--success" },
                { data: b.series.blocked, color: "--danger" },
              ]}
              height={180}
            />
            <Legend
              items={[
                { label: "Yangi kelganlar", color: "--brass" },
                { label: "Faol (yozgan)", color: "--success" },
                { label: "Bloklagan", color: "--danger" },
              ]}
            />
          </div>
        </Card>
      </div>

      <div className="grid2">
        <Card
          title="Muddati tugayotganlar"
          action={<Link className="more" to="/foydalanuvchilar">Hammasi →</Link>}
        >
          {expiring.length === 0 ? (
            <Empty>Yaqin kunlarda tugaydigan yo'q.</Empty>
          ) : (
            <ul className="list">
              {expiring.slice(0, 6).map((u) => (
                <li key={u.user_id}>
                  <Link className="who" to={`/foydalanuvchilar/${u.user_id}`}>
                    <Av name={u.first_name || u.username || "?"} seed={u.user_id} />
                    <span style={{ minWidth: 0 }}>
                      <span className="nm">{u.first_name || "Nomsiz"}</span>
                      <span className="meta">{u.username ? `@${u.username}` : `ID ${u.user_id}`}</span>
                    </span>
                  </Link>
                  <Tag kind={u.state}>{u.state}</Tag>
                  <span className="num">{u.days_left} kun</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Oxirgi to'lovlar" action={<Link className="more" to="/tolovlar">To'lovlar →</Link>}>
          {payments.length === 0 ? (
            <Empty>Hozircha to'lov yo'q.</Empty>
          ) : (
            <ul className="list">
              {payments.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link to={`/foydalanuvchilar/${p.user_id}`} className="grow">
                    {p.first_name || p.user_id}
                    <span className="meta"> · {day(p.created_at)} · {p.plan_code}</span>
                  </Link>
                  <Tag kind={p.method === "payme" ? "ok" : ""}>{usulNomi(p.method)}</Tag>
                  <span className="num" style={{ color: p.voided_at ? "var(--text-3)" : "var(--brass)" }}>
                    {p.voided_at ? <s>{som(p.amount)}</s> : som(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <h2 className="sec-title">Umumiy ko'rsatkichlar</h2>
      <div className="kpis three">
        <Kpi label="Foydalanuvchilar" value={ov.users_total} sub={`7 kunda faol: ${ov.active_7}`} />
        <Kpi label="Obunachilar" value={ov.states.obunachi} sub={`konversiya ${ov.conversion}%`} tone="good" />
        <Kpi label="Bepul sinovda" value={ov.states.sinov} sub={`${ov.states.bepul} tasi bepul darajada`} />
        <Kpi label="Shu oy daromad" value={som(ov.revenue_month)} sub={`jami ${som(ov.revenue_all)} so'm`} tone="brass" />
        <Kpi label="Shu oy sof foyda" value={som(ov.profit_month)} sub={`AI sarfi ${usd(ov.cost_month)} ayirilgan`}
             tone={ov.profit_month < 0 ? "bad" : "good"} />
        <Kpi label="Bugungi yozuvlar" value={ov.tx_today} sub={`${ov.calls_today} ta AI chaqiruvi`} />
      </div>

      <div className="grid2">
        <Card title="Foydalanuvchilar taqsimoti">
          <div className="pad">
            <Bars
              max={total}
              rows={[
                ["obunachi", "Obunachilar", "--success"],
                ["sinov", "Bepul sinovda", "--warn"],
                ["bepul", "Bepul daraja", "--border-strong"],
                ["bloklangan", "Bloklangan", "--danger"],
                ["ega", "Egalar", "--brass"],
              ].map(([key, label, color]) => ({
                label,
                value: ov.states[key],
                color: `var(${color})`,
                text: `${ov.states[key]} · ${Math.round((100 * ov.states[key]) / total)}%`,
              }))}
            />
            <div className="subhead">Aloqa</div>
            <Bars
              max={total}
              rows={[
                ["yetib_boradi", "Xabar yetib boradi", "--success"],
                ["bloklagan", "Botni bloklagan", "--danger"],
                ["rozilik_yoq", "Rozilik bermagan", "--warn"],
                ["yozmagan", "Hech yozmagan", "--border-strong"],
              ].map(([key, label, color]) => ({
                label,
                value: churn[key] || 0,
                color: `var(${color})`,
                text: `${churn[key] || 0} · ${Math.round((100 * (churn[key] || 0)) / total)}%`,
              }))}
            />
          </div>
        </Card>

        <Card title="AI sarfi va limit" action={<Link className="more" to="/moliya">Moliya →</Link>}>
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
            <p className="hint" style={{ margin: 0 }}>
              Shu oy {usd(ai.spentUsd)} sarflandi. O'rtacha chek{" "}
              <span className="mono">{som(stats.avgCheck)}</span> so'm, sinovdan
              to'lovga {stats.conversion}%.
            </p>
          </div>
        </Card>
      </div>

      {/* Kunlik va haftalik pul oqimi (daromad va AI sarfi). */}
      <Cashflow />

      <Card title="Oxirgi amallar" action={<Link className="more" to="/jurnal">Jurnal →</Link>}>
        {log.length === 0 ? (
          <Empty>Jurnal bo'sh.</Empty>
        ) : (
          log.map((r) => (
            <div className="log-row" key={r.id} title={r.ip}>
              <span className="t">{dt(r.created_at).slice(-5)}</span>
              <span className="who">{r.admin}</span>
              <span className="msg">
                {r.action}
                {r.details ? ` — ${r.details}` : r.target ? ` — ${r.target}` : ""}
              </span>
            </div>
          ))
        )}
      </Card>
    </>
  );
}
