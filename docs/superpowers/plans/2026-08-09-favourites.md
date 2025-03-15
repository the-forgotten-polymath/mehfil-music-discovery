# Favourites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone mark songs they like, keep those marks on their device, and give them a route to play them back.

**Architecture:** One module owns the stored ids and exposes them through `useSyncExternalStore`, so localStorage is treated as the external state it is and each row subscribes individually. A separate module owns the tap animation and renders it through a portal on `document.body`, because the song list both clips and unmounts its rows. A heart button composes the two. The route reuses the existing `SongList` and `setQueue` pattern, so no playback code is added.

**Tech Stack:** Next.js 16 App Router, React 19 (`useSyncExternalStore`, `createPortal`), Tailwind v4, lucide-react, react-virtuoso.

## Global Constraints

- **Storage key:** `mehfil:favourites:v1` — version in the key, so a format change is a new key rather than a migration.
- **Stored value:** a JSON array of song ids in the order they were liked. No bitset, no packing: the full catalogue is 19.9 KB, 0.38% of the smallest quota.
- **Never throw from storage.** `setItem` fails in private mode and on a full disk; the in-memory state stays correct and the session keeps working.
- **Never prune unknown ids.** Ids whose songs are missing from the catalogue stay in storage and are filtered at render — pruning on read would delete someone's likes on any load where the catalogue fetch failed.
- **Burst on liking only, never on unliking.**
- **`prefers-reduced-motion: reduce` suppresses particles entirely**, keeping the fill. The state change is the information; the particles are decoration.
- **No test framework exists.** `web/package.json` defines `lint` and `build` only. Verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and the named manual checks in each task. Do not add a test framework as part of this work.
- **Spelling is British throughout** (`favourites`), matching the existing copy.
- Every file starts with `"use client"` if it uses hooks, state, or browser APIs.

## File structure

| File | Responsibility |
|---|---|
| `web/lib/favourites.ts` (create) | The stored ids. Nothing else — it knows about numbers, not songs. |
| `web/components/like-burst.tsx` (create) | The particle animation and its portal host. Knows nothing about favourites. |
| `web/components/like-button.tsx` (create) | The heart. Composes the two modules above. |
| `web/app/globals.css` (modify) | The one keyframe rule the particles animate on. |
| `web/components/track-row.tsx` (modify) | A heart in the existing right-hand column. |
| `web/components/player-bar.tsx` (modify) | A heart in the collapsed bar and in the expanded actions row. |
| `web/app/favourites/page.tsx` (create) | The route. |
| `web/components/app-frame.tsx` (modify) | Nav item, and mounts the burst host once. |

The two created modules do not import each other. `like-button.tsx` is the only file that knows both exist, which is what keeps the animation reusable and the storage testable by inspection.

---

### Task 1: The storage module

**Files:**
- Create: `web/lib/favourites.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `useIsFavourite(id: number): boolean`
  - `useFavouriteIds(): readonly number[]`
  - `useFavouritesRevision(): number`
  - `toggleFavourite(id: number): void`
  - `isFavourite(id: number): boolean` — non-hook read, for the button deciding whether to burst

- [ ] **Step 1: Write the module**

```tsx
"use client";

import { useSyncExternalStore } from "react";

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
 */
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== KEY) return;
  ids = null;
  index = null;
  revision += 1;
  for (const listener of listeners) listener();
}

// Attached once, not reference-counted. Counting subscribers leaves a gap:
// with the last component unmounted the listener is gone but the caches above
// are not, so a write from another tab during that gap is missed permanently
// — re-subscribing does not re-read. The next toggle would then write a set
// built from stale data and delete the other tab's like with no error and no
// way back. One listener for the life of the page has no such window.
if (typeof window !== "undefined") window.addEventListener("storage", onStorage);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a song is liked, without subscribing. For event handlers. */
export function isFavourite(id: number): boolean {
  return currentIndex().has(id);
}

export function toggleFavourite(id: number) {
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
```

- [ ] **Step 2: Verify it compiles and the app still builds**

```bash
cd web && npx tsc --noEmit && npm run lint && npm run build
```

Expected: tsc silent, lint `0 errors`, build `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add web/lib/favourites.ts
git commit -m "Keep liked songs on the device"
```

---

### Task 2: The burst

**Files:**
- Create: `web/components/like-burst.tsx`
- Modify: `web/app/globals.css` (append the keyframes at the end of the file)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `burstAt(x: number, y: number): void` — screen coordinates of the burst origin
  - `<LikeBurstHost />` — mounted exactly once, renders nothing until a burst fires

- [ ] **Step 1: Add the keyframes to `web/app/globals.css`**

Append at the end of the file:

```css
/* A liked heart throwing off smaller ones.
 *
 * One static rule for every particle: each is handed its own drift, rise,
 * rotation, end scale and delay as custom properties, so six differ without six
 * keyframe definitions.
 *
 * Transform and opacity only. Both are composited, so the whole burst runs off
 * the main thread and cannot cause layout while a song is starting. */
@keyframes like-rise {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.4) rotate(0deg);
  }
  15% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy)))
      scale(var(--end-scale)) rotate(var(--rot));
  }
}
```

- [ ] **Step 2: Write `web/components/like-burst.tsx`**

```tsx
"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Heart } from "lucide-react";

