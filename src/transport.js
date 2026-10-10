import { Peer } from "peerjs";
import { PROTOCOL, roomCode } from "./core.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const peerId = (room) => `flash-speaker-v${PROTOCOL}-${room}`;

export function createPeer(room, config = {}) {
  return new Peer(room ? peerId(room) : undefined, {
    debug: 0,
    ...(config.peerServer || {}),
    config: {
      iceServers: config.iceServers || [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    },
  });
}

export function peerLink(conn, onMessage, onClose) {
  let closed = false;
  conn.on("data", (message) => {
    if (!closed) onMessage(message);
  });
  const end = () => {
    if (!closed) {
      closed = true;
      onClose?.();
    }
  };
  conn.on("close", end);
  conn.on("error", end);
  return {
    transport: "WebRTC",
    get open() {
      return !closed && conn.open;
    },
    send(message) {
      if (!closed && conn.open) conn.send(message);
    },
    async writable() {
      const deadline = Date.now() + 15000;
      while (
        !closed &&
        conn.open &&
        (conn.bufferSize > 4 || conn.dataChannel?.bufferedAmount > 256 * 1024)
      ) {
        if (Date.now() > deadline)
          throw new Error(
            "The receiver is not accepting audio. Reconnect and try again.",
          );
        await sleep(20);
      }
      if (closed || !conn.open)
        throw new Error("Receiver disconnected during transfer.");
    },
    close() {
      if (!closed) {
        closed = true;
        conn.close();
      }
    },
  };
}

export function relayURL(value) {
  if (!value) return null;
  const url = new URL(value);
  if (
    url.protocol !== "wss:" &&
    !(
      url.protocol === "ws:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("The relay must use WSS, or WS on localhost.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Use a relay URL without credentials or query parameters.");
  return url.href;
}

export class Relay {
  constructor(url, room, role, { onJoin, onMessage, onClose, onError } = {}) {
    if (!roomCode(room)) throw new Error("Invalid room code.");
    this.role = role;
    this.room = room;
    this.callbacks = { onJoin, onMessage, onClose, onError };
    this.ws = new WebSocket(relayURL(url));
    this.ready = false;
    this.closed = false;
    this.id = crypto.randomUUID();
    this.ws.onopen = () =>
      this.ws.send(
        JSON.stringify({
          type: "join",
          room,
          role,
          id: this.id,
          protocol: PROTOCOL,
        }),
      );
    this.ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "joined") {
        this.ready = true;
        this.callbacks.onJoin?.(message);
      } else if (message.type === "peer-joined" || message.type === "peer-left")
        this.callbacks.onMessage?.(message);
      else if (message.type === "message") {
        const data = message.payload;
        if (data?.type === "chunk" && typeof data.data === "string") {
          if (data.data.length > 24000) return;
          try {
            data.data = Uint8Array.from(atob(data.data), (c) =>
              c.charCodeAt(0),
            ).buffer;
          } catch {
            return;
          }
        }
        this.callbacks.onMessage?.({ ...message, payload: data });
      } else if (message.type === "error")
        this.callbacks.onError?.(new Error(message.message));
    };
    this.ws.onclose = () => {
      this.ready = false;
      if (!this.closed) this.callbacks.onClose?.();
    };
    this.ws.onerror = () =>
      this.callbacks.onError?.(
        new Error(
          "Relay connection failed. Check the relay address and network.",
        ),
      );
  }
  link(id) {
    const relay = this;
    return {
      transport: "Relay",
      get open() {
        return relay.ready && !relay.closed;
      },
      send(message) {
        if (!relay.ready) return;
        if (message.type === "chunk")
          message = {
            ...message,
            data: btoa(String.fromCharCode(...new Uint8Array(message.data))),
          };
        relay.ws.send(
          JSON.stringify({ type: "message", to: id, payload: message }),
        );
      },
      async writable() {
        const deadline = Date.now() + 15000;
        while (relay.ready && relay.ws.bufferedAmount > 256 * 1024) {
          if (Date.now() > deadline)
            throw new Error("Relay transfer timed out.");
          await sleep(20);
        }
        if (!relay.ready) throw new Error("Relay disconnected.");
      },
      close() {
        if (relay.role === "guest") relay.close();
        else if (relay.ready)
          relay.ws.send(JSON.stringify({ type: "remove", to: id }));
      },
    };
  }
  close() {
    this.closed = true;
    this.ready = false;
    this.ws.close();
  }
}
