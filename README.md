# Flash Speaker

A browser experiment for playing the same audio file across nearby devices. One device hosts a room; receivers download the track, estimate the host's clock and schedule playback from shared timestamps.

[Open Flash Speaker](https://rhythm-sanghi.github.io/flash-speaker/)

## Use it

1. Open the app on the host and choose an audio file, or use the built-in eight-second test tone.
2. Create a room. Open its invite link on another device, scan the QR code, or enter the eight-character code.
3. Wait for each receiver to show **Ready**, then select **Play together** on the host.

Keep the pages visible and use the same Wi-Fi where possible. Volume, mute and left/right output apply only to the current device. Receivers can adjust timing by ear; positive values delay that speaker. The host controls playback, seeking and file changes, and can remove receivers.

Files are limited to 15 MiB and checked with SHA-256 after transfer. Browser codec support varies. The test tone is generated locally; no sample audio file needs to be downloaded.

YouTube is an experimental alternative. Every device streams its own copy through a visible YouTube player, so buffering, ads, embedding restrictions and autoplay rules can interrupt playback or affect timing.

## Run locally

Use Node.js 22 or newer:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:8091`. `npm run check` runs syntax checks, regression tests and the production build. GitHub Actions publishes only `dist/` after those checks pass. GitHub Pages must use **GitHub Actions** as its deployment source.

The browser dependencies are pinned, bundled locally and installed through the lockfile. The build retains their licenses in `dist/third-party-licenses.txt`. YouTube's API is loaded only when that source is chosen; the camera scanner is loaded only when requested. Use `npm run format` before contributing changes.

## Connections

The default route uses PeerJS's public signaling service to establish a WebRTC data connection. STUN helps devices discover a route, but some networks require TURN or an application relay. Same Wi-Fi alone does not guarantee a connection, and the default setup still needs internet signaling.

`config.js` supports a custom PeerServer, ICE servers and an optional relay URL. Everything in that file is public: use short-lived TURN credentials where needed, never a private service secret.

An optional WebSocket relay lives in `relay/`. To test it locally, run `npm run relay`, enter `ws://127.0.0.1:8787` in Connection settings on the host and choose **Relay only**. The generated invite includes those settings. For devices on other machines, deploy behind HTTPS with a `wss://` URL; localhost points to each device itself.

For a hosted relay, set `HOST`, `PORT` and a comma-separated `ALLOWED_ORIGINS` list. Defaults bind to loopback and allow the local development app and this project's GitHub Pages origin. The server bounds message size, message rate, rooms and receivers, binds message identity to each socket and closes receivers when their host leaves. It is a small experimental relay, not a managed public service; add deployment-specific connection limits and monitoring before exposing it widely.

There is no account or room password. Anyone who knows the room code can join; share invites privately. A relay carries the audio bytes through its server. Direct transfers use WebRTC's encrypted data channel. YouTube mode contacts YouTube independently on each device.

## Timing limits

This does not promise sample-accurate or acoustic synchronization. Clock estimates compensate for network timing; they cannot measure Bluetooth delay, speaker hardware latency or every browser's audio pipeline. Background tabs may be suspended, particularly on phones. The playback difference readout compares software timelines, not microphone measurements.

Use the test tone at a low volume on the actual devices you want to connect. Wired speakers and a shared audio interface remain more reliable when precise alignment matters.

## Layout

- `src/`: interface, audio engine, transport, timing and transfer logic.
- `relay/`: optional Node.js WebSocket server and room routing.
- `test/`: regression tests for timing, file handling, audio lifecycle and relay routing.
- `scripts/`: production build and loopback development server.
- `assets/`: the app mark. Styles use system fonts and the neutral/green palette shared with Threadmark and Benchlight.
