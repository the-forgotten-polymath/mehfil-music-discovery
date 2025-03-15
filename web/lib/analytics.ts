"use client";

/**
 * The whole of what Mehfil records, in one place.
 *
 * This list is the single source of truth twice over: `track()` will only send
 * an event that appears here, and /curious/architecture renders this same array
 * as the page telling people what is collected. So the disclosure cannot drift
 * from the behaviour — adding an event without describing it is not possible,
 * because the description is what makes it exist.
 *
 * What is deliberately absent, and why:
 *
 *   Search text. Knowing that someone searched is useful; knowing what they
 *   typed is a diary. The event fires with no query attached.
 *
 *   Anything identifying. No user id, no session id, no device fingerprint.
 *   Umami sets no cookie and no identifier that outlives the page, so these
 *   events are counts, not a trail — two plays from one person and two plays
 *   from two people are indistinguishable here, by design.
 *
 * Everything sent is either a bare count or a value from a fixed set: a theme
 * name, a collection kind, "liked" or "unliked". Nothing free-typed ever
 * leaves the browser.
 */

/** Name -> what it means, in the words shown to anyone who asks. */
export const EVENTS = {
  play: "A song started, and how — a row, the queue, shuffle, next, previous, the end of the last one, or a skip past a broken video",
  search: "Somebody searched — never what they typed",
  favourite: "A song was liked or unliked. The count, not which song",
  collection: "A collection was opened, and whether it was a singer, film, station or mood",
  theme: "A backdrop was chosen, and which one",
  install: "What came of the install offer — installed, declined at the browser's own prompt, put off, or shown the iOS instructions",
  report: "A wrong recording was reported, or a missing song was sent in",
} as const;

export type EventName = keyof typeof EVENTS;

type Umami = { track: (name: string, data?: Record<string, string>) => void };

/**
 * Send one event, or quietly do nothing.
 *
 * Nothing here is important enough to interrupt anyone for. The script is
 * absent in development and on previews, it is absent for anyone running a
 * blocker, and it can simply fail to load — all of which are ordinary, none of
 * which a listener should ever see. So every path out of this function is
 * silent.
 */
export function track(name: EventName, data?: Record<string, string>) {
  try {
    const umami = (window as unknown as { umami?: Umami }).umami;
    umami?.track(name, data);
  } catch {
    // An analytics call is the last thing that should break a music player.
  }
}
