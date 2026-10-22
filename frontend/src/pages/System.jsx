import { useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch } from "react-redux";
import { useSystemQuery, useUpdateCategoryMutation } from "../store/api";
import { pushToast } from "../store/uiSlice";
import Fresh from "../components/Fresh";
import {
  Bars, Card, Empty, ErrorBox, Fact, Facts, Kpi, Loading, Tag,
} from "../components/common";
import { dt, voqeaNomi } from "../lib/format";

/**
 * Tizim holati — bot jarayoni (heartbeat), rejali ishlar, xatolar, voqealar
 * oqimi, taklif statistikasi, AI yaratgan kategoriyalar, kurslar, server va
 * baza. Shaxsiy yozuvlar bu yerda YO'Q: shaxsiy baza panel uchun yopiq va
 * shunday ko'rsatiladi.
 */

function dur(s) {
  if (s == null) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} kun ${h} soat`;
  if (h) return `${h} soat ${m} daq`;
  if (m) return `${m} daq`;
  return `${s} s`;
}

function bytes(n) {
  if (n == null) return "—";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function ms(n) {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`;
}

function size(info) {
  if (!info) return "—";
  if (info.closed) return "yopiq (ataylab)";
  if (info.missing) return "yo'q";
  return bytes(info.size);
}

function Who({ row }) {
  if (!row?.user_id) return <span className="muted">—</span>;
  const name = row.first_name || (row.username ? `@${row.username}` : `#${row.user_id}`);
  return <Link to={`/foydalanuvchilar/${row.user_id}`}>{name}</Link>;
}

