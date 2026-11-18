import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useUsersQuery } from "../store/api";
import { setUserFilters } from "../store/uiSlice";
import Fresh from "../components/Fresh";
import Icon from "../components/Icon";
import UserDrawer from "../components/UserDrawer";
import { Av, Card, Empty, ErrorBox, Loading, Tag } from "../components/common";
import { day, manbaNomi, tilNomi } from "../lib/format";

const STATES = [
  ["", "Holat — barchasi"],
  ["obunachi", "Faol obuna"],
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

const SORTS = [
  ["yangi", "Yangi kelganlar"],
  ["faol", "Oxirgi faollik"],
  ["yozuv", "Ko'p yozganlar"],
];

const CLEAR = { holat: "", tarif: "", faollik: "", segment: "", til: "", manba: "" };

function idleText(days) {
  if (days == null) return "—";
  if (days === 0) return "bugun";
  if (days === 1) return "kecha";
  return `${days} kun oldin`;
}

function Contact({ r }) {
  if (r.bot_blocked) return <Tag kind="bad">bloklagan</Tag>;
  if (!r.consented) return <Tag kind="warn">rozilik yo'q</Tag>;
  return null;
}

export default function Users() {
  const dispatch = useDispatch();
  const filters = useSelector((s) => s.ui.userFilters);
  const { data, isFetching, error, refetch, fulfilledTimeStamp } = useUsersQuery(filters);
  const [open, setOpen] = useState(null);
  const [more, setMore] = useState(false);

  const set = (patch) => dispatch(setUserFilters({ sahifa: 1, ...patch }));
  const plans = data?.plans || [];
  const act = data?.activity || {};
  const summary = data?.summary || {};
  const seg = summary.segments || {};
  const segLabels = data?.segment_labels || {};
  const sources = summary.sources || [];

  // Tez filtrlar — eng ko'p kerak bo'ladigan kesimlar, soni bilan.
  const presets = [
    { label: "Hammasi", patch: CLEAR },
    { label: "Bugun faol", patch: { ...CLEAR, faollik: "bugun" }, n: act.today },
    { label: "7 kunda faol", patch: { ...CLEAR, faollik: "hafta" }, n: act.week },
    { label: "Sinovda", patch: { ...CLEAR, holat: "sinov" } },
    { label: "Faol obuna", patch: { ...CLEAR, holat: "obunachi" } },
    { label: "Bepul daraja", patch: { ...CLEAR, holat: "bepul" } },
    { label: "Botni bloklagan", patch: { ...CLEAR, segment: "bloklagan" }, n: seg.bloklagan },
    { label: "Rozilik bermagan", patch: { ...CLEAR, segment: "rozilik_yoq" }, n: seg.rozilik_yoq },
    { label: "Hech yozmagan", patch: { ...CLEAR, segment: "yozmagan" }, n: seg.yozmagan },
  ];
  const isOn = (patch) => Object.keys(CLEAR).every((k) => (filters[k] || "") === (patch[k] || ""));
  const advanced = ["tarif", "til", "manba"].filter((k) => filters[k]).length;
  const anyFilter = Object.keys(CLEAR).some((k) => filters[k]) || filters.q;

  return (
    <>
      <UserDrawer userId={open} onClose={() => setOpen(null)} />

      <section className="finder">
      <div className="toolbar">
        <label className="field-search grow">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Ism, @username yoki ID"
            value={filters.q}
            maxLength={64}
            onChange={(e) => set({ q: e.target.value })}
          />
        </label>
        <select value={filters.tartib} onChange={(e) => set({ tartib: e.target.value })} aria-label="Tartib">
          {SORTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <button className={`btn ${more || advanced ? "pri" : ""}`} onClick={() => setMore((v) => !v)}>
          <Icon name="filter" size={15} />
          Filtrlar{advanced ? ` · ${advanced}` : ""}
        </button>
        <a className="btn" href="/api/export/users.csv">CSV</a>
      </div>

      <div className="chips" role="tablist" aria-label="Tez filtrlar">
        {presets.map((p) => (
          <button
            key={p.label}
            role="tab"
            aria-selected={isOn(p.patch)}
            className={`chip ${isOn(p.patch) ? "on" : ""}`}
            onClick={() => set(p.patch)}
          >
            {p.label}
            {p.n != null && <span className="chip-n">{p.n}</span>}
          </button>
        ))}
      </div>

      {more && (
        <div className="filters">
          <label className="fld"><span>Holat</span>
            <select value={filters.holat} onChange={(e) => set({ holat: e.target.value })}>
              {STATES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <label className="fld"><span>Tarif</span>
            <select value={filters.tarif} onChange={(e) => set({ tarif: e.target.value })}>
              <option value="">Barchasi</option>
              {plans.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
          </label>
          <label className="fld"><span>Faollik</span>
            <select value={filters.faollik} onChange={(e) => set({ faollik: e.target.value })}>
              {ACTIVITY.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <label className="fld"><span>Bot bilan aloqa</span>
            <select value={filters.segment} onChange={(e) => set({ segment: e.target.value })}>
              <option value="">Barchasi</option>
              {Object.entries(segLabels).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <label className="fld"><span>Til</span>
            <select value={filters.til} onChange={(e) => set({ til: e.target.value })}>
              <option value="">Barchasi</option>
              {Object.entries(summary.langs || {}).map(([code, n]) => (
                <option key={code} value={code}>{tilNomi(code)} ({n})</option>
              ))}
            </select>
          </label>
          <label className="fld"><span>Manba</span>
            <select value={filters.manba} onChange={(e) => set({ manba: e.target.value })}>
              <option value="">Barchasi</option>
              {sources.map((s) => (
                <option key={s.source || "-"} value={s.source || "-"}>
                  {s.source || "to'g'ridan-to'g'ri"} ({s.count})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="result-line">
        <span>
          <b className="mono">{data?.total ?? "…"}</b> ta foydalanuvchi
          {anyFilter && (
            <button className="link" onClick={() => set({ ...CLEAR, q: "" })}>Filtrlarni tozalash</button>
          )}
        </span>
        <Fresh at={fulfilledTimeStamp} busy={isFetching} />
      </div>
      </section>

      {error && <ErrorBox error={error} onRetry={refetch} />}

      <Card className="flush">
        {isFetching && !data ? (
          <Loading />
        ) : (
          <>
            <div className="tbl-wrap only-wide">
              <table className="users-tbl">
                <thead>
                  <tr>
                    <th>Foydalanuvchi</th>
                    <th>Holat</th>
                    <th>Manba</th>
                    <th>Kelgan</th>
                    <th>Oxirgi faollik</th>
                    <th className="num">Yozuvlar</th>
                    <th>Muddat</th>
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
                          <span style={{ minWidth: 0 }}>
                            <span className="nm">{r.first_name || "Nomsiz"}</span>
                            <span className="meta">{r.username ? `@${r.username} · ` : ""}{r.user_id}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="tags">
                          <Tag kind={r.state}>{r.state}</Tag>
                          <Contact r={r} />
                        </span>
                      </td>
                      <td className="muted">{manbaNomi(r.source)}</td>
                      <td className="mono muted nowrap">{day(r.created_at)}</td>
                      <td className="muted nowrap">{idleText(r.idle_days)}</td>
                      <td className="num">{r.tx_count}</td>
                      <td className="mono muted nowrap">{day(r.expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Telefon: jadval o'rniga kartochkalar. */}
            <ul className="ucards only-narrow">
              {data?.items.length === 0 && <li className="empty-li">Mos foydalanuvchi topilmadi.</li>}
              {data?.items.map((r) => (
                <li key={r.user_id}>
                  <button className="ucard" onClick={() => setOpen(r.user_id)}>
                    <Av name={r.first_name || r.username || "?"} seed={r.user_id} size="md" />
                    <span className="ucard-body">
                      <span className="ucard-top">
                        <b>{r.first_name || "Nomsiz"}</b>
                        <span className="num">{r.tx_count} yozuv</span>
                      </span>
                      <span className="meta">{r.username ? `@${r.username} · ` : ""}{r.user_id}</span>
                      <span className="tags">
                        <Tag kind={r.state}>{r.state}</Tag>
                        <Contact r={r} />
                        <span className="muted small">{manbaNomi(r.source)} · {idleText(r.idle_days)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="pager">
              <span className="mono">{data?.page ?? 1} / {data?.pages ?? 1}</span>
              <div className="row">
                <button className="btn sm" disabled={(data?.page || 1) <= 1}
                        onClick={() => dispatch(setUserFilters({ sahifa: (data?.page || 1) - 1 }))}>
                  Oldingi
                </button>
                <button className="btn sm" disabled={(data?.page || 1) >= (data?.pages || 1)}
                        onClick={() => dispatch(setUserFilters({ sahifa: (data?.page || 1) + 1 }))}>
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
