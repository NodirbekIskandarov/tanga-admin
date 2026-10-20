import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useUsersQuery } from "../store/api";
import { setUserFilters } from "../store/uiSlice";
import Fresh from "../components/Fresh";
import UserDrawer from "../components/UserDrawer";
import { Av, Card, Empty, ErrorBox, Loading, Tag } from "../components/common";
import { day, tilNomi } from "../lib/format";

const STATES = [
  ["", "Holat — barchasi"],
  ["obunachi", "Faol"],
  ["sinov", "Sinovda"],
  ["bepul", "Bepul daraja"],
  ["bloklangan", "Bloklangan"],
  ["ega", "Egalar"],
];

const ACTIVITY = [
  ["", "Faollik — barchasi"],
  ["bugun", "Bugun faol"],
  ["hafta", "Oxirgi 7 kun"],
  ["oy", "Oxirgi 30 kun"],
];

export default function Users() {
  const dispatch = useDispatch();
  const filters = useSelector((s) => s.ui.userFilters);
  const { data, isFetching, error, refetch, fulfilledTimeStamp } =
    useUsersQuery(filters);
  const [open, setOpen] = useState(null);

  const set = (patch) => dispatch(setUserFilters(patch));
  const plans = data?.plans || [];
  const act = data?.activity || {};
  const summary = data?.summary || {};
  const seg = summary.segments || {};
  const segLabels = data?.segment_labels || {};
  const sources = summary.sources || [];
  const filtered = ["holat", "tarif", "faollik", "segment", "til", "manba"]
    .some((k) => filters[k]) || filters.q;

  return (
    <>
      <UserDrawer userId={open} onClose={() => setOpen(null)} />

      <div className="row">
        <input
          type="text"
          className="search"
          placeholder="Ism, username yoki ID"
          value={filters.q}
          maxLength={64}
          onChange={(e) => set({ q: e.target.value })}
        />
        <select value={filters.holat} onChange={(e) => set({ holat: e.target.value })}>
          {STATES.map(([v, t]) => (
            <option key={v} value={v}>{t}</option>
          ))}
        </select>
        <select value={filters.tarif} onChange={(e) => set({ tarif: e.target.value })}>
          <option value="">Tarif — barchasi</option>
          {plans.map((p) => (
            <option key={p.code} value={p.code}>{p.label}</option>
          ))}
        </select>
        <select value={filters.faollik} onChange={(e) => set({ faollik: e.target.value })}>
          {ACTIVITY.map(([v, t]) => (
            <option key={v} value={v}>{t}</option>
          ))}
        </select>
        <select value={filters.segment} onChange={(e) => set({ segment: e.target.value })}>
          <option value="">Aloqa — barchasi</option>
          {Object.entries(segLabels).map(([v, t]) => (
            <option key={v} value={v}>{t}</option>
          ))}
        </select>
        <select value={filters.til} onChange={(e) => set({ til: e.target.value })}>
          <option value="">Til — barchasi</option>
          {Object.entries(summary.langs || {}).map(([code, n]) => (
            <option key={code} value={code}>{tilNomi(code)} ({n})</option>
          ))}
        </select>
        {/* Reklama manbasi (/start src_<kanal>) — kanal paydo bo'lgandagina. */}
        {sources.length > 1 && (
          <select value={filters.manba} onChange={(e) => set({ manba: e.target.value })}>
            <option value="">Manba — barchasi</option>
            {sources.map((s) => (
              <option key={s.source || "-"} value={s.source || "-"}>
                {s.source || "to'g'ridan-to'g'ri"} ({s.count})
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <a className="btn" href="/api/export/users.csv">CSV yuklab olish</a>
      </div>

      {/* Faollik qatori — bosilsa o'sha filtr qo'yiladi. */}
      <div className="quick">
        <button onClick={() => set({ faollik: "bugun" })}>
          Bugun faol — <span className="mono">{act.today ?? "—"}</span>
        </button>
        <span className="sep">·</span>
        <button onClick={() => set({ faollik: "hafta" })}>
          Oxirgi 7 kunda — <span className="mono">{act.week ?? "—"}</span>
        </button>
        <span className="sep">·</span>
        <button onClick={() => set({ faollik: "oy" })}>
          Oxirgi 30 kunda — <span className="mono">{act.month ?? "—"}</span>
        </button>
        <span className="spacer" />
        <Fresh at={fulfilledTimeStamp} busy={isFetching} />
      </div>

      {/* Aloqa qatori: kimga xabar yetib boradi, kim ketgan, kim boshlamagan. */}
      <div className="quick">
        <button onClick={() => set({ segment: "yetib_boradi" })}>
          Xabar yetib boradi — <span className="mono">{seg.yetib_boradi ?? "—"}</span>
        </button>
        <span className="sep">·</span>
        <button onClick={() => set({ segment: "bloklagan" })}>
          Botni bloklagan — <span className="mono">{seg.bloklagan ?? "—"}</span>
        </button>
        <span className="sep">·</span>
        <button onClick={() => set({ segment: "rozilik_yoq" })}>
          Rozilik bermagan — <span className="mono">{seg.rozilik_yoq ?? "—"}</span>
        </button>
        <span className="sep">·</span>
        <button onClick={() => set({ segment: "yozmagan" })}>
          Hech yozmagan — <span className="mono">{seg.yozmagan ?? "—"}</span>
        </button>
        <span className="spacer" />
        {filtered && (
          <button onClick={() => set({ q: "", holat: "", tarif: "", faollik: "",
                                       segment: "", til: "", manba: "" })}>
            Filtrlarni tozalash ×
          </button>
        )}
      </div>

      {error && <ErrorBox error={error} onRetry={refetch} />}

      <Card>
        {isFetching && !data ? (
          <Loading />
        ) : (
          <>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ism</th>
                    <th>Username</th>
                    <th>Telegram ID</th>
                    <th>Holat</th>
                    <th>Aloqa</th>
                    <th>Til</th>
                    <th>Obuna tugashi</th>
                    <th className="num">Yozuvlar</th>
                    <th className="num">Faollik</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.length === 0 && (
                    <Empty colSpan={9} title="Mos foydalanuvchi topilmadi">
                      Qidiruvni qisqartiring yoki filtrni tozalang.
                    </Empty>
                  )}
                  {data?.items.map((r) => (
                    <tr key={r.user_id} className="click" onClick={() => setOpen(r.user_id)}>
                      <td>
                        <span className="who">
                          <Av name={r.first_name || r.username || "?"} seed={r.user_id} />
                          <span className="nm">{r.first_name || "Nomsiz"}</span>
                        </span>
                      </td>
                      <td className="mono muted">{r.username ? `@${r.username}` : "—"}</td>
                      <td className="mono muted">{r.user_id}</td>
                      <td>
                        <Tag kind={r.state}>{r.state}</Tag>
                      </td>
                      <td>
                        {r.bot_blocked
                          ? <Tag kind="bad">botni bloklagan</Tag>
                          : !r.consented
                            ? <Tag kind="warn">rozilik yo'q</Tag>
                            : <span className="muted">ochiq</span>}
                      </td>
                      <td className="mono muted" title={tilNomi(r.lang)}>
                        {String(r.lang || "uz").toUpperCase()}
                      </td>
                      <td className="mono muted">{day(r.expires_at)}</td>
                      <td className="num">{r.tx_count}</td>
                      <td className="num muted" style={{ fontSize: 12 }}>
                        {r.idle_days == null
                          ? "—"
                          : r.idle_days === 0
                            ? "bugun"
                            : `${r.idle_days} kun oldin`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span className="mono">
                {data?.items.length ?? 0} / {data?.total ?? 0}
              </span>
              <div className="row">
                <button
                  className="btn sm"
                  disabled={(data?.page || 1) <= 1}
                  onClick={() => set({ sahifa: (data?.page || 1) - 1 })}
                >
                  Oldingi
                </button>
                <button
                  className="btn sm"
                  disabled={(data?.page || 1) >= (data?.pages || 1)}
                  onClick={() => set({ sahifa: (data?.page || 1) + 1 })}
                >
                  Keyingi
                </button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
