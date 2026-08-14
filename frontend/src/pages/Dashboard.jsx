import Fresh from "../components/Fresh";
import { Link } from "react-router-dom";
import { useDashboardQuery } from "../store/api";
import { BarChart, Legend } from "../components/Chart";
import { Bars, Card, Empty, ErrorBox, Kpi, Loading, Tag } from "../components/common";
import { day, pct, som, usd } from "../lib/format";

const DIST = [
  ["obunachi", "Obunachilar", "var(--ok)"],
  ["sinov", "Bepul sinovda", "var(--warn)"],
  ["tugagan", "Muddati tugagan", "var(--ink-3)"],
  ["bloklangan", "Bloklangan", "var(--danger)"],
  ["ega", "Egalar", "var(--brand)"],
];

export default function Dashboard() {
  // Ma'lumot bot ishlaganda o'zgaradi — sahifani qo'lda yangilash
  // shart bo'lmasin. 20 soniya: yuk kam, lekin ko'rinish tirik.
  const { data, isLoading, error, refetch, fulfilledTimeStamp } =
    useDashboardQuery(undefined, { pollingInterval: 20000 });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const { overview: ov, series, expiring, payments } = data;
  const total = ov.users_total || 1;

  return (
    <>
      <div className="page-head">
        <Fresh at={fulfilledTimeStamp} />
      </div>

      {ov.pending > 0 && (
        <div className="note warn">
          <b>{ov.pending} ta obuna so'rovi</b> javob kutmoqda —{" "}
          <Link to="/sorovlar">ko'rish</Link>
        </div>
      )}

      <div className="kpis">
        <Kpi
          label="Foydalanuvchilar"
          value={ov.users_total}
          sub={`${ov.active_7} tasi 7 kun ichida faol`}
        />
        <Kpi
          label="Obunachilar"
          value={ov.states.obunachi}
          sub={`Konversiya ${ov.conversion}%`}
          tone="good"
        />
        <Kpi
          label="Bepul sinovda"
          value={ov.states.sinov}
          sub={`${ov.states.tugagan} tasining muddati tugagan`}
          tone="warn"
        />
        <Kpi
          label="Shu oy daromad"
          value={som(ov.revenue_month)}
          sub={`Jami ${som(ov.revenue_all)} so'm`}
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

      <Card title="Oxirgi 30 kun">
        <BarChart
          labels={series.labels}
          series={[
            { data: series.users, color: "#1B4E8F" },
            { data: series.transactions, color: "#C77700" },
          ]}
        />
        <Legend
          items={[
            { label: "Yangi foydalanuvchi", color: "#1B4E8F" },
            { label: "Yozuvlar", color: "#C77700" },
          ]}
        />
      </Card>

      <div className="grid2">
        <Card title="Muddati tugayotganlar">
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
                      <Link to={`/foydalanuvchilar/${u.user_id}`}>
                        {u.first_name || u.user_id}
                      </Link>
                      {u.username && <span className="muted"> @{u.username}</span>}
                    </td>
                    <td>
                      <Tag kind={u.state}>{u.state}</Tag>
                    </td>
                    <td className="num">{u.days_left} kun</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Oxirgi to'lovlar">
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
                {payments.length === 0 && (
                  <Empty colSpan={4}>Hozircha to'lov yo'q.</Empty>
                )}
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="mono nowrap">{day(p.created_at)}</td>
                    <td>
                      <Link to={`/foydalanuvchilar/${p.user_id}`}>
                        {p.first_name || p.user_id}
                      </Link>
                    </td>
                    <td>{p.plan_code}</td>
                    <td className="num">{som(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="Foydalanuvchilar taqsimoti">
        <div className="pad">
          <Bars
            max={total}
            rows={DIST.map(([key, label, color]) => ({
              label,
              value: ov.states[key],
              color,
              text: `${ov.states[key]} · ${pct((100 * ov.states[key]) / total)}`,
            }))}
          />
        </div>
      </Card>
    </>
  );
}