/**
 * Small hearts rising from a tap.
 *
 * Portalled onto document.body rather than rendered where the tap happened,
 * for two independent reasons that have the same fix. The song list is a scroll
 * container, so particles rising out of a row would be clipped at its edge; and
 * the list is virtualised, so the row can unmount mid-flight and take the
 * animation with it. Positioned from the button's screen coordinates, captured
 * at click time, they are subject to neither.
 *
 * The host is mounted once by the app frame and renders nothing until a burst
 * fires. A module-level emitter reaches it, so a button does not need to be
 * wired to anything.
 */

type Particle = {
  dx: string;
  dy: string;
  rot: string;
  scale: string;
  delay: string;
  size: number;
};

type Burst = { key: number; x: number; y: number; particles: Particle[] };

const COUNT = 6;
/** Longest a particle can still be on screen: duration + the largest delay. */
const LIFETIME = 1100;
/**
 * Four at once is plenty. A fifth drops the oldest rather than queueing —
 * queued bursts arrive after the tap that caused them and read as lag.
 */
const MAX = 4;

let sequence = 0;
let bursts: readonly Burst[] = Object.freeze([]);
const listeners = new Set<() => void>();

function publish(next: Burst[]) {
  bursts = Object.freeze(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function particle(): Particle {
  // Signed drift so they fan out either side, biased upward by the rise.
  const dx = Math.round((Math.random() - 0.5) * 90);
  const dy = -Math.round(70 + Math.random() * 70);
  return {
    dx: `${dx}px`,
    dy: `${dy}px`,
    rot: `${Math.round((Math.random() - 0.5) * 90)}deg`,
    scale: (0.4 + Math.random() * 0.4).toFixed(2),
    delay: `${Math.round(Math.random() * 120)}ms`,
    size: 10 + Math.round(Math.random() * 8),
  };
}

/**
 * Fire a burst at a point on screen.
 *
 * Silently does nothing under reduced motion. That is not a lesser version of
 * the feature: the heart filling is the information, and this is decoration.
 */
export function burstAt(x: number, y: number) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const key = ++sequence;
  const next = [
    ...bursts,
    { key, x, y, particles: Array.from({ length: COUNT }, particle) },
  ].slice(-MAX);
  publish(next);

  // A timer rather than animationend. The end event would arrive six times per
  // burst and the last one is not identifiable without tracking them, whereas
  // the duration is a number we chose. It also survives a tab backgrounded
  // mid-animation, where animation events never arrive at all.
  window.setTimeout(() => {
    publish(bursts.filter((burst) => burst.key !== key));
  }, LIFETIME);
}

export function LikeBurstHost() {
  const active = useSyncExternalStore(
    subscribe,
    () => bursts,
    () => Object.freeze([]) as readonly Burst[]
  );

  // Portals need a DOM target, which does not exist during the server render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || active.length === 0) return null;

  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[95]">
      {active.map((burst) =>
        burst.particles.map((p, i) => (
          <Heart
            key={`${burst.key}-${i}`}
            className="absolute fill-primary text-primary"
            style={
              {
                left: burst.x,
                top: burst.y,
                width: p.size,
                height: p.size,
                "--dx": p.dx,
                "--dy": p.dy,
                "--rot": p.rot,
                "--end-scale": p.scale,
                animation: `like-rise 900ms cubic-bezier(0.22, 0.61, 0.36, 1) ${p.delay} both`,
              } as React.CSSProperties
            }
          />
        ))
      )}
    </div>,
    document.body
  );
}
```

- [ ] **Step 3: Verify**

```bash
cd web && npx tsc --noEmit && npm run lint && npm run build
```

Expected: tsc silent, lint `0 errors`, build `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add web/components/like-burst.tsx web/app/globals.css
git commit -m "Add the burst a liked heart throws off"
```

---

### Task 3: The heart button

**Files:**
- Create: `web/components/like-button.tsx`

**Interfaces:**
- Consumes: `useIsFavourite`, `isFavourite`, `toggleFavourite` from Task 1; `burstAt` from Task 2.
- Produces: `<LikeButton songId={number} className?={string} size?={number} />`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { Heart } from "lucide-react";
import { burstAt } from "@/components/like-burst";
import { isFavourite, toggleFavourite, useIsFavourite } from "@/lib/favourites";

/**
 * The one control that likes a song.
 *
 * Always rendered rather than revealed on hover, so nothing shifts when the
 * state changes and it is reachable on a phone, where there is no hover to
 * reveal anything.
 */
export function LikeButton({
  songId,
  className = "",
  size = 16,
}: {
  songId: number;
  className?: string;
  size?: number;
}) {
  const liked = useIsFavourite(songId);

  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={liked ? "Remove from favourites" : "Add to favourites"}
      title={liked ? "Remove from favourites" : "Add to favourites"}
      onClick={(event) => {
        // Rows are themselves play buttons, and the expanded player closes on
        // background clicks. Without both of these, liking would also start a
        // song or dismiss the view it was pressed in.
        event.stopPropagation();
        event.preventDefault();

        // Read before toggling: the burst celebrates liking, and firing it on
        // removal would read as mockery.
        const willLike = !isFavourite(songId);
        toggleFavourite(songId);

        if (willLike) {
          const box = event.currentTarget.getBoundingClientRect();
          burstAt(box.left + box.width / 2, box.top + box.height / 2);
        }
      }}
      className={`grid shrink-0 place-items-center rounded-full transition active:scale-90 ${
        liked
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground"
      } ${className}`}
    >
      <Heart
        style={{ width: size, height: size }}
        // Only the fill animates. Scaling the icon would move it inside a fixed
        // grid cell and shift whatever sits beside it.
        className={`transition-transform duration-200 ${liked ? "fill-current scale-110" : "scale-100"}`}
      />
    </button>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd web && npx tsc --noEmit && npm run lint && npm run build
```

