import Fresh from "../components/Fresh";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDispatch } from "react-redux";
import {
  useLazyUserTransactionsQuery, useUserActionMutation, useUserQuery,
} from "../store/api";
import { pushToast } from "../store/uiSlice";
import {
  Card, Empty, ErrorBox, Kpi, Loading, Tag, useConfirm,
} from "../components/common";
import { day, som, usd } from "../lib/format";

export default function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  // Izohlar alohida so'raladi — shu bosish serverda jurnalga tushadi.
  const [msgOpen, setMsgOpen] = useState(false);
  const [loadNotes, { data: notesData, isFetching: notesLoading }] =
    useLazyUserTransactionsQuery();
  const notes = notesData?.items || null;
  const { data, isLoading, error, refetch, fulfilledTimeStamp } =
    useUserQuery(id, { pollingInterval: 25000 });
  const [act, { isLoading: acting }] = useUserActionMutation();
  const [ask, confirmDialog] = useConfirm();

  const [planCode, setPlanCode] = useState("");
  const [trialDays, setTrialDays] = useState(7);
  const [message, setMessage] = useState("");

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const u = data.user;
  const plans = data.plans;
  const chosenPlan = planCode || plans[0]?.code;

  async function run(body, { confirm, danger, after } = {}) {
    if (confirm && !(await ask(confirm, danger))) return;
    try {
      const res = await act({ id: Number(id), ...body }).unwrap();
      dispatch(pushToast(res.message || "Bajarildi."));
      after?.(res);
    } catch (err) {
      dispatch(pushToast(err?.data?.detail || "Xatolik yuz berdi.", "bad"));
    }
  }

  return (
    <>
      {confirmDialog}

      <div className="inline" style={{ marginBottom: 14 }}>
        <Link className="btn" to="/foydalanuvchilar">
          ← Ro'yxatga
        </Link>
        <h2 style={{ margin: 0, fontSize: 19 }}>{u.first_name || "Nomsiz"}</h2>
        <span className="spacer" />
        <Fresh at={fulfilledTimeStamp} />
      </div>

      <div className="kpis">
        <Kpi
          label="Holat"
          value={<Tag kind={u.state}>{u.state}</Tag>}
          sub={u.days_left != null ? `${u.days_left} kun qoldi` : "muddat yo'q"}
        />
        <Kpi
          label="Telegram ID"
          value={<span style={{ fontFamily: "var(--mono)", fontSize: 20 }}>{u.user_id}</span>}
          sub={u.username ? `@${u.username}` : "username yo'q"}
        />
        <Kpi label="Yozuvlari" value={u.tx_count} sub={`oxirgi faollik ${day(u.last_seen_at)}`} />
        <Kpi label="AI xarajati" value={usd(u.cost_usd)} sub={`ro'yxatdan ${day(u.created_at)}`} />
        <Kpi label="To'lagan" value={som(u.paid_total)} sub="so'm, jami" tone="good" />
      </div>

      <div className="grid3">
        <div>
          <Card title="Obunani boshqarish">
            <div className="pad">
              <div className="row">
                <label className="fld grow" style={{ margin: 0 }}>
                  <span>Tarif</span>
                  <select value={chosenPlan} onChange={(e) => setPlanCode(e.target.value)}>
                    {plans.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.label} — {som(p.price)} so'm ({p.days} kun)
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn pri"
                  disabled={acting}
                  onClick={() =>
                    run(
                      { amal: "obuna", plan_code: chosenPlan },
                      { confirm: "To'lov tushdimi? Obuna darhol faollashadi va foydalanuvchiga xabar boradi." }
                    )
                  }
                >
                  Obuna berish
                </button>
              </div>
              <p className="hint">
                Muddat mavjud obuna ustiga qo'shiladi. To'lov avtomatik qayd
                etiladi va foydalanuvchiga Telegram orqali xabar boradi.
              </p>

              <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "16px 0" }} />

              <div className="row">
                <label className="fld" style={{ margin: 0, width: 130 }}>
                  <span>Sinov, kun</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={trialDays}
                    onChange={(e) => setTrialDays(Number(e.target.value))}
                  />
                </label>
                <button
                  className="btn"
                  disabled={acting}
                  onClick={() => run({ amal: "sinov", kun: trialDays })}
                >
                  Sinovni uzaytirish
                </button>

                <button
                  className="btn"
                  disabled={acting}
                  onClick={() => run({ amal: "bekor" }, { confirm: "Obuna bekor qilinsinmi?" })}
                >
                  Obunani bekor qilish
                </button>

                {u.blocked ? (
                  <button
                    className="btn ok"
                    disabled={acting}
                    onClick={() => run({ amal: "ochish" })}
                  >
                    Blokdan chiqarish
                  </button>
                ) : (
                  <button
                    className="btn dan"
                    disabled={acting}
                    onClick={() =>
                      run(
                        { amal: "bloklash" },
                        { confirm: "Bloklansinmi? Foydalanuvchi botdan foydalana olmaydi.", danger: true }
                      )
                    }
                  >
                    Bloklash
                  </button>
                )}
              </div>
            </div>
          </Card>

          <Card
            title="Yozuvlari"
            action={
              notes ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  ochildi · jurnalga yozildi
                </span>
              ) : (
                <button
                  className="btn sm"
                  disabled={notesLoading || u.tx_count === 0}
                  onClick={() => loadNotes(id)}
                >
                  {notesLoading ? "Yuklanmoqda…" : "Ochib ko'rish"}
                </button>
              )
            }
          >
            {!notes ? (
              /* Yozuvlar YOPIQ turadi: sana, kategoriya va summaning
                 o'zi ham shaxsiy moliya. Kundalik ish uchun soni
                 yetarli — ro'yxatni ochish ongli harakat bo'lsin. */
              <div className="pad">
                <p style={{ margin: "0 0 6px", fontSize: 15 }}>
                  <b>{u.tx_count}</b> ta yozuv
                </p>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {u.tx_count === 0
                    ? "Foydalanuvchi hali hech narsa yozmagan."
                    : "Yozuvlar foydalanuvchining shaxsiy moliyasi — sana, " +
                      "kategoriya va summa ham shunga kiradi. Ro'yxatni " +
                      "ochsangiz, bu jurnalga yoziladi."}
                </p>
              </div>
            ) : (
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sana</th>
                      <th>Turi</th>
                      <th>Kategoriya</th>
                      <th>Izoh</th>
                      <th className="num">Summa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.length === 0 && <Empty colSpan={5}>Yozuv yo'q.</Empty>}
                    {notes.map((t) => (
                      <tr key={t.id}>
                        <td className="mono nowrap">{t.occurred_on}</td>
                        <td>{t.kind}</td>
                        <td>{t.category}</td>
                        <td className="muted">{(t.note || "").slice(0, 48)}</td>
                        <td className="num">
                          {t.currency === "usd" ? usd(t.amount) : som(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            title="Shaxsiy xabar yuborish"
            action={
              <button className="btn sm" onClick={() => setMsgOpen((v) => !v)}>
                {msgOpen ? "Yopish" : "Ochish"}
              </button>
            }
          >
            <div className="pad" hidden={!msgOpen}>
              <label className="fld">
                <span>Matn (HTML: &lt;b&gt; &lt;i&gt; &lt;code&gt;)</span>
                <textarea
                  value={message}
                  maxLength={3000}
                  placeholder="Salom! ..."
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <button
                className="btn pri"
                disabled={acting || !message.trim()}
                onClick={() =>
                  run({ amal: "xabar", matn: message }, { after: () => setMessage("") })
                }
              >
                Telegramga yuborish
              </button>
            </div>
          </Card>

        </div>

        <div>
          <Card title="AI sarfi">
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Amal</th>
                    <th className="num">Soni</th>
                    <th className="num">Narx</th>
                  </tr>
                </thead>
                <tbody>
                  {u.usage.length === 0 && <Empty colSpan={3}>Sarf yo'q.</Empty>}
                  {u.usage.map((x) => (
                    <tr key={x.operation}>
                      <td>{x.operation}</td>
                      <td className="num">{x.calls}</td>
                      <td className="num">{usd(x.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="To'lovlar tarixi">
            {u.payments.length === 0 ? (
              <p className="pad muted" style={{ margin: 0 }}>Hali to'lov qilmagan.</p>
            ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sana</th>
                    <th>Tarif</th>
                    <th className="num">Summa</th>
                  </tr>
                </thead>
                <tbody>
                  {u.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="mono nowrap">{day(p.created_at)}</td>
                      <td>{p.plan_code}</td>
                      <td className="num">{som(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </Card>

          <Card title="So'rovlari">
            {u.requests.length === 0 ? (
              <p className="pad muted" style={{ margin: 0 }}>So'rov yubormagan.</p>
            ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sana</th>
                    <th>Tarif</th>
                    <th>Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {u.requests.map((r) => (
                    <tr key={r.id}>
                      <td className="mono nowrap">{day(r.created_at)}</td>
                      <td>{r.plan_code}</td>
                      <td>
                        <Tag kind={r.status.replace(" ", "")}>{r.status}</Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </Card>

          <Card title="Xavfli hudud" className="danger-zone">
            <div className="pad">
              <p className="hint" style={{ marginTop: 0 }}>
                Foydalanuvchining barcha yozuvlari, sarf tarixi va hisobi
                butunlay o'chiriladi. Qaytarib bo'lmaydi.
              </p>
              <button
                className="btn dan"
                disabled={acting}
                onClick={() =>
                  run(
                    { amal: "ochirish" },
                    {
                      confirm: `${u.tx_count} ta yozuv va butun hisob o'chiriladi. Davom etilsinmi?`,
                      danger: true,
                      after: () => navigate("/foydalanuvchilar"),
                    }
                  )
                }
              >
                Hamma ma'lumotni o'chirish
              </button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
