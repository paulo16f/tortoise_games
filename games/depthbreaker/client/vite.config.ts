import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Connects DIRECTLY to the backend (http://localhost:3100) and the Colyseus
// realtime server (ws://localhost:2667); both have CORS enabled server-side,
// so no dev proxy is configured. See src/config.ts for the URLs.
export default defineConfig({
  plugins: [react()],
  // @solana/web3.js expects Node's `global` + `Buffer`. The trailing slash
  // forces the npm `buffer` package over Vite's externalized Node builtin
  // (main.tsx installs it on globalThis before anything else loads).
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      buffer: "buffer/",
    },
  },
  server: {
    port: 5184,
  },
});