Expected: tsc silent, lint `0 errors`, build `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add web/components/like-button.tsx
git commit -m "Add the heart control"
```

---

### Task 4: Put the heart where songs are

**Files:**
- Modify: `web/components/track-row.tsx` — right-hand action column
- Modify: `web/components/player-bar.tsx` — collapsed bar, and the expanded secondary actions row
- Modify: `web/components/app-frame.tsx` — mount `<LikeBurstHost />` once

**Interfaces:**
- Consumes: `<LikeButton>` from Task 3, `<LikeBurstHost>` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Add the import and the button to `web/components/track-row.tsx`**

Add to the imports:

```tsx
import { LikeButton } from "@/components/like-button";
```

In the final `<div className="flex items-center gap-3 pr-1">`, insert the button as the **last** child, after the confidence dot:

```tsx
        <LikeButton songId={song.id} size={15} className="size-7" />
```

- [ ] **Step 2: Add the burst host in `web/components/app-frame.tsx`**

Add to the imports:

```tsx
import { LikeBurstHost } from "@/components/like-burst";
```

Render it once, as the last child of the component's outermost returned element, beside the existing frame content:

```tsx
      <LikeBurstHost />
```

- [ ] **Step 3: Add the heart to the collapsed player bar in `web/components/player-bar.tsx`**

Add to the imports:

```tsx
import { LikeButton } from "@/components/like-button";
```

In the collapsed bar, immediately after the element whose `onClick` is `() => setDetailsOpen(true)` around line 978 — the song title and artist cluster — add as its next sibling:

```tsx
          {song && <LikeButton songId={song.id} size={16} className="size-8" />}
```

- [ ] **Step 4: Add the heart to the expanded secondary actions row in `web/components/player-bar.tsx`**

In the expanded view's secondary actions row — the one using the `secondaryAction` class alongside details and report — add as the first action:

```tsx
              {song && (
                <LikeButton
                  songId={song.id}
                  size={16}
                  className={secondaryAction}
                />
              )}
```

- [ ] **Step 5: Verify**

```bash
cd web && npx tsc --noEmit && npm run lint && npm run build
```

Expected: tsc silent, lint `0 errors`, build `✓ Compiled successfully`.

- [ ] **Step 6: Verify by hand — these are the checks a build cannot make**

Run `npm run dev` and confirm each:

1. Clicking a heart in a song row **fills it and does not start the song**.
2. The burst is **not clipped** by the list — particles rise past the top of the row and over the header.
3. Like a song, then immediately scroll it out of view: **the particles still finish**.
4. Reload the page: **the fill survives**.
5. Open a second tab, like a song there, return to the first: **the first tab shows it liked**.
6. In DevTools, set emulation to `prefers-reduced-motion: reduce`, then like a song: **the heart fills, no particles appear**.
7. Unlike a song: **the fill clears and no particles appear**.

- [ ] **Step 7: Commit**

