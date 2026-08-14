import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch } from "react-redux";
import { useDecideRequestMutation, useRequestsQuery } from "../store/api";
import { pushToast } from "../store/uiSlice";
import Fresh from "../components/Fresh";
import {
  Av, Card, Empty, ErrorBox, Fact, Facts, Kbd, Kpi, Lightbox, Loading, Modal,
} from "../components/common";
import { dt, som } from "../lib/format";

// Tayyor sabablar — eng ko'p uchraydigan uchtasi va o'z matni.
// Sabab foydalanuvchiga o'zgarishsiz yuboriladi, shuning uchun matni
// aniq va ayblovsiz.
const REASONS = ["Summa mos emas", "Chek o'qilmadi", "Takroriy chek"];

const HINTS = [
  ["J / K", "keyingi / oldingi chek"],
  ["A", "tasdiqlash"],
  ["R", "rad etish"],
  ["Space", "rasmni kattalashtirish"],
  ["?", "yorliqlar ro'yxati"],
];

/** 24 soatdan oshgan chek — javob kechikkan, ko'zga tashlansin. */
const LATE_HOURS = 24;

function waitedHours(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3600000);
}

function waited(iso) {
  const h = waitedHours(iso);
  if (h < 1) return `${Math.round(h * 60)} daqiqa`;
  if (h < 24) return `${Math.floor(h)} soat`;
  return `${Math.floor(h / 24)} kun ${Math.floor(h % 24)} soat`;
}

function history(req) {
  if (!req.paid_count) return "birinchi to'lov";
  const times = `${req.paid_count} marta`;
  return req.rejected_count
    ? `${times} · ${req.rejected_count} chek rad etilgan`
    : `${times} · muammosiz`;
}

function Proof({ req, onZoom }) {
  const url = `/api/requests/${req.id}/proof`;

  if (!req.proof_file_id) {
    return (
      <div className="shot">
        <div className="ph">
          Chek hali
          <br />
          yuborilmagan
        </div>
      </div>
    );
  }

  if (req.proof_kind === "pdf") {
    // PDF ni <img> ko'rsata olmaydi — brauzerning o'z ko'ruvchisiga beramiz.
    return (
      <>
        <object data={url} type="application/pdf" className="pdf-proof"
                aria-label="To'lov cheki (PDF)">
          <div className="ph">PDF chek</div>
        </object>
        <a className="btn sm" href={url} target="_blank" rel="noopener">
          PDF ni alohida ochish
        </a>
      </>
    );
  }

  return (
    <button className="shot" onClick={onZoom} title="Kattalashtirish — Space">
      <img src={url} alt="To'lov cheki" loading="lazy" />
    </button>
  );
}

