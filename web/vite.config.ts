import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The UI calls the local Enzo engine via relative /api paths. In dev, Vite
// proxies those to the backend so there are no CORS quirks and the same paths
// keep working when the app is packaged later.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5310,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:6666",
        changeOrigin: true,
      },
    },
  },
});
