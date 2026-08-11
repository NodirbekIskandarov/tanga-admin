import { useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useDecideRequestMutation, useRequestsQuery } from "../store/api";
import { pushToast, setRequestFilter } from "../store/uiSlice";
import {
  Card, Empty, ErrorBox, Lightbox, Loading, Tag, useConfirm,
} from "../components/common";
import { dt, som } from "../lib/format";

const FILTERS = [
  ["ochiq", "Javob kutmoqda"],
  ["tekshiruvda", "Cheki kelgan"],
  ["tasdiqlandi", "Tasdiqlangan"],
  ["rad etildi", "Rad etilgan"],
  ["", "Hammasi"],
];

const TAGS = {
  kutilmoqda: "kutilmoqda",
  tekshiruvda: "tekshiruvda",
  tasdiqlandi: "tasdiqlandi",
  "rad etildi": "rad",
};

function RequestCard({ req, onDecide, busy }) {
  const [reason, setReason] = useState("");
  const [zoom, setZoom] = useState(false);
  const open = req.status === "kutilmoqda" || req.status === "tekshiruvda";
  const proofUrl = `/api/requests/${req.id}/proof`;

  return (
    <>
      <Lightbox src={zoom ? proofUrl : null} onClose={() => setZoom(false)} />
      <section className={`card req ${req.status === "tekshiruvda" ? "live" : ""}`}>
        <h2>
          <Tag kind={TAGS[req.status]}>
            {req.status === "tekshiruvda" ? "chek keldi" : req.status}
          </Tag>
          <span style={{ fontFamily: "var(--sans)", textTransform: "none", letterSpacing: 0, color: "var(--ink)" }}>
            #{req.id}
          </span>
          <span className="spacer" />
          <span style={{ fontFamily: "var(--sans)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
            {dt(req.created_at)}
          </span>
        </h2>

        <div className="req-body">
          <div className="req-info">
            <dl>
              <dt>Foydalanuvchi</dt>
              <dd>
                <Link to={`/foydalanuvchilar/${req.user_id}`}>
                  <b>{req.first_name || "Nomsiz"}</b>
                </Link>
                {req.username && <span className="muted"> @{req.username}</span>}
              </dd>

              <dt>Telegram ID</dt>
              <dd className="mono">{req.user_id}</dd>

              <dt>Tarif</dt>
              <dd>
                <b>{req.plan_code}</b> — {som(req.price)} so'm
              </dd>

              <dt>Chek</dt>
              <dd>
                {req.proof_file_id ? (
                  <>
                    ✅ {req.proof_kind === "pdf" ? "PDF" : "rasm"} · {dt(req.proof_at)}
                  </>
                ) : (
                  <span style={{ color: "var(--warn)" }}>⏳ hali kelmagan</span>
                )}
              </dd>

              {req.decided_by && (
                <>
                  <dt>Hal qilgan</dt>
                  <dd>
                    {req.decided_by} · {dt(req.decided_at)}
                  </dd>
                </>
              )}
              {req.note && (
                <>
                  <dt>Izoh</dt>
                  <dd>{req.note}</dd>
                </>
              )}
            </dl>

            {open && (
              <div className="req-actions">
                <button
                  className="btn ok"
                  disabled={busy}
                  onClick={() => onDecide(req, "tasdiq")}
                >
                  ✓ Tasdiqlash — obunani yoqish
                </button>
                <div className="reject">
                  <input
                    type="text"
                    maxLength={200}
                    placeholder="Rad etish sababi (foydalanuvchiga ko'rinadi)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <button
                    className="btn dan"
                    disabled={busy}
                    onClick={() => onDecide(req, "rad", reason)}
                  >
                    ✕ Rad etish
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="req-proof">
            {req.proof_file_id && req.proof_kind === "pdf" ? (
              // PDF chekni <img> ko'rsata olmaydi — brauzerning o'z
              // ko'ruvchisiga beramiz.
              <>
                <object
                  data={proofUrl}
                  type="application/pdf"
                  className="pdf-proof"
                  aria-label="To'lov cheki (PDF)"
                >
                  <div className="no-proof">
                    <div style={{ fontSize: 30 }}>📄</div>
                    <div>PDF chek</div>
                  </div>
                </object>
                <a
                  className="btn sm"
                  href={proofUrl}
                  target="_blank"
                  rel="noopener"
                  style={{ justifyContent: "center" }}
                >
                  📄 PDF ni ochish
                </a>
              </>
            ) : req.proof_file_id ? (
              <>
                <img
                  src={proofUrl}
                  alt="To'lov cheki"
                  loading="lazy"
                  style={{ cursor: "zoom-in" }}
                  onClick={() => setZoom(true)}
                />
                <div className="hint" style={{ textAlign: "center" }}>
                  Kattalashtirish uchun bosing
                </div>
              </>
            ) : (
              <div className="no-proof">
                <div style={{ fontSize: 30 }}>🧾</div>
                <div>
                  Chek hali
                  <br />
                  yuborilmagan
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

export default function Requests() {
  const dispatch = useDispatch();
  const filter = useSelector((s) => s.ui.requestFilter);
  const { data, isFetching, error, refetch } = useRequestsQuery(filter);
  const [decide, { isLoading: busy }] = useDecideRequestMutation();
  const [ask, confirmDialog] = useConfirm();

  async function onDecide(req, qaror, sabab = "") {
    if (qaror === "tasdiq") {
      const ok = await ask(
        `To'lov haqiqatan tushdimi? ${req.plan_code} obunasi darhol ` +
          `faollashadi va foydalanuvchiga xabar boradi.`
      );
      if (!ok) return;
    }
    try {
      const res = await decide({ id: req.id, qaror, sabab }).unwrap();
      dispatch(pushToast(res.message));
    } catch (err) {
      dispatch(pushToast(err?.data?.detail || "Xatolik yuz berdi.", "bad"));
    }
  }

  return (
    <>
      {confirmDialog}

      <Card>
        <div className="pad">
          <div className="row">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                className={`btn ${filter === value ? "pri" : ""}`}
                onClick={() => dispatch(setRequestFilter(value))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {error && <ErrorBox error={error} onRetry={refetch} />}
      {isFetching && !data && <Loading />}

      {data?.items.length === 0 && (
        <Card>
          <Empty>Bu bo'limda so'rov yo'q.</Empty>
        </Card>
      )}

      {data?.items.map((req) => (
        <RequestCard key={req.id} req={req} onDecide={onDecide} busy={busy} />
      ))}

      <div className="note">
        <b>Qanday ishlaydi.</b> Foydalanuvchi botda tarif tanlaydi → karta
        rekvizitlarini oladi → pul o'tkazadi → chek skrinshotini yuboradi.
        Chek shu yerda ko'rinadi. «Tasdiqlash» bosilganda obuna darhol
        faollashadi, to'lov moliya hisobotiga tushadi va foydalanuvchiga
        Telegram orqali xabar boradi.
      </div>
    </>
  );
}
