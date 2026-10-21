import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  useBroadcastInfoQuery,
  useBroadcastJobQuery,
  useRemoveBroadcastVideoMutation,
  useSendBroadcastMutation,
  useUploadBroadcastVideoMutation,
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
  // Reklama videosi: serverga yuklangan nusxa (video_id) va brauzerdagi
  // ko'rinish uchun vaqtinchalik URL.
  const [video, setVideo] = useState(null);
  const [uploadVideo, { isLoading: uploading }] = useUploadBroadcastVideoMutation();
  const [removeVideo] = useRemoveBroadcastVideoMutation();
  const fileInput = useRef(null);

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
  const videoInfo = data.video || { max_mb: 50, caption_limit: 1024, types: ["video/mp4"] };
  // Video bilan matn — uning izohi, Telegram chegarasi qisqaroq.
  const limit = video ? videoInfo.caption_limit : LIMIT;
  const tooLong = text.length > limit;
  const ready = (text.trim() || video) && total && !tooLong;

  function dropVideo() {
    if (video) {
      URL.revokeObjectURL(video.url);
      removeVideo(video.video_id);
    }
    setVideo(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > videoInfo.max_mb * 1024 * 1024) {
      dispatch(pushToast(`Video ${videoInfo.max_mb} MB dan katta.`, "bad"));
      e.target.value = "";
      return;
    }
    try {
      const res = await uploadVideo(file).unwrap();
      if (video) URL.revokeObjectURL(video.url);
      setVideo({ ...res, url: URL.createObjectURL(file) });
    } catch (err) {
      dispatch(pushToast(err?.data?.detail || "Videoni yuklab bo'lmadi.", "bad"));
      e.target.value = "";
    }
  }

  async function onSend() {
    setAsking(false);
    try {
      const res = await send({
        segment, matn: text, til: lang, tasdiq: true, video_id: video?.video_id || "",
      }).unwrap();
      dispatch(pushToast(res.message));
      watching.current = res.job?.id ?? null;
      setText("");
      if (video) URL.revokeObjectURL(video.url);
      setVideo(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (err) {
      dispatch(pushToast(err?.data?.detail || "Yuborib bo'lmadi.", "bad"));
    }
  }

  return (
    <>
      {asking && (
        <Modal
          title={`${total} kishiga yuborilsinmi?`}
          sub={`${segments[segment]} · ${langs[lang]}.${video ? ` Video «${video.name}» va izoh.` : ""} Xabar darhol yuborila boshlaydi va qaytarib olib bo'lmaydi.`}
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
              placeholder={video ? "Video ostidagi izoh (ixtiyoriy)" : "Xabar matni"}
            />

            <div className="fld" style={{ margin: 0 }}>
              <span>Reklama videosi</span>
              <div className="row" style={{ alignItems: "center" }}>
                <input
                  ref={fileInput}
                  type="file"
                  accept={videoInfo.types.join(",")}
                  onChange={onPick}
                  disabled={uploading || running}
                  style={{ maxWidth: 320 }}
                />
                {uploading && <span className="muted" style={{ fontSize: 13 }}>Yuklanmoqda…</span>}
                {video && !uploading && (
                  <>
                    <span className="mono muted" style={{ fontSize: 13 }}>
                      {video.name} · {(video.size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                    <button type="button" className="btn sm" onClick={dropVideo}>
                      Olib tashlash
                    </button>
                  </>
                )}
              </div>
            </div>

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
              belgilar:{" "}
              <span className="mono" style={tooLong ? { color: "var(--danger)" } : undefined}>
                {limit - text.length}
              </span>
              {video ? ` (video izohi ${videoInfo.caption_limit} belgigacha)` : ""}. Video:
              MP4, {videoInfo.max_mb} MB gacha — Telegram'ga bir marta yuklanadi, avval
              sizga nusxasi boradi. Til tanlansa, xabar faqat botda o'sha tilni
              tanlaganlarga boradi. Bloklanganlar, botni bloklaganlar va shartlarga
              rozilik bermaganlar sanoqqa kirmaydi.
            </p>

            <div className="inline bordered-top">
              <span className="muted" style={{ fontSize: 13 }}>
                <span className="mono" style={{ color: "var(--text)" }}>{total}</span>{" "}
                kishiga yuboriladi
              </span>
              <span className="spacer" />
              <button className="btn" disabled={!text && !video}
                      onClick={() => { setText(""); dropVideo(); }}>
                Bekor qilish
              </button>
              <button
                className="btn pri"
                disabled={sending || running || uploading || !ready}
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
                {video && (
                  <video
                    src={video.url}
                    controls
                    playsInline
                    preload="metadata"
                    style={{ display: "block", width: "100%", maxHeight: 280,
                             borderRadius: 8, marginBottom: 8, background: "#000" }}
                  />
                )}
                {preview(text) || (video ? "" : "Xabar matni shu yerda ko'rinadi")}
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
              {video ? " Video Telegram'da shu ko'rinishda, izoh uning ostida chiqadi." : ""}
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
