/**
 * Declare what is playing to the operating system.
 *
 * Without this the phone has no idea the page is a music player. It sees a
 * cross-origin iframe making noise, shows YouTube's own generic notification if
 * anything, and — the part that matters here — feels free to freeze the page
 * once the screen locks. Our JavaScript is what advances the queue, so a frozen
 * page means the track ends and nothing follows it until the phone is woken.
 *
 * Declaring a media session is how a page says "I am playback, keep me
 * running". It is not a guarantee — the platform still decides — but it is the
 * signal the platform looks for, and it was absent.
 *
 * It also buys the lock screen and notification controls, which a music app is
 * expected to have: the title and artwork on the lock screen, and skip buttons
 * that reach us rather than the iframe.
 */

export type NowPlaying = {
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
};

type Handlers = {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek?: (seconds: number) => void;
};

function available(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

// Separate from mediaSession itself, and constructing it is what would throw.
function canDescribe(): boolean {
  return available() && typeof MediaMetadata === "function";
}

/** What the lock screen shows. */
export function setNowPlaying(song: NowPlaying | null) {
  if (!canDescribe()) return;

  if (!song) {
    navigator.mediaSession.metadata = null;
    return;
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist,
    album: song.album,
    // The size it actually is. Listing the same URL as 96, 256 and 512 square
    // is a common trick and a lie here — a YouTube thumbnail is 480x360 — and
    // a platform that trusts the declaration will letterbox or crop against a
    // shape the image does not have.
    artwork: song.artwork
      ? [{ src: song.artwork, sizes: "480x360", type: "image/jpeg" }]
      : [],
  });
}

/** Whether the OS should draw a play or a pause button. */
export function setPlaybackState(playing: boolean) {
  if (!available()) return;
  navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}

/**
 * How far through, so the lock screen can draw a progress bar.
 *
 * Guarded rather than trusted: setPositionState throws if duration is zero or
 * position runs past it, both of which happen briefly while a track is
 * loading, and an exception here would take the caller down with it.
 */
export function setPosition(elapsed: number, duration: number) {
  if (!available() || typeof navigator.mediaSession.setPositionState !== "function") {
    return;
  }
  // Both, not just duration. getCurrentTime() returns NaN before the player is
  // ready, and a NaN position is rejected the same way a zero duration is —
  // caught below, but caught means never updated rather than merely skipped.
  if (!Number.isFinite(duration) || duration <= 0) return;
  if (!Number.isFinite(elapsed)) return;

  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(elapsed, 0), duration),
      playbackRate: 1,
    });
  } catch {
    // A rejected position is not worth interrupting playback over.
  }
}

/** Wire the OS controls to ours. Returns a teardown. */
export function setHandlers(handlers: Handlers): () => void {
  if (!available()) return () => {};

  const entries: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => handlers.play()],
    ["pause", () => handlers.pause()],
    ["nexttrack", () => handlers.next()],
    ["previoustrack", () => handlers.previous()],
  ];

  if (handlers.seek) {
    entries.push([
      "seekto",
      (details) => {
        if (typeof details.seekTime === "number") handlers.seek!(details.seekTime);
      },
    ]);
  }

  for (const [action, handler] of entries) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Not every action is supported everywhere; an unsupported one throws
      // and the rest should still be registered.
    }
  }

  return () => {
    for (const [action] of entries) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // Nothing to do if it was never accepted.
      }
    }
  };
}
