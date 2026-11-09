// Platform adapter for datgamesstudio.com. The YouTube Playables build swaps this one file for
// platform-youtube.js; app.js only ever talks to the object exported here.

const KEY = "snake-uncoil-web-v1";

export const platform = {
  name: "site",

  /** Saved progress, or null. Storage can throw (private mode, blocked site data). */
  async load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  },

  async save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (_) { /* Progress is a convenience here; the game keeps working without it. */ }
  },

  /** GA4 through the site's shared tracker (assets/analytics.js). */
  track(name, params) {
    window.datTrack?.(name, params);
  },

  /** The site shows install links; YouTube must not link out. */
  showsStoreLinks: true,

  firstFrameReady() {},
  gameReady() {},

  onPause(fn) {
    document.addEventListener("visibilitychange", () => { if (document.hidden) fn(); });
  },
  onResume(fn) {
    document.addEventListener("visibilitychange", () => { if (!document.hidden) fn(); });
  },

  /** Whether the host allows sound at all (YouTube can mute a Playable). */
  audioAllowed() { return true; },
  onAudioAllowedChange() {},
};
