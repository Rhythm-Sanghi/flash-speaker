import qrcode from "qrcode-generator";
import {
  MAX_FILE_BYTES,
  CHUNK_BYTES,
  PROTOCOL,
  roomCode,
  newRoomCode,
  videoId,
  now,
  clockSample,
  estimateClock,
  positionAt,
  formatTime,
  Transfer,
  digest,
  clamp,
} from "./core.js";
import { AudioEngine, testTone } from "./audio.js";
import { createPeer, peerId, peerLink, Relay, relayURL } from "./transport.js";
import { YouTubePlayer } from "./youtube.js";

const $ = (id) => document.getElementById(id);
const text = (id, value) => ($(id).textContent = value);
const show = (id, visible) => ($(id).hidden = !visible);
const config = window.FLASH_SPEAKER_CONFIG || {};
const state = {
  role: null,
  room: null,
  status: "idle",
  track: null,
  command: { playing: false, position: 0, target: 0, seq: 0 },
  peer: null,
  link: null,
  relay: null,
  guests: new Map(),
  offset: 0,
  rtt: 0,
  clockReady: false,
  ready: false,
  transfer: null,
  adjustment: 0,
  epoch: 0,
  load: 0,
  seq: 0,
  pending: null,
  timers: new Set(),
  pings: new Map(),
  syncing: false,
  guestNumber: 0,
};
const audio = new AudioEngine(ended);
const youtube = new YouTubePlayer();
let scanner = null,
  scannerStarting = false,
  wakeLock = null,
  messageTimer = null;
let selectedSource = "file";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function notify(message, error = false) {
  clearTimeout(messageTimer);
  text("message-text", message);
  $("message").classList.toggle("error", error);
  show("message", true);
  if (!error) messageTimer = setTimeout(() => show("message", false), 6500);
}
function failure(error) {
  notify(error.message || String(error), true);
}
function receiverFailure(error) {
  audio.stop();
  youtube.pause();
  clearPending();
  state.ready = false;
  state.command.playing = false;
  state.transfer = null;
  status("Playback preparation failed · reconnect to try again");
  render();
  failure(error);
}
function receiveGuest(message, epoch) {
  if (epoch !== state.epoch) return;
  guestMessage(message).catch((error) => {
    if (epoch === state.epoch) receiverFailure(error);
  });
}
function action(fn) {
  return async (event) => {
    try {
      await fn(event);
    } catch (error) {
      failure(error);
    }
  };
}
function later(fn, delay) {
  const timer = setTimeout(
    () => {
      state.timers.delete(timer);
      fn();
    },
    Math.max(0, delay),
  );
  state.timers.add(timer);
  return timer;
}
function clearPending() {
  if (state.pending) {
    clearTimeout(state.pending);
    state.timers.delete(state.pending);
    state.pending = null;
  }
}
function duration() {
  return state.track?.mode === "youtube"
    ? youtube.duration()
    : audio.buffer?.duration || 0;
}
function output() {
  audio.setOutput(
    Number($("volume").value) / 100,
    $("channel").value,
    $("mute").checked,
  );
  youtube.volume(Number($("volume").value) / 100, $("mute").checked);
  text("volume-value", $("volume").value + "%");
}
function status(value) {
  state.status = value;
  text("connection-status", value);
  show(
    "reconnect",
    state.role === "guest" && /Disconnected|failed|unavailable/i.test(value),
  );
}
function broadcast(message) {
  for (const guest of state.guests.values()) guest.link.send(message);
}
function send(message) {
  state.link?.send(message);
}
function trackMeta() {
  const t = state.track;
  return t
    ? {
        id: t.id,
        name: t.name,
        mode: t.mode,
        bytes: t.bytes,
        hash: t.hash,
        chunks: t.chunks,
        videoId: t.videoId,
        duration: t.duration,
      }
    : null;
}

function tab(role) {
  show("host-setup", role === "host");
  show("guest-setup", role === "guest");
  $("host-tab").setAttribute("aria-selected", String(role === "host"));
  $("guest-tab").setAttribute("aria-selected", String(role === "guest"));
  $("host-tab").tabIndex = role === "host" ? 0 : -1;
  $("guest-tab").tabIndex = role === "guest" ? 0 : -1;
}

