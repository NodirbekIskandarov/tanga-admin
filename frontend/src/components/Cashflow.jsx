import { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useCashflowQuery } from "../store/api";
import { setCashflowDays, setCashflowView } from "../store/uiSlice";
import { BarChart, Legend } from "./Chart";
import { Card, Delta, Empty, ErrorBox, Loading, Seg } from "./common";
import { hafta, kunOy, qisqa, som } from "../lib/format";

/**
 * Kunlik va haftalik daromad/sarf.
 *
 * IKKI xil pul oqimi bor va ular ATAYLAB aralashtirilmaydi:
 *
 *   «Xizmat daromadi va sarfi» — Tanga'ning o'z puli: obuna to'lovlari
 *   va AI xarajati. Egasi «daromad» deganda odatda shuni nazarda tutadi.
 *
 *   «Foydalanuvchilar aylanmasi» — odamlarning botga yozgan kirim/chiqim
 *   yozuvlari yig'indisi. Bu Tanga'ning puli EMAS — mahsulot qanchalik
 *   ishlatilayotganini ko'rsatadigan hajm. Ikkisi bitta raqamga qo'shilsa
 *   panel yolg'on gapirgan bo'lardi.
 *
 * Ranglar: daromad — yashil, sarf — qizil. Rang yagona belgi emas —
 * ustunlar tartibi doim bir xil (chapda daromad), yonida nom bilan
 * belgisi bor va «Jadval» ko'rinishida hamma son matn bilan yozilgan.
 */

const RANGES = [
  [7, "7 kun"],
  [14, "14 kun"],
  [30, "30 kun"],
];

const VIEWS = [
  ["grafik", "Grafik"],
  ["jadval", "Jadval"],
];

const IN_COLOR = "--success";
const OUT_COLOR = "--danger";

/** Sana oralig'i: bir kunlik davr uchun bitta sana. */
function range(start, end) {
  return start === end ? kunOy(start) : `${kunOy(start)} – ${kunOy(end)}`;
}

function Line({ label, color, value, delta, prev, invert, tone = "" }) {
  return (
    <div className="flow-line">
      <span className="k">
        {color && <i className="dot" style={{ background: `var(${color})` }} />}
        {label}
      </span>
      <span className="r">
        <span className={`v ${tone}`}>{som(value)}</span>
        <Delta
          value={delta}
          now={value}
          invert={invert}
          hint={`Oldingi davr: ${som(prev)} so'm`}
        />
      </span>
    </div>
  );
}

/** Bitta davr kartasi: daromad, sarf va ularning farqi. */
function Flow({ title, p, inLabel, outLabel, netLabel }) {
  return (
    <div className="flow">
      <header>
        <b>{title}</b>
        {/* Solishtirilayotgan davr sarlavhaga sig'maydi, lekin uni bilish
            kerak: joriy hafta o'tgan haftaning AYNAN shuncha kuni bilan
            solishtiriladi — to'liq hafta bilan emas. */}
        <span title={`Solishtiruv: ${range(p.prevStart, p.prevEnd)}`}>
          {range(p.start, p.end)}
        </span>
      </header>
      <Line
        label={inLabel}
        color={IN_COLOR}
        value={p.revenue}
        delta={p.revenueDelta}
        prev={p.prevRevenue}
      />
      <Line
        label={outLabel}
        color={OUT_COLOR}
        value={p.expense}
        delta={p.expenseDelta}
        prev={p.prevExpense}
        invert
      />
      <div className="flow-line sum">
        <span className="k">{netLabel}</span>
        <span className="r">
          <span className={`v ${p.net < 0 ? "neg" : ""}`}>{som(p.net)}</span>
          <Delta
            value={p.netDelta}
            now={p.net}
            hint={`Oldingi davr: ${som(p.prevNet)} so'm`}
          />
        </span>
      </div>
    </div>
  );
}

