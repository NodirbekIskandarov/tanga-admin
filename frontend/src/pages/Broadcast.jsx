import { useState } from "react";
import { useDispatch } from "react-redux";
import { useBroadcastInfoQuery, useSendBroadcastMutation } from "../store/api";
import { pushToast } from "../store/uiSlice";
import { Bars, Card, ErrorBox, Loading, useConfirm } from "../components/common";

export default function Broadcast() {
  const dispatch = useDispatch();
  const { data, isLoading, error, refetch } = useBroadcastInfoQuery();
  const [send, { isLoading: sending }] = useSendBroadcastMutation();
  const [ask, confirmDialog] = useConfirm();
  const [segment, setSegment] = useState("hammasi");
  const [text, setText] = useState("");
  const [agree, setAgree] = useState(false);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const { segments, counts } = data;

  async function onSend(e) {
    e.preventDefault();
    const ok = await ask(
      `Xabar quyidagilarga yuboriladi: ${segments[segment]} — ` +
        `${counts[segment]} ta foydalanuvchi. Qaytarib olib bo'lmaydi.`,
      true
    );
    if (!ok) return;
    try {
      const res = await send({ segment, matn: text, tasdiq: agree }).unwrap();
      dispatch(pushToast(res.message));
      setText("");
      setAgree(false);
    } catch (err) {
      dispatch(pushToast(err?.data?.detail || "Yuborib bo'lmadi.", "bad"));
    }
  }

  return (
    <>
      {confirmDialog}

      <div className="note warn">
        <b>Ehtiyot bo'ling.</b> Xabar tanlangan hamma foydalanuvchiga darhol
        yuboriladi va qaytarib olib bo'lmaydi. Tez-tez yuborilgan xabar
        odamlarni botdan bezdiradi — oyiga bir-ikki martadan oshirmang.
      </div>

      <div className="grid2">
        <Card title="Xabar yozish">
          <div className="pad">
            <form onSubmit={onSend}>
              <label className="fld">
                <span>Kimga</span>
                <select value={segment} onChange={(e) => setSegment(e.target.value)}>
                  {Object.entries(segments).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label} — {counts[key]} ta
                    </option>
                  ))}
                </select>
              </label>

              <label className="fld">
                <span>Matn</span>
                <textarea
                  required
                  maxLength={3500}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="🎉 Yangilik! Botga byudjet qo'shildi…"
                />
              </label>
              <p className="hint">
                HTML teglari ishlaydi: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>,{" "}
                <code>&lt;code&gt;</code>, <code>&lt;a href&gt;</code>. Emoji ham
                mumkin. Qolgan belgilar: {3500 - text.length}
              </p>

              <label
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "flex-start",
                  margin: "16px 0",
                }}
              >
                <input
                  type="checkbox"
                  required
                  checked={agree}
                  onChange={(e) => setAgree(e.target.checked)}
                  style={{ width: "auto", marginTop: 4 }}
                />
                <span style={{ fontSize: 14 }}>
                  Matnni tekshirdim, yuborishga tayyorman.
                </span>
              </label>

              <button
                className="btn pri"
                type="submit"
                disabled={sending || !text.trim()}
              >
                {sending ? "Yuborilmoqda…" : "📣 Yuborish"}
              </button>
            </form>
          </div>
        </Card>

        <Card title="Qamrov">
          <div className="pad">
            <Bars
              rows={Object.entries(segments).map(([key, label]) => ({
                label,
                value: counts[key],
                text: String(counts[key]),
              }))}
            />
          </div>
          <div className="pad" style={{ borderTop: "1px solid var(--line)" }}>
            <p className="hint" style={{ margin: 0 }}>
              Egalar ro'yxatga kirmaydi. Botni bloklagan foydalanuvchilarga
              xabar yetmaydi — ular «yuborilmadi» deb sanaladi, jarayon
              to'xtamaydi. 1000 ta xabar taxminan bir daqiqada ketadi.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
