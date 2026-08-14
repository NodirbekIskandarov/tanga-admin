import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLogQuery } from "../store/api";
import { setLogPage } from "../store/uiSlice";
import Fresh from "../components/Fresh";
import { Card, Empty, ErrorBox, Loading, Pager } from "../components/common";
import { dt } from "../lib/format";

// Amal turlari — jurnalda yozilgan nomlar bo'yicha.
const KINDS = [
  ["", "Amal — barchasi"],
  ["chek", "Chek qarori"],
  ["obuna", "Obuna berildi"],
  ["ommaviy xabar", "Ommaviy xabar"],
  ["blok", "Bloklash"],
  ["sozlamalar", "Sozlamalar"],
  ["yozuvlarni", "Yozuvlarni ko'rish"],
];

function timeOnly(raw) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw).slice(11, 16);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Bir qatorli tavsif: «Chek tasdiqlandi — Aziza N., 6 oylik». */
function describe(row) {
  const parts = [row.action];
  if (row.details) parts.push(row.details);
  else if (row.target) parts.push(row.target);
  return parts.join(" — ");
}

export default function Log() {
  const dispatch = useDispatch();
  const page = useSelector((s) => s.ui.logPage);
  const [kind, setKind] = useState("");
  // Jurnal ikkinchi adminning amallarini ham ko'rsatadi — o'zi yangilanib
  // tursin, aks holda «hech narsa bo'lmayapti» degan taassurot qoladi.
  const { data, isFetching, error, refetch, fulfilledTimeStamp } =
    useLogQuery(page, { pollingInterval: 30000 });

  if (error) return <ErrorBox error={error} onRetry={refetch} />;
  if (!data && isFetching) return <Loading />;

  const items = (data?.items || []).filter(
    (r) => !kind || String(r.action).toLowerCase().includes(kind)
  );

  // Sana bo'yicha guruh — bir kunning ichida vaqt ko'rsatiladi.
  const groups = [];
  for (const row of items) {
    const day = String(row.created_at).slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, rows: [row] });
  }

  return (
    <>
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map(([v, t]) => (
            <option key={v} value={v}>{t}</option>
          ))}
        </select>
        <span className="muted" style={{ fontSize: 13 }}>
          {data?.total ?? 0} ta yozuv
        </span>
        <span className="spacer" />
        <Fresh at={fulfilledTimeStamp} busy={isFetching} />
      </div>

      <Card>
        {items.length === 0 ? (
          <Empty title="Yozuv yo'q">Filtrni o'zgartiring.</Empty>
        ) : (
          groups.map((g) => (
            <div key={g.day}>
              <div className="log-day">{g.day.split("-").reverse().join(".")}</div>
              {g.rows.map((r) => (
                <div className="log-row" key={r.id} title={`${dt(r.created_at)} · ${r.ip}`}>
                  <span className="t">{timeOnly(r.created_at)}</span>
                  <span className="who">{r.admin}</span>
                  <span className="msg">{describe(r)}</span>
                </div>
              ))}
            </div>
          ))
        )}
        <Pager
          page={data?.page || 1}
          pages={data?.pages || 1}
          total={data?.total}
          onChange={(p) => dispatch(setLogPage(p))}
        />
      </Card>

      <div className="note">
        <span className="grow">
          Jurnal barcha admin amallarini yozib boradi: kirish, obuna berish,
          bloklash, o'chirish, sozlama va ommaviy xabar. O'chirib bo'lmaydi —
          bu ataylab shunday.
        </span>
      </div>
    </>
  );
}
