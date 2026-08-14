import { Link } from "react-router-dom";
import { useDashboardQuery } from "../store/api";
import Fresh from "../components/Fresh";
import { BarChart, Legend } from "../components/Chart";
import {
  Av, Bars, Card, Empty, ErrorBox, Kpi, Loading, Tag,
} from "../components/common";
import { day, dt, som, usd } from "../lib/format";

/**
 * Umumiy holat — bir ekranda hamma bo'lim bo'yicha qisqacha javob.
 *
 * Har bir blok o'z ekraniga havola qiladi: bu yerda «nima bo'lyapti»
 * ko'rinadi, tafsilot esa tegishli bo'limda.
 */
export default function Dashboard() {
  const { data, isLoading, isFetching, error, refetch, fulfilledTimeStamp } =
    useDashboardQuery(undefined, { pollingInterval: 20000 });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const { overview: ov, series, expiring, payments, stats, activity, log } = data;
  const ai = stats.ai;
  const aiTone = ai.percent >= 90 ? "bad" : ai.percent >= 75 ? "warn" : "";
  const total = ov.users_total || 1;

  return (
    <>
      <div className="page-head">
        <Fresh at={fulfilledTimeStamp} busy={isFetching} />
      </div>

      {ov.pending > 0 && (
        <div className="note warn">
          <span className="grow">
            <b>{ov.pending} ta to'lov cheki</b> javob kutmoqda.
          </span>
          <Link className="btn sm" to="/tolovlar">Ko'rish</Link>
        </div>
      )}
      {ai.percent >= 75 && (
        <div className={`note ${aiTone}`}>
          <span className="grow">
            AI oylik limitining <b>{ai.percent}%</b> sarflandi — oy oxirigacha{" "}
            {ai.daysLeft} kun.
          </span>
          <Link className="btn sm" to="/statistika">Statistika</Link>
        </div>
      )}

      <div className="kpis three">
        <Kpi
          label="Foydalanuvchilar"
          value={ov.users_total}
          sub={`${activity.today} tasi bugun faol`}
        />
        <Kpi
          label="Obunachilar"
          value={ov.states.obunachi}
          sub={`konversiya ${ov.conversion}%`}
          tone="good"
        />
        <Kpi
          label="Bepul sinovda"
          value={ov.states.sinov}
          sub={`${ov.states.tugagan} tasining muddati tugagan`}
        />
        <Kpi
          label="Shu oy daromad"
          value={som(ov.revenue_month)}
          sub={`jami ${som(ov.revenue_all)} so'm`}
          tone="brass"
        />
        <Kpi
          label="Shu oy sof foyda"
          value={som(ov.profit_month)}
          sub={`AI sarfi ${usd(ov.cost_month)} ayirilgan`}
          tone={ov.profit_month < 0 ? "bad" : "good"}
        />
        <Kpi
          label="Bugungi faollik"
          value={ov.tx_today}
          sub={`${ov.calls_today} ta AI chaqiruvi`}
        />
      </div>

      <Card
        title="Oxirgi 30 kun"
        action={<Link className="more" to="/statistika">Statistika →</Link>}
      >
        <div className="pad">
          <BarChart
            labels={series.labels}
            series={[
              { data: series.users, color: "--brass" },
              { data: series.transactions, color: "--success" },
            ]}
          />
          <Legend
            items={[
              { label: "Yangi foydalanuvchi", color: "--brass" },
              { label: "Yozuvlar", color: "--success" },
            ]}
          />
        </div>
      </Card>

      <div className="grid2">
        <Card
          title="Muddati tugayotganlar"
          action={<Link className="more" to="/foydalanuvchilar">Hammasi →</Link>}
        >
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Foydalanuvchi</th>
                  <th>Holat</th>
                  <th className="num">Qoldi</th>
                </tr>
              </thead>
              <tbody>
                {expiring.length === 0 && (
                  <Empty colSpan={3}>Yaqin kunlarda tugaydigan yo'q.</Empty>
                )}
                {expiring.map((u) => (
                  <tr key={u.user_id}>
                    <td>
                      <Link className="who" to={`/foydalanuvchilar/${u.user_id}`}>
                        <Av name={u.first_name || u.username || "?"} seed={u.user_id} />
                        <span style={{ minWidth: 0 }}>
                          <span className="nm">{u.first_name || "Nomsiz"}</span>
                          <span className="meta">
                            {u.username ? `@${u.username}` : `ID ${u.user_id}`}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td><Tag kind={u.state}>{u.state}</Tag></td>
                    <td className="num">{u.days_left} kun</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Oxirgi to'lovlar"
          action={<Link className="more" to="/moliya">Moliya →</Link>}
        >
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sana</th>
                  <th>Foydalanuvchi</th>
                  <th>Tarif</th>
                  <th className="num">Summa</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && <Empty colSpan={4}>Hozircha to'lov yo'q.</Empty>}
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="mono nowrap">{day(p.created_at)}</td>
                    <td>
                      <Link to={`/foydalanuvchilar/${p.user_id}`}>
                        {p.first_name || p.user_id}
                      </Link>
                    </td>
                    <td>{p.plan_code}</td>
                    <td className="num" style={{ color: "var(--brass)" }}>
                      {som(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid2">
        <Card title="Foydalanuvchilar taqsimoti">
          <div className="pad">
            <Bars
              max={total}
              rows={[
                ["obunachi", "Obunachilar", "--success"],
                ["sinov", "Bepul sinovda", "--warn"],
                ["tugagan", "Muddati tugagan", "--border-strong"],
                ["bloklangan", "Bloklangan", "--danger"],
                ["ega", "Egalar", "--brass"],
              ].map(([key, label, color]) => ({
                label,
                value: ov.states[key],
                color: `var(${color})`,
                text: `${ov.states[key]} · ${Math.round((100 * ov.states[key]) / total)}%`,
              }))}
            />
          </div>
        </Card>

        <Card title="AI sarfi va limit">
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

      <Card
        title="Oxirgi amallar"
        action={<Link className="more" to="/jurnal">Jurnal →</Link>}
      >
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