function render() {
  const inRoom = !!state.role;
  const connecting = state.status === "connecting";
  for (const id of ["host-tab", "guest-tab", "audio-file", "test-tone"])
    $(id).disabled = connecting;
  for (const input of document.querySelectorAll('[name="source"]'))
    input.disabled = connecting;
  show("setup", !inRoom);
  show("room", inRoom);
  show("invite", state.role === "host");
  show("receivers", state.role === "host");
  show("host-lead", state.role === "host");
  show("clock-details", state.role === "guest");
  show("guest-adjustment", state.role === "guest");
  show("player-controls", state.role === "host");
  show("replace-label", state.role === "host" && state.track?.mode === "file");
  text(
    "role-label",
    state.role === "host" ? "01 / Host room" : "02 / Receiver",
  );
  text(
    "room-title",
    state.role === "host" ? "Playback room" : "Connected speaker",
  );
  text("track-name", state.track?.name || "Waiting for the host");
  text(
    "track-detail",
    state.track
      ? state.track.mode === "youtube"
        ? "YouTube · each device streams independently"
        : `${(state.track.bytes / 1048576).toFixed(2)} MiB · ${formatTime(state.track.duration)} · transferred before playback`
      : "The audio file will be transferred before playback.",
  );
  const busy =
    !!state.pending || (state.command.playing && now() < state.command.target);
  $("play").disabled = !state.ready || state.command.playing || busy;
  $("pause").disabled = !state.command.playing || busy;
  $("stop").disabled = !state.ready;
  $("seek").disabled = state.role !== "host" || !state.ready || busy;
  text(
    "playback-state",
    !state.ready
      ? "Preparing"
      : busy
        ? "Scheduled"
        : state.command.playing
          ? "Playing"
          : "Ready",
  );
  $("create-room").disabled =
    !state.track || state.status === "loading" || state.status === "connecting";
  text(
    "create-room",
    state.status === "connecting" ? "Creating room…" : "Create room",
  );
  text("selected-name", state.track?.name || "");
  text(
    "selected-detail",
    state.track
      ? state.track.mode === "file"
        ? `${(state.track.bytes / 1048576).toFixed(2)} MiB · ${formatTime(state.track.duration)}`
        : "YouTube · approximate synchronization"
      : "",
  );
  show("loaded-track", !!state.track && !state.role);
  show("video-section", state.track?.mode === "youtube");
  text("rtt", state.clockReady ? `${state.rtt.toFixed(1)} ms` : "Estimating…");
  text(
    "offset",
    state.clockReady
      ? `${state.offset >= 0 ? "+" : ""}${state.offset.toFixed(1)} ms`
      : "—",
  );
  text("transport-label", state.link?.transport || "—");
  $("channel").disabled = state.track?.mode === "youtube";
  renderGuests();
}

