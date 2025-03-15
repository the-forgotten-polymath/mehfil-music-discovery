"use client";

import { useSyncExternalStore } from "react";

import { track } from "@/lib/analytics";

/**
 * Which animated backdrop the app is wearing.
 *
 * Same shape as lib/favourites.ts: localStorage is external state, so it is
 * read through useSyncExternalStore rather than a context, and the server
 * snapshot is what makes the server render coherent without a `mounted` flag.
 *
 * The server snapshot is "none" rather than the default, deliberately. Serving
 * the default would mean anyone who picked something else downloads a backdrop
 * they will not see before downloading the one they will. Rendering nothing
 * costs a beat with no backdrop, which the fade-in below turns into something
 * that reads as intentional rather than as a flash.
 */

const KEY = "mehfil:backdrop:v1";

export type Backdrop = {
  id: string;
  label: string;
  /** One line, shown under the label on the themes page. */
  note: string;
};

const DEFAULT_BACKDROP = "lofi";

/** Absence, chosen on purpose. Not every room wants weather in it. */
export const NO_BACKDROP = "none";

export const BACKDROPS: readonly Backdrop[] = [
  { id: "lofi", label: "Lofi room", note: "A studio with the hills outside" },
  { id: "reading", label: "Reading room", note: "A dog asleep, a book open, a laptop playing something" },
  { id: "meadow", label: "Meadow", note: "A sheep, a dog, an afternoon" },
  { id: "flock", label: "Evening flock", note: "The whole flock at sunset" },
  { id: "stop-dusk", label: "Bus stop, dusk", note: "A cat waiting, in red light" },
  { id: "stop-night", label: "Bus stop, night", note: "The same cat, under a lamp" },
  { id: "porch", label: "Sleeping porch", note: "Two cats, entirely asleep" },
];

const IDS = new Set<string>(BACKDROPS.map((b) => b.id));

export function backdropSrc(id: string) {
  return { video: `/backdrops/${id}.mp4`, poster: `/backdrops/${id}.jpg` };
}

const listeners = new Set<() => void>();
let chosen: string | null = null;

function read(): string {
  try {
    const raw = localStorage.getItem(KEY);
    // An unknown id means a theme that has since been removed, or a
    // hand-edited value. Fall back rather than requesting a file that is not
    // there and leaving the app with no backdrop and no explanation.
    if (raw === NO_BACKDROP) return NO_BACKDROP;
    return raw && IDS.has(raw) ? raw : DEFAULT_BACKDROP;
  } catch {
    return DEFAULT_BACKDROP;
  }
}

function current(): string {
  if (chosen === null) chosen = read();
  return chosen;
}

export function setBackdrop(id: string) {
  track("theme", { theme: id });
  chosen = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private mode, or a full disk. The choice still applies for this session.
  }
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== KEY) return;
  chosen = null;
  for (const listener of listeners) listener();
}

// Once, not reference-counted — see lib/favourites.ts for why. A listener
// attached only while something is subscribed leaves a window in which another
// tab's write is missed and never re-read.
if (typeof window !== "undefined") window.addEventListener("storage", onStorage);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBackdrop(): string {
  return useSyncExternalStore(subscribe, current, () => NO_BACKDROP);
}
