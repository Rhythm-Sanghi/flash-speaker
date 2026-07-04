# Flash-Speaker

Flash-Speaker is a real-time, low-latency multi-device audio broadcasting and synchronization platform. Built with vanilla Web Audio API, WebRTC, and NTP clock synchronization, it enables a Host device to stream audio or YouTube streams to multiple Guest devices simultaneously with sub-millisecond precision.

## 🎛️ Features

* **Asymmetric Console Layout**: Designed like an analog telemetry deck with a glowing cathode-ray tube (CRT) signal visualizer.
* **Precision Synchronization**: Uses NTP clock-sync algorithms and Scheduled Web Audio API buffer nodes to ensure all receivers play at the exact same wall-clock instant.
* **Dual Playback Modes**:
  * **File Mode**: Load local `.wav`, `.mp3`, or other audio files.
  * **YouTube Stream Mode**: Synchronize audio from YouTube videos using the YouTube IFrame Player API.
* **Telemetry Telemetry**: Monospace readouts for latency, room codes, offset timings, and connection states.
* **Secure WebRTC Signaling**: Peer-to-peer transmission powered by PeerJS.

## 🚀 Getting Started

Simply open `index.html` in any browser!

> [!IMPORTANT]
> Because WebRTC and secure media APIs require a secure context, this app **must** be hosted over HTTPS (e.g., GitHub Pages) to connect mobile guest devices.

### Host Setup
1. Open the page and select **Source Protocol** (File or YouTube).
2. Load your media file or YouTube URL.
3. Click **Initialize Broadcast Room** to get your 6-character Room ID and QR code.
4. Share the ID or QR code with your guests.

### Guest Setup
1. Select **Guest Receiver** mode on the landing page.
2. Enter the Room ID (or scan the QR code).
3. Connect and wait for the host to trigger playback.

## 🛠️ Tech Stack
* HTML5 / Tailwind CSS
* Vanilla ES6 JavaScript
* WebRTC (via PeerJS)
* Web Audio API