```bash
git add web/components/track-row.tsx web/components/player-bar.tsx web/components/app-frame.tsx
git commit -m "Put the heart in the rows and the player"
```

---

### Task 5: The favourites route

**Files:**
- Create: `web/app/favourites/page.tsx`
- Modify: `web/components/app-frame.tsx` — nav item in the shared nav block

**Interfaces:**
- Consumes: `useFavouriteIds`, `useFavouritesRevision` from Task 1.
- Produces: the `/favourites` route.

- [ ] **Step 1: Write `web/app/favourites/page.tsx`**

```tsx
"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Heart, Play, Shuffle } from "lucide-react";
import { CatalogueGate } from "@/components/catalogue-gate";
import { useFrame } from "@/components/app-frame";
import { usePlayer } from "@/components/player-provider";
import { SongList } from "@/components/song-list";
import { useFavouriteIds, useFavouritesRevision } from "@/lib/favourites";
import { useCatalogue } from "@/lib/queries";

export default function FavouritesPage() {
  const { data: catalogue, isLoading, isError, error } = useCatalogue();
  const { scrollEl } = useFrame();
  const { currentId, playing, play, playFirst, playRandom, setQueue } = usePlayer();
  const ids = useFavouriteIds();
  const revision = useFavouritesRevision();

  const results = useMemo(() => {
    if (!catalogue) return [];
    const byId = new Map(catalogue.songs.map((song) => [song.id, song]));
    // Newest first, and ids missing from the catalogue are skipped rather than
    // removed from storage: a failed catalogue fetch would otherwise look
    // exactly like every song having been deleted.
    return ids
      .map((id) => byId.get(id))
      .filter((song): song is NonNullable<typeof song> => Boolean(song))
      .reverse();
  }, [catalogue, ids]);

  // The player advances through whatever this route is showing.
  useEffect(() => setQueue(results), [results, setQueue]);

  return (
    <CatalogueGate isLoading={isLoading} isError={isError} error={error}>
      {catalogue && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3 pb-4">
            <div className="min-w-0">
              <h2 className="truncate pt-1 text-2xl leading-tight">Your favourites</h2>
              <p className="text-xs text-muted-foreground">
                {results.length.toLocaleString()}{" "}
                {results.length === 1 ? "song" : "songs"} · kept on this device
              </p>
            </div>
            {results.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => playRandom(results)}
                  title="Shuffle"
                  className="grid size-10 place-items-center rounded-full border border-white/15 transition hover:bg-white/10"
                >
                  <Shuffle className="size-4" />
                </button>
                <button
                  onClick={() => playFirst(results)}
                  title="Play"
                  className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105"
                >
                  <Play className="size-5 translate-x-px fill-current" />
                </button>
              </div>
            )}
          </div>

          {results.length === 0 ? (
            <div className="py-20 text-center">
              <Heart className="mx-auto size-8 text-muted-foreground/40" />
              <p className="mt-4 text-sm text-muted-foreground">
                Nothing here yet. Tap the heart beside any song and it will be
                waiting for you.
              </p>
              <Link
                href="/songs"
                className="mt-4 inline-block rounded-full border border-white/15 px-4 py-2 text-xs transition hover:bg-white/10"
              >
                Browse all songs
              </Link>
            </div>
          ) : (
            <SongList
              catalogue={catalogue}
              songs={results}
              filterKey={`favourites:${revision}`}
              currentId={currentId}
              playing={playing}
              scrollParent={scrollEl}
              onPlay={play}
            />
          )}
        </>
      )}
    </CatalogueGate>
  );
}
```

- [ ] **Step 2: Add the nav item in `web/components/app-frame.tsx`**

Add `Heart` to the existing `lucide-react` import. In the shared nav block — the one whose comment says it serves both the rail and the mobile menu — insert between the "All songs" and "Help us find songs" links:

```tsx
        <Link href="/favourites" className={navClass(pathname === "/favourites")}>
          <Heart className="size-4" /> Your favourites
        </Link>
```

- [ ] **Step 3: Verify**

```bash
cd web && npx tsc --noEmit && npm run lint && npm run build
```

Expected: tsc silent, lint `0 errors`, build `✓ Compiled successfully`.

