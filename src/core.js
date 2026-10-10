export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const CHUNK_BYTES = 16 * 1024;
export const PROTOCOL = 1;
export const now = () => performance.timeOrigin + performance.now();
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function roomCode(value) {
  let text = String(value).trim();
  try {
    text = new URL(text).searchParams.get("room") || "";
  } catch {
    /* A code is also accepted. */
  }
  text = text.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z0-9]{8}$/.test(text) ? text : null;
}

export function newRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (n) => alphabet[n % alphabet.length],
  ).join("");
}

export function videoId(value) {
  const text = String(value).trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.hostname === "youtu.be") return videoId(url.pathname.slice(1));
    if (
      ![
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "www.youtube-nocookie.com",
      ].includes(url.hostname)
    )
      return null;
    const id =
      url.searchParams.get("v") ||
      url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function clockSample(t0, t1, t2, t3) {
  if (![t0, t1, t2, t3].every(Number.isFinite)) return null;
  const rtt = t3 - t0 - (t2 - t1);
  return rtt >= 0 && rtt <= 2000
    ? { rtt, offset: (t1 - t0 + (t2 - t3)) / 2 }
    : null;
}

export function estimateClock(samples) {
  const sorted = samples
    .filter(
      (s) =>
        Number.isFinite(s.rtt) &&
        Number.isFinite(s.offset) &&
        s.rtt >= 0 &&
        s.rtt <= 2000,
    )
    .sort((a, b) => a.rtt - b.rtt);
  if (sorted.length < 3)
    throw new Error("Not enough clock samples. Try reconnecting.");
  const kept = sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.75)));
  const offsets = kept.map((s) => s.offset).sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  return {
    offset:
      offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2,
    rtt: kept.reduce((n, s) => n + s.rtt, 0) / kept.length,
  };
}

export function playbackPlan(
  target,
  position,
  localNow,
  offset,
  adjustment,
  duration,
) {
  const delay = (target - offset + adjustment - localNow) / 1000;
  const start = Math.max(0, position + Math.max(0, -delay));
  return {
    delay: Math.max(0, delay),
    position: Math.min(duration, start),
    ended: start >= duration,
  };
}

export function positionAt(state, time, duration = Infinity) {
  return clamp(
    state.position +
      (state.playing ? Math.max(0, time - state.target) / 1000 : 0),
    0,
    duration,
  );
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  seconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export class Transfer {
  constructor(meta) {
    if (
      !meta ||
      !Number.isSafeInteger(meta.bytes) ||
      meta.bytes < 1 ||
      meta.bytes > MAX_FILE_BYTES ||
      meta.chunks !== Math.ceil(meta.bytes / CHUNK_BYTES) ||
      typeof meta.id !== "string" ||
      typeof meta.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(meta.hash)
    )
      throw new Error("Invalid audio transfer metadata.");
    this.meta = meta;
    this.parts = new Map();
    this.bytes = 0;
  }
  add(id, index, data) {
    if (id !== this.meta.id) return false;
    if (!Number.isInteger(index) || index < 0 || index >= this.meta.chunks)
      throw new Error("Invalid audio chunk index.");
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const expected = Math.min(
      CHUNK_BYTES,
      this.meta.bytes - index * CHUNK_BYTES,
    );
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expected)
      throw new Error("Invalid audio chunk size.");
    if (this.parts.has(index)) return false;
    this.parts.set(index, bytes);
    this.bytes += bytes.byteLength;
    return true;
  }
  finish() {
    if (this.bytes !== this.meta.bytes || this.parts.size !== this.meta.chunks)
      throw new Error("Audio transfer is incomplete. Reconnect to try again.");
    const result = new Uint8Array(this.bytes);
    for (let i = 0; i < this.meta.chunks; i++)
      result.set(this.parts.get(i), i * CHUNK_BYTES);
    this.parts.clear();
    return result.buffer;
  }
}

export async function digest(buffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
