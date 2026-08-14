import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useLogoutMutation, useSessionQuery } from "../store/api";
import { pushToast } from "../store/uiSlice";
import { useTheme } from "../lib/theme";
import { dt } from "../lib/format";

// Menyu tartibi va nomlari dizayn bo'yicha. «Umumiy holat» — kirish
// nuqtasi: hamma bo'lim bo'yicha qisqacha javob shu yerda.
const NAV = [
  { to: "/", label: "Umumiy holat", end: true },
  { to: "/tolovlar", label: "To'lovlar", badge: "pending" },
  { to: "/foydalanuvchilar", label: "Foydalanuvchilar" },
  { to: "/xabar", label: "Xabarlar" },
  { to: "/statistika", label: "Statistika" },
  { to: "/jurnal", label: "Jurnal" },
  { to: "/sozlamalar", label: "Sozlamalar" },
];

const TITLES = {
  "/": "Umumiy holat",
  "/tolovlar": "To'lovlar",
  "/foydalanuvchilar": "Foydalanuvchilar",
  "/xabar": "Ommaviy xabar",
  "/statistika": "Statistika",
  "/jurnal": "Jurnal",
  "/sozlamalar": "Sozlamalar",
  "/moliya": "Moliya va AI sarfi",
  "/parol": "Parol va hisoblar",
};

/** Sarlavha yonidagi soat — sahifa ochiq turganini ko'rsatib turadi. */
function Clock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="clock">{dt(now)}</span>;
}

export default function Layout() {
  const { pathname } = useLocation();
  const dispatch = useDispatch();
  const admin = useSelector((s) => s.auth.admin);
  const { data: session } = useSessionQuery();
  const [logout] = useLogoutMutation();
  const [theme, toggleTheme] = useTheme();

  const title =
    TITLES[pathname] ||
    (pathname.startsWith("/foydalanuvchilar/") ? "Foydalanuvchi" : "Admin");

  useEffect(() => {
    document.title = `${title} · Tanga admin`;
  }, [title]);

  async function onLogout() {
    await logout();
    dispatch(pushToast("Tizimdan chiqdingiz."));
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img className="mark" src="/icon-32.png" alt="" width="24" height="24" />
          <span className="logo">tanga</span>
          <span className="sub">admin</span>
        </div>

        <nav>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? "on" : "")}
            >
              <span>{item.label}</span>
              {item.badge && session?.[item.badge] > 0 && (
                <span className="badge">{session[item.badge]}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="side-foot">
          <button className="btn sm" onClick={toggleTheme}>
            {theme === "light" ? "Qorong'i rejim" : "Yorug' rejim"}
          </button>
          <div className="who">
            <div>
              <b>{admin}</b>
              <small>admin</small>
            </div>
            <button className="btn ghost sm" onClick={onLogout}>
              Chiqish
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="content">
          <div className="topbar">
            <h1>{title}</h1>
            <Clock />
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
