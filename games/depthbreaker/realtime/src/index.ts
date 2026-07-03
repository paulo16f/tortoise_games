// Colyseus realtime server bootstrap. Wraps the game server in an Express app
// so CORS is handled for the browser client's matchmaking requests (the client
// runs on a different dev origin, e.g. Vite :5173).

import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ZONE_ROOM } from "@depthbreaker/protocol";
import { ZoneRoom } from "./ZoneRoom.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const app = express();
app.use(cors());
app.get("/health", (_req, res) => {
  res.json({ status: "ok", requireTicket: config.requireTicket });
});

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });

gameServer.define(ZONE_ROOM, ZoneRoom);

gameServer
  .listen(config.port)
  .then(() => {
    console.log(`[realtime] Colyseus listening on ws://localhost:${config.port}`);
    console.log(`[realtime] room "${ZONE_ROOM}" | requireTicket=${config.requireTicket} | backend=${config.backendUrl}`);
  })
  .catch((err) => {
    console.error("[realtime] failed to start:", err);
    process.exit(1);
  });