/** Kunlik sonlar jadvali — grafikning matnli egizagi. */
function DailyTable({ labels, revenue, expense, inLabel, outLabel }) {
  // Harakati yo'q kun ham qoladi — noli bilan. Bo'sh kunlarni tashlab
  // ketish o'sish bordek ko'rsatardi, grafikda ham, jadvalda ham.
  const rows = labels.map((d, i) => ({ d, i })).reverse();

  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Kun</th>
            <th className="num">{inLabel}</th>
            <th className="num">{outLabel}</th>
            <th className="num">Farqi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ d, i }) => {
            const net = revenue[i] - expense[i];
            return (
              <tr key={d}>
                <td className="mono nowrap">
                  {kunOy(d)} <span className="muted">{hafta(d)}</span>
                </td>
                <td className="num">{som(revenue[i])}</td>
                <td className="num">{som(expense[i])}</td>
                <td className="num" style={net < 0 ? { color: "var(--danger)" } : undefined}>
                  {som(net)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Bitta pul oqimi: uchta davr + kunlik taqsimot. */
function Block({ title, flows, series, labels, view, chart, hint,
                inLabel, outLabel, netLabel, empty }) {
  const bars = useMemo(
    () => [
      { data: series.revenue, color: IN_COLOR },
      { data: series.expense, color: OUT_COLOR },
    ],
    [series]
  );

  const tip = useMemo(
    () => (i) =>
      `${kunOy(labels[i])} · ${inLabel.toLowerCase()} ${som(series.revenue[i])} · ` +
      `${outLabel.toLowerCase()} ${som(series.expense[i])}`,
    [labels, series, inLabel, outLabel]
  );

  const hasAny = series.revenue.some(Boolean) || series.expense.some(Boolean);

  return (
    <Card title={title}>
      <div className="pad stack-sm">
        <div className="flows">
          <Flow title="Bugun" p={flows.day} inLabel={inLabel}
                outLabel={outLabel} netLabel={netLabel} />
          <Flow title="Oxirgi 7 kun" p={flows.week7} inLabel={inLabel}
                outLabel={outLabel} netLabel={netLabel} />
          <Flow title="Shu hafta" p={flows.week} inLabel={inLabel}
                outLabel={outLabel} netLabel={netLabel} />
        </div>

        {chart && !hasAny && <Empty title={empty.title}>{empty.text}</Empty>}

        {chart && hasAny && view === "grafik" && (
          <div>
            <BarChart labels={labels} series={bars} format={qisqa} tip={tip} />
            <Legend
              items={[
                { label: inLabel, color: IN_COLOR },
                { label: outLabel, color: OUT_COLOR },
              ]}
            />
          </div>
        )}

        {chart && hasAny && view === "jadval" && (
          <DailyTable labels={labels} revenue={series.revenue}
                      expense={series.expense} inLabel={inLabel} outLabel={outLabel} />
        )}

        <p className="hint">{hint}</p>
      </div>
    </Card>
  );
}

export default function Cashflow({ full = false }) {
  const dispatch = useDispatch();
  const days = useSelector((s) => s.ui.cashflowDays);
  const view = useSelector((s) => s.ui.cashflowView);
  const { data, isLoading, error, refetch } = useCashflowQuery(days, {
    pollingInterval: 60000,
  });

  if (isLoading) return <Loading label="Pul oqimi yuklanmoqda…" />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;
  if (!data) return null;

  // Filtrlar bitta qatorda va IKKALA blokni ham boshqaradi — har bir
  // grafikning o'z tanlagichi bo'lsa, ikkovi turli davrni ko'rsatib
  // taqqoslashni buzardi.
  const filters = (
    <div className="row">
      <span className="lbl">Kunlik taqsimot:</span>
      <Seg
        options={RANGES}
        value={days}
        onChange={(d) => dispatch(setCashflowDays(d))}
      />
      <span className="spacer" />
      <Seg
        options={VIEWS}
        value={view}
        onChange={(v) => dispatch(setCashflowView(v))}
      />
    </div>
  );

  return (
    <>
      {filters}

      <Block
        title="Xizmat daromadi va sarfi"
        flows={data.service}
        series={data.series.service}
        labels={data.series.labels}
        view={view}
        chart
        inLabel="Daromad"
        outLabel="Sarf"
        netLabel="Sof natija"
        empty={{
          title: "Bu oynada harakat yo'q",
          text: "Tasdiqlangan to'lov ham, AI sarfi ham qayd etilmagan.",
        }}
        hint={
          <>
            Daromad — tasdiqlangan obuna to'lovlari. Sarf — AI chaqiruvlari,
            kurs <span className="mono">{som(data.usd_rate)}</span> so'm bilan
            o'girilgan. Server va domen kabi doimiy xarajatlar bazada yo'q,
            shuning uchun bu yerga kirmaydi.
          </>
        }
      />

      <Block
        title="Foydalanuvchilar aylanmasi"
        flows={data.users}
        series={data.series.users}
        labels={data.series.labels}
        view={view}
        chart={full}
        inLabel="Kirim"
        outLabel="Chiqim"
        netLabel="Farqi"
        empty={{
          title: "Yozuv yo'q",
          text: "Bu oynada foydalanuvchilar birorta kirim yoki chiqim yozmagan.",
        }}
        hint={
          <>
            Bu <b>Tanga'ning puli emas</b> — foydalanuvchilar botga yozgan
            yozuvlar yig'indisi, ya'ni mahsulot qanchalik ishlatilayotgani.
            Qarz yozuvlari hisobga olinmaydi. Valyutali yozuvlar o'sha kundagi
            kurs bilan so'mga o'girilgan.
            {data.noBaseCount > 0 && (
              <>
                {" "}
                <b>{data.noBaseCount} ta</b> eski yozuvning kursi noma'lum —
                ular nominal qiymatida sanalgan.
              </>
            )}
          </>
        }
      />
    </>
  );
}
