import { PROTOCOL, roomCode } from "../src/core.js";

// Socket identity is bound at join; clients cannot choose a sender in an envelope.
export class RoomRouter {
  constructor() {
    this.rooms = new Map();
    this.clients = new Map();
  }
  send(socket, message) {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }
  receive(socket, message) {
    if (!message || typeof message !== "object") return;
    const client = this.clients.get(socket);
    if (message.type === "join") {
      if (client) return;
      if (
        message.protocol !== PROTOCOL ||
        roomCode(message.room) !== message.room ||
        !["host", "guest"].includes(message.role) ||
        typeof message.id !== "string" ||
        !message.id.length ||
        message.id.length > 100 ||
        (message.role === "guest" && message.id === "host")
      ) {
        this.send(socket, {
          type: "error",
          message: "Invalid room registration.",
        });
        socket.close(1008);
        return;
      }
      let room = this.rooms.get(message.room);
      if (message.role === "host") {
        if (room) {
          this.send(socket, {
            type: "error",
            message: "This room already has a host.",
          });
          socket.close(1008);
          return;
        }
        if (this.rooms.size >= 100) {
          socket.close(1013);
          return;
        }
        room = { host: socket, guests: new Map() };
        this.rooms.set(message.room, room);
      } else if (
        !room ||
        room.guests.size >= 12 ||
        room.guests.has(message.id)
      ) {
        this.send(socket, {
          type: "error",
          message:
            "Room unavailable. Check that the host is connected to this relay.",
        });
        socket.close(1008);
        return;
      } else room.guests.set(message.id, socket);
      this.clients.set(socket, {
        room: message.room,
        id: message.role === "host" ? "host" : message.id,
        role: message.role,
      });
      this.send(socket, { type: "joined" });
      if (message.role === "guest")
        this.send(room.host, { type: "peer-joined", id: message.id });
      return;
    }
    if (!client) return;
    const room = this.rooms.get(client.room);
    if (!room) return;
    if (message.type === "remove" && client.role === "host") {
      room.guests.get(message.to)?.close(1000, "Removed by host");
      return;
    }
    if (
      message.type !== "message" ||
      !message.payload ||
      typeof message.payload !== "object"
    )
      return;
    const target =
      client.role === "guest" ? room.host : room.guests.get(message.to);
    if (target)
      this.send(target, {
        type: "message",
        from: client.id,
        payload: message.payload,
      });
  }
  leave(socket) {
    const client = this.clients.get(socket);
    if (!client) return;
    this.clients.delete(socket);
    const room = this.rooms.get(client.room);
    if (!room) return;
    if (client.role === "host") {
      this.rooms.delete(client.room);
      for (const guest of room.guests.values()) {
        this.clients.delete(guest);
        guest.close(1001, "Host left the room");
      }
    } else {
      room.guests.delete(client.id);
      this.send(room.host, { type: "peer-left", id: client.id });
    }
  }
}
