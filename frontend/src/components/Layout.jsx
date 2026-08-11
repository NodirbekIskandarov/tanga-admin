import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useLogoutMutation, useSessionQuery } from "../store/api";
import { pushToast } from "../store/uiSlice";

const NAV = [
  { to: "/", icon: "📊", label: "Umumiy holat", end: true },
  { to: "/foydalanuvchilar", icon: "👥", label: "Foydalanuvchilar" },
  { to: "/sorovlar", icon: "💎", label: "Obuna so'rovlari", badge: "pending" },
  { to: "/moliya", icon: "💰", label: "Moliya va sarf" },
  { group: "Amallar" },
  { to: "/xabar", icon: "📣", label: "Ommaviy xabar" },
  { to: "/jurnal", icon: "📋", label: "Amallar jurnali" },
  { to: "/parol", icon: "🔑", label: "Parol va hisoblar" },
];

const TITLES = {
  "/": "Umumiy holat",
  "/foydalanuvchilar": "Foydalanuvchilar",
  "/sorovlar": "Obuna so'rovlari",
  "/moliya": "Moliya va AI sarfi",
  "/xabar": "Ommaviy xabar",
  "/jurnal": "Amallar jurnali",
  "/parol": "Parol va hisoblar",
};

export default function Layout() {
  const { pathname } = useLocation();
  const dispatch = useDispatch();
  const admin = useSelector((s) => s.auth.admin);
  const { data: session } = useSessionQuery();
  const [logout] = useLogoutMutation();

  const title =
    TITLES[pathname] ||
    (pathname.startsWith("/foydalanuvchilar/") ? "Foydalanuvchi" : "Admin");

  async function onLogout() {
    await logout();
    dispatch(pushToast("Tizimdan chiqdingiz."));
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="logo">
            <span className="dot" /> Hisobchi AI
          </div>
          <div className="sub">Boshqaruv paneli</div>
        </div>

        <nav>
          {NAV.map((item, i) =>
            item.group ? (
              <div className="group" key={`g${i}`}>
                {item.group}
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? "on" : "")}
              >
                <span className="ic">{item.icon}</span>
                {item.label}
                {item.badge && session?.[item.badge] > 0 && (
                  <span className="badge">{session[item.badge]}</span>
                )}
              </NavLink>
            )
          )}
        </nav>

        <div className="side-foot">
          <span>
            <b>{admin}</b>
          </span>
          <button className="btn sm" onClick={onLogout}>
            Chiqish
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h1>{title}</h1>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
