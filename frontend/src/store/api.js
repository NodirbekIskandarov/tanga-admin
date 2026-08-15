import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { sessionExpired } from "./authSlice";

// CSRF tokeni sessiyaning ichida keladi va har bir o'zgartiruvchi
// so'rovda sarlavhada qaytariladi. Cookie SameSite=Strict — boshqa sayt
// so'rov yubora olmaydi; bu ikkinchi qatlam.
const baseQuery = fetchBaseQuery({
  baseUrl: "/api",
  credentials: "same-origin",
  prepareHeaders: (headers, { getState, type }) => {
    if (type === "mutation") {
      const csrf = getState().auth.csrf;
      if (csrf) headers.set("X-CSRF-Token", csrf);
    }
    return headers;
  },
});

// 401 kelsa — sessiya tugagan, foydalanuvchini kirish sahifasiga qaytaramiz.
const baseQueryWithAuth = async (args, api, extra) => {
  const result = await baseQuery(args, api, extra);
  const isLogin = typeof args === "object" && args.url === "/login";
  if (result.error?.status === 401 && !isLogin) {
    api.dispatch(sessionExpired());
  }
  return result;
};

export const api = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithAuth,
  tagTypes: [
    "Session", "Users", "User", "Requests", "Dashboard", "Finance", "Log",
    "Settings",
  ],
  endpoints: (build) => ({
    // ---- Sessiya ----
    session: build.query({
      query: () => "/session",
      providesTags: ["Session"],
    }),
    login: build.mutation({
      query: (body) => ({ url: "/login", method: "POST", body }),
      invalidatesTags: ["Session"],
    }),
    logout: build.mutation({
      query: () => ({ url: "/logout", method: "POST" }),
      invalidatesTags: ["Session"],
    }),
    changePassword: build.mutation({
      query: (body) => ({ url: "/password", method: "POST", body }),
    }),
    admins: build.query({ query: () => "/admins" }),

    // ---- Boshqaruv paneli ----
    dashboard: build.query({
      query: () => "/dashboard",
      providesTags: ["Dashboard"],
    }),

    // ---- Foydalanuvchilar ----
    users: build.query({
      query: ({ q = "", holat = "", tarif = "", faollik = "",
                tartib = "yangi", sahifa = 1 }) => ({
        url: "/users",
        params: { q, holat, tarif, faollik, tartib, sahifa },
      }),
      providesTags: ["Users"],
    }),
    user: build.query({
      query: (id) => `/users/${id}`,
      providesTags: (r, e, id) => [{ type: "User", id }],
    }),
    // Izohlar shaxsiy ma'lumot: ular kartaga avtomatik yuklanmaydi va
    // faqat admin ataylab so'raganda olinadi. Har bir so'rov serverda
    // jurnalga yoziladi, shuning uchun keshlanmaydi ham.
    userTransactions: build.query({
      query: (id) => `/users/${id}/transactions`,
      keepUnusedDataFor: 0,
    }),
    userAction: build.mutation({
      query: ({ id, ...body }) => ({
        url: `/users/${id}/action`,
        method: "POST",
        body,
      }),
      invalidatesTags: (r, e, { id }) => [
        { type: "User", id },
        "Users",
        "Dashboard",
        "Finance",
      ],
    }),

    // ---- Obuna so'rovlari ----
    requests: build.query({
      query: (holat = "ochiq") => ({ url: "/requests", params: { holat } }),
      providesTags: ["Requests"],
    }),
    decideRequest: build.mutation({
      query: ({ id, ...body }) => ({
        url: `/requests/${id}/decide`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["Requests", "Session", "Dashboard", "Users", "Finance"],
    }),

    // ---- Moliya va statistika ----
    finance: build.query({
      query: (kun = 30) => ({ url: "/finance", params: { kun } }),
      providesTags: ["Finance"],
    }),
    stats: build.query({
      query: (davr = "oylik") => ({ url: "/stats", params: { davr } }),
      providesTags: ["Finance"],
    }),
    // Kunlik/haftalik daromad va sarf. ATAYLAB alohida so'rov: bloki bir
    // nechta ekranda ishlatiladi va xatosi butun sahifani yiqitmasligi,
    // o'zi qayta urina olishi kerak.
    cashflow: build.query({
      query: (kun = 14) => ({ url: "/cashflow", params: { kun } }),
      providesTags: ["Finance"],
    }),

    // ---- Sozlamalar ----
    settings: build.query({ query: () => "/settings", providesTags: ["Settings"] }),
    saveSettings: build.mutation({
      query: (body) => ({ url: "/settings", method: "POST", body }),
      invalidatesTags: ["Settings", "Users", "Requests", "Finance"],
    }),

    // ---- Ommaviy xabar ----
    broadcastInfo: build.query({ query: () => "/broadcast" }),
    sendBroadcast: build.mutation({
      query: (body) => ({ url: "/broadcast", method: "POST", body }),
    }),

    // ---- Jurnal ----
    log: build.query({
      query: (sahifa = 1) => ({ url: "/log", params: { sahifa } }),
      providesTags: ["Log"],
    }),
  }),
});

export const {
  useSessionQuery,
  useLoginMutation,
  useLogoutMutation,
  useChangePasswordMutation,
  useAdminsQuery,
  useDashboardQuery,
  useUsersQuery,
  useUserQuery,
  useLazyUserTransactionsQuery,
  useUserActionMutation,
  useRequestsQuery,
  useDecideRequestMutation,
  useFinanceQuery,
  useStatsQuery,
  useCashflowQuery,
  useSettingsQuery,
  useSaveSettingsMutation,
  useBroadcastInfoQuery,
  useSendBroadcastMutation,
  useLogQuery,
} = api;
