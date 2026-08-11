import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useFinanceQuery } from "../store/api";
import { setFinanceDays } from "../store/uiSlice";
import { LineChart, Legend } from "../components/Chart";
import { Card, Empty, ErrorBox, Kpi, Loading } from "../components/common";
import { dt, som, usd } from "../lib/format";

const RANGES = [7, 30, 90, 365];

export default function Finance() {
  const dispatch = useDispatch();
  const days = useSelector((s) => s.ui.financeDays);
  const { data, isFetching, error, refetch } = useFinanceQuery(days);

  if (error) return <ErrorBox error={error} onRetry={refetch} />;
  if (!data) return <Loading />;

  const ov = data.overview;
  const margin =
    ov.revenue_month > 0
      ? `marja ${Math.round((100 * ov.profit_month) / ov.revenue_month)}%`
      : "daromad hali yo'q";

  return (
    <>
      <Card>
        <div className="pad">
          <div className="row">
            <span className="muted" style={{ fontSize: 13 }}>
              Davr:
            </span>
            {RANGES.map((d) => (
              <button
                key={d}
                className={`btn sm ${days === d ? "pri" : ""}`}
                onClick={() => dispatch(setFinanceDays(d))}
              >
                {d} kun
              </button>
            ))}
            <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
              Kurs: 1 $ = {som(data.usd_rate)} so'm
            </span>
            <a className="btn" href="/api/export/payments.csv">
              ⬇ To'lovlar CSV
            </a>
          </div>
        </div>
      </Card>

      <div className="kpis">
        <Kpi label="Shu oy daromad" value={som(ov.revenue_month)} sub="so'm" tone="good" />
        <Kpi
          label="Shu oy AI sarfi"
          value={som(data.cost_month_som)}
          sub={usd(ov.cost_month)}
          tone="bad"
        />
        <Kpi
          label="Sof foyda"
          value={som(ov.profit_month)}
          sub={margin}
          tone={ov.profit_month < 0 ? "bad" : "good"}
        />
        <Kpi
          label="1 foydalanuvchi tannarxi"
          value={som(data.per_user_som)}
          sub={`oyiga, ${usd(data.per_user_usd, 4)}`}
        />
        <Kpi label="Jami daromad" value={som(ov.revenue_all)} sub="boshidan beri" />
        <Kpi
          label="Jami AI sarfi"
          value={usd(ov.cost_all)}
          sub={`${som(ov.cost_all * data.usd_rate)} so'm`}
        />
      </div>

      <Card title="Kunlik AI xarajati">
        <LineChart
          labels={data.series.labels}
          data={data.series.cost}
          color="#A0221C"
          format={(v) => "$" + v.toFixed(2)}
        />
        <Legend items={[{ label: "Xarajat, $", color: "#A0221C" }]} />
      </Card>

      <div className="grid2">
        <Card title="Amal turlari bo'yicha">
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Amal</th>
                  <th className="num">Chaqiruv</th>
                  <th className="num">Narx</th>
                  <th className="num">O'rtacha</th>
                  <th className="num">Keshdan</th>
                </tr>
              </thead>
              <tbody>
                {data.breakdown.by_operation.length === 0 && (
                  <Empty colSpan={5}>Sarf yo'q.</Empty>
                )}
                {data.breakdown.by_operation.map((r) => (
                  <tr key={r.operation}>
                    <td>
                      <b>{r.operation}</b>
                    </td>
                    <td className="num">{r.calls}</td>
                    <td className="num">{usd(r.cost)}</td>
                    <td className="num">{usd((r.cost || 0) / (r.calls || 1), 4)}</td>
                    <td className="num">{som(r.cread || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Model bo'yicha">
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Chaqiruv</th>
                  <th className="num">Narx</th>
                </tr>
              </thead>
              <tbody>
                {data.breakdown.by_model.length === 0 && (
                  <Empty colSpan={3}>Sarf yo'q.</Empty>
                )}
                {data.breakdown.by_model.map((r) => (
                  <tr key={r.model || "—"}>
                    <td className="mono">{r.model || "—"}</td>
                    <td className="num">{r.calls}</td>
                    <td className="num">{usd(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid2">
        <Card title="Eng ko'p sarflaganlar">
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Foydalanuvchi</th>
                  <th className="num">Chaqiruv</th>
                  <th className="num">Narx</th>
                </tr>
              </thead>
              <tbody>
                {data.spenders.length === 0 && <Empty colSpan={3}>Ma'lumot yo'q.</Empty>}
                {data.spenders.map((r) => (
                  <tr key={r.user_id}>
                    <td>
                      <Link to={`/foydalanuvchilar/${r.user_id}`}>
                        {r.first_name || r.user_id}
                      </Link>
                    </td>
                    <td className="num">{r.calls}</td>
                    <td className="num">{usd(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Tariflar">
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tarif</th>
                  <th className="num">Narx</th>
                  <th className="num">Oyiga</th>
                  <th className="num">Kun</th>
                </tr>
              </thead>
              <tbody>
                {data.plans.map((p) => (
                  <tr key={p.code}>
                    <td>
                      <b>{p.label}</b>
                    </td>
                    <td className="num">{som(p.price)}</td>
                    <td className="num">{som(p.monthly)}</td>
                    <td className="num">{p.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="To'lovlar tarixi">
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Sana</th>
                <th>Foydalanuvchi</th>
                <th>Tarif</th>
                <th className="num">Summa</th>
                <th className="num">Kun</th>
                <th>Kim qo'shdi</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.length === 0 && <Empty colSpan={6}>To'lov yo'q.</Empty>}
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td className="mono nowrap">{dt(p.created_at)}</td>
                  <td>
                    <Link to={`/foydalanuvchilar/${p.user_id}`}>
                      {p.first_name || p.user_id}
                    </Link>
                  </td>
                  <td>{p.plan_code}</td>
                  <td className="num">{som(p.amount)}</td>
                  <td className="num">{p.days}</td>
                  <td className="muted">{p.created_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {isFetching && <div className="hint">Yangilanmoqda…</div>}
    </>
  );
}
