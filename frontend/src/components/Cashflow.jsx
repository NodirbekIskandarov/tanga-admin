import { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useCashflowQuery } from "../store/api";
import { setCashflowPeriod, setCashflowPoints, setCashflowView } from "../store/uiSlice";
import { BarChart, Legend } from "./Chart";
import { Card, Delta, Empty, ErrorBox, Loading, Seg } from "./common";
import { davrNomi, hafta, kunOy, oraliq, oyQisqa, qisqa, som } from "../lib/format";

/**
 * Daromad va sarf — kun, hafta yoki oy kesimida.
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
 * Davr tanlagichi IKKALA blokka ham birdek ta'sir qiladi: bir blok haftani,
 * ikkinchisi oyni ko'rsatib tursa, ular yonma-yon o'qilmay qolardi.
 *
 * Ranglar: daromad — yashil, sarf — qizil. Rang yagona belgi emas —
 * ustunlar tartibi doim bir xil (chapda daromad), yonida nom bilan
 * belgisi bor va «Jadval» ko'rinishida hamma son matn bilan yozilgan.
 */

const PERIODS = [
  ["kun", "Kun"],
  ["hafta", "Hafta"],
  ["oy", "Oy"],
];

// Grafik oynasi har bir davr uchun alohida: kunlarda 14–30 kun, haftalarda
// 8–12 hafta, oylarda 6–12 oy — hammasi bir ekranga sig'adigan miqdor.
const SPANS = {
  kun: [[14, "14 kun"], [30, "30 kun"]],
  hafta: [[8, "8 hafta"], [12, "12 hafta"]],
  oy: [[6, "6 oy"], [12, "12 oy"]],
};

// Joriy va solishtiriladigan davr nomlari.
const TITLES = {
  kun: ["Bugun", "Kecha"],
  hafta: ["Shu hafta", "O'tgan hafta"],
  oy: ["Shu oy", "O'tgan oy"],
};

const COLUMN = { kun: "Kun", hafta: "Hafta", oy: "Oy" };

const VIEWS = [
  ["grafik", "Grafik"],
  ["jadval", "Jadval"],
];

const IN_COLOR = "--success";
const OUT_COLOR = "--danger";

/**
 * Karta sarlavhasidagi oraliq.
 *
 * Bir kunlik davrga bitta sana yetadi, uzunroq davr esa AYNAN qaysi
 * kunlarni qamrayotganini aytishi kerak: «Shu oy 1–15 avgust» va yonida
 * «O'tgan oy 1–15 iyul» — solishtiruv teng kunlar bo'yicha ketayotgani
 * shundan ko'rinadi.
 */
function range(period, start, end) {
  return period === "kun" ? kunOy(start) : oraliq(start, end);
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
        {/* Solishtiruv kartasida foiz yo'q: u o'zi solishtirish nuqtasi,
            «o'zidan oldingi davr» esa boshqa savol. */}
        {delta !== false && (
          <Delta
            value={delta}
            now={value}
            invert={invert}
            hint={`Oldingi davr: ${som(prev)} so'm`}
          />
        )}
      </span>
    </div>
  );
}

/**
 * Bitta davr kartasi: daromad, sarf va ularning farqi.
 *
 * `compare` — o'tgan davr kartasi: o'sha sonlar, foizsiz va xira.
 * Foiz ipuchasi sichqonchasiz qurilmada ko'rinmaydi, shuning uchun
 * solishtirilayotgan davr sonlari yashirin qolmaydi.
 */
function Flow({ title, period, p, compare = false, inLabel, outLabel, netLabel }) {
  const v = compare
    ? { start: p.prevStart, end: p.prevEnd, revenue: p.prevRevenue,
        expense: p.prevExpense, net: p.prevNet }
    : p;

  return (
    <div className={`flow${compare ? " ref" : ""}`}>
      <header>
        <b>{title}</b>
        <span
          title={compare ? "Joriy davr bilan teng kunlar oralig'i" : undefined}
        >
          {range(period, v.start, v.end)}
        </span>
      </header>
      <Line
        label={inLabel}
        color={IN_COLOR}
        value={v.revenue}
        delta={compare ? false : p.revenueDelta}
        prev={p.prevRevenue}
      />
      <Line
        label={outLabel}
        color={OUT_COLOR}
        value={v.expense}
        delta={compare ? false : p.expenseDelta}
        prev={p.prevExpense}
        invert
      />
      <div className="flow-line sum">
        <span className="k">{netLabel}</span>
        <span className="r">
          <span className={`v ${v.net < 0 ? "neg" : ""}`}>{som(v.net)}</span>
          {!compare && (
            <Delta
              value={p.netDelta}
              now={p.net}
              hint={`Oldingi davr: ${som(p.prevNet)} so'm`}
            />
          )}
        </span>
      </div>
    </div>
  );
}

