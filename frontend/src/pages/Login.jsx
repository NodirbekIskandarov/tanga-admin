import { useState } from "react";
import { useLoginMutation } from "../store/api";

export default function Login() {
  const [login, { isLoading }] = useLoginMutation();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await login(form).unwrap();
    } catch (err) {
      setError(err?.data?.detail || "Kirib bo'lmadi. Qayta urinib ko'ring.");
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-box" onSubmit={onSubmit}>
        <img className="login-mark" src="/icon-180.png" alt="Tanga" width="72" height="72" />
        <h1>Tanga</h1>
        <p className="sub">Admin boshqaruv paneli</p>

        {error && <div className="note bad">{error}</div>}

        <label className="fld">
          <span>Login</span>
          <input
            type="text"
            autoComplete="username"
            autoFocus
            required
            maxLength={64}
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </label>

        <label className="fld">
          <span>Parol</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>

        <button className="btn pri" type="submit" disabled={isLoading}>
          {isLoading ? "Tekshirilmoqda…" : "Kirish"}
        </button>
      </form>
    </div>
  );
}
