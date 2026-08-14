import { useCallback, useEffect, useState } from "react";

/**
 * Yorug'/qorong'i rejim.
 *
 * Tanlov `localStorage` da qoladi — admin har safar qaytadan
 * tanlamaydi. Tanlov bo'lmasa tizim sozlamasi olinadi.
 *
 * Belgi <html> ga qo'yiladi, chunki fon rangi `body` dan tashqariga
 * ham cho'ziladi (sahifa oxirida ortiqcha oq chiziq ko'rinmasin).
 */
const KEY = "tanga.theme";

function initial() {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  // Brauzerning o'z elementlari — aylantirish paneli, tanlash ro'yxati —
  // ham to'g'ri rangda chiqsin.
  document.documentElement.style.colorScheme = theme;
}

// React hali chizmagan paytda ham fon to'g'ri bo'lsin: bu modul
// birinchi chizishdan oldin ishga tushadi, shuning uchun qorong'i
// rejimda oq lipillash ko'rinmaydi.
apply(initial());

export function useTheme() {
  const [theme, setTheme] = useState(initial);

  useEffect(() => {
    apply(theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((t) => (t === "light" ? "dark" : "light")),
    []
  );

  return [theme, toggle];
}
