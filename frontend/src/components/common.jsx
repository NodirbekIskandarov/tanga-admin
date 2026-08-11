import { useEffect, useRef, useState } from "react";

export function Loading({ label = "Yuklanmoqda…" }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  const detail =
    error?.data?.detail ||
    error?.error ||
    (error?.status ? `Xatolik ${error.status}` : "Noma'lum xatolik");
  return (
    <div className="note bad">
      {detail}
      {onRetry && (
        <>
          {" "}
          <button className="btn sm" onClick={onRetry} style={{ marginLeft: 8 }}>
            Qayta urinish
          </button>
        </>
      )}
    </div>
  );
}

export function Card({ title, action, children, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <h2>
          {title}
          {action && (
            <>
              <span className="spacer" />
              {action}
            </>
          )}
        </h2>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone = "" }) {
  return (
    <div className={`kpi ${tone}`}>
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Tag({ children, kind }) {
  return <span className={`tag ${kind || ""}`}>{children}</span>;
}

export function Empty({ children = "Ma'lumot yo'q.", colSpan }) {
  if (colSpan) {
    return (
      <tr>
        <td colSpan={colSpan} className="empty">
          {children}
        </td>
      </tr>
    );
  }
  return <div className="empty">{children}</div>;
}

export function Pager({ page, pages, onChange, total }) {
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <span className="cnt">
        {page} / {pages} sahifa{total != null && ` · ${total} ta`}
      </span>
      {page > 1 && (
        <button className="btn sm" onClick={() => onChange(page - 1)}>
          ← Oldingi
        </button>
      )}
      {page < pages && (
        <button className="btn sm" onClick={() => onChange(page + 1)}>
          Keyingi →
        </button>
      )}
    </div>
  );
}

/** Tasdiqlash oynasi — window.confirm o'rniga, matnni to'liq boshqarish uchun. */
export function useConfirm() {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  function ask(message, danger = false) {
    setState({ message, danger });
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }

  function finish(answer) {
    setState(null);
    resolver.current?.(answer);
    resolver.current = null;
  }

  const dialog = state ? (
    <div
      className="lightbox"
      style={{ cursor: "default" }}
      onClick={() => finish(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card"
        style={{ maxWidth: 460, margin: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pad">
          <p style={{ margin: "0 0 18px", fontSize: 15 }}>{state.message}</p>
          <div className="inline" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => finish(false)}>
              Bekor
            </button>
            <button
              className={`btn ${state.danger ? "dan" : "pri"}`}
              onClick={() => finish(true)}
              autoFocus
            >
              Ha, davom etaman
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return [ask, dialog];
}

/** Rasmni to'liq ekranda ko'rsatish. */
export function Lightbox({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!src) return null;
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <img src={src} alt="To'lov cheki" />
    </div>
  );
}

export function Bars({ rows, max }) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span>{r.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{
                width: `${Math.min(100, (100 * r.value) / top)}%`,
                background: r.color || "var(--brand)",
              }}
            />
          </span>
          <span className="bar-val">{r.text ?? r.value}</span>
        </div>
      ))}
    </div>
  );
}
