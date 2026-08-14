import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useUsersQuery } from "../store/api";
import { setUserFilters } from "../store/uiSlice";
import Fresh from "../components/Fresh";
import UserDrawer from "../components/UserDrawer";
import { Av, Card, Empty, ErrorBox, Loading, Tag } from "../components/common";
import { day } from "../lib/format";

const STATES = [
  ["", "Holat — barchasi"],
  ["obunachi", "Faol"],
  ["sinov", "Sinovda"],
  ["tugagan", "Muddati tugagan"],
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
                    <th>Obuna tugashi</th>
                    <th className="num">Yozuvlar</th>
                    <th className="num">Faollik</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.length === 0 && (
                    <Empty colSpan={7} title="Mos foydalanuvchi topilmadi">
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
