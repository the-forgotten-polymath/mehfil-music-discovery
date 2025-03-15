"use client";

/**
 * Whether the welcome has been seen, and a way to be told when it is.
 *
 * Lives here rather than inside notice-dialog.tsx because two components now
 * care: the welcome writes it, and the install card waits on it. A key spelled
 * out in two files is how one of them quietly stops matching the other, and the
 * symptom — a nudge that never arrives, or arrives twice — looks like a bug in
 * the dialog rather than a typo in a string.
 *
 * The install card needs more than the stored value. It has to know the moment
 * the welcome is dismissed, so it can start counting from there rather than
 * appearing on top of it, and localStorage has no event for a write made by
 * the same tab. Hence the listener set.
 */

const SEEN_KEY = "mehfil:notice-seen:v1";

const listeners = new Set<() => void>();

export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Private browsing refuses localStorage. Treated as not seen, which shows
    // the welcome again rather than silently never showing it.
    return false;
  }
}

export function markWelcomeSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Nothing to persist to; the welcome opens again next visit, which is a
    // worse first run rather than a broken one.
  }
  // Fired even when the write failed. Whether it was recorded is a separate
  // question from whether it just happened, and the install card is waiting on
  // the second one.
  for (const listener of listeners) listener();
}

/** Called when the welcome is dismissed. Returns a teardown. */
export function onWelcomeSeen(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
