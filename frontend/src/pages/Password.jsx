import { useState } from "react";
import { useDispatch } from "react-redux";
import { useAdminsQuery, useChangePasswordMutation } from "../store/api";
import { pushToast } from "../store/uiSlice";
import { Card, ErrorBox, Loading, Tag } from "../components/common";
import { dt } from "../lib/format";

const EMPTY = { current: "", new1: "", new2: "" };

export default function Password() {
  const dispatch = useDispatch();
  const { data, isLoading, error, refetch } = useAdminsQuery();
  const [change, { isLoading: saving }] = useChangePasswordMutation();
  const [form, setForm] = useState(EMPTY);
  const [problem, setProblem] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setProblem("");
    if (form.new1 !== form.new2) {
      setProblem("Yangi parollar mos kelmadi.");
      return;
    }
    try {
      await change(form).unwrap();
      dispatch(pushToast("Parol almashtirildi."));
      setForm(EMPTY);
    } catch (err) {
      setProblem(err?.data?.detail || "Almashtirib bo'lmadi.");
    }
  }

  return (
    <div className="grid2">
      <Card title="Parolni almashtirish">
        <div className="pad">
          {problem && <div className="note bad">{problem}</div>}
          <form onSubmit={onSubmit}>
            <label className="fld">
              <span>Joriy parol</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={form.current}
                onChange={(e) => setForm({ ...form, current: e.target.value })}
              />
            </label>
            <label className="fld">
              <span>Yangi parol</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                value={form.new1}
                onChange={(e) => setForm({ ...form, new1: e.target.value })}
              />
            </label>
            <label className="fld">
              <span>Yangi parolni takrorlang</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                value={form.new2}
                onChange={(e) => setForm({ ...form, new2: e.target.value })}
              />
            </label>
            <button className="btn pri" type="submit" disabled={saving}>
              {saving ? "Saqlanmoqda…" : "Almashtirish"}
            </button>
            <p className="hint">
              Kamida 10 belgi. Parol <code>scrypt</code> bilan saqlanadi —
              bazadan o'qib bo'lmaydi.
            </p>
          </form>
        </div>
      </Card>

      <Card title="Admin hisoblari">
        {isLoading && <Loading />}
        {error && <ErrorBox error={error} onRetry={refetch} />}
        {data && (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Login</th>
                  <th>Ism</th>
                  <th>Holat</th>
                  <th>Oxirgi kirish</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.username}>
                    <td className="mono">
                      <b>{a.username}</b>
                    </td>
                    <td>{a.full_name || "—"}</td>
                    <td>
                      <Tag kind={a.is_active ? "ok" : "tugagan"}>
                        {a.is_active ? "faol" : "o'chirilgan"}
                      </Tag>
                    </td>
                    <td className="mono nowrap">{dt(a.last_login_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pad" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="hint" style={{ margin: 0 }}>
            Yangi admin qo'shish serverda amalga oshiriladi:
            <br />
            <code>python manage.py admin-qoshish &lt;login&gt;</code>
          </p>
        </div>
      </Card>
    </div>
  );
}
