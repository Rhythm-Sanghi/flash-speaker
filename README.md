# Flash-Speaker

A browser audio-sharing experiment with host and guest devices. It uses PeerJS
for WebRTC connections, Web Audio for file playback, and the YouTube iframe
player for video playback control.

## Try it

For a desktop preview, run `python -m http.server 8080` from this directory and
open http://localhost:8080. The page loads scripts from public CDNs.

For mobile guests, serve the site over HTTPS, for example with GitHub Pages.
Use a recent browser with WebRTC and Web Audio support. A plain file URL or an
HTTP address on another device is not the full secure-context setup. Browser
audio permission, network restrictions and relay availability can affect use.

1. On the host, choose **Source Protocol** and load a local audio file or YouTube URL.
2. Select **Initialize Broadcast Room** and share its six-character ID or QR code.
3. On each guest, choose **Guest Receiver**, enter the room ID and connect.
4. Start playback from the host. The interface shows connection and timing status.

## Timing

The app exchanges clock samples and schedules audio with Web Audio buffer
nodes. It aims to align playback between devices; sub-millisecond accuracy and
identical physical speaker output have not been established. Device output
latency, browser scheduling, network conditions and YouTube player behavior can
introduce drift. The displayed clock estimate is not a measurement of acoustic
alignment at the speakers.

## Files

- `index.html`: application interface and client logic.
- `tools/turn_diagnostic.html`: connection diagnostic; open through the same
  hosted origin at `/tools/turn_diagnostic.html`.
- `tools/generate_beep.py`: generates a short WAV tone and prints its data URL.
  Run it from a scratch directory; it creates `temp_beep.wav` in that directory.

The interface uses a console-style layout with room, latency and connection
readouts. There is no npm build step for the static page.
