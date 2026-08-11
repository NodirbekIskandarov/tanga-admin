import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Yig'ilgan fayllar FastAPI beradigan katalogga tushadi.
// Ishlab chiqish paytida /api so'rovlari mahalliy backendga yo'naltiriladi.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../static/dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8100", changeOrigin: false },
    },
  },
});
