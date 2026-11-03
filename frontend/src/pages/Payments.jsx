import { useState } from "react";
import { Link } from "react-router-dom";
import { usePaymeQuery } from "../store/api";
import Fresh from "../components/Fresh";
import { Card, Empty, ErrorBox, Kpi, Loading, Seg, Tag } from "../components/common";
import { bekorSababi, dt, paymeHolat, som } from "../lib/format";

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

export default function Payments() {
  const [holat, setHolat] = useState("");
  const [test, setTest] = useState(false);
  const { data, isFetching, error, refetch, fulfilledTimeStamp } =
    usePaymeQuery({ holat, test });

  if (error) return <ErrorBox error={error} onRetry={refetch} />;
  if (!data) return <Loading />;

  const sm = data.summary || {};
  const bs = sm.by_state || {};
  const count = (k) => bs[k]?.count || 0;

  return (
    <>
      <div className="page-head">
        <Fresh at={fulfilledTimeStamp} busy={isFetching} />
      </div>

      <PaymeStatusNote status={sm.status} />

      {sm.known === false ? (
        <Card title="Payme">
          <p className="pad muted" style={{ margin: 0 }}>
            Buyurtmalar jadvali hali yo'q — bot Payme versiyasi bilan ishga tushgach paydo bo'ladi.
          </p>
        </Card>
      ) : (
        <>
          <div className="kpis three">
            <Kpi
              label="Bugun to'landi"
              value={som(sm.paid_today?.amount || 0)}
              sub={`${sm.paid_today?.count || 0} ta to'lov`}
              tone="brass"
            />
            <Kpi
              label="Shu oy Payme orqali"
              value={som(sm.paid_month?.amount || 0)}
              sub={`${sm.paid_month?.count || 0} ta to'lov`}
            />
            <Kpi
              label="Havoladan to'lovga (30 kun)"
              value={sm.conversion_30 == null ? "—" : `${sm.conversion_30}%`}
              sub={`${sm.paid_30 || 0} / ${sm.links_30 || 0} havola`}
            />
            <Kpi
              label="Hozir to'lanmoqda"
              value={count("created")}
              sub="Payme sahifasida (12 soatgacha)"
              tone={count("created") > 0 ? "warn" : ""}
            />
            <Kpi label="To'lanmagan havolalar" value={count("pending")} sub="24 soatda eskiradi" />
            <Kpi
              label="Bekor / qaytarilgan"
              value={count("cancelled") + count("refunded")}
              sub={`qaytarilgan: ${som(bs.refunded?.amount || 0)} so'm`}
            />
          </div>

          <div className="row">
            <Seg options={FILTERS} value={holat} onChange={setHolat} />
            <span className="spacer" />
            <label className="muted" style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />
              Sandbox (test) buyurtmalari · {sm.test_count || 0}
            </label>
          </div>

          <Card title={test ? "Test buyurtmalari (daromadga kirmaydi)" : "Payme buyurtmalari"}>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Yaratildi</th>
                    <th>Buyurtma</th>
                    <th>Foydalanuvchi</th>
                    <th>Tarif</th>
                    <th className="num">Summa</th>
                    <th>Holat</th>
                    <th>To'langan / bekor</th>
                    <th>Payme ID</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 && (
                    <Empty colSpan={8}>Bu bo'limda buyurtma yo'q.</Empty>
                  )}
                  {data.items.map((o) => {
                    const h = paymeHolat(o.state);
                    const when = o.perform_time_at || o.cancel_time_at;
                    const reason = o.cancel_time_at ? bekorSababi(o.cancel_reason) : "";
                    return (
                      <tr key={o.id}>
                        <td className="mono nowrap">{dt(o.created_at)}</td>
                        <td className="mono">{o.order_id}</td>
                        <td>
                          <Link to={`/foydalanuvchilar/${o.user_id}`}>
                            {o.first_name || o.user_id}
                          </Link>
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
                        <td className="mono muted" title={o.provider_txn_id || ""}>
                          {o.provider_txn_id ? `${o.provider_txn_id.slice(0, 8)}…` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
