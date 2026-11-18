import { useEffect, useRef, useState } from "react";
import { initials, tone } from "../lib/person";

export function Loading({ label = "Yuklanmoqda…" }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

/**
 * Xatoni oddiy tilda aytadi. Ilgari ekranga «SyntaxError: Unexpected token…»
 * kabi texnik matn chiqardi — endi nima bo'lgani va nima qilish kerakligi,
 * texnik kod esa kichik harf bilan pastda.
 */
export function errorText(error) {
  const status = error?.originalStatus ?? error?.status;
  const detail = error?.data?.detail;
  if (typeof detail === "string" && detail) return { text: detail, code: status };
  if (Array.isArray(detail)) return { text: "Kiritilgan ma'lumot noto'g'ri.", code: status };
  if (error?.status === "FETCH_ERROR") {
    return { text: "Server bilan aloqa yo'q. Internetni tekshirib, qayta urinib ko'ring.", code: null };
  }
  if (error?.status === "TIMEOUT_ERROR") {
    return { text: "Server uzoq javob bermadi. Birozdan keyin qayta urinib ko'ring.", code: null };
  }
  if ([502, 503, 504].includes(status)) {
    return { text: "Panel hozir javob bermayapti — ehtimol yangilanmoqda. Bir daqiqadan keyin qayta urinib ko'ring.", code: status };
  }
  if (typeof status === "number" && status >= 500) {
    return { text: "Serverda xatolik yuz berdi. Qayta urinib ko'ring; takrorlansa, «Jurnal» bo'limini tekshiring.", code: status };
  }
  if (error?.status === "PARSING_ERROR") {
    return { text: "Serverdan tushunarsiz javob keldi. Sahifani yangilab ko'ring.", code: status };
  }
  if (status === 404) return { text: "Topilmadi.", code: status };
  if (status === 403) return { text: "Bu amalga ruxsat yo'q.", code: status };
  return { text: "Kutilmagan xatolik. Qayta urinib ko'ring.", code: status || null };
}

export function ErrorBox({ error, onRetry }) {
  const { text, code } = errorText(error);
  return (
    <div className="note bad" role="alert">
      <span className="grow err-body">
        {text}
        {code ? <small>kod: {code}</small> : null}
      </span>
      {onRetry && (
        <button className="btn sm" onClick={onRetry}>
          Qayta urinish
        </button>
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

function foiz(value) {
  const abs = Math.abs(value);
  const text =
    abs >= 100
      ? String(Math.round(abs))
      : abs.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  return `${text}%`;
}

/**
 * Oldingi davrga nisbatan o'zgarish.
 *
 * Rang YAGONA belgi emas: o'q (↑ ↓ →) va aria matni ham bor — rang
 * ko'rmaydigan yoki qora-oq chop etilgan holatda ham ma'no yo'qolmaydi.
 *
 * `invert` — sarf uchun: sarfning o'sishi yaxshi xabar emas, shuning
 * uchun yashil bilan qizil o'rin almashadi.
 * `value` null bo'lsa oldingi davrda son nol (yoki manfiy) bo'lgan —
 * foiz hisoblab bo'lmaydi, shuning uchun «yangi» yoki «—» chiqadi.
 */
export function Delta({ value, now = 0, hint = "", invert = false }) {
  const good = (up) => (invert ? !up : up);

  if (value === null || value === undefined) {
    if (!now) {
      return (
        <span className="delta none" title={hint || "Oldingi davrda ham bo'lmagan"}>
          —
        </span>
      );
    }
    return (
      <span
        className={`delta ${good(true) ? "good" : "bad"}`}
        title={hint || "Oldingi davrda bo'lmagan"}
      >
        ↑ yangi
      </span>
    );
  }

  if (Math.abs(value) < 0.05) {
    return (
      <span className="delta flat" title={hint} aria-label="o'zgarmadi">
        → 0%
      </span>
    );
  }

  const up = value > 0;
  return (
    <span
      className={`delta ${good(up) ? "good" : "bad"}`}
      title={hint}
      aria-label={`${foiz(value)} ${up ? "o'sish" : "pasayish"}`}
    >
      {up ? "↑" : "↓"} {foiz(value)}
    </span>
  );
}

/** Bosh harflardan iborat avatar. Rang ID bo'yicha barqaror. */
export function Av({ name, seed, size = "" }) {
  return (
    <span className={`av ${tone(seed)} ${size}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Ism + username/ID juftligi — jadval va kartada bir xil ko'rinsin. */
export function Who({ name, meta, seed, size = "" }) {
  return (
    <span className="who">
      <Av name={name} seed={seed} size={size} />
      <span style={{ minWidth: 0 }}>
        <span className="nm">{name}</span>
        {meta && <span className="meta">{meta}</span>}
      </span>
    </span>
  );
}

/** Segment tanlagich: bir nechta o'zaro istisno variant. */
export function Seg({ options, value, onChange }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, label]) => (
        <button
          key={v}
          role="tab"
          aria-selected={v === value}
          className={v === value ? "on" : ""}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Empty({ title, children = "Ma'lumot yo'q.", colSpan }) {
  const body = (
    <>
      {title && <b>{title}</b>}
      <span>{children}</span>
    </>
  );
  if (colSpan) {
    return (
      <tr>
        <td colSpan={colSpan} className="empty">
          {body}
        </td>
      </tr>
    );
  }
  return <div className="empty">{body}</div>;
}

export function Pager({ page, pages, onChange, total }) {
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <span className="mono">
        {page} / {pages} sahifa{total != null && ` · ${total} ta`}
      </span>
      <div className="row">
        <button className="btn sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Oldingi
        </button>
        <button className="btn sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Keyingi
        </button>
      </div>
    </div>
  );
}

/**
 * Qoplama oyna.
 *
 * Esc bilan yopiladi va fon bosilganda ham — tasdiq so'raydigan oyna
 * uchun bu «bekor qilish» degani, shuning uchun `onClose` doim
 * xavfsiz tomonga olib boradi.
 */
export function Modal({ title, sub, onClose, children, width, z }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="scrim"
      style={z ? { zIndex: z } : undefined}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal" style={width ? { width } : undefined} onClick={(e) => e.stopPropagation()}>
        {title && <h3>{title}</h3>}
        {sub && <div className="sub">{sub}</div>}
        {children}
      </div>
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
    <Modal title={state.message} onClose={() => finish(false)} z={40}>
      <div className="acts">
        <button className="btn" onClick={() => finish(false)}>
          Bekor qilish
        </button>
        <button
          className={`btn ${state.danger ? "dan" : "pri"}`}
          onClick={() => finish(true)}
          autoFocus
        >
          Ha, davom etaman
        </button>
      </div>
    </Modal>
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

/** Nomi + qiymati bo'lgan kichik kataklar. */
export function Facts({ children }) {
  return <div className="facts">{children}</div>;
}

export function Fact({ label, children, mono = true }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <span className={mono ? "mono" : ""}>{children}</span>
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
                background: r.color || "var(--brass)",
              }}
            />
          </span>
          <span className="bar-val">{r.text ?? r.value}</span>
        </div>
      ))}
    </div>
  );
}