function renderGuests() {
  if (state.role !== "host") return;
  const list = $("receiver-list");
  list.replaceChildren();
  text("receiver-count", `${state.guests.size} connected`);
  if (!state.guests.size) {
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = "No receivers yet. Open the invite link on another device.";
    list.append(p);
    return;
  }
  for (const guest of state.guests.values()) {
    const row = document.createElement("div");
    row.className = "receiver";
    const identity = document.createElement("div"),
      name = document.createElement("strong"),
      detail = document.createElement("small");
    name.textContent = guest.name;
    detail.textContent = `${guest.link.transport}${Number.isFinite(guest.rtt) ? " · " + guest.rtt.toFixed(1) + " ms RTT" : ""}`;
    identity.append(name, detail);
    const phase = document.createElement("span");
    phase.className = "receiver-state";
    phase.textContent = guest.phase;
    const remove = document.createElement("button");
    remove.className = "quiet danger";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${guest.name}`);
    remove.onclick = () => {
      state.guests.delete(guest.id);
      guest.transferToken++;
      guest.link.send({ type: "removed" });
      guest.link.close();
      renderGuests();
    };
    row.append(identity, phase, remove);
    list.append(row);
  }
}

async function loadFile(file) {
  if (state.status === "connecting") return;
  if (!file || !file.size || file.size > MAX_FILE_BYTES)
    throw new Error("Choose a non-empty audio file up to 15 MiB.");
  if (
    file.type &&
    !file.type.startsWith("audio/") &&
    !/\.(wav|mp3|m4a|ogg|aac|flac)$/i.test(file.name)
  )
    throw new Error("Choose an audio file, such as MP3 or WAV.");
  const load = ++state.load,
    epoch = state.epoch;
  $("create-room").disabled = true;
  status("loading");
  notify("Reading and decoding audio…");
  try {
    const bytes = await file.arrayBuffer();
    const buffer = await audio.decode(bytes);
    const hash = await digest(bytes);
    if (load !== state.load || epoch !== state.epoch) return;
    audio.stop();
    clearPending();
    youtube.destroy();
    audio.buffer = buffer;
    state.track = {
      id: crypto.randomUUID(),
      name: file.name.slice(0, 200),
      mode: "file",
      bytes: bytes.byteLength,
      data: bytes,
      hash,
      chunks: Math.ceil(bytes.byteLength / CHUNK_BYTES),
      duration: buffer.duration,
    };
    state.command = {
      playing: false,
      position: 0,
      target: now(),
      seq: ++state.seq,
    };
    state.ready = true;
    status(state.role ? "Room open" : "idle");
    if (state.role === "host") {
      broadcast({ type: "track-changed", track: trackMeta() });
      for (const guest of state.guests.values()) {
        guest.ready = false;
        guest.phase = "Preparing new track";
        guest.transferToken++;
      }
    }
    render();
    notify("Audio loaded.");
  } catch (error) {
    if (load !== state.load || epoch !== state.epoch) return;
    status(state.role ? "Room open" : "idle");
    render();
    throw new Error(
      "Could not read this audio file. Try another format or a smaller file.",
      { cause: error },
    );
  }
}

async function loadVideo(value) {
  const id = videoId(value);
  if (!id)
    throw new Error("Enter a valid YouTube link or 11-character video ID.");
  const load = ++state.load,
    epoch = state.epoch;
  status("loading");
  audio.stop();
  clearPending();
  show("video-section", true);
  notify("Loading YouTube player…");
  try {
    await youtube.load(id, {
      onEnded: ended,
      onError: failure,
      onBlocked: () => {
        show("unlock-panel", true);
        notify(
          "YouTube blocked automatic playback. Tap Enable audio or the player’s Play control.",
          true,
        );
      },
    });
    if (load !== state.load || epoch !== state.epoch) return;
    state.track = {
      id: crypto.randomUUID(),
      name: youtube.title().slice(0, 200) || `YouTube · ${id}`,
      mode: "youtube",
      videoId: id,
      duration: youtube.duration(),
    };
    state.command = {
      playing: false,
      position: 0,
      target: now(),
      seq: ++state.seq,
    };
    state.ready = true;
    status("idle");
    output();
    render();
    notify("Video loaded. You can create a room.");
  } catch (error) {
    if (load !== state.load || epoch !== state.epoch) return;
    state.track = null;
    state.ready = false;
    status("idle");
    render();
    throw error;
  }
}

function settings() {
  const relay = relayURL($("relay-url").value.trim());
  const route = $("route").value;
  if (route === "relay" && !relay)
    throw new Error("Enter a relay address before choosing Relay only.");
  return { relay, route };
}

async function openPeer(room, epoch) {
  const peer = createPeer(room, config);
  state.peer = peer;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "The signaling server did not respond. Check your network or configure a relay.",
          ),
        ),
      12000,
    );
    peer.once("open", () => {
      clearTimeout(timeout);
      if (epoch === state.epoch) resolve();
      else reject(new Error("Connection cancelled."));
    });
    peer.once("error", (error) => {
      clearTimeout(timeout);
      reject(
        new Error(
          error.type === "unavailable-id"
            ? "Room code is already in use. Create a room again."
            : `Connection failed: ${error.type}. Check the network or use a configured relay.`,
        ),
      );
    });
  });
  peer.on("disconnected", () => {
    if (epoch !== state.epoch || peer.destroyed) return;
    notify("Signaling disconnected. Existing audio links may keep working.");
    later(() => {
      if (epoch === state.epoch && peer.disconnected && !peer.destroyed)
        peer.reconnect();
    }, 2000);
  });
  return peer;
}

function hostRelay(url, epoch) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Relay registration timed out.")),
      8000,
    );
    const relay = new Relay(url, state.room, "host", {
      onJoin: () => {
        clearTimeout(timeout);
        resolve(relay);
      },
      onMessage: (message) => {
        if (epoch !== state.epoch) return;
        if (message.type === "peer-joined")
          addGuest(message.id, relay.link(message.id));
        if (message.type === "peer-left") dropGuest(message.id);
        if (message.type === "message") {
          const guest = state.guests.get(message.from);
          if (guest) hostMessage(guest, message.payload).catch(failure);
        }
      },
      onClose: () => {
        if (epoch === state.epoch) {
          for (const guest of [...state.guests.values()])
            if (guest.link.transport === "Relay") dropGuest(guest.id);
          notify(
            "Relay disconnected. Direct receivers are still connected.",
            true,
          );
        }
      },
      onError: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    state.relay = relay;
  });
}

async function createRoom() {
  if (!state.track || state.role || state.status === "connecting") return;
  const options = settings();
  const epoch = ++state.epoch;
  show("message", false);
  state.room = newRoomCode();
  status("connecting");
  render();
  try {
    await audio.unlock();
    if (options.route !== "relay") {
      let peer;
      try {
        peer = await openPeer(state.room, epoch);
      } catch (error) {
        if (epoch !== state.epoch) return;
        state.peer?.destroy();
        state.peer = null;
        if (!options.relay) throw error;
        options.route = "relay";
        notify("Direct signaling is unavailable. Using the configured relay.");
      }
      if (peer)
        peer.on("connection", (conn) => {
          if (epoch !== state.epoch || state.guests.size >= 12) {
            conn.close();
            return;
          }
          const id = conn.peer;
          let link;
          link = peerLink(
            conn,
            (message) => {
              const guest = state.guests.get(id);
              if (guest?.link === link)
                hostMessage(guest, message).catch(failure);
            },
            () => {
              if (state.guests.get(id)?.link === link) dropGuest(id);
            },
          );
          const connected = () => {
            if (epoch === state.epoch) addGuest(id, link);
            else link.close();
          };
          if (conn.open) connected();
          else conn.once("open", connected);
        });
    }
    if (options.relay) {
      try {
        await hostRelay(options.relay, epoch);
      } catch (error) {
        if (epoch !== state.epoch) return;
        state.relay?.close();
        state.relay = null;
        if (options.route === "relay") throw error;
        notify(
          "Direct room is available, but the optional relay could not connect.",
          true,
        );
      }
    }
    if (epoch !== state.epoch) return;
    state.role = "host";
    state.ready = true;
    status("Room open");
    const invite = new URL(location.pathname, location.origin);
    invite.searchParams.set("room", state.room);
    if (options.relay) invite.searchParams.set("relay", options.relay);
    if (options.route === "relay") invite.searchParams.set("route", "relay");
    text("room-code", state.room);
    $("share-link").value = invite.href;
    const qr = qrcode(0, "M");
    qr.addData(invite.href);
    qr.make();
    $("qr-code").innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
    render();
    $("room-title").focus();
    notify("Room created. Share the invite with another device.");
  } catch (error) {
    if (epoch !== state.epoch) return;
    state.peer?.destroy();
    state.peer = null;
    state.relay?.close();
    state.relay = null;
    state.role = null;
    status("idle");
    render();
    throw error;
  }
}

function addGuest(id, link) {
  if (!state.guests.has(id) && state.guests.size >= 12) {
    link.close();
    return;
  }
  const previous = state.guests.get(id);
  previous?.link.close();
  const guest = {
    id,
    link,
    name: `Speaker ${String(++state.guestNumber).padStart(2, "0")}`,
    phase: "Estimating clock",
    ready: false,
    transferToken: 0,
  };
  state.guests.set(id, guest);
  renderGuests();
}
function dropGuest(id) {
  const guest = state.guests.get(id);
  if (guest) {
    guest.transferToken++;
    state.guests.delete(id);
    renderGuests();
  }
}

async function hostMessage(guest, message) {
  if (
    !message ||
    typeof message.type !== "string" ||
    state.guests.get(guest.id) !== guest
  )
    return;
  if (message.type === "hello")
    guest.link.send({
      type: "welcome",
      protocol: PROTOCOL,
      track: trackMeta(),
    });
  else if (message.type === "ping" && Number.isFinite(message.t0))
    guest.link.send({
      type: "pong",
      id: message.id,
      t0: message.t0,
      t1: now(),
      t2: now(),
    });
  else if (message.type === "request-track") await transferTrack(guest);
  else if (
    message.type === "progress" &&
    message.id === state.track?.id &&
    Number.isFinite(message.percent)
  ) {
    guest.phase = `Receiving · ${Math.round(clamp(message.percent, 0, 100))}%`;
    renderGuests();
  } else if (message.type === "ready" && message.id === state.track?.id) {
    guest.ready = true;
    guest.phase = "Ready";
    guest.rtt = Number.isFinite(message.rtt)
      ? clamp(message.rtt, 0, 2000)
      : undefined;
    renderGuests();
    sendSnapshot(guest.link);
  } else if (message.type === "request-state") sendSnapshot(guest.link);
  else if (message.type === "bye") {
    guest.link.close();
    dropGuest(guest.id);
  }
}

async function transferTrack(guest) {
  const track = state.track;
  if (!track) return;
  if (track.mode === "youtube") {
    guest.link.send({ type: "video", track: trackMeta() });
    return;
  }
  const token = ++guest.transferToken;
  guest.ready = false;
  guest.phase = "Sending audio";
  renderGuests();
  guest.link.send({ type: "meta", ...trackMeta() });
  try {
    for (let index = 0; index < track.chunks; index++) {
      await guest.link.writable();
      if (
        token !== guest.transferToken ||
        state.track !== track ||
        state.guests.get(guest.id) !== guest
      )
        return;
      guest.link.send({
        type: "chunk",
        id: track.id,
        index,
        data: track.data.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES),
      });
      if (guest.link.transport === "Relay") await sleep(9);
    }
    guest.link.send({ type: "done", id: track.id });
    guest.phase = "Decoding on receiver";
    renderGuests();
  } catch (error) {
    if (state.guests.get(guest.id) === guest) {
      guest.phase = "Transfer failed";
      renderGuests();
      failure(error);
    }
  }
}

function sendSnapshot(link) {
  if (!state.track) return;
  if (state.command.playing) {
    const target = now() + Number($("lead").value) * 1000;
    link.send({
      type: "state",
      track: state.track.id,
      command: {
        playing: true,
        position: positionAt(state.command, target, duration()),
        target,
        seq: state.command.seq,
      },
    });
  } else
    link.send({ type: "state", track: state.track.id, command: state.command });
}

async function guestDirect(room, epoch) {
  const peer = await openPeer(null, epoch);
  return new Promise((resolve, reject) => {
    const conn = peer.connect(peerId(room), {
      reliable: true,
      serialization: "binary",
      metadata: { protocol: PROTOCOL },
    });
    const timeout = setTimeout(() => {
      conn.close();
      reject(new Error("Direct connection timed out."));
    }, 8000);
    const link = peerLink(
      conn,
      (message) => {
        receiveGuest(message, epoch);
      },
      () => {
        if (epoch === state.epoch && state.link === link) disconnected();
      },
    );
    conn.once("open", () => {
      clearTimeout(timeout);
      if (epoch !== state.epoch) {
        link.close();
        reject(new Error("Connection cancelled."));
      } else resolve(link);
    });
    conn.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("The host could not be reached."));
    });
    peer.once("error", () => {
      clearTimeout(timeout);
      reject(
        new Error(
          "The room is unavailable. Check the code and keep the host page open.",
        ),
      );
    });
  });
}

function guestRelay(url, room, epoch) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Relay connection timed out.")),
      8000,
    );
    const relay = new Relay(url, room, "guest", {
      onJoin: () => {
        clearTimeout(timeout);
        resolve(relay.link("host"));
      },
      onMessage: (message) => {
        if (message.type === "message") receiveGuest(message.payload, epoch);
      },
      onClose: () => {
        if (epoch === state.epoch && state.role === "guest") disconnected();
      },
      onError: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    state.relay = relay;
  });
}

async function joinRoom() {
  const code = roomCode($("room-input").value);
  if (!code)
    throw new Error(
      "Use the eight-character room code or the complete invite link.",
    );
  if (state.role) return;
  try {
    const invite = new URL($("room-input").value);
    if (invite.searchParams.get("relay"))
      $("relay-url").value = relayURL(invite.searchParams.get("relay"));
    if (invite.searchParams.get("route") === "relay")
      $("route").value = "relay";
  } catch (error) {
    if (error instanceof TypeError) {
    } else throw error;
  }
  const options = settings();
  const epoch = ++state.epoch;
  state.role = "guest";
  show("message", false);
  state.room = code;
  state.ready = false;
  state.clockReady = false;
  state.offset = 0;
  state.track = null;
  audio.stop();
  youtube.destroy();
  show("unlock-panel", false);
  text("unlock-audio", "Enable audio");
  state.command = { playing: false, position: 0, target: 0, seq: 0 };
  state.seq = -1;
  status("Connecting…");
  render();
  try {
    await audio.unlock();
    if (options.route !== "relay") {
      try {
        state.link = await guestDirect(code, epoch);
      } catch (error) {
        if (epoch !== state.epoch) return;
        state.peer?.destroy();
        state.peer = null;
        if (!options.relay) throw error;
        status("Trying configured relay…");
      }
    }
    if (!state.link) state.link = await guestRelay(options.relay, code, epoch);
    if (epoch !== state.epoch) return;
    status("Connected · waiting for host");
    render();
    // Requesting the handshake also covers messages delivered immediately as a channel opens.
    state.link.send({ type: "hello", protocol: PROTOCOL });
    later(() => {
      if (epoch === state.epoch && !state.ready)
        status("Preparation failed or timed out · reconnect to try again");
    }, 45000);
  } catch (error) {
    if (epoch === state.epoch) {
      state.link?.close();
      state.link = null;
      state.relay?.close();
      state.relay = null;
      state.peer?.destroy();
      state.peer = null;
      status("Connection failed");
      render();
    }
    throw error;
  }
}

async function guestMessage(message) {
  if (!message || typeof message.type !== "string" || state.role !== "guest")
    return;
  if (message.type === "pong") {
    const pending = state.pings.get(message.id);
    if (pending) {
      state.pings.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(clockSample(pending.t0, message.t1, message.t2, now()));
    }
    return;
  }
  if (message.type === "welcome") {
    if (message.protocol !== PROTOCOL)
      throw new Error(
        "The host uses a different version. Refresh both devices.",
      );
    if (!message.track || !["file", "youtube"].includes(message.track.mode))
      return;
    state.track = message.track;
    render();
    const epoch = state.epoch;
    await synchronize();
    if (epoch === state.epoch) send({ type: "request-track" });
    return;
  }
  if (message.type === "track-changed") {
    audio.stop();
    clearPending();
    state.ready = false;
    state.transfer = null;
    state.track = message.track;
    state.seq = -1;
    state.command = { playing: false, position: 0, target: 0, seq: 0 };
    render();
    send({ type: "request-track" });
    return;
  }
  if (message.type === "meta") {
    const transfer = new Transfer(message);
    audio.stop();
    clearPending();
    state.ready = false;
    state.transfer = transfer;
    state.track = {
      ...message,
      name: String(message.name || "Audio file").slice(0, 200),
    };
    show("transfer-state", true);
    $("transfer-progress").value = 0;
    status("Receiving audio…");
    render();
    return;
  }
  if (message.type === "chunk") {
    const transfer = state.transfer;
    if (!transfer) return;
    transfer.add(message.id, message.index, message.data);
    const percent = (transfer.bytes / transfer.meta.bytes) * 100;
    $("transfer-progress").value = percent;
    text("transfer-label", `Receiving audio · ${Math.round(percent)}%`);
    if (transfer.parts.size % 16 === 0)
      send({ type: "progress", id: message.id, percent });
    return;
  }
  if (message.type === "done") {
    const transfer = state.transfer;
    if (!transfer || message.id !== transfer.meta.id) return;
    const epoch = state.epoch;
    status("Checking and decoding audio…");
    const bytes = transfer.finish();
    if ((await digest(bytes)) !== transfer.meta.hash)
      throw new Error(
        "The audio checksum did not match. Reconnect to transfer it again.",
      );
    const buffer = await audio.decode(bytes);
    if (epoch !== state.epoch || state.transfer !== transfer) return;
    audio.buffer = buffer;
    state.track.duration = buffer.duration;
    state.transfer = null;
    text("unlock-audio", "Enable audio");
    show("transfer-state", false);
    markReady();
    return;
  }
  if (message.type === "video") {
    if (!message.track || !videoId(message.track.videoId)) return;
    const epoch = state.epoch;
    state.track = message.track;
    state.ready = false;
    show("video-section", true);
    render();
    await youtube.load(message.track.videoId, {
      onEnded: ended,
      onError: failure,
      onBlocked: () => show("unlock-panel", true),
    });
    if (epoch !== state.epoch || state.track !== message.track) return;
    show("unlock-panel", true);
    text("unlock-audio", "Enable video");
    markReady();
    return;
  }
  if (
    message.type === "state" &&
    state.ready &&
    message.track === state.track?.id
  ) {
    applyCommand(message.command);
    return;
  }
  if (
    message.type === "check" &&
    state.ready &&
    state.command.playing &&
    message.track === state.track?.id &&
    Number.isFinite(message.time) &&
    Number.isFinite(message.position)
  ) {
    const expected =
      message.position +
      (now() + state.offset - message.time - state.adjustment) / 1000;
    const actual =
      state.track.mode === "file" ? audio.position() : youtube.position();
    const drift = actual - expected;
    text(
      "drift",
      `${drift >= 0 ? "+" : ""}${(drift * 1000).toFixed(0)} ms (estimated)`,
    );
    if (
      Math.abs(drift) > (state.track.mode === "file" ? 0.15 : 0.6) &&
      now() + state.offset > state.command.target
    )
      send({ type: "request-state" });
  }
  if (message.type === "removed") {
    await leaveRoom();
    notify("The host removed this speaker from the room.", true);
  }
}

function ping() {
  return new Promise((resolve) => {
    const id = crypto.randomUUID(),
      t0 = now();
    const timer = setTimeout(() => {
      state.pings.delete(id);
      resolve(null);
    }, 1200);
    state.pings.set(id, { resolve, timer, t0 });
    send({ type: "ping", id, t0 });
  });
}
async function synchronize() {
  if (state.syncing || !state.link?.open) return;
  state.syncing = true;
  const epoch = state.epoch;
  const samples = [];
  try {
    if (!state.clockReady) status("Estimating clock…");
    for (let i = 0; i < 8; i++) {
      if (epoch !== state.epoch) return;
      const sample = await ping();
      if (sample) samples.push(sample);
      await sleep(80);
    }
    if (epoch !== state.epoch) return;
    const clock = estimateClock(samples);
    state.offset = clock.offset;
    state.rtt = clock.rtt;
    state.clockReady = true;
    render();
  } finally {
    if (epoch === state.epoch) state.syncing = false;
  }
}
function markReady() {
  if (!state.clockReady) {
    status("Clock estimate unavailable. Reconnect to try again.");
    return;
  }
  state.ready = true;
  status("Ready · waiting for host");
  output();
  render();
  send({ type: "ready", id: state.track.id, rtt: state.rtt });
}
function disconnected() {
  audio.stop();
  youtube.pause();
  clearPending();
  state.ready = false;
  state.clockReady = false;
  state.transfer = null;
  state.command = { playing: false, position: 0, target: 0, seq: 0 };
  show("transfer-state", false);
  status("Disconnected · reconnect to continue");
  render();
}

function applyCommand(command) {
  if (
    !command ||
    ![command.position, command.target, command.seq].every(Number.isFinite) ||
    command.position < 0 ||
    typeof command.playing !== "boolean" ||
    command.seq < state.seq ||
    Math.abs(
      command.target - (now() + (state.role === "guest" ? state.offset : 0)),
    ) > 86400000
  )
    return;
  state.seq = command.seq;
  clearPending();
  state.command = { ...command };
  const offset = state.role === "guest" ? state.offset : 0,
    adjustment = state.role === "guest" ? state.adjustment : 0;
  const delay = command.target - offset + adjustment - now();
  if (command.playing && state.track.mode === "file") {
    try {
      audio.play(command.target, command.position, offset, adjustment);
      show("unlock-panel", false);
    } catch (error) {
      show("unlock-panel", true);
      failure(error);
    }
  } else {
    state.pending = later(() => {
      state.pending = null;
      if (state.track?.mode === "youtube") {
        if (command.playing)
          youtube.play(
            command.position +
              Math.max(0, now() - (command.target - offset + adjustment)) /
                1000,
          );
        else {
          youtube.pause();
          youtube.seek(command.position);
        }
      } else audio.stop();
      render();
    }, delay);
  }
  if (state.role === "guest")
    status(command.playing ? "Playback scheduled" : "Ready · waiting for host");
  render();
}

async function command(playing, position) {
  if (state.role !== "host" || !state.ready) return;
  await audio.unlock();
  const target = now() + (playing ? Number($("lead").value) * 1000 : 400);
  const value = {
    playing,
    position: clamp(position, 0, duration()),
    target,
    seq: ++state.seq,
  };
  broadcast({ type: "state", track: state.track.id, command: value });
  applyCommand(value);
}
function ended() {
  if (!state.role) {
    state.command.playing = false;
    return;
  }
  if (state.role === "host") {
    state.command = {
      playing: false,
      position: 0,
      target: now(),
      seq: ++state.seq,
    };
    broadcast({
      type: "state",
      track: state.track?.id,
      command: state.command,
    });
  } else state.command.playing = false;
  render();
}

async function leaveRoom() {
  const keep = state.role === "host" ? state.track : null;
  state.epoch++;
  state.load++;
  clearPending();
  for (const timer of state.timers) clearTimeout(timer);
  state.timers.clear();
  for (const pending of state.pings.values()) {
    clearTimeout(pending.timer);
    pending.resolve(null);
  }
  state.pings.clear();
  state.link?.send({ type: "bye" });
  state.link?.close();
  state.link = null;
  for (const guest of state.guests.values()) {
    guest.transferToken++;
    guest.link.close();
  }
  state.guests.clear();
  state.peer?.destroy();
  state.peer = null;
  state.relay?.close();
  state.relay = null;
  audio.stop();
  youtube.pause();
  state.role = null;
  state.room = null;
  state.track = keep;
  state.ready = !!keep;
  state.clockReady = false;
  state.syncing = false;
  state.transfer = null;
  state.seq = 0;
  state.command = { playing: false, position: 0, target: 0, seq: 0 };
  status("idle");
  show("transfer-state", false);
  show("unlock-panel", false);
  if (!keep) {
    youtube.destroy();
    audio.buffer = null;
  }
  $("keep-awake").checked = false;
  await keepAwake();
  history.replaceState(null, "", location.pathname);
  render();
  tab("host");
  $("host-tab").focus();
}

async function reconnect() {
  const room = state.room;
  await leaveRoom();
  $("room-input").value = room;
  tab("guest");
  await joinRoom();
}

async function scan() {
  if (scannerStarting || scanner) return;
  if (!isSecureContext)
    throw new Error(
      "Camera scanning needs HTTPS or localhost. Enter the room code instead.",
    );
  scannerStarting = true;
  $("scanner-dialog").showModal();
  try {
    const { Html5Qrcode } = await import("html5-qrcode");
    if (!$("scanner-dialog").open) return;
    scanner = new Html5Qrcode("qr-reader");
    await scanner.start(
      { facingMode: "environment" },
      { fps: 8 },
      (value) => {
        const code = roomCode(value);
        if (code) {
          $("room-input").value = value;
          closeScanner();
          notify("Room invite scanned. Tap Join room to connect.");
        }
      },
      () => {},
    );
    if (!$("scanner-dialog").open) await closeScanner();
  } catch (error) {
    await closeScanner();
    throw new Error(
      "Camera unavailable. Check access or enter the room code manually.",
      { cause: error },
    );
  } finally {
    scannerStarting = false;
  }
}
async function closeScanner() {
  const current = scanner;
  scanner = null;
  if (current) {
    try {
      await current.stop();
    } catch {}
    try {
      current.clear();
    } catch {}
  }
  if ($("scanner-dialog").open) $("scanner-dialog").close();
}
async function keepAwake() {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
  if ($("keep-awake").checked && document.visibilityState === "visible") {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    } catch {
      $("keep-awake").checked = false;
      notify("This browser could not keep the screen awake.", true);
    }
  }
}

$("host-tab").onclick = () => tab("host");
$("guest-tab").onclick = () => tab("guest");
for (const role of ["host", "guest"])
  $(role + "-tab").onkeydown = (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? "host"
          : event.key === "End"
            ? "guest"
            : role === "host"
              ? "guest"
              : "host";
      tab(next);
      $(next + "-tab").focus();
    }
  };
for (const radio of document.querySelectorAll("[name=source]"))
  radio.onchange = () => {
    selectedSource = radio.value;
    state.load++;
    audio.stop();
    youtube.destroy();
    state.track = null;
    state.ready = false;
    status("idle");
    show("file-setup", selectedSource === "file");
    show("video-form", selectedSource === "youtube");
    render();
  };
$("audio-file").onchange = action((event) => loadFile(event.target.files[0]));
$("replace-file").onchange = action((event) => loadFile(event.target.files[0]));
$("test-tone").onclick = action(() =>
  loadFile(
    new File([testTone()], "Test tone · eight pulses.wav", {
      type: "audio/wav",
    }),
  ),
);
$("video-form").onsubmit = action((event) => {
  event.preventDefault();
  return loadVideo($("video-url").value);
});
$("create-room").onclick = action(createRoom);
$("join-form").onsubmit = action((event) => {
  event.preventDefault();
  return joinRoom();
});
$("leave-room").onclick = action(leaveRoom);
$("reconnect").onclick = action(reconnect);
$("play").onclick = action(() =>
  command(
    true,
    positionAt(state.command, now(), duration()) >= duration()
      ? 0
      : positionAt(state.command, now(), duration()),
  ),
);
$("pause").onclick = action(() =>
  command(false, positionAt(state.command, now() + 400, duration())),
);
$("stop").onclick = action(() => command(false, 0));
$("seek").onchange = action(() =>
  command(state.command.playing, Number($("seek").value)),
);
for (const id of ["volume", "channel", "mute"])
  $(id).addEventListener("input", output);
$("adjustment").oninput = () => {
  state.adjustment = Number($("adjustment").value);
  text(
    "adjustment-value",
    `${state.adjustment > 0 ? "+" : ""}${state.adjustment} ms`,
  );
};
$("adjustment").onchange = () => send({ type: "request-state" });
$("unlock-audio").onclick = action(async () => {
  await audio.unlock();
  if (state.track?.mode === "youtube") youtube.unlock();
  output();
  show("unlock-panel", false);
  send({ type: "request-state" });
});
$("copy-link").onclick = action(async () => {
  try {
    await navigator.clipboard.writeText($("share-link").value);
    notify("Invite link copied.");
  } catch {
    $("share-link").focus();
    $("share-link").select();
    notify("Copy the selected invite link.", true);
  }
});
$("scan-code").onclick = action(scan);
$("close-scanner").onclick = action(closeScanner);
$("scanner-dialog").addEventListener("cancel", () => closeScanner());
$("dismiss-message").onclick = () => show("message", false);
$("drop-zone").ondragover = (event) => {
  event.preventDefault();
  $("drop-zone").classList.add("dragging");
};
$("drop-zone").ondragleave = () => $("drop-zone").classList.remove("dragging");
$("drop-zone").ondrop = action((event) => {
  event.preventDefault();
  $("drop-zone").classList.remove("dragging");
  return loadFile(event.dataTransfer.files[0]);
});
$("keep-awake").disabled = !("wakeLock" in navigator);
$("keep-awake").onchange = action(keepAwake);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if ($("keep-awake").checked) keepAwake();
    if (state.role === "guest" && state.link?.open)
      synchronize()
        .then(() => send({ type: "request-state" }))
        .catch(failure);
  }
});
window.addEventListener("pagehide", () => {
  state.link?.send({ type: "bye" });
  state.relay?.close();
  state.peer?.destroy();
  audio.stop();
  wakeLock?.release();
});

let theme;
try {
  theme = localStorage.getItem("flash-speaker-theme");
} catch {}
theme ||= matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
function setTheme() {
  document.documentElement.dataset.theme = theme;
  text("theme", theme === "dark" ? "Light" : "Dark");
  $("theme").setAttribute(
    "aria-label",
    `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
  );
}
setTheme();
$("theme").onclick = () => {
  theme = theme === "dark" ? "light" : "dark";
  setTheme();
  try {
    localStorage.setItem("flash-speaker-theme", theme);
  } catch {}
};
$("relay-url").value = config.relayUrl || "";
const params = new URLSearchParams(location.search);
const code = roomCode(params.get("room") || "");
if (code) {
  tab("guest");
  $("room-input").value = code;
  try {
    if (params.get("relay"))
      $("relay-url").value = relayURL(params.get("relay"));
    if (params.get("route") === "relay") $("route").value = "relay";
  } catch (error) {
    failure(error);
  }
} else {
  tab("host");
  if (params.has("room"))
    notify(
      "This invite has an invalid room code. Ask the host for a new link.",
      true,
    );
}
if (!window.AudioContext || !isSecureContext) {
  notify(
    "Use a current browser over HTTPS or localhost for audio and device connections.",
    true,
  );
  $("create-room").disabled = true;
  $("join-room").disabled = true;
}

setInterval(() => {
  if (!state.role || !state.track) return;
  const time = now() + (state.role === "guest" ? state.offset : 0),
    position = positionAt(state.command, time, duration());
  if (document.activeElement !== $("seek")) $("seek").value = String(position);
  $("seek").max = String(duration() || 1);
  text("elapsed", formatTime(position));
  text("duration", formatTime(duration()));
  const wait = (state.command.target - time) / 1000;
  text(
    "countdown",
    state.command.playing && wait > 0 ? `Starting in ${Math.ceil(wait)}…` : "",
  );
  if (wait <= 0 && state.command.playing && !state.pending) {
    $("pause").disabled = false;
    $("stop").disabled = false;
    $("seek").disabled = state.role !== "host";
    text("playback-state", "Playing");
  }
}, 200);
setInterval(() => {
  if (
    state.role === "host" &&
    state.command.playing &&
    now() > state.command.target
  )
    broadcast({
      type: "check",
      track: state.track.id,
      time: now(),
      position: positionAt(state.command, now(), duration()),
    });
}, 5000);
setInterval(() => {
  if (state.role === "guest" && state.ready) synchronize().catch(failure);
}, 20000);
render();
