import { useMemo, useState } from "react";
import { useAiCostQuery } from "../store/api";
import { BarChart, Legend } from "./Chart";
import { Card, Empty, ErrorBox, Loading, Seg } from "./common";
import { amalNomi, davrNomi, kunOy, oyQisqa, som, usd } from "../lib/format";

/**
 * AI xarajati — kun · hafta · oy · yil kesimida: ustunli grafik (sichqoncha
 * ostida aniq qiymat) va ostida aniq qiymatlar jadvali ($, so'm,
 * chaqiruvlar, tokenlar, 1 chaqiruv tannarxi). Oxirgi davr odatda
 * tugamagan — jadvalda belgilanadi.
 */
const PERIODS = [["kun", "Kun"], ["hafta", "Hafta"], ["oy", "Oy"], ["yil", "Yil"]];
const SPANS = {
  kun: [[7, "7"], [14, "14"], [30, "30"], [60, "60"], [90, "90"]],
  hafta: [[4, "4"], [8, "8"], [12, "12"], [26, "26"], [52, "52"]],
  oy: [[3, "3"], [6, "6"], [12, "12"], [24, "24"], [36, "36"]],
  yil: [[2, "2"], [3, "3"], [5, "5"], [10, "10"]],
};
const DEFAULTS = { kun: 30, hafta: 12, oy: 12, yil: 5 };
const UNITS = { kun: "kun", hafta: "hafta", oy: "oy", yil: "yil" };

function nameOf(period, it) {
  if (period === "yil") return `${it.start.slice(0, 4)}-yil`;
  return davrNomi(period, it.start, it.end);
}

function tokens(n) {
  if (!n) return "0";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} mln`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} ming`;
  return String(n);
}

export default function AiCost() {
  const [period, setPeriod] = useState("kun");
  const [points, setPoints] = useState(DEFAULTS);
  const nuqta = points[period];
  const { data, isLoading, error, refetch, isFetching } = useAiCostQuery(
    { davr: period, nuqta },
    { pollingInterval: 60000 }
  );

  const filters = (
    <div className="row">
      <span className="lbl">Kesim:</span>
      <Seg options={PERIODS} value={period} onChange={setPeriod} />
      <span className="lbl">Oxirgi:</span>
      <Seg
        options={SPANS[period].map(([n, l]) => [n, `${l} ${UNITS[period]}`])}
        value={nuqta}
        onChange={(n) => setPoints((p) => ({ ...p, [period]: n }))}
      />
    </div>
  );

  const items = data?.items || [];
  const tip = useMemo(
    () => (i) => {
      const it = items[i];
      if (!it) return "";
      return `${nameOf(period, it)} · ${usd(it.cost_usd, 4)} = ${som(it.cost_som)} so'm · ` +
        `${it.calls} chaqiruv${it.partial ? " · davom etmoqda" : ""}`;
    },
    [items, period]
  );
  const xLabel = period === "oy" ? oyQisqa
    : period === "yil" ? (s) => s.slice(0, 4)
    : period === "hafta" ? kunOy : undefined;

  if (error) return <Card title="AI xarajati"><div className="pad">{filters}<ErrorBox error={error} onRetry={refetch} /></div></Card>;
  if (isLoading || !data) return <Card title="AI xarajati"><div className="pad">{filters}<Loading /></div></Card>;

  const hasAny = items.some((i) => i.calls > 0);
  const bars = [{ label: "Xarajat, $", color: "--danger", data: items.map((i) => i.cost_usd) }];

  return (
    <Card
      title="AI xarajati"
      action={<span className="muted" style={{ fontSize: 13 }}>{isFetching ? "yangilanmoqda…" : `1 $ = ${som(data.usd_rate)} so'm`}</span>}
    >
      <div className="pad stack-sm">
        {filters}

        <div className="facts">
          <div className="fact"><span>Jami ({items.length} {UNITS[period]})</span>
            <span className="mono">{usd(data.total_usd, 4)} · {som(data.total_som)} so'm</span></div>
          <div className="fact"><span>Chaqiruvlar</span><span className="mono">{data.calls}</span></div>
          <div className="fact"><span>O'rtacha (faol davr)</span><span className="mono">{usd(data.avg_usd, 4)}</span></div>
          <div className="fact"><span>Eng ko'p</span><span className="mono">{usd(data.max_usd, 4)}</span></div>
        </div>

        {!hasAny ? (
          <Empty title="Bu oraliqda AI chaqiruvi bo'lmagan" />
        ) : (
          <>
            <BarChart
              labels={items.map((i) => i.start)}
              series={bars}
              format={(v) => "$" + (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2))}
              tip={tip}
              xLabel={xLabel}
            />
            <Legend items={[{ label: "Xarajat, $ (sichqonchada aniq qiymat)", color: "--danger" }]} />

            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Davr</th><th>Xarajat, $</th><th>So'm</th><th>Chaqiruv</th>
                    <th>Token (kirish / chiqish)</th><th>1 chaqiruv, $</th>
                  </tr>
                </thead>
                <tbody>
                  {[...items].reverse().map((it) => (
                    <tr key={it.start} className={it.calls ? "" : "muted"}>
                      <td className="nowrap">
                        {nameOf(period, it)}
                        {it.partial && <span className="muted"> · davom etmoqda</span>}
                      </td>
                      <td className="mono">{usd(it.cost_usd, 4)}</td>
                      <td className="mono">{som(it.cost_som)}</td>
                      <td className="mono">{it.calls}</td>
                      <td className="mono">{tokens(it.tokens_in)} / {tokens(it.tokens_out)}</td>
                      <td className="mono">{it.calls ? usd(it.per_call_usd, 5) : "—"}</td>
                    </tr>
                  ))}
                  <tr>
                    <th>Jami</th>
                    <th className="mono">{usd(data.total_usd, 4)}</th>
                    <th className="mono">{som(data.total_som)}</th>
                    <th className="mono">{data.calls}</th>
                    <th className="mono">
                      {tokens(items.reduce((a, i) => a + i.tokens_in, 0))} / {tokens(items.reduce((a, i) => a + i.tokens_out, 0))}
                    </th>
                    <th className="mono">{data.calls ? usd(data.total_usd / data.calls, 5) : "—"}</th>
                  </tr>
                </tbody>
              </table>
            </div>

            {data.by_operation.length > 0 && (
              <p className="hint" style={{ margin: 0 }}>
                Shu oraliqda amal turlari:{" "}
                {data.by_operation.map((o) => `${amalNomi(o.operation)} ${usd(o.cost, 4)} (${o.calls})`).join(" · ")}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