/** Davrlar jadvali — grafikning matnli egizagi. */
function FlowTable({ period, series, revenue, expense, inLabel, outLabel }) {
  // Harakati yo'q davr ham qoladi — noli bilan. Bo'shlarini tashlab
  // ketish o'sish bordek ko'rsatardi, grafikda ham, jadvalda ham.
  const rows = series.labels.map((d, i) => ({ d, i })).reverse();

  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>{COLUMN[period]}</th>
            <th className="num">{inLabel}</th>
            <th className="num">{outLabel}</th>
            <th className="num">Farqi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ d, i }) => {
            const net = revenue[i] - expense[i];
            // Oxirgi hafta/oy hali tugamagan — sonini to'liq davr bilan
            // solishtirib bo'lmasligi shu yerda ochiq aytiladi.
            const note = period === "kun"
              ? hafta(d)
              : series.partial[i] && "davom etmoqda";
            return (
              <tr key={d}>
                <td className={period === "kun" ? "mono nowrap" : "nowrap"}>
                  {davrNomi(period, d, series.ends[i])}{" "}
                  {note && <span className="muted">{note}</span>}
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

/** Bitta pul oqimi: tanlangan davr, solishtiruvi va tarixi. */
function Block({ title, period, flow, series, values, view, chart, hint,
                inLabel, outLabel, netLabel, empty }) {
  const bars = useMemo(
    () => [
      { data: values.revenue, color: IN_COLOR },
      { data: values.expense, color: OUT_COLOR },
    ],
    [values]
  );

  const tip = useMemo(
    () => (i) =>
      `${davrNomi(period, series.labels[i], series.ends[i])} · ` +
      `${inLabel.toLowerCase()} ${som(values.revenue[i])} · ` +
      `${outLabel.toLowerCase()} ${som(values.expense[i])}`,
    [period, series, values, inLabel, outLabel]
  );

  // Oylik kesimda o'q ostida sana emas, oy nomi turishi kerak.
  const xLabel = period === "oy" ? oyQisqa : undefined;
  const [now, before] = TITLES[period];
  const hasAny = values.revenue.some(Boolean) || values.expense.some(Boolean);

  return (
    <Card title={title}>
      <div className="pad stack-sm">
        <div className="flows">
          <Flow title={now} period={period} p={flow} inLabel={inLabel}
                outLabel={outLabel} netLabel={netLabel} />
          <Flow title={before} period={period} p={flow} compare inLabel={inLabel}
                outLabel={outLabel} netLabel={netLabel} />
        </div>

        {chart && !hasAny && <Empty title={empty.title}>{empty.text}</Empty>}

        {chart && hasAny && view === "grafik" && (
          <div>
            <BarChart labels={series.labels} series={bars} format={qisqa}
                      tip={tip} xLabel={xLabel} />
            <Legend
              items={[
                { label: inLabel, color: IN_COLOR },
                { label: outLabel, color: OUT_COLOR },
              ]}
            />
          </div>
        )}

        {chart && hasAny && view === "jadval" && (
          <FlowTable period={period} series={series} revenue={values.revenue}
                     expense={values.expense} inLabel={inLabel} outLabel={outLabel} />
        )}

        <p className="hint">{hint}</p>
      </div>
    </Card>
  );
}

export default function Cashflow({ full = false }) {
  const dispatch = useDispatch();
  const period = useSelector((s) => s.ui.cashflowPeriod);
  const points = useSelector((s) => s.ui.cashflowPoints[s.ui.cashflowPeriod]);
  const view = useSelector((s) => s.ui.cashflowView);
  const { data, isLoading, error, refetch } = useCashflowQuery(
    { davr: period, nuqta: points },
    { pollingInterval: 60000 }
  );

  // Filtrlar bitta qatorda va IKKALA blokni ham boshqaradi — har bir
  // grafikning o'z tanlagichi bo'lsa, ikkovi turli davrni ko'rsatib
  // taqqoslashni buzardi.
  const filters = (
    <div className="row">
      <span className="lbl">Davr:</span>
      <Seg
        options={PERIODS}
        value={period}
        onChange={(p) => dispatch(setCashflowPeriod(p))}
      />
      <span className="lbl">Tarix:</span>
      <Seg
        options={SPANS[period]}
        value={points}
        onChange={(n) => dispatch(setCashflowPoints({ davr: period, nuqta: n }))}
      />
      <span className="spacer" />
      <Seg
        options={VIEWS}
        value={view}
        onChange={(v) => dispatch(setCashflowView(v))}
      />
    </div>
  );

  // Yangi davr birinchi marta so'ralganda ma'lumot bo'lmaydi. Tanlagich
  // shunda ham joyida qoladi: g'oyib bo'lsa, tanlovni o'zgartirgan odam
  // nima bosganini yo'qotib qo'yadi va tugmalar sakrab ketadi.
  if (isLoading || error || !data) {
    return (
      <>
        {filters}
        {error ? <ErrorBox error={error} onRetry={refetch} />
               : <Loading label="Pul oqimi yuklanmoqda…" />}
      </>
    );
  }

  return (
    <>
      {filters}

      <Block
        title="Xizmat daromadi va sarfi"
        period={data.period}
        flow={data.service}
        series={data.series}
        values={data.series.service}
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
        period={data.period}
        flow={data.users}
        series={data.series}
        values={data.series.users}
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
