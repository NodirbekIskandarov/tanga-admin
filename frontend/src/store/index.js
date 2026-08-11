import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { api } from "./api";
import auth from "./authSlice";
import ui from "./uiSlice";

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    auth,
    ui,
  },
  middleware: (getDefault) => getDefault().concat(api.middleware),
});

// Oyna yana faollashganda ma'lumot o'zi yangilanadi — admin panelda
// bu muhim: boshqa admin o'zgartirgan bo'lishi mumkin.
setupListeners(store.dispatch);