- [ ] **Step 4: Verify the route responds**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/favourites
```

Expected: `200`.

- [ ] **Step 5: Verify by hand**

1. With nothing liked, `/favourites` shows the empty state and **no play buttons**.
2. Like three songs, return: **all three appear, most recent first**.
3. Press Play: it plays, and **Next advances within the favourites**, not the whole catalogue.
4. Unlike a song while standing on the route: **it disappears from the list immediately**.
5. Unlike every song while playing: the list empties and **playback continues** rather than crashing.
6. The nav item is present in both the desktop rail and the mobile drawer, and **highlights when on the route**.

- [ ] **Step 6: Commit**

```bash
git add web/app/favourites/page.tsx web/components/app-frame.tsx
git commit -m "Add the favourites route"
```

---

## Self-review

**Spec coverage.** Storage module with the three named exports — Task 1, plus `isFavourite` and `useFavouritesRevision`, both needed by later tasks and both documented above. `setItem` throwing — Task 1, `commit`. Cross-tab `storage` listener — Task 1, `onStorage`. Heart in the track row, collapsed bar, and expanded actions — Task 4. Portalled burst, six particles, custom properties, one keyframe rule, transform and opacity only — Task 2. Like-only, reduced-motion, capped at four dropping the oldest — Task 2. `aria-hidden` and `pointer-events-none` on particles, `aria-pressed` on the button — Tasks 2 and 3. Route reusing `SongList` and `setQueue`, nav item, empty state, unknown ids filtered not pruned — Task 5.

**One deliberate deviation from the spec.** The spec said cleanup would run on the last `animationend` with a timeout as backstop. The plan uses the timer alone: six particles each fire the event, the last is not identifiable without tracking them, and the duration is a number we choose rather than one we must observe. The backstop was the reliable half of that pair; the event added a code path that could only agree with it.

**Placeholders.** None — every step carries the code it needs.

**Type consistency.** `useIsFavourite`, `useFavouriteIds`, `useFavouritesRevision`, `isFavourite`, `toggleFavourite`, `burstAt`, `LikeBurstHost`, `LikeButton` are used in later tasks exactly as declared in their producing task. `SongList` is called with the same props as `web/app/songs/page.tsx` passes today.

**Not covered, and correctly so:** backup and export, sync, like counts, playlists, and any separate recently-liked ordering — storing ids in like-order and reversing at render provides the last one already.

---

# Backdrop themes

Added after the favourites tasks above and executed after them. It shares no
code with favourites, but it reuses the same external-store shape, so doing it
second means that pattern is already established and reviewed.

**Goal:** Let someone choose which animated backdrop the app wears, from a
route showing all of them.

**Architecture:** The backdrop currently lives in `app/layout.tsx`, a server
component, so it cannot read a choice made in the browser. It moves into a
client component that reads the stored id through `useSyncExternalStore` —
the same shape as favourites — and both the app frame and the expanded player
render that one component.

## Assets, and why they are video

The seven GIFs total 9.1 MB. As h264 they total 1.3 MB, and only the chosen one
is ever fetched:

| theme | id | source | mp4 | poster |
|---|---|---|---|---|
| Lofi room | `lofi` | already shipped | 301K | 102K |
| Meadow | `meadow` | sheep1.gif 3.2M | 230K | 92K |
| Evening flock | `flock` | sheep2.gif 2.9M | 172K | 79K |
| Bus stop, dusk | `stop-dusk` | cat1.gif 600K | 156K | 79K |
| Bus stop, night | `stop-night` | cat2.gif 556K | 140K | 53K |
| Sleeping porch | `porch` | cat3.gif 348K | 88K | 67K |
| Waiting in the rain | `rain` | gib1.gif 1.1M | 57K | 24K |

Every one is lighter than the backdrop shipping today. A GIF also decodes on the
CPU and re-decodes every loop, which is the wrong thing to spend while a YouTube
player is running; h264 decodes in hardware.

`bg_gif.gif` is the lofi room already in the repo — same 150 frames — and the
shipped mp4 is the higher-resolution copy, so it is kept rather than re-encoded.

The pixel-art sources were encoded at crf 23 rather than 26: h264 smears hard
edges, and pixel art is nothing but hard edges.

---

### Task 6: Assets and the backdrop catalogue

**Files:**
- Create: `web/public/backdrops/{lofi,meadow,flock,stop-dusk,stop-night,porch,rain}.{mp4,jpg}`
- Delete: `web/public/backdrop.mp4`, `web/public/backdrop.jpg`
- Create: `web/lib/backdrops.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `BACKDROPS: readonly Backdrop[]` where `Backdrop = { id: string; label: string; note: string }`
  - `DEFAULT_BACKDROP = "lofi"`
  - `useBackdrop(): string` — the chosen id, or `"none"`
  - `setBackdrop(id: string): void`
  - `backdropSrc(id: string): { video: string; poster: string }`

- [ ] **Step 1: Convert and place the assets**

The conversions have already been produced in the scratchpad. Copy them in and
move the existing backdrop into the new folder:

