import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The UI calls the local Enzo AI engine via relative /api paths. In dev, Vite
// proxies those to the backend so there are no CORS quirks and the same paths
// keep working when the app is packaged later.
//
// Ports: dev backend = 1716, prod (packaged app / Docker) = 1616. Keeping them
// distinct means a running dev server never clashes with an installed app.
const DEV_API_PORT = process.env.ENZO_PORT ?? "1716";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5310,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${DEV_API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
