import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  useBroadcastInfoQuery,
  useBroadcastJobQuery,
  useSendBroadcastMutation,
} from "../store/api";
import { pushToast, setBroadcastLang } from "../store/uiSlice";
import { Card, ErrorBox, Loading, Modal, Seg } from "../components/common";

const LIMIT = 3500;

/**
 * Telegram HTML ni ko'rinishga aylantirish.
 *
 * Ataylab `dangerouslySetInnerHTML` ishlatilmaydi: matn adminning
 * o'zidan kelsa ham, uni HTML sifatida sahifaga qo'yish keraksiz xavf.
 * Teglar olib tashlanadi — ko'rinishda qalin/qiya bo'lmaydi, lekin
 * uzunligi va satrlari to'g'ri ko'rinadi.
 */
function preview(text) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export default function Broadcast() {
  const dispatch = useDispatch();
  const lang = useSelector((s) => s.ui.broadcastLang);
  const { data, isLoading, error, refetch } = useBroadcastInfoQuery();
  const [send, { isLoading: sending }] = useSendBroadcastMutation();
  const [segment, setSegment] = useState("hammasi");
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);

  // Yuborish serverda fonda ketadi; holatni shu yerda so'rab turamiz.
  const [pollMs, setPollMs] = useState(0);
  const { data: jobData } = useBroadcastJobQuery(undefined, { pollingInterval: pollMs });
  const job = jobData?.job;
  const running = !!job && !job.done;
  const watching = useRef(null);
  useEffect(() => { setPollMs(running ? 1500 : 0); }, [running]);
  useEffect(() => {
    if (!job) return;
    if (!job.done) { watching.current = job.id; return; }
    // Biz kuzatgan yuborish tugadi — yakuniy natijani bir marta aytamiz.
    if (watching.current === job.id) {
      watching.current = null;
      dispatch(pushToast(
        `Yuborish tugadi: ${job.ok} ta yuborildi, ${job.failed} ta yuborilmadi.`));
    }
  }, [job, dispatch]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const { segments, langs, byLang } = data;
  const counts = byLang?.[lang] || data.counts;
  const total = counts?.[segment] ?? 0;
  const langOptions = Object.entries(langs).map(([code, label]) => [code, label]);

  async function onSend() {
    setAsking(false);
    try {
      const res = await send({ segment, matn: text, til: lang, tasdiq: true }).unwrap();
      dispatch(pushToast(res.message));
      watching.current = res.job?.id ?? null;
      setText("");
    } catch (err) {
      dispatch(pushToast(err?.data?.detail || "Yuborib bo'lmadi.", "bad"));
    }
  }

  return (
    <>
      {asking && (
        <Modal
          title={`${total} kishiga yuborilsinmi?`}
          sub={`${segments[segment]} · ${langs[lang]}. Xabar darhol yuborila boshlaydi va qaytarib olib bo'lmaydi.`}
          onClose={() => setAsking(false)}
        >
          <div className="acts">
            <button className="btn" onClick={() => setAsking(false)}>Bekor qilish</button>
            <button className="btn pri" autoFocus disabled={sending} onClick={onSend}>
              Yuborish
            </button>
          </div>
        </Modal>
      )}

      {job && (
        <Card title={running ? "Yuborilmoqda…" : "Oxirgi yuborish"}>
          <div className="pad stack-sm">
            <div className="inline mono" style={{ fontSize: 13 }}>
              <span>{job.sent} / {job.total}</span>
              <span className="spacer" />
              <span className="muted">{job.target}</span>
            </div>
            <div className="meter">
              <span style={{ width: `${Math.min(100, (100 * job.sent) / Math.max(1, job.total))}%` }} />
            </div>
            <p className="hint" style={{ margin: 0 }}>
              Yuborildi <span className="mono">{job.ok}</span> · yuborilmadi{" "}
              <span className="mono">{job.failed}</span>
              {job.error ? ` · xato: ${job.error}` : ""}
              {Object.entries(job.errors || {}).slice(0, 3).map(([msg, n]) => (
                <span key={msg} className="muted"> · {msg} ({n})</span>
              ))}
            </p>
          </div>
        </Card>
      )}

      <div className="grid3">
        <Card>
          <div className="pad stack-sm">
            <Seg
              options={langOptions}
              value={lang}
              onChange={(v) => dispatch(setBroadcastLang(v))}
            />

            <textarea
              maxLength={LIMIT}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Xabar matni"
            />

            <div className="fld" style={{ margin: 0 }}>
              <span>Qabul qiluvchilar</span>
              <div className="row">
                {Object.entries(segments).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`chip ${segment === key ? "on" : ""}`}
                    onClick={() => setSegment(key)}
                  >
                    {label} · {counts[key]}
                  </button>
                ))}
              </div>
            </div>

            <p className="hint" style={{ margin: 0 }}>
              HTML teglari ishlaydi: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>,{" "}
              <code>&lt;code&gt;</code>, <code>&lt;a href&gt;</code>. Qolgan
              belgilar: <span className="mono">{LIMIT - text.length}</span>. Til
              tanlansa, xabar faqat botda o'sha tilni tanlaganlarga boradi.
              Bloklanganlar, botni bloklaganlar va shartlarga rozilik
              bermaganlar sanoqqa kirmaydi.
            </p>

            <div className="inline bordered-top">
              <span className="muted" style={{ fontSize: 13 }}>
                <span className="mono" style={{ color: "var(--text)" }}>{total}</span>{" "}
                kishiga yuboriladi
              </span>
              <span className="spacer" />
              <button className="btn" disabled={!text} onClick={() => setText("")}>
                Bekor qilish
              </button>
              <button
                className="btn pri"
                disabled={sending || running || !text.trim() || !total}
                onClick={() => setAsking(true)}
              >
                {sending ? "Yuborilmoqda…" : "Yuborish"}
              </button>
            </div>
          </div>
        </Card>

        <Card>
          <div className="pad stack-sm">
            <div className="lbl">Jonli ko'rinish</div>
            <div className="bubble-wrap">
              <img src="/icon-32.png" alt="Tanga bot" width="28" height="28" />
              <div className="bubble">
                {preview(text) || "Xabar matni shu yerda ko'rinadi"}
                <div className="stamp">
                  {new Date().toLocaleTimeString("ru-RU", {
                    hour: "2-digit", minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
            <p className="hint" style={{ margin: 0 }}>
              Telegram bot xabari, {langs[lang].toLowerCase()} tilida. Teglar bu
              yerda ko'rsatilmaydi — botda ular qalin va qiya matnga aylanadi.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
