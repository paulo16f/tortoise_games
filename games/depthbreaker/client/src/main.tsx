// Node-globals polyfill MUST come first: @solana/web3.js (Phantom payments)
// reads Buffer at import time — without this the whole module graph dies and
// the page renders blank.
import { Buffer } from "buffer";
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer ?? Buffer;

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
