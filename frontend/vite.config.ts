import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 2000 }, // plotly.js is ~1.3 MB
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
