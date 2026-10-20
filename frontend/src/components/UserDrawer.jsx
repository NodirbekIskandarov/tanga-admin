import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch } from "react-redux";
import { useUserActionMutation, useUserQuery } from "../store/api";
import { pushToast } from "../store/uiSlice";
import { Av, Fact, Facts, Loading, Modal, Tag } from "./common";
import { day, dt, som, tilNomi } from "../lib/format";

/**
 * Foydalanuvchi kartasi o'ng paneldan ochiladi.
 *
 * Nega alohida sahifa emas: admin ro'yxatni ko'zdan kechirib chiqadi va
 * har safar sahifa almashtirish filtr va aylantirish holatini yo'qotardi.
 * Panel yopilganda ro'yxat qayerda edi — o'sha yerda qoladi.
 */
export default function UserDrawer({ userId, onClose }) {
  const dispatch = useDispatch();
  const { data, isLoading } = useUserQuery(userId, { skip: !userId });
  const [act, { isLoading: acting }] = useUserActionMutation();
  const [confirm, setConfirm] = useState(null);
  const [plan, setPlan] = useState("");
  // «Ruxsat berish»: ixtiyoriy kun + chegara darajasi (PRO / sinov).
  const [grantDays, setGrantDays] = useState(1);
  const [grantLevel, setGrantLevel] = useState("pro");
  const [grantAmount, setGrantAmount] = useState(0);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !confirm && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirm]);

  if (!userId) return null;

  const u = data?.user;
  const plans = data?.plans || [];
  const chosen = plan || plans[0]?.code;

  async function run(body, after) {
    try {
      const res = await act({ id: Number(userId), ...body }).unwrap();
      dispatch(pushToast(res.message || "Bajarildi."));
      after?.();
    } catch (err) {
      dispatch(pushToast(err?.data?.detail || "Xatolik yuz berdi.", "bad"));
    }
  }

  return (
    <>
      {confirm && (
        <Modal
          title={confirm.title}
          sub={confirm.note}
          onClose={() => setConfirm(null)}
          z={40}
        >
          <div className="acts">
            <button className="btn" onClick={() => setConfirm(null)}>
              Bekor qilish
            </button>
            <button
              className="btn dan"
              autoFocus
              disabled={acting}
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                run(c.body, c.after);
              }}
            >
              {confirm.cta}
            </button>
          </div>
        </Modal>
      )}

      <div className="scrim right" role="dialog" aria-modal="true">
        <button className="away" onClick={onClose} aria-label="Yopish" />
        <aside className="drawer" onClick={(e) => e.stopPropagation()}>
          {isLoading || !u ? (
            <Loading />
          ) : (
            <>
              <header>
                <span className="who">
                  <Av name={u.first_name || u.username || "?"} seed={u.user_id} size="md" />
                  <span style={{ minWidth: 0 }}>
                    <span className="nm" style={{ fontSize: 16, fontWeight: 500 }}>
                      {u.first_name || "Nomsiz"}
                    </span>
                    <span className="meta">
                      {u.username ? `@${u.username} · ` : ""}ID {u.user_id}
                    </span>
                  </span>
                </span>
                <button className="icon-btn" onClick={onClose} aria-label="Yopish">
                  ×
                </button>
              </header>

              <div className="body">
                <Facts>
                  <Fact label="Holat" mono={false}>
                    <Tag kind={u.state}>{u.state}</Tag>
                  </Fact>
                  <Fact label="Obuna tugashi">
                    {day(u.subscribed_until || u.trial_ends_at)}
                  </Fact>
                  <Fact label="Yozuvlar">{u.tx_count}</Fact>
                  <Fact label="Oxirgi faollik">{day(u.last_seen_at)}</Fact>
                  <Fact label="Til" mono={false}>{tilNomi(u.lang)}</Fact>
                  <Fact label="Aloqa" mono={false}>
                    {u.bot_blocked
                      ? <Tag kind="bad">botni bloklagan</Tag>
                      : !u.consented
                        ? <Tag kind="warn">rozilik yo'q</Tag>
                        : "ochiq"}
                  </Fact>
                </Facts>

                <div className="group">
                  <div className="lbl">To'lov tarixi</div>
                  {u.payments.length === 0 ? (
                    <p className="hint" style={{ margin: 0 }}>Hali to'lov qilmagan.</p>
                  ) : (
                    u.payments.map((p) => (
                      <div className="line" key={p.id}>
                        <span className="mono muted">{day(p.created_at)}</span>
                        <span>{p.plan_code}</span>
                        <span className="mono" style={{ color: "var(--brass)" }}>
                          {som(p.amount)}
                        </span>
                        <Tag kind="ok">Tasdiqlangan</Tag>
                      </div>
                    ))
                  )}
                </div>

                {u.requests.length > 0 && (
                  <div className="group">
                    <div className="lbl">So'rovlari</div>
                    {u.requests.map((r) => (
                      <div className="line" key={r.id}>
                        <span className="mono muted">{day(r.created_at)}</span>
                        <span>{r.plan_code}</span>
                        <span className="spacer" />
                        <Tag kind={String(r.status).replace(" ", "")}>{r.status}</Tag>
                      </div>
                    ))}
                  </div>
                )}

                <div className="group bordered">
                  <div className="lbl">Ruxsat berish (ixtiyoriy muddat)</div>
                  <div className="row">
                    <input
                      type="number"
                      className="mono"
                      min={1}
                      max={3650}
                      style={{ width: 84 }}
                      value={grantDays}
                      onChange={(e) => setGrantDays(Number(e.target.value))}
                      aria-label="Necha kun"
                    />
                    <span className="muted">kun</span>
                    <select
                      value={grantLevel}
                      onChange={(e) => setGrantLevel(e.target.value)}
                      aria-label="Qaysi chegarada"
                    >
                      <option value="pro">PRO — to'liq</option>
                      <option value="sinov">Sinov — cheklangan</option>
                    </select>
                  </div>
                  {grantLevel === "pro" && (
                    <div className="row">
                      <input
                        type="number"
                        className="mono"
                        min={0}
                        style={{ width: 120 }}
                        value={grantAmount}
                        onChange={(e) => setGrantAmount(Math.max(0, Number(e.target.value) || 0))}
                        aria-label="Tushgan summa"
                      />
                      <span className="muted">so'm tushgan (0 — sovg'a)</span>
                    </div>
                  )}
                  <div className="row">
                    <button
                      className="btn pri"
                      disabled={acting || !(grantDays >= 1 && grantDays <= 3650)}
                      onClick={() =>
                        setConfirm({
                          title: `${grantDays} kunlik ${grantLevel === "pro" ? "PRO" : "sinov"} ruxsati beriladimi?`,
                          note:
                            grantLevel === "pro"
                              ? (grantAmount > 0
                                  ? `${som(grantAmount)} so'm daromadga yoziladi. `
                                  : "Sovg'a: daromadga hech narsa yozilmaydi. ") +
                                "Foydalanuvchiga xabar boradi."
                              : "Jami chek soni cheklangan. Foydalanuvchiga xabar boradi.",
                          cta: "Ruxsat berish",
                          body: {
                            amal: "ruxsat",
                            kun: grantDays,
                            daraja: grantLevel,
                            ...(grantLevel === "pro" ? { summa: grantAmount } : {}),
                          },
                        })
                      }
                    >
                      Ruxsat berish
                    </button>
                  </div>
                </div>

                <div className="group bordered">
                  <div className="lbl">Amallar</div>
                  <div className="row">
                    <select value={chosen} onChange={(e) => setPlan(e.target.value)}>
                      {plans.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.label} — {som(p.price)} so'm
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn"
                      disabled={acting}
                      onClick={() =>
                        setConfirm({
                          title: "To'lov tushdimi?",
                          note: "Obuna darhol faollashadi va foydalanuvchiga xabar boradi.",
                          cta: "Obunani uzaytirish",
                          body: {
                            amal: "obuna", plan_code: chosen,
                            // Tezkor tugma: tarif narxi to'langan deb yoziladi.
                            // Sovg'a yoki boshqa summa — foydalanuvchi sahifasida.
                            summa: plans.find((p) => p.code === chosen)?.price ?? 0,
                          },
                        })
                      }
                    >
                      Obunani uzaytirish
                    </button>
                  </div>
                  <div className="row">
                    <a className="btn" href="/api/export/users.csv">CSV yuklab olish</a>
                    {u.blocked ? (
                      <button className="btn ok" disabled={acting}
                              onClick={() => run({ amal: "ochish" })}>
                        Blokdan chiqarish
                      </button>
                    ) : (
                      <button
                        className="btn dan"
                        disabled={acting}
                        onClick={() =>
                          setConfirm({
                            title: `${u.first_name || "Foydalanuvchi"} bloklansinmi?`,
                            note: "Botdan foydalana olmaydi, obunasi to'xtaydi.",
                            cta: "Bloklash",
                            body: { amal: "bloklash" },
                          })
                        }
                      >
                        Bloklash
                      </button>
                    )}
                    <button
                      className="btn ghost dan"
                      disabled={acting}
                      onClick={() =>
                        setConfirm({
                          title: `${u.first_name || "Foydalanuvchi"} ma'lumoti o'chirilsinmi?`,
                          note: `${u.tx_count} ta yozuv va butun hisob qaytarib bo'lmaydigan tarzda o'chiriladi.`,
                          cta: "O'chirish",
                          body: { amal: "ochirish" },
                          after: onClose,
                        })
                      }
                    >
                      Ma'lumotni o'chirish
                    </button>
                  </div>
                  <Link className="more" to={`/foydalanuvchilar/${u.user_id}`}>
                    To'liq profil — yozuvlar, AI sarfi, shaxsiy xabar →
                  </Link>
                </div>

                <p className="hint" style={{ margin: 0 }}>
                  Ro'yxatdan {dt(u.created_at)}
                </p>
              </div>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
