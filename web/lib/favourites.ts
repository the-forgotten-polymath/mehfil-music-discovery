"use client";

import { useSyncExternalStore } from "react";

import { track } from "@/lib/analytics";

/**
 * Which songs someone has liked, kept on their device.
 *
 * localStorage rather than a database, because an account is the wrong price
 * for this. Storing likes server-side needs a login, and a login is a wall in
 * front of an app that currently asks nothing of anyone — a large amount of
 * machinery, plus a privacy policy, to hold about twenty kilobytes.
 *
 * Twenty kilobytes is measured, not estimated: all 3,916 ids as a JSON array is
 * 19.9 KB, 0.38% of the smallest quota. So there is no encoding scheme here. A
 * bitset would cost readability and buy nothing.
 *
 * Read through useSyncExternalStore rather than a context, because localStorage
 * genuinely is external state: the hook's server-snapshot path handles the
 * server render without a `mounted` flag, and rows subscribe individually so
 * liking one song re-renders that row instead of the whole list.
 *
 * The trade accepted: favourites are per-browser, they do not follow anyone to
 * another device, and clearing site data destroys them. That is deliberate.
 */

const KEY = "mehfil:favourites:v1";

/** Frozen so the server snapshot is referentially stable across renders. */
const EMPTY: readonly number[] = Object.freeze([]);

const listeners = new Set<() => void>();

// Cached rather than re-read per render: getSnapshot runs on every render of
// every subscriber, and parsing 20 KB of JSON there would be pointless work.
// Both caches are dropped together whenever the underlying value changes.
let ids: readonly number[] | null = null;
let index: ReadonlySet<number> | null = null;
let revision = 0;

function read(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    // Anything could be under this key — another tab's bug, a hand-edited
    // value, a half-written string. Take only what is usable rather than
    // letting a bad entry throw on every render.
    return Array.isArray(parsed)
      ? parsed.filter((value): value is number => Number.isInteger(value))
      : [];
  } catch {
    // Private mode can refuse getItem outright, and JSON.parse throws on a
    // truncated value. Neither is a reason to fail the render.
    return [];
  }
}

function current(): readonly number[] {
  if (ids === null) ids = Object.freeze(read());
  return ids;
}

/** O(1) membership, so a list of rows does not scan the array per row. */
function currentIndex(): ReadonlySet<number> {
  if (index === null) index = new Set(current());
  return index;
}

function commit(next: number[]) {
  ids = Object.freeze(next);
  index = new Set(next);
  revision += 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded, or private mode refusing writes. The in-memory state is
    // still correct, so the session behaves normally and only persistence is
    // lost. Failing the toggle instead would make the app look broken.
  }
  for (const listener of listeners) listener();
}

/**
 * Another tab wrote the key.
 *
 * Without this, two tabs silently eat each other's likes: tab A writes its
 * array, tab B — holding a copy from before that write — writes its own, and
 * A's like is gone. This is a data-loss fix, not a nicety.
 *
 * A null key means storage.clear(), which also concerns us.
 *
 * The listener is attached once at module scope rather than reference-counted,
 * so there is no window during which a write can be missed. A single global
 * listener is cheap, and eliminates the class of gap where cache staleness
 * could survive a 0→1 subscriber transition.
 */
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== KEY) return;
  ids = null;
  index = null;
  revision += 1;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", onStorage);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether a song is liked, without subscribing. For event handlers. */
export function isFavourite(id: number): boolean {
  return currentIndex().has(id);
}

export function toggleFavourite(id: number) {
  // The action, never the song. Which songs a person loves is theirs.
  track("favourite", { action: isFavourite(id) ? "unliked" : "liked" });
  const now = current();
  commit(isFavourite(id) ? now.filter((value) => value !== id) : [...now, id]);
}

export function useIsFavourite(id: number): boolean {
  // A boolean snapshot, so only rows whose own state changed re-render.
  return useSyncExternalStore(
    subscribe,
    () => currentIndex().has(id),
    () => false
  );
}

export function useFavouriteIds(): readonly number[] {
  return useSyncExternalStore(subscribe, current, () => EMPTY);
}

/**
 * A counter that moves on every change.
 *
 * The favourites route feeds a filter key to the paged list, and that key has
 * to change whenever the set does. Length cannot do it — unliking one song and
 * liking another leaves it identical — and joining 3,500 ids into a string on
 * every render to use as a cache key is worse than counting.
 */
export function useFavouritesRevision(): number {
  return useSyncExternalStore(
    subscribe,
    () => revision,
    () => 0
  );
}
