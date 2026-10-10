import { clamp, now, playbackPlan } from "./core.js";

export class AudioEngine {
  constructor(onEnded) {
    this.onEnded = onEnded;
    this.context = null;
    this.buffer = null;
    this.source = null;
    this.volume = 0.7;
    this.channel = "stereo";
    this.muted = false;
    this.anchor = null;
  }
  async unlock() {
    this.context ||= new AudioContext({ latencyHint: "interactive" });
    if (this.context.state !== "running") await this.context.resume();
    if (this.context.state !== "running")
      throw new Error("Tap Enable audio to allow playback on this device.");
  }
  async decode(bytes) {
    this.context ||= new AudioContext({ latencyHint: "interactive" });
    return this.context.decodeAudioData(bytes.slice(0));
  }
  stop() {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {}
      this.source.disconnect();
    }
    this.source = null;
    this.anchor = null;
    for (const node of [this.gain, this.splitter, this.merger])
      node?.disconnect();
    this.gain = this.splitter = this.merger = null;
  }
  play(target, position, offset = 0, adjustment = 0) {
    this.stop();
    if (!this.buffer || this.context?.state !== "running")
      throw new Error("Enable audio on this device before playback.");
    const plan = playbackPlan(
      target,
      position,
      now(),
      offset,
      adjustment,
      this.buffer.duration,
    );
    if (plan.ended) return;
    const ctx = this.context;
    this.source = ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.gain = ctx.createGain();
    this.gain.gain.value = this.muted ? 0 : this.volume;
    this.source.connect(this.gain);
    this.splitter = ctx.createChannelSplitter(2);
    this.merger = ctx.createChannelMerger(2);
    this.route();
    this.anchor = {
      time: ctx.currentTime + plan.delay,
      position: plan.position,
    };
    this.source.onended = () => {
      this.stop();
      this.onEnded?.();
    };
    this.source.start(this.anchor.time, plan.position);
  }
  route() {
    if (!this.gain) return;
    this.gain.disconnect();
    this.splitter.disconnect();
    this.merger.disconnect();
    if (this.channel === "stereo") this.gain.connect(this.context.destination);
    else {
      this.gain.connect(this.splitter);
      const output = this.channel === "right" ? 1 : 0;
      const input = this.buffer.numberOfChannels === 1 ? 0 : output;
      this.splitter.connect(this.merger, input, output);
      this.merger.connect(this.context.destination);
    }
  }
  setOutput(volume, channel, muted = false) {
    this.volume = clamp(volume, 0, 1);
    this.muted = muted;
    if (this.gain)
      this.gain.gain.setTargetAtTime(
        muted ? 0 : this.volume,
        this.context.currentTime,
        0.015,
      );
    if (this.channel !== channel) {
      this.channel = channel;
      this.route();
    }
  }
  position() {
    return this.anchor
      ? Math.min(
          this.buffer.duration,
          this.anchor.position +
            Math.max(0, this.context.currentTime - this.anchor.time),
        )
      : 0;
  }
  async close() {
    this.stop();
    await this.context?.close();
    this.context = null;
    this.buffer = null;
  }
}

export function testTone() {
  const rate = 44100,
    samples = rate * 8,
    bytes = new ArrayBuffer(44 + samples * 2),
    view = new DataView(bytes);
  const text = (at, value) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const phase = (i % rate) / rate;
    const envelope = phase < 0.15 ? Math.sin((Math.PI * phase) / 0.15) ** 2 : 0;
    view.setInt16(
      44 + i * 2,
      Math.sin((2 * Math.PI * 440 * i) / rate) * envelope * 8000,
      true,
    );
  }
  return bytes;
}
