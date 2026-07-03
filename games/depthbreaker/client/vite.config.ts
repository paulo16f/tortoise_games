import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Connects DIRECTLY to the backend (http://localhost:3000) and the Colyseus
// realtime server (ws://localhost:2567); both have CORS enabled server-side,
// so no dev proxy is configured. See src/config.ts for the URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