```bash
cd /Users/shashwa7/Desktop/personal/carvaan
SRC=/private/tmp/claude-501/-Users-shashwa7-Desktop-personal/2ce5e5dc-414d-487a-a318-923e9c2de1fd/scratchpad/themes
mkdir -p web/public/backdrops
git mv web/public/backdrop.mp4 web/public/backdrops/lofi.mp4
git mv web/public/backdrop.jpg web/public/backdrops/lofi.jpg
cp $SRC/sheep1.mp4 web/public/backdrops/meadow.mp4
cp $SRC/sheep1.jpg web/public/backdrops/meadow.jpg
cp $SRC/sheep2.mp4 web/public/backdrops/flock.mp4
cp $SRC/sheep2.jpg web/public/backdrops/flock.jpg
cp $SRC/cat1.mp4   web/public/backdrops/stop-dusk.mp4
cp $SRC/cat1.jpg   web/public/backdrops/stop-dusk.jpg
cp $SRC/cat2.mp4   web/public/backdrops/stop-night.mp4
cp $SRC/cat2.jpg   web/public/backdrops/stop-night.jpg
cp $SRC/cat3.mp4   web/public/backdrops/porch.mp4
cp $SRC/cat3.jpg   web/public/backdrops/porch.jpg
cp $SRC/gib1.mp4   web/public/backdrops/rain.mp4
cp $SRC/gib1.jpg   web/public/backdrops/rain.jpg
ls -la web/public/backdrops/
```

Expected: 14 files, none larger than 302K.

- [ ] **Step 2: Write `web/lib/backdrops.ts`**

```tsx
"use client";

import { useSyncExternalStore } from "react";

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

export const DEFAULT_BACKDROP = "lofi";

/** Absence, chosen on purpose. Not every room wants weather in it. */
export const NO_BACKDROP = "none";

export const BACKDROPS: readonly Backdrop[] = [
  { id: "lofi", label: "Lofi room", note: "A studio with the hills outside" },
  { id: "meadow", label: "Meadow", note: "A sheep, a dog, an afternoon" },
  { id: "flock", label: "Evening flock", note: "The whole flock at sunset" },
  { id: "stop-dusk", label: "Bus stop, dusk", note: "A cat waiting, in red light" },
  { id: "stop-night", label: "Bus stop, night", note: "The same cat, under a lamp" },
  { id: "porch", label: "Sleeping porch", note: "Two cats, entirely asleep" },
  { id: "rain", label: "Waiting in the rain", note: "An umbrella and a long wait" },
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
```

- [ ] **Step 3: Verify**

```bash
cd web && npx tsc --noEmit && npm run lint && npm run build
```

Expected: tsc silent, lint `0 errors`, build `✓ Compiled successfully`.

At this point the app still references the deleted `/backdrop.mp4`; Task 7
fixes that. Do not commit until Task 7's step 1 is done — a commit here would
leave the tree with a broken image reference.

---

### Task 7: One backdrop component, driven by the choice

**Files:**
- Create: `web/components/app-backdrop.tsx`
- Modify: `web/app/layout.tsx` — replace the inline backdrop markup
- Modify: `web/components/player-bar.tsx` — replace the expanded-view copy

**Interfaces:**
- Consumes: `useBackdrop`, `backdropSrc`, `NO_BACKDROP` from Task 6.
- Produces: `<AppBackdrop opacity={number} />`

- [ ] **Step 1: Write `web/components/app-backdrop.tsx`**

```tsx
"use client";

import { backdropSrc, NO_BACKDROP, useBackdrop } from "@/lib/backdrops";

/**
 * The moving backdrop, wherever it appears.
 *
 * A client component because the choice lives in the browser, which is why this
 * is no longer inline in the layout. One definition serves the app frame and
 * the expanded player: they differ only in opacity, and two copies would drift
 * the moment either was touched.
 *
 * Video rather than the GIF each came from: a GIF decodes on the CPU and
 * re-decodes every loop, which is the wrong thing to spend while a YouTube
 * player is already running. The still beside it is both the poster and what
 * anyone who has asked for reduced motion gets instead.
 *
 * `key` on the video is deliberate. Changing a <source> element's src does not
 * reload a video — the browser has already committed to the loaded one — so
 * switching themes without remounting would leave the old footage playing under
 * a new name.
 *
 * Positioning belongs to the caller; this fills whatever box it is given.
 */
export function AppBackdrop({ opacity }: { opacity: number }) {
  const id = useBackdrop();
  if (id === NO_BACKDROP) return null;

  const { video, poster } = backdropSrc(id);

  return (
    <>
      <video
        key={id}
        autoPlay
        muted
        loop
        playsInline
        poster={poster}
        // Fades in rather than appearing. The server renders no backdrop, so
        // there is always a moment before this arrives; easing it in reads as
        // intentional where a pop reads as a glitch.
        className="absolute inset-0 size-full animate-[fade-in_700ms_ease-out_both] object-cover motion-reduce:hidden"
        style={{ opacity }}
      >
        <source src={video} type="video/mp4" />
      </video>
      <img
        src={poster}
        alt=""
        className="absolute inset-0 hidden size-full object-cover motion-reduce:block"
        style={{ opacity }}
      />
      {/* Warm wash, so the backdrop belongs to the brass palette rather than
          merely sitting under it. */}
      <div className="absolute inset-0 bg-[oklch(0.79_0.135_78)]/[0.07]" />
    </>
  );
}
```