export default function Payments() {
  const dispatch = useDispatch();
  // Admin bu ekranda chekni KUTIB o'tiradi — eng tez yangilanish shu yerda.
  const { data, isFetching, error, refetch, fulfilledTimeStamp } =
    useRequestsQuery("ochiq", { pollingInterval: 12000 });
  const [decide, { isLoading: busy }] = useDecideRequestMutation();

  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [other, setOther] = useState("");
  const [help, setHelp] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const items = useMemo(() => data?.items || [], [data]);
  const ov = data?.overview;
  const current = items[Math.min(index, items.length - 1)] || null;

  // Ro'yxat qisqarsa (chek hal qilindi) — ko'rsatkich chegaradan chiqmasin.
  useEffect(() => {
    setIndex((i) => (items.length ? Math.min(i, items.length - 1) : 0));
  }, [items.length]);

  const longest = useMemo(() => {
    if (!items.length) return null;
    return items.reduce((a, b) =>
      waitedHours(a.created_at) > waitedHours(b.created_at) ? a : b);
  }, [items]);

  function move(step) {
    if (!items.length) return;
    setIndex((i) => (i + step + items.length) % items.length);
    setZoom(false);
  }

  async function send(req, qaror, sabab = "") {
    try {
      const res = await decide({ id: req.id, qaror, sabab }).unwrap();
      dispatch(pushToast(res.message, qaror === "tasdiq" ? "ok" : "bad"));
    } catch (err) {
      dispatch(pushToast(err?.data?.detail || "Xatolik yuz berdi.", "bad"));
    }
  }

  function onReject(reason) {
    setRejecting(false);
    setOther("");
    if (current) send(current, "rad", reason);
  }

  // Klaviatura yorliqlari: navbatda o'nlab chek bo'lganda sichqonchaga
  // qaytish har safar bir necha soniya yeydi.
  useEffect(() => {
    function onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape") {
        setZoom(false);
        setRejecting(false);
        setHelp(false);
        setConfirming(null);
        return;
      }
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "?") return setHelp(true);
      if (!current || rejecting || confirming) return;
      const k = e.key.toLowerCase();
      if (k === "j") { e.preventDefault(); move(1); }
      else if (k === "k") { e.preventDefault(); move(-1); }
      else if (k === "a") { e.preventDefault(); setConfirming(current); }
      else if (k === "r") { e.preventDefault(); setRejecting(true); }
      else if (e.key === " ") { e.preventDefault(); setZoom((z) => !z); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const withProof = items.filter((r) => r.proof_file_id).length;
  const lateNow = longest && waitedHours(longest.created_at) >= LATE_HOURS;

  return (
    <>
      <Lightbox
        src={zoom && current?.proof_file_id && current.proof_kind !== "pdf"
          ? `/api/requests/${current.id}/proof`
          : null}
        onClose={() => setZoom(false)}
      />

      {confirming && (
        <Modal
          title={`${confirming.first_name || "Foydalanuvchi"} — ${confirming.plan_code} obunasi faollashtirilsinmi?`}
          sub="Obuna darhol yoqiladi va foydalanuvchiga Telegram orqali xabar boradi."
          onClose={() => setConfirming(null)}
          z={40}
        >
          <div className="acts">
            <button className="btn" onClick={() => setConfirming(null)}>
              Bekor qilish
            </button>
            <button
              className="btn ok"
              autoFocus
              disabled={busy}
              onClick={() => { const r = confirming; setConfirming(null); send(r, "tasdiq"); }}
            >
              Tasdiqlash
            </button>
          </div>
        </Modal>
      )}

      {rejecting && current && (
        <Modal
          title="Rad etish sababi"
          sub="Sabab foydalanuvchiga o'zgarishsiz yuboriladi."
          onClose={() => setRejecting(false)}
        >
          <div className="reasons">
            {REASONS.map((r) => (
              <button key={r} className="choice" onClick={() => onReject(r)}>
                {r}
              </button>
            ))}
          </div>
          <label className="fld" style={{ margin: 0 }}>
            <span>Boshqa sabab</span>
            <input
              type="text"
              maxLength={200}
              autoFocus
              placeholder="O'z so'zingiz bilan"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && other.trim() && onReject(other.trim())}
            />
          </label>
          <div className="acts">
            <button className="btn" onClick={() => setRejecting(false)}>
              Bekor qilish
            </button>
            <button className="btn dan" disabled={!other.trim()}
                    onClick={() => onReject(other.trim())}>
              Rad etish
            </button>
          </div>
        </Modal>
      )}

      {help && (
        <Modal title="Klaviatura yorliqlari" onClose={() => setHelp(false)} width={360} z={60}>
          <div className="keylist">
            {HINTS.map(([key, what]) => (
              <div key={key}>
                <span>{what}</span>
                <Kbd>{key}</Kbd>
              </div>
            ))}
          </div>
          <div className="acts">
            <button className="btn" onClick={() => setHelp(false)}>Yopish</button>
          </div>
        </Modal>
      )}

      <div className="kpis">
        <Kpi
          label="Faol obuna"
          value={ov ? ov.states.obunachi : "—"}
          sub={ov ? `konversiya ${ov.conversion}%` : ""}
          tone="good"
        />
        <Kpi
          label="Sinov muddatida"
          value={ov ? ov.states.sinov : "—"}
          sub={ov ? `${ov.states.tugagan} tasining muddati tugagan` : ""}
        />
        <Kpi
          label="Oylik daromad"
          value={ov ? som(ov.revenue_month) : "—"}
          sub={ov ? `jami ${som(ov.revenue_all)} so'm` : ""}
          tone="brass"
        />
        <Kpi
          label="Kutayotgan chek"
          value={items.length}
          sub={longest ? `eng uzoq kutgani — ${waited(longest.created_at)}` : "navbat bo'sh"}
          tone={items.length ? (lateNow ? "bad" : "warn") : "good"}
        />
      </div>

      {error && <ErrorBox error={error} onRetry={refetch} />}
      {isFetching && !data && <Loading />}

      {current && (
        <Card
          title="Chekni ko'rish"
          action={
            <div className="row">
              <span className="mono muted">
                {Math.min(index, items.length - 1) + 1} / {items.length}
              </span>
              <button className="btn sm mono" onClick={() => move(-1)} title="Oldingi — K">K</button>
              <button className="btn sm mono" onClick={() => move(1)} title="Keyingi — J">J</button>
            </div>
          }
        >
          <div className="review">
            <div className="shots">
              <Proof req={current} onZoom={() => setZoom(true)} />
              {current.proof_file_id && current.proof_kind !== "pdf" && (
                <div className="hint">
                  Kattalashtirish — <Kbd>Space</Kbd>
                </div>
              )}
            </div>

            <div className="facts-side">
              <div className="who">
                <Av name={current.first_name || current.username || "?"}
                    seed={current.user_id} size="lg" />
                <div style={{ minWidth: 0 }}>
                  <div className="name">{current.first_name || "Nomsiz"}</div>
                  <div className="meta">
                    {current.username ? `@${current.username} · ` : ""}ID {current.user_id}
                  </div>
                </div>
              </div>

              <Facts>
                <Fact label="Tarif va summa">
                  <b style={{ color: "var(--brass)" }}>
                    {current.plan_code} · {som(current.price)} so'm
                  </b>
                </Fact>
                <Fact label="Yuborilgan">
                  <span style={waitedHours(current.created_at) >= LATE_HOURS
                    ? { color: "var(--danger)" } : undefined}>
                    {waited(current.created_at)} oldin
                  </span>
                </Fact>
                <Fact label="Oldingi obuna">{history(current)}</Fact>
                <Fact label="Yozuvlari">
                  {current.tx_count} ta
                  {current.member_days != null && ` · ${current.member_days} kun`}
                </Fact>
              </Facts>

              {current.proof_file_id ? null : (
                <div className="note warn">
                  <span className="grow">
                    Chek hali yuborilmagan — foydalanuvchi tarifni tanlagan,
                    lekin to'lov suratini jo'natmagan.
                  </span>
                </div>
              )}

              <div className="row">
                <button className="btn ok lg" disabled={busy}
                        onClick={() => setConfirming(current)}>
                  Tasdiqlash
                </button>
                <button className="btn dan lg" disabled={busy}
                        onClick={() => setRejecting(true)}>
                  Rad etish
                </button>
                <Link className="btn lg" to={`/foydalanuvchilar/${current.user_id}`}>
                  Profil
                </Link>
              </div>

              <div className="keys">
                {HINTS.map(([key, what]) => (
                  <span key={key}>
                    <Kbd>{key}</Kbd>
                    {what}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {!current && !isFetching && (
        <Card>
          <Empty title="Navbatda chek yo'q">Barcha to'lovlar ko'rib chiqilgan.</Empty>
        </Card>
      )}

      <Card
        title="Navbat"
        action={
          <>
            <span className="muted" style={{ fontSize: 13 }}>
              cheki kelgan — <span className="mono">{withProof}</span>
            </span>
            <span className="spacer" />
            <Fresh at={fulfilledTimeStamp} busy={isFetching} />
          </>
        }
      >
        {items.length === 0 ? (
          <Empty title="Navbat bo'sh">Yangi so'rov kelganda shu yerda ko'rinadi.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ism</th>
                  <th>Tarif va summa</th>
                  <th className="num">Kutish muddati</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r, i) => {
                  const late = waitedHours(r.created_at) >= LATE_HOURS;
                  return (
                    <tr
                      key={r.id}
                      className="click"
                      aria-selected={i === index}
                      style={i === index ? { background: "var(--sunken)" } : undefined}
                      onClick={() => { setIndex(i); setZoom(false); }}
                    >
                      <td>
                        <span className="who">
                          <Av name={r.first_name || r.username || "?"} seed={r.user_id} />
                          <span style={{ minWidth: 0 }}>
                            <span className="nm">{r.first_name || "Nomsiz"}</span>
                            <span className="meta">
                              {r.username ? `@${r.username}` : `ID ${r.user_id}`}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="mono">
                        {r.plan_code} · <b style={{ color: "var(--brass)" }}>{som(r.price)}</b>
                        {!r.proof_file_id && (
                          <span className="muted"> · chek yo'q</span>
                        )}
                      </td>
                      <td className="num" style={late ? { color: "var(--danger)" } : undefined}>
                        {waited(r.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
