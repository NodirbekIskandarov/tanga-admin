import { createSlice, nanoid } from "@reduxjs/toolkit";

// Serverdan kelmaydigan holat: filtrlar va bildirishnomalar.
// Filtrlarni Redux'da saqlash sahifalar orasida yurganda tanlovni
// yo'qotmaslik uchun kerak.
const initialState = {
  userFilters: { q: "", holat: "", tarif: "", faollik: "", tartib: "yangi", sahifa: 1 },
  requestFilter: "ochiq",
  financeDays: 30,
  statsRange: "oylik",
  // Daromad/sarf bloki: qaysi davr kesimida (kun · hafta · oy), grafikda
  // nechta ustun va grafikmi yoki jadvalmi. Ekranlar orasida yurganda
  // tanlov saqlanadi. Ustunlar soni har bir davr uchun ALOHIDA eslanadi —
  // oyga o'tib qaytganda kunlik oyna 14 kunligicha qoladi.
  cashflowPeriod: "kun",
  cashflowPoints: { kun: 14, hafta: 8, oy: 6 },
  cashflowView: "grafik",
  broadcastLang: "",
  logPage: 1,
  toasts: [],
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setUserFilters(state, { payload }) {
      const resetPage = Object.keys(payload).some((k) => k !== "sahifa");
      state.userFilters = {
        ...state.userFilters,
        ...payload,
        ...(resetPage && payload.sahifa === undefined ? { sahifa: 1 } : {}),
      };
    },
    setRequestFilter(state, { payload }) {
      state.requestFilter = payload;
    },
    setFinanceDays(state, { payload }) {
      state.financeDays = payload;
    },
    setStatsRange(state, { payload }) {
      state.statsRange = payload;
    },
    setCashflowPeriod(state, { payload }) {
      state.cashflowPeriod = payload;
    },
    setCashflowPoints(state, { payload: { davr, nuqta } }) {
      state.cashflowPoints[davr] = nuqta;
    },
    setCashflowView(state, { payload }) {
      state.cashflowView = payload;
    },
    setBroadcastLang(state, { payload }) {
      state.broadcastLang = payload;
    },
    setLogPage(state, { payload }) {
      state.logPage = payload;
    },
    pushToast: {
      reducer(state, { payload }) {
        state.toasts.push(payload);
      },
      prepare(text, kind = "ok") {
        return { payload: { id: nanoid(), text, kind } };
      },
    },
    dismissToast(state, { payload }) {
      state.toasts = state.toasts.filter((t) => t.id !== payload);
    },
  },
});

export const {
  setUserFilters,
  setRequestFilter,
  setFinanceDays,
  setStatsRange,
  setCashflowPeriod,
  setCashflowPoints,
  setCashflowView,
  setBroadcastLang,
  setLogPage,
  pushToast,
  dismissToast,
} = uiSlice.actions;
export default uiSlice.reducer;
