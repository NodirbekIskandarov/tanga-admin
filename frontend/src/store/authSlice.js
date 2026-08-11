import { createSlice } from "@reduxjs/toolkit";
import { api } from "./api";

// Sessiya holati. CSRF tokeni faqat xotirada saqlanadi — localStorage'ga
// yozilmaydi, shunda XSS bo'lsa ham u yerdan o'g'irlab bo'lmaydi.
const initialState = {
  admin: null,
  csrf: null,
  ready: false, // birinchi /session so'rovi tugadimi
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    sessionExpired(state) {
      state.admin = null;
      state.csrf = null;
      state.ready = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addMatcher(api.endpoints.session.matchFulfilled, (state, { payload }) => {
        state.admin = payload.admin;
        state.csrf = payload.csrf;
        state.ready = true;
      })
      .addMatcher(api.endpoints.session.matchRejected, (state) => {
        state.admin = null;
        state.csrf = null;
        state.ready = true;
      })
      .addMatcher(api.endpoints.login.matchFulfilled, (state, { payload }) => {
        state.admin = payload.admin;
        state.csrf = payload.csrf;
        state.ready = true;
      })
      .addMatcher(api.endpoints.logout.matchFulfilled, (state) => {
        state.admin = null;
        state.csrf = null;
        state.ready = true;
      });
  },
});

export const { sessionExpired } = authSlice.actions;
export default authSlice.reducer;
