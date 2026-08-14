import { useEffect, useState } from "react";

/**
 * «Qachon yangilangan» ko'rsatkichi.
 *
 * Sahifalar endi o'zi qayta so'raydi (pollingInterval). Ko'rsatkichsiz
 * bu ko'rinmaydi: ekrandagi son eskimi yoki hozirgimi — bilib bo'lmaydi.
 * Yosh har soniya sanaladi, shuning uchun yangilanish to'xtasa raqam
 * o'sib ketadi va darhol sezildi.
 *
 * `at` — RTK Query beradigan fulfilledTimeStamp.
 */
export default function Fresh({ at, busy = false }) {
  const [, force] = useState(0);

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!at) return null;

  const age = Math.round((Date.now() - at) / 1000);
  const text = busy
    ? "yangilanmoqda…"
    : age < 5
      ? "hozir yangilandi"
      : age < 60
        ? `${age} soniya oldin`
        : `${Math.round(age / 60)} daqiqa oldin`;

  return (
    <span className={`fresh${busy ? " busy" : ""}`} title="Ma'lumot o'zi yangilanib turadi">
      <i />
      {text}
    </span>
  );
}