- [ ] **Step 2: Add the fade keyframes to `web/app/globals.css`**

Append at the end of the file:

```css
/* The backdrop arriving after hydration. See components/app-backdrop.tsx. */
@keyframes fade-in {
  from {
    opacity: 0;
  }
}
```

Note: this animates from `opacity: 0` to whatever the inline style sets, because
a keyframe with no `to` uses the element's own value as the end state.

- [ ] **Step 3: Replace the backdrop block in `web/app/layout.tsx`**

Add to the imports:

```tsx
import { AppBackdrop } from "@/components/app-backdrop";
```

Replace the whole `{/* App-wide backdrop. ... */}` block — the wrapper div and
everything inside it — with:

```tsx
        {/* App-wide backdrop. Fixed and behind everything, so it holds still
            while content scrolls over it.

            24%, and that is a balance rather than a maximum: the content area
            lays bg-card/40 over it, so 60% of whatever is set here ends up
            behind the song rows. At 38% the footage read well in the open
            margins but crowded the rows. */}
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
          <AppBackdrop opacity={0.24} />
          {/* Only the bottom, and gently. A gradient from the top would undo
              the opacity chosen above. */}
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background/70 to-transparent" />
        </div>
```

- [ ] **Step 4: Replace the expanded-player copy in `web/components/player-bar.tsx`**

Add to the imports:

```tsx
import { AppBackdrop } from "@/components/app-backdrop";
```

Replace the contents of the `{expanded && (...)}` block that currently holds the
video, img and wash — keeping its wrapper div exactly as it is — so it reads:

```tsx
      {expanded && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-20 hidden md:block"
        >
          <AppBackdrop opacity={0.2} />
        </div>
      )}
```

- [ ] **Step 5: Verify no reference to the old paths survives**

```bash
cd /Users/shashwa7/Desktop/personal/carvaan
grep -rn "/backdrop\.mp4\|/backdrop\.jpg" web/app web/components web/public || echo "none — good"
cd web && npx tsc --noEmit && npm run lint && npm run build
```

Expected: `none — good`, then tsc silent, lint `0 errors`, build succeeds.

- [ ] **Step 6: Verify by hand**

1. The backdrop still appears on every route, and looks as it did.
2. It still appears in the expanded player on desktop, and still does not on a
   phone.
3. Under `prefers-reduced-motion: reduce`, the still shows and the video does
   not.

- [ ] **Step 7: Commit**

```bash
git add web/public/backdrops web/lib/backdrops.ts web/components/app-backdrop.tsx web/app/layout.tsx web/app/globals.css web/components/player-bar.tsx
git rm --cached web/public/backdrop.mp4 web/public/backdrop.jpg 2>/dev/null || true
git commit -m "Make the backdrop a choice rather than a constant"
```

---

### Task 8: The themes route

**Files:**
- Create: `web/app/themes/page.tsx`
- Modify: `web/components/app-frame.tsx` — nav item
- Modify: `web/app/about/page.tsx` — credit all seven rather than one

**Interfaces:**
- Consumes: `BACKDROPS`, `useBackdrop`, `setBackdrop`, `backdropSrc`, `NO_BACKDROP` from Task 6.
- Produces: the `/themes` route.

- [ ] **Step 1: Write `web/app/themes/page.tsx`**

