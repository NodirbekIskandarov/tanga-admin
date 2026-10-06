import { useState } from "react";
import { useLoginMutation } from "../store/api";

export default function Login() {
  const [login, { isLoading }] = useLoginMutation();
  const [form, setForm] = useState({ username: "", password: "", code: "" });
  const [error, setError] = useState("");
  // Ikki bosqichli kirish yoqilgan admin: server parolni qabul qilib,
  // `totp: true` qaytaradi — shunda kod maydoni ochiladi.
  const [needCode, setNeedCode] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await login(form).unwrap();
    } catch (err) {
      if (err?.data?.totp) {
        const first = !needCode;
        setNeedCode(true);
        // Birinchi qadamda bu xato emas — shunchaki kod so'ralmoqda.
        if (first && !form.code) return;
      }
      setError(err?.data?.detail || "Kirib bo'lmadi. Qayta urinib ko'ring.");
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-box" onSubmit={onSubmit}>
        <div className="head">
          <img className="login-mark" src="/icon-180.png" alt="Tanga" width="44" height="44" />
          <div>
            <h1>tanga</h1>
            <div className="sub">Admin paneli</div>
          </div>
        </div>

        {error && <div className="note bad">{error}</div>}

        <div>
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

          <label className="fld" style={{ marginBottom: 0 }}>
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

          {needCode && (
            <label className="fld" style={{ marginTop: 12, marginBottom: 0 }}>
              <span>Autentifikator kodi</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                maxLength={8}
                className="mono"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </label>
          )}
        </div>

        <button className="btn pri lg" type="submit" disabled={isLoading}>
          {isLoading ? "Tekshirilmoqda…" : "Kirish"}
        </button>
      </form>
    </div>
  );
}
