import http from "node:http";
import { WebSocketServer } from "ws";
import { RoomRouter } from "./router.js";

const router = new RoomRouter();
const server = http.createServer((_, response) => {
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("Flash Speaker relay\n");
});
const wss = new WebSocketServer({
  server,
  maxPayload: 32 * 1024,
  perMessageDeflate: false,
});
const allowed = new Set(
  (
    process.env.ALLOWED_ORIGINS ||
    "http://127.0.0.1:8091,http://localhost:8091,https://rhythm-sanghi.github.io"
  ).split(","),
);
wss.on("connection", (socket, request) => {
  if (!allowed.has(request.headers.origin)) {
    socket.close(1008, "Origin not allowed");
    return;
  }
  let count = 0,
    windowStart = Date.now();
  const registration = setTimeout(() => {
    if (!router.clients.has(socket)) socket.close(1008, "Join timed out");
  }, 10000);
  socket.on("message", (raw) => {
    if (Date.now() - windowStart >= 1000) {
      count = 0;
      windowStart = Date.now();
    }
    if (++count > 180) {
      socket.close(1008, "Message rate exceeded");
      return;
    }
    try {
      router.receive(socket, JSON.parse(raw));
    } catch {
      socket.close(1008, "Invalid message");
    }
  });
  socket.on("close", () => {
    clearTimeout(registration);
    router.leave(socket);
  });
  socket.on("error", () => router.leave(socket));
  socket.isAlive = true;
  socket.on("pong", () => (socket.isAlive = true));
});
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30000);
server.on("close", () => clearInterval(heartbeat));
server.listen(
  Number(process.env.PORT || 8787),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      "Flash Speaker relay listening on port " + (process.env.PORT || 8787),
    ),
);
