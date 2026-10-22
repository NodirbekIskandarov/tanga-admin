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
    "Settings", "Broadcast", "System"],
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
      // Parol almashganda server yangi sessiya (va yangi CSRF tokeni) beradi.
      invalidatesTags: ["Session"],
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
                segment = "", til = "", manba = "",
                tartib = "yangi", sahifa = 1 }) => ({
        url: "/users",
        params: { q, holat, tarif, faollik, segment, til, manba, tartib, sahifa },
      }),
      providesTags: ["Users"],
    }),
    user: build.query({
      query: (id) => `/users/${id}`,
      providesTags: (r, e, id) => [{ type: "User", id }],
    }),
    // `userTransactions` OLIB TASHLANDI: foydalanuvchining yozuvlari
    // alohida shifrlangan bazada va serverda uning kaliti yo'q.
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
    // Daromad va sarf tanlangan davr (kun · hafta · oy) kesimida.
    // ATAYLAB alohida so'rov: bloki bir nechta ekranda ishlatiladi va
    // xatosi butun sahifani yiqitmasligi, o'zi qayta urina olishi kerak.
    // `nuqta` — grafikdagi ustunlar soni.
    cashflow: build.query({
      query: ({ davr = "kun", nuqta = 0 } = {}) => ({
        url: "/cashflow",
        params: { davr, nuqta },
      }),
      providesTags: ["Finance"],
    }),

    // AI xarajati kun · hafta · oy · yil kesimida, aniq qiymatlar bilan.
    aiCost: build.query({
      query: ({ davr = "kun", nuqta = 0 } = {}) => ({ url: "/ai-cost", params: { davr, nuqta } }),
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
      invalidatesTags: ["Broadcast"],
    }),
    // Reklama videosi: fayl xom bayt sifatida ketadi (multipart emas),
    // nomi sarlavhada. Javob — video_id, u sendBroadcast'ga beriladi.
    uploadBroadcastVideo: build.mutation({
      query: (file) => ({
        url: "/broadcast/video",
        method: "POST",
        body: file,
        headers: {
          "Content-Type": file.type || "video/mp4",
          "X-File-Name": encodeURIComponent(file.name || "video.mp4"),
        },
      }),
    }),
    removeBroadcastVideo: build.mutation({
      query: (id) => ({ url: `/broadcast/video/${id}`, method: "DELETE" }),
    }),
    // Yuborish fonda ketadi — interfeys shu holatni so'rab turadi.
    broadcastJob: build.query({
      query: () => "/broadcast/job",
      providesTags: ["Broadcast"],
    }),
    // Xato yoki takroriy to'lov yozuvini daromaddan chiqarish (pul qaytarilmaydi).
    voidPayment: build.mutation({
      query: (id) => ({ url: `/payments/${id}/void`, method: "POST" }),
      invalidatesTags: ["User", "Users", "Dashboard", "Finance"],
    }),

    // ---- Jurnal ----
    // Tizim holati: bot heartbeat, rejali ishlar, xatolar, voqealar, kategoriyalar.
    system: build.query({
      query: () => "/system",
      providesTags: ["System"],
    }),
    updateCategory: build.mutation({
      query: ({ id, ...body }) => ({ url: `/categories/${id}`, method: "POST", body }),
      invalidatesTags: ["System", "Dashboard"],
    }),
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
  useUploadBroadcastVideoMutation,
  useRemoveBroadcastVideoMutation,
  useBroadcastJobQuery,
  useVoidPaymentMutation,
  useLogQuery,
  useAiCostQuery,
  useSystemQuery,
  useUpdateCategoryMutation,
} = api;
