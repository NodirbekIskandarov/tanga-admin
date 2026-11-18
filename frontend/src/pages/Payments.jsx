import { useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useFinanceQuery, usePaymeQuery } from "../store/api";
import Fresh from "../components/Fresh";
import { Card, Empty, ErrorBox, Kpi, Loading, Tag } from "../components/common";
import { bekorSababi, dt, paymeHolat, som, usulNomi } from "../lib/format";

// Obuna faqat Payme orqali: foydalanuvchi to'laydi — PRO o'zi yoqiladi.
// Admin tasdig'i yo'q, shuning uchun bu sahifa — kuzatuv: kim, qachon,
// qancha to'ladi, qaysi havola to'lanmay qoldi, nima bekor bo'ldi.
const FILTERS = [
  ["", "Hammasi"],
  ["paid", "To'langan"],
  ["created", "To'lanmoqda"],
  ["pending", "Havola"],
  ["cancelled", "Bekor"],
  ["refunded", "Qaytarilgan"],
  ["expired", "Eskirgan"],
];

/** Payme sozlamasi: foydalanuvchilar hozir to'lay oladimi. */
export function PaymeStatusNote({ status, compact = false }) {
  if (!status || !status.env) {
    return compact ? null : (
      <div className="note warn">
        <span className="grow">
          Payme holati noma'lum — bot yangi versiya bilan hali ishga tushmagan.
        </span>
      </div>
    );
  }
  if (!status.ready) {
    return (
      <div className="note bad">
        <span className="grow">
          <b>Foydalanuvchilar hozir to'lay olmaydi:</b>{" "}
          {!status.enabled ? "botda Payme tugmasi o'chiq (PAYME_ENABLED=false)" : "kassa ID yoki kalit yo'q"}.
          {" "}Bot tarif tanlaganlarga «to'lov vaqtincha ishlamayapti» deydi.
        </span>
        {compact && <Link className="btn sm" to="/tolovlar">To'lovlar</Link>}
      </div>
    );
  }
  if (!status.prod) {
    return (
      <div className="note warn">
        <span className="grow">
          <b>Payme test rejimida</b> — havolalar {status.checkout} ga boradi, haqiqiy
          pul yechilmaydi va to'lovlar daromadga kirmaydi.
        </span>
        {compact && <Link className="btn sm" to="/tolovlar">To'lovlar</Link>}
      </div>
    );
  }
  return compact ? null : (
    <div className="note ok">
      <span className="grow">
        Payme <b>ishchi rejimda</b>: to'lov o'tishi bilan PRO o'zi yoqiladi,
        foydalanuvchiga va sizga xabar keladi. Qo'lda tasdiqlash yo'q.
      </span>
    </div>
  );
}

const VIEWS = [
  ["tushgan", "Tushgan to'lovlar"],
  ["payme", "Payme buyurtmalari"],
];

/** Tushgan to'lovlar: daromadga yozilgan har bir to'lov (Payme va qo'lda). */
function Received({ data }) {
  const pays = data.payments || [];
  return (
    <>
      <Card
        title="Oxirgi to'lovlar"
        action={<a className="btn sm" href="/api/export/payments.csv">CSV</a>}
      >
        <div className="tbl-wrap only-wide">
          <table>
            <thead>
              <tr>
                <th>Sana</th>
                <th>Foydalanuvchi</th>
                <th>Tarif</th>
                <th className="num">Summa</th>
                <th className="num">Kun</th>
                <th>Usul</th>
                <th>Kim qo'shdi</th>
              </tr>
            </thead>
            <tbody>
              {pays.length === 0 && <Empty colSpan={7}>To'lov yo'q.</Empty>}
              {pays.map((p) => (
                <tr key={p.id}>
                  <td className="mono nowrap">{dt(p.created_at)}</td>
                  <td>
                    <Link to={`/foydalanuvchilar/${p.user_id}`}>{p.first_name || p.user_id}</Link>
                  </td>
                  <td>{p.plan_code}</td>
                  <td className="num nowrap">
                    {p.voided_at
                      ? <span className="muted" title="Daromaddan chiqarilgan"><s>{som(p.amount)}</s></span>
                      : som(p.amount)}
                  </td>
                  <td className="num">{p.days}</td>
                  <td><Tag kind={p.method === "payme" ? "ok" : ""}>{usulNomi(p.method)}</Tag></td>
                  <td className="muted">{p.created_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list only-narrow">
          {pays.length === 0 && <li className="empty-li">To'lov yo'q.</li>}
          {pays.map((p) => (
            <li key={p.id}>
              <Link to={`/foydalanuvchilar/${p.user_id}`}>
                {p.first_name || p.user_id}
                <span className="meta"> · {dt(p.created_at)} · {p.plan_code}</span>
              </Link>
              <span className="num" style={{ color: p.voided_at ? "var(--text-3)" : "var(--brass)" }}>
                {p.voided_at ? <s>{som(p.amount)}</s> : som(p.amount)}
              </span>
            </li>
          ))}
        </ul>
        <p className="hint pad" style={{ margin: 0 }}>
          Oxirgi {pays.length} ta yozuv. Chizilgani — «xato yozuv» deb daromaddan chiqarilgan
          (pul qaytarilmaydi). To'liq ro'yxat — CSV.
        </p>
      </Card>

      <Card title="Usul bo'yicha">
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Usul</th>
                <th className="num">Shu oy</th>
                <th className="num">Soni (oy)</th>
                <th className="num">Jami</th>
                <th className="num">Soni (jami)</th>
              </tr>
            </thead>
            <tbody>
              {(data.by_method || []).length === 0 && <Empty colSpan={5}>Daromad yo'q.</Empty>}
              {(data.by_method || []).map((m) => (
                <tr key={m.method}>
                  <td><b>{usulNomi(m.method)}</b></td>
                  <td className="num">{som(m.month)}</td>
                  <td className="num">{m.month_n}</td>
                  <td className="num">{som(m.total)}</td>
                  <td className="num">{m.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint pad" style={{ margin: 0 }}>
          Bekor qilingan («xato yozuv») va Payme test (sandbox) to'lovlari daromadga kirmaydi.
        </p>
      </Card>
    </>
  );
}

/** Payme buyurtmalari: havola olingan, to'lanayotgan, bekor bo'lgan va h.k. */
function Orders({ data, holat, setHolat, test, setTest }) {
  const sm = data.summary || {};
  const bs = sm.by_state || {};
  const count = (k) => bs[k]?.count || 0;
  return (
    <>
      <div className="chips" role="tablist" aria-label="Buyurtma holati">
        {FILTERS.map(([v, label]) => (
          <button key={v || "all"} role="tab" aria-selected={holat === v}
                  className={`chip ${holat === v ? "on" : ""}`} onClick={() => setHolat(v)}>
            {label}
            {v && count(v) > 0 && <span className="chip-n">{count(v)}</span>}
          </button>
        ))}
        <button className={`chip ${test ? "on" : ""}`} onClick={() => setTest(!test)}
                title="Payme sandbox orqali o'tgan sinov buyurtmalari — daromadga kirmaydi">
          Test (sandbox){sm.test_count ? <span className="chip-n">{sm.test_count}</span> : null}
        </button>
      </div>

      <Card title={test ? "Test buyurtmalari (daromadga kirmaydi)" : "Payme buyurtmalari"}>
        <div className="tbl-wrap only-wide">
          <table>
            <thead>
              <tr>
                <th>Yaratildi</th>
                <th>Foydalanuvchi</th>
                <th>Tarif</th>
                <th className="num">Summa</th>
                <th>Holat</th>
                <th>To'langan / bekor</th>
                <th>Buyurtma</th>
                <th>Payme ID</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && <Empty colSpan={8}>Bu bo'limda buyurtma yo'q.</Empty>}
              {data.items.map((o) => {
                const h = paymeHolat(o.state);
                const when = o.perform_time_at || o.cancel_time_at;
                const reason = o.cancel_time_at ? bekorSababi(o.cancel_reason) : "";
                return (
                  <tr key={o.id}>
                    <td className="mono nowrap">{dt(o.created_at)}</td>
                    <td>
                      <Link to={`/foydalanuvchilar/${o.user_id}`}>{o.first_name || o.user_id}</Link>
                      {o.username && <span className="muted"> @{o.username}</span>}
                    </td>
                    <td>{o.plan}</td>
                    <td className="num nowrap">{som(o.amount)}</td>
                    <td className="nowrap">
                      <Tag kind={h.kind}>{h.label}</Tag>
                      {o.test && <> <Tag>test</Tag></>}
                    </td>
                    <td className="nowrap">
                      {when ? <span className="mono">{dt(when)}</span> : <span className="muted">—</span>}
                      {reason && <div className="muted" style={{ fontSize: 12 }}>{reason}</div>}
                    </td>
                    <td className="mono muted">{o.order_id}</td>
                    <td className="mono muted" title={o.provider_txn_id || ""}>
                      {o.provider_txn_id ? `${o.provider_txn_id.slice(0, 8)}…` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="list only-narrow">
          {data.items.length === 0 && <li className="empty-li">Bu bo'limda buyurtma yo'q.</li>}
          {data.items.map((o) => {
            const h = paymeHolat(o.state);
            return (
              <li key={o.id}>
                <Link to={`/foydalanuvchilar/${o.user_id}`}>
                  {o.first_name || o.user_id}
                  <span className="meta"> · {dt(o.created_at)} · {o.plan}</span>
                </Link>
                <Tag kind={h.kind}>{h.label}</Tag>
                <span className="num">{som(o.amount)}</span>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

/**
 * To'lovlar: ikki ko'rinish. «Tushgan to'lovlar» — daromadga yozilganlar
 * (ilgari «Moliya» sahifasining oxirida edi). «Payme buyurtmalari» — havola
 * olinganidan to to'lov yoki bekorgacha bo'lgan kuzatuv.
 */
export default function Payments() {
  const [view, setView] = useState("tushgan");
  const [holat, setHolat] = useState("");
  const [test, setTest] = useState(false);
  const days = useSelector((s) => s.ui.financeDays);
  const payme = usePaymeQuery({ holat, test });
  const fin = useFinanceQuery(days, { skip: view !== "tushgan" });

  const { data, error, refetch } = payme;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;
  if (!data) return <Loading />;

  const sm = data.summary || {};
  const bs = sm.by_state || {};
  const count = (k) => bs[k]?.count || 0;
  const current = view === "tushgan" ? fin : payme;

  return (
    <>
      <PaymeStatusNote status={sm.status} />

      {sm.known !== false && (
        <div className="kpis">
          <Kpi label="Bugun tushdi" value={som(sm.paid_today?.amount || 0)}
               sub={`${sm.paid_today?.count || 0} ta to'lov, so'm`} tone="brass" />
          <Kpi label="Shu oy (Payme)" value={som(sm.paid_month?.amount || 0)}
               sub={`${sm.paid_month?.count || 0} ta to'lov, so'm`} />
          <Kpi label="Havoladan to'lovga (30 kun)"
               value={sm.conversion_30 == null ? "—" : `${sm.conversion_30}%`}
               sub={`${sm.paid_30 || 0} / ${sm.links_30 || 0} havola`} />
          <Kpi label="Hozir to'lanmoqda" value={count("created")}
               sub={`to'lanmagan havola: ${count("pending")} · bekor: ${count("cancelled") + count("refunded")}`}
               tone={count("created") > 0 ? "warn" : ""} />
        </div>
      )}

      <div className="tabs" role="tablist">
        {VIEWS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={view === key}
                  className={view === key ? "on" : ""} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
        <span className="tabs-side">
          <Fresh at={current.fulfilledTimeStamp} busy={current.isFetching} />
        </span>
      </div>

      {view === "tushgan" && (
        fin.error ? <ErrorBox error={fin.error} onRetry={fin.refetch} />
          : !fin.data ? <Loading /> : <Received data={fin.data} />
      )}

      {view === "payme" && (
        sm.known === false ? (
          <Card title="Payme">
            <p className="pad muted" style={{ margin: 0 }}>
              Buyurtmalar jadvali hali yo'q — bot Payme versiyasi bilan ishga tushgach paydo bo'ladi.
            </p>
          </Card>
        ) : (
          <Orders data={data} holat={holat} setHolat={setHolat} test={test} setTest={setTest} />
        )
      )}
    </>
  );
}
