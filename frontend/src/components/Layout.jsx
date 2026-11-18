import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useLogoutMutation, useSessionQuery } from "../store/api";
import { pushToast, setUserFilters } from "../store/uiSlice";
import { useTheme } from "../lib/theme";
import Icon from "./Icon";

/**
 * Menyu guruhlari — egasining kundalik ishi bo'yicha: holat, odamlar, pul,
 * tahlil, aloqa, tizim. Ilgari menyu tekis ro'yxat edi va «Moliya», «Parol»
 * umuman ko'rinmasdi.
 */
const GROUPS = [
  { items: [{ to: "/", label: "Umumiy holat", icon: "home", end: true }] },
  {
    title: "Foydalanuvchilar",
    items: [
      { to: "/foydalanuvchilar", label: "Ro'yxat", icon: "users" },
      { to: "/muntazamlik", label: "Muntazamlik", icon: "repeat" },
    ],
  },
  {
    title: "Pul",
    items: [
      { to: "/tolovlar", label: "To'lovlar", icon: "card" },
      { to: "/moliya", label: "Moliya va AI", icon: "coins" },
    ],
  },
  { title: "Tahlil", items: [{ to: "/statistika", label: "Statistika", icon: "chart" }] },
  { title: "Aloqa", items: [{ to: "/xabar", label: "Ommaviy xabar", icon: "send" }] },
  {
    title: "Tizim",
    items: [
      { to: "/tizim", label: "Tizim holati", icon: "server" },
      { to: "/jurnal", label: "Jurnal", icon: "list" },
      { to: "/sozlamalar", label: "Sozlamalar", icon: "settings" },
      { to: "/parol", label: "Parol va hisoblar", icon: "key" },
    ],
  },
];

// Telefon: pastki menyuda eng ko'p kerak bo'ladigan to'rttasi + «Yana».
const TABS = [
  { to: "/", label: "Holat", icon: "home", end: true },
  { to: "/foydalanuvchilar", label: "Odamlar", icon: "users" },
  { to: "/tolovlar", label: "To'lovlar", icon: "card" },
  { to: "/statistika", label: "Tahlil", icon: "chart" },
];

const TITLES = {
  "/": "Umumiy holat",
  "/tolovlar": "To'lovlar",
  "/foydalanuvchilar": "Foydalanuvchilar",
  "/muntazamlik": "Muntazam foydalanuvchilar",
  "/xabar": "Ommaviy xabar",
  "/statistika": "Statistika",
  "/tizim": "Tizim holati",
  "/jurnal": "Jurnal",
  "/sozlamalar": "Sozlamalar",
  "/moliya": "Moliya va AI sarfi",
  "/parol": "Parol va hisoblar",
};

/** Foydalanuvchini istalgan sahifadan topish: ism, @username yoki ID. */
function GlobalSearch({ onDone, hotkey = false }) {
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    if (!hotkey) return undefined;
    // «/» — qidiruvga o'tish (matn maydonida yozilayotgan bo'lmasa).
    function onKey(e) {
      const tag = (e.target.tagName || "").toLowerCase();
      if (e.key === "/" && !["input", "textarea", "select"].includes(tag)) {
        e.preventDefault();
        ref.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  function submit(e) {
    e.preventDefault();
    const text = q.trim().replace(/^@/, "");
    if (!text) return;
    if (/^\d{5,}$/.test(text)) {
      navigate(`/foydalanuvchilar/${text}`);
    } else {
      dispatch(setUserFilters({ q: text, sahifa: 1 }));
      navigate("/foydalanuvchilar");
    }
    setQ("");
    onDone?.();
  }

  return (
    <form className="gsearch" role="search" onSubmit={submit}>
      <Icon name="search" size={16} />
      <input
        ref={ref}
        type="search"
        value={q}
        maxLength={64}
        placeholder="Topish: ism, @username yoki ID"
        aria-label="Foydalanuvchini topish"
        onChange={(e) => setQ(e.target.value)}
      />
      {hotkey && <kbd className="kbd-hint">/</kbd>}
    </form>
  );
}

function NavGroups({ onPick }) {
  return GROUPS.map((g, i) => (
    <div className="navgroup" key={i}>
      {g.title && <div className="navtitle">{g.title}</div>}
      {g.items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onPick}
          className={({ isActive }) => (isActive ? "on" : "")}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </div>
  ));
}

export default function Layout() {
  const { pathname } = useLocation();
  const dispatch = useDispatch();
  const admin = useSelector((s) => s.auth.admin);
  useSessionQuery();
  const [logout] = useLogoutMutation();
  const [theme, toggleTheme] = useTheme();
  const [sheet, setSheet] = useState(false);

  const title =
    TITLES[pathname] ||
    (pathname.startsWith("/foydalanuvchilar/") ? "Foydalanuvchi" : "Admin");

  useEffect(() => {
    document.title = `${title} · Tanga admin`;
    setSheet(false);
  }, [title, pathname]);

  async function onLogout() {
    await logout();
    dispatch(pushToast("Tizimdan chiqdingiz."));
  }

  const footer = (
    <div className="side-foot">
      <button className="btn sm ghost" onClick={toggleTheme}>
        <Icon name={theme === "light" ? "moon" : "sun"} size={16} />
        {theme === "light" ? "Qorong'i rejim" : "Yorug' rejim"}
      </button>
      <div className="who">
        <div>
          <b>{admin}</b>
          <small>admin</small>
        </div>
        <button className="btn ghost sm" onClick={onLogout} title="Chiqish">
          <Icon name="logout" size={16} />
          Chiqish
        </button>
      </div>
    </div>
  );

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img className="mark" src="/icon-32.png" alt="" width="24" height="24" />
          <span className="logo">tanga</span>
          <span className="sub">admin</span>
        </div>
        <nav aria-label="Bo'limlar">
          <NavGroups />
        </nav>
        {footer}
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{title}</h1>
          {/* Ro'yxat sahifasining o'z qidiruvi bor — ikkinchisi chalg'itadi. */}
          {pathname !== "/foydalanuvchilar" && <GlobalSearch hotkey />}
        </header>
        <div className="content">
          <Outlet />
        </div>
      </main>

      {/* Telefon: pastki menyu. Qolgan bo'limlar — «Yana» ichida. */}
      <nav className="tabbar" aria-label="Asosiy bo'limlar">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? "on" : "")}>
            <Icon name={t.icon} size={20} />
            <span>{t.label}</span>
          </NavLink>
        ))}
        <button className={sheet ? "on" : ""} onClick={() => setSheet(true)}>
          <Icon name="more" size={20} />
          <span>Yana</span>
        </button>
      </nav>

      {sheet && (
        <div className="sheet-back" onClick={() => setSheet(false)}>
          <div className="sheet" role="dialog" aria-label="Barcha bo'limlar" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <b>Bo'limlar</b>
              <button className="btn ghost sm" onClick={() => setSheet(false)} aria-label="Yopish">
                <Icon name="close" size={18} />
              </button>
            </div>
            <nav className="sheet-nav">
              <NavGroups onPick={() => setSheet(false)} />
            </nav>
            {footer}
          </div>
        </div>
      )}
    </div>
  );
}
