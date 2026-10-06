import { Navigate, Route, Routes } from "react-router-dom";
import { useSelector } from "react-redux";
import { useSessionQuery } from "./store/api";
import { Loading } from "./components/common";
import Layout from "./components/Layout";
import Toasts from "./components/Toasts";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Payments from "./pages/Payments";
import Users from "./pages/Users";
import UserDetail from "./pages/UserDetail";
import Broadcast from "./pages/Broadcast";
import Stats from "./pages/Stats";
import Finance from "./pages/Finance";
import Log from "./pages/Log";
import Settings from "./pages/Settings";
import Password from "./pages/Password";

export default function App() {
  // Sessiya birinchi yuklanishda tekshiriladi. 401 kelsa authSlice uni
  // ushlaydi va admin=null bo'ladi.
  useSessionQuery();
  const { admin, ready, mustChange } = useSelector((s) => s.auth);

  if (!ready) return <Loading label="Tekshirilmoqda…" />;

  if (!admin) {
    return (
      <>
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
        <Toasts />
      </>
    );
  }

  // Parol terminalda berilgan — avval o'zi almashtiradi (server ham boshqa
  // hamma so'rovni 403 bilan to'xtatadi).
  if (mustChange) {
    return (
      <>
        <div className="login-wrap">
          <div className="login-box" style={{ maxWidth: 760 }}>
            <div className="note warn">
              Parolingiz terminalda ko'rsatilgan edi. Davom etishdan oldin uni
              o'zingiz almashtiring.
            </div>
            <Password />
          </div>
        </div>
        <Toasts />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tolovlar" element={<Payments />} />
          <Route path="/foydalanuvchilar" element={<Users />} />
          <Route path="/xabar" element={<Broadcast />} />
          <Route path="/statistika" element={<Stats />} />
          <Route path="/jurnal" element={<Log />} />
          <Route path="/sozlamalar" element={<Settings />} />

          {/* Menyuda yo'q, lekin ichkaridan havola bilan ochiladi. */}
          <Route path="/foydalanuvchilar/:id" element={<UserDetail />} />
          <Route path="/moliya" element={<Finance />} />
          <Route path="/parol" element={<Password />} />

          <Route path="/sorovlar" element={<Navigate to="/tolovlar" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toasts />
    </>
  );
}