export default function System() {
  const { data, isLoading, isFetching, error, refetch, fulfilledTimeStamp } =
    useSystemQuery(undefined, { pollingInterval: 30000 });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const { bot, jobs, errors, events, referrals, categories, rates, server, panel, tables } = data;
  const botTone = !bot.known ? "warn" : bot.alive ? "good" : "bad";
  const botText = !bot.known
    ? "Ma'lumot yo'q"
    : bot.alive ? "Ishlayapti" : `Javob yo'q · ${dur(bot.stale_s)}`;
  const load = server.load ? server.load[0] : null;
  const memUsed = server.mem_total && server.mem_available != null
    ? server.mem_total - server.mem_available : null;
  const maxErr = Math.max(1, ...errors.days.map((d) => d.n));

  return (
    <>
      <div className="page-head">
        <Fresh at={fulfilledTimeStamp} busy={isFetching} />
      </div>

      {!bot.known && (
        <div className="note warn">
          <span className="grow">
            Bot hali heartbeat yozmayapti — bot yangi versiyaga yangilangach (tizim monitoringi)
            holat shu yerda ko'rinadi.
          </span>
        </div>
      )}
      {bot.known && !bot.alive && (
        <div className="note bad">
          <span className="grow">
            <b>Bot {dur(bot.stale_s)} dan beri heartbeat yubormayapti.</b> Serverda:{" "}
            <span className="kbd">systemctl status tanga</span> · <span className="kbd">journalctl -u tanga -n 50</span>
          </span>
        </div>
      )}

      <div className="kpis three">
        <Kpi label="Bot holati" value={botText} tone={botTone}
             sub={bot.last_seen ? `heartbeat ${dt(bot.last_seen)}` : "heartbeat yo'q"} />
        <Kpi label="Bot ish vaqti" value={dur(bot.uptime_s)}
             sub={bot.commit ? `commit ${bot.commit} · PID ${bot.pid}` : "—"} />
        <Kpi label="Xatolar (24 soat)" value={bot.errors_24h} tone={bot.errors_24h ? "bad" : "good"}
             sub={bot.last_error ? `oxirgisi: ${bot.last_error.kind} · ${dt(bot.last_error.created_at)}` : "xato yo'q"} />
        <Kpi label="Server yuklamasi" value={load == null ? "—" : `${load} / ${server.cpus}`}
             tone={load != null && load > server.cpus ? "warn" : ""}
             sub={server.uptime_s ? `server ${dur(server.uptime_s)} ishlayapti` : "load / CPU"} />
        <Kpi label="Xotira (RAM)" value={memUsed == null ? "—" : `${bytes(memUsed)}`}
             sub={server.mem_total ? `jami ${bytes(server.mem_total)}` : "—"}
             tone={server.mem_total && memUsed / server.mem_total > 0.9 ? "warn" : ""} />
        <Kpi label="Disk bo'sh" value={bytes(server.disk_free)}
             sub={server.disk_total ? `jami ${bytes(server.disk_total)}` : "—"}
             tone={server.disk_total && server.disk_free / server.disk_total < 0.1 ? "bad" : ""} />
      </div>

      <div className="grid2">
        <Card title="Rejali ishlar">
          {jobs.length === 0 ? (
            <Empty title="Ma'lumot yo'q">Bot heartbeat yozgach ro'yxat chiqadi.</Empty>
          ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ish</th><th>Oxirgi</th><th>Davomiyligi</th><th>Natija</th>
                    <th>7 kun</th><th>Keyingi</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.name}>
                      <td className="mono">{j.name}</td>
                      <td className="nowrap">{j.last ? dt(j.last.started_at) : "—"}</td>
                      <td className="mono">{j.last ? ms(j.last.duration_ms) : "—"}</td>
                      <td>
                        {!j.last ? <span className="muted">—</span>
                          : j.last.ok ? <Tag kind="ok">ok</Tag>
                          : <Tag kind="bad" >{j.last.error || "xato"}</Tag>}
                      </td>
                      <td className="mono">
                        {j.week ? `${j.week.ok_runs}/${j.week.runs}` : "—"}
                      </td>
                      <td className="nowrap">{j.next ? dt(j.next) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Xatolar">
          <div className="pad stack-sm">
            <Bars
              max={maxErr}
              rows={errors.days.map((d) => ({
                label: d.day.slice(5), value: d.n,
                color: d.n ? "var(--danger)" : "var(--border-strong)", text: d.n,
              }))}
            />
            {errors.by_kind?.length > 0 && (
              <div className="stack-sm">
                <div className="lbl">7 kunda eng ko'p</div>
                {errors.by_kind.map((e) => (
                  <div key={`${e.kind}${e.place}`} className="inline">
                    <span className="mono">{e.kind}</span>
                    <span className="muted mono" style={{ fontSize: 12 }}>{e.place}</span>
                    <span className="spacer" />
                    <b>{e.n}</b>
                  </div>
                ))}
              </div>
            )}
            {errors.recent.length === 0 ? (
              <p className="hint" style={{ margin: 0 }}>Xatolar yozilmagan.</p>
            ) : (
              <div className="stack-sm">
                {errors.recent.slice(0, 20).map((e) => (
                  <div key={e.id} className="log-row">
                    <span className="muted nowrap">{dt(e.created_at)}</span>
                    <span>
                      <span className="mono">{e.kind}</span>
                      {e.place && <span className="muted mono"> · {e.place}</span>}
                      {e.update_kind && <span className="muted"> · {e.update_kind}</span>}
                      {e.user_id && <> · <Who row={e} /></>}
                      {e.message && <div className="muted" style={{ fontSize: 12 }}>{e.message}</div>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid2">
        <Card title={`Voqealar${events.today != null ? ` · bugun ${events.today}` : ""}`}>
          {events.by_name.length === 0 ? (
            <Empty title="Voqealar yo'q" />
          ) : (
            <>
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Hodisa</th><th>7 kun</th><th>30 kun</th></tr></thead>
                  <tbody>
                    {events.by_name.map((e) => (
                      <tr key={e.name}>
                        <td>{voqeaNomi(e.name)} <span className="muted mono" style={{ fontSize: 12 }}>{e.name}</span></td>
                        <td className="mono">{e.n7}</td>
                        <td className="mono">{e.n30}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pad stack-sm">
                <div className="lbl">Oxirgi voqealar</div>
                {events.recent.slice(0, 30).map((e) => (
                  <div key={e.id} className="log-row">
                    <span className="muted nowrap">{dt(e.created_at)}</span>
                    <span>
                      <Who row={e} /> — {voqeaNomi(e.name)}
                      {e.detail && <span className="muted"> · {e.detail}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <div className="stack">
          <Card title="Taklif qilish (referal)">
            {!referrals.available ? (
              <Empty title="Ma'lumot yo'q">Botda referal maydoni hali yo'q.</Empty>
            ) : (
              <div className="pad stack-sm">
                <Facts>
                  <Fact label="Taklif bilan kelganlar">{referrals.referred}</Fact>
                  <Fact label="Taklif qilganlar">{referrals.referrers}</Fact>
                  {referrals.bonus_days != null && (
                    <Fact label="Sovg'a kunlar (jami)">{referrals.bonus_days}</Fact>
                  )}
                </Facts>
                {referrals.top.length > 0 && (
                  <div className="stack-sm">
                    <div className="lbl">Eng ko'p taklif qilganlar</div>
                    {referrals.top.map((r) => (
                      <div key={r.user_id} className="inline">
                        <Who row={r} />
                        <span className="spacer" />
                        <b className="mono">{r.n}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card title="Valyuta kurslari">
            {rates.latest.length === 0 ? (
              <Empty title="Kurs yo'q" />
            ) : (
              <div className="pad stack-sm">
                <Facts>
                  {rates.latest.map((r) => (
                    <Fact key={r.currency} label={`${r.currency.toUpperCase()} · ${r.day}`}>
                      {Number(r.rate).toLocaleString("ru-RU")} so'm
                      {r.source && <span className="muted"> · {r.source}</span>}
                    </Fact>
                  ))}
                </Facts>
                <p className="hint" style={{ margin: 0 }}>
                  So'nggi 14 kun: {rates.series.filter((s) => s.currency === rates.latest[0].currency)
                    .map((s) => `${s.day.slice(5)} ${Math.round(s.rate)}`).join(" · ") || "—"}
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      <CategoriesCard categories={categories} />

      <div className="grid2">
        <Card title="Bot jarayoni">
          <div className="pad">
            <Facts>
              <Fact label="Holat">{botText}</Fact>
              <Fact label="Ishga tushgan">{bot.started_at ? dt(bot.started_at) : "—"}</Fact>
              <Fact label="Commit">{bot.commit || "—"}</Fact>
              <Fact label="Python / PTB">{bot.python || "—"} / {bot.ptb || "—"}</Fact>
              <Fact label="Parallel yangilanishlar">{bot.concurrent_updates || "—"}</Fact>
              <Fact label="So'nggi ishlar">
                {bot.recent_runs?.length ? `${bot.recent_runs.filter((r) => r.ok).length}/${bot.recent_runs.length} ok` : "—"}
              </Fact>
            </Facts>
          </div>
        </Card>
        <Card title="Panel va baza">
          <div className="pad">
            <Facts>
              <Fact label="Panel commit">{panel.commit || "—"}</Fact>
              <Fact label="Panel ish vaqti">{dur(panel.uptime_s)}</Fact>
              <Fact label="Python">{panel.python}</Fact>
              <Fact label="Asosiy baza">{size(server.db.main)} {server.db.wal?.size ? `(+WAL ${bytes(server.db.wal.size)})` : ""}</Fact>
              <Fact label="Shaxsiy baza (yozuvlar)">{size(server.db.private)}</Fact>
              <Fact label="Jadvallar" mono={false}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {Object.entries(tables).map(([n, c]) => `${n} ${c ?? "?"}`).join(" · ")}
                </span>
              </Fact>
            </Facts>
          </div>
        </Card>
      </div>
    </>
  );
}

/** AI yaratgan kategoriyalar katalogi — ruscha nomi va emojisini tuzatish. */
function CategoriesCard({ categories }) {
  const dispatch = useDispatch();
  const [update, { isLoading }] = useUpdateCategoryMutation();
  const [draft, setDraft] = useState({});

  function val(c, key) {
    return draft[c.id]?.[key] ?? c[key] ?? "";
  }
  function set(c, key, value) {
    setDraft((d) => ({ ...d, [c.id]: { ...(d[c.id] || {}), [key]: value } }));
  }
  async function save(c) {
    try {
      await update({ id: c.id, ru: val(c, "ru"), emoji: val(c, "emoji"), icon: val(c, "icon") }).unwrap();
      dispatch(pushToast("Saqlandi"));
      setDraft((d) => { const n = { ...d }; delete n[c.id]; return n; });
    } catch (err) {
      dispatch(pushToast(err?.data?.detail || "Saqlab bo'lmadi.", "bad"));
    }
  }

  return (
    <Card title={`AI yaratgan kategoriyalar · ${categories.length}`}>
      {categories.length === 0 ? (
        <Empty title="Hali yo'q">AI yangi kategoriya taklif qilganda shu yerda ko'rinadi.</Empty>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Nomi</th><th>Turi</th><th>Emoji</th><th>Ruscha</th><th>Ikonka</th><th>Yaratilgan</th><th /></tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td><Tag kind={c.kind === "kirim" ? "ok" : ""}>{c.kind}</Tag></td>
                  <td><input type="text" style={{ width: 56 }} value={val(c, "emoji")} maxLength={8}
                             onChange={(e) => set(c, "emoji", e.target.value)} /></td>
                  <td><input type="text" style={{ width: 160 }} value={val(c, "ru")} maxLength={60}
                             onChange={(e) => set(c, "ru", e.target.value)} /></td>
                  <td><input type="text" className="mono" style={{ width: 110 }} value={val(c, "icon")} maxLength={32}
                             onChange={(e) => set(c, "icon", e.target.value)} /></td>
                  <td className="muted nowrap">{dt(c.created_at)}</td>
                  <td>
                    <button className="btn sm" disabled={isLoading || !draft[c.id]} onClick={() => save(c)}>
                      Saqlash
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