```tsx
"use client";

import { Check, ImageOff } from "lucide-react";
import {
  BACKDROPS,
  backdropSrc,
  NO_BACKDROP,
  setBackdrop,
  useBackdrop,
} from "@/lib/backdrops";

/**
 * Pick what the app wears.
 *
 * There is no preview pane, because the page itself is the preview: choosing
 * applies immediately and the panel this grid sits on is translucent, so the
 * chosen backdrop is already visible behind the choice being made.
 *
 * The cards show stills rather than the videos. Seven autoplaying clips to
 * choose one is a great deal of decoding for a decision, and the live backdrop
 * behind the page is the moving version already.
 */
export default function ThemesPage() {
  const chosen = useBackdrop();

  return (
    <>
      <div className="pb-4">
        <h2 className="pt-1 text-2xl leading-tight">Themes</h2>
        <p className="text-xs text-muted-foreground">
          Kept on this device · applies straight away
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 pb-8 sm:grid-cols-3">
        {BACKDROPS.map((backdrop) => {
          const selected = chosen === backdrop.id;
          return (
            <button
              key={backdrop.id}
              onClick={() => setBackdrop(backdrop.id)}
              aria-pressed={selected}
              className={`group overflow-hidden rounded-xl border text-left transition ${
                selected
                  ? "border-primary/60 ring-1 ring-primary/40"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <span className="relative block aspect-video overflow-hidden bg-black/40">
                <img
                  src={backdropSrc(backdrop.id).poster}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover transition duration-500 group-hover:scale-105"
                />
                {selected && (
                  <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3.5" />
                  </span>
                )}
              </span>
              <span className="block px-3 py-2.5">
                <span className="block truncate text-sm">{backdrop.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {backdrop.note}
                </span>
              </span>
            </button>
          );
        })}

        {/* Absence, offered as plainly as the rest. A moving backdrop is not to
            everyone's taste and should not need a browser setting to escape. */}
        <button
          onClick={() => setBackdrop(NO_BACKDROP)}
          aria-pressed={chosen === NO_BACKDROP}
          className={`group overflow-hidden rounded-xl border text-left transition ${
            chosen === NO_BACKDROP
              ? "border-primary/60 ring-1 ring-primary/40"
              : "border-white/10 hover:border-white/25"
          }`}
        >
          <span className="relative grid aspect-video place-items-center bg-black/30">
            <ImageOff className="size-6 text-muted-foreground" />
            {chosen === NO_BACKDROP && (
              <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3.5" />
              </span>
            )}
          </span>
          <span className="block px-3 py-2.5">
            <span className="block text-sm">None</span>
            <span className="block text-[11px] text-muted-foreground">
              Just the dark room
            </span>
          </span>
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add the nav item in `web/components/app-frame.tsx`**

Add `Palette` to the existing `lucide-react` import. In the lower link group —
the one containing the `/about` link — add above it:

```tsx
          <Link
            href="/themes"
            className={navClass(pathname === "/themes")}
          >
            <Palette className="size-4" /> Themes
          </Link>
```

Match the surrounding links' class usage exactly; if the `/about` link there
uses a different class than `navClass`, use that one instead.

- [ ] **Step 3: Update the credit in `web/app/about/page.tsx`**

Replace the paragraph beginning "The animated backdrop behind the app is an
illustrated loop" with:

```tsx
        <p>
          The backdrops offered under Themes are illustrated loops by artists we
          have not been able to identify, re-encoded and warmed to sit with the
          rest of the palette. They are used decoratively and at low opacity. If
          you made one, or hold the rights to one, tell us and we will credit it
          or take it down — whichever you prefer.
        </p>
```

- [ ] **Step 4: Verify**

```bash
cd web && npx tsc --noEmit && npm run lint && npm run build
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/themes
```

Expected: build succeeds, route returns `200`.

- [ ] **Step 5: Verify by hand**

1. Choosing a theme **changes the backdrop immediately**, without a reload.
2. The change **survives a reload**.
3. Choosing None removes the backdrop entirely and **leaves no broken video
   element** behind.
4. Switching between two themes actually swaps the footage rather than keeping
   the first — this is what the `key` on the video guards, and it is the thing
   most likely to be silently wrong.
5. The choice **applies inside the expanded player** on desktop too.
6. A second tab follows the choice made in the first.
7. On a phone, the grid is two columns and the cards are legible.

- [ ] **Step 6: Commit**

```bash
git add web/app/themes/page.tsx web/components/app-frame.tsx web/app/about/page.tsx
git commit -m "Add a themes route"
```

## Self-review for the theme tasks

**Coverage.** A route showing every theme — Task 8. The images supplied plus the
one already shipped — Task 6, seven in total. Stored per device — Task 6, same
external-store shape as favourites. Applied app-wide and in the expanded player
— Task 7, one component in both places.

**The risk worth naming.** Changing a `<source>` element's `src` does not reload
a `<video>`; the browser has already committed to what it loaded. Without the
`key` on the video element in Task 7, switching themes would leave the old
footage playing. It is in the code and it is manual check 4 in Task 8, because a
build cannot see it.

**Type consistency.** `useBackdrop`, `setBackdrop`, `backdropSrc`, `BACKDROPS`,
`DEFAULT_BACKDROP`, `NO_BACKDROP` and `<AppBackdrop opacity>` are used in Tasks
7 and 8 exactly as Task 6 declares them.

**Not doing:** no colour-palette themes, no per-route backdrops, no upload. The
request was to choose among these images.
