let loading;
function api() {
  if (window.YT?.Player) return Promise.resolve();
  return (loading ||= new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      loading = null;
      reject(
        new Error(
          "YouTube did not load. Check the network or use an audio file.",
        ),
      );
    }, 15000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      clearTimeout(timeout);
      loading = null;
      reject(new Error("YouTube is unavailable on this network."));
    };
    document.head.append(script);
  }));
}

export class YouTubePlayer {
  constructor() {
    this.generation = 0;
    this.cancel = null;
    this.player = null;
  }
  async load(id, { onEnded, onError, onBlocked } = {}) {
    this.destroy();
    const generation = this.generation;
    await api();
    if (generation !== this.generation)
      throw new Error("Video loading cancelled.");
    const element = document.createElement("div");
    element.id = "youtube-player";
    document.getElementById("video-frame").replaceChildren(element);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              "The video player did not become ready. Try another video.",
            ),
          ),
        15000,
      );
      this.cancel = () => {
        clearTimeout(timer);
        reject(new Error("Video loading cancelled."));
      };
      this.player = new YT.Player(element, {
        videoId: id,
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          autoplay: 0,
          controls: 1,
          playsinline: 1,
          rel: 0,
          origin: location.origin,
        },
        events: {
          onReady: () => {
            clearTimeout(timer);
            this.cancel = null;
            resolve();
          },
          onStateChange: (e) => {
            if (
              generation === this.generation &&
              e.data === YT.PlayerState.ENDED
            )
              onEnded?.();
          },
          onAutoplayBlocked: () => {
            if (generation === this.generation) onBlocked?.();
          },
          onError: (e) => {
            if (generation !== this.generation) return;
            clearTimeout(timer);
            this.cancel = null;
            const error = new Error(
              `YouTube could not play this video (code ${e.data}). It may be private or unavailable for embedding.`,
            );
            reject(error);
            onError?.(error);
          },
        },
      });
    });
  }
  unlock() {
    this.player?.unMute?.();
    this.player?.playVideo?.();
  }
  play(position) {
    this.player?.seekTo?.(position, true);
    this.player?.playVideo?.();
  }
  pause() {
    this.player?.pauseVideo?.();
  }
  seek(position) {
    this.player?.seekTo?.(position, true);
  }
  volume(value, muted) {
    this.player?.setVolume?.(value * 100);
    if (muted) this.player?.mute?.();
    else this.player?.unMute?.();
  }
  position() {
    return this.player?.getCurrentTime?.() || 0;
  }
  duration() {
    return this.player?.getDuration?.() || 0;
  }
  title() {
    return this.player?.getVideoData?.()?.title || "";
  }
  destroy() {
    this.generation++;
    this.cancel?.();
    this.cancel = null;
    this.player?.destroy?.();
    this.player = null;
  }
}
