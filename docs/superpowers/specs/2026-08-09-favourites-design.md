# Favourites

Let someone mark songs they like, keep the marks on their device, and give them
a place to play them back.

## Why not a database

A database is the obvious answer and the wrong one. Storing which songs a person
likes needs an account, an account needs a login, and a login is a wall in front
of an app that currently asks nothing of anyone. That is a large amount of
machinery, plus a privacy policy, to hold about twenty kilobytes.

Twenty kilobytes is the measured figure, not an estimate. All 3,916 song ids
serialised as a JSON array is 19.9 KB — 0.38% of the smallest localStorage
quota. The worry that a full catalogue of likes might bloat storage does not
survive contact with the number, so there is no encoding scheme here: no bitset,
no packing, no compression. Those would cost readability and buy nothing.

The trade accepted in exchange: favourites are per-browser, they do not follow
anyone to another device, and clearing site data destroys them with no recovery.
That is a real cost and it is deliberate. It can be revisited without changing
anything below.

## Identity, and the pipeline change this requires first

Song ids are declared `id INTEGER PRIMARY KEY`, which makes them look persisted.
They are not. `parse_songlist.py` assigns them by counting through an
alphabetically sorted list:

    catalogue = sorted(songs.values(), key=lambda s: (s["title"].lower(), s["film"] or ""))
    for song_id, song in enumerate(catalogue, start=1):
        song["id"] = song_id

An id is a position in a sort, and the database takes whatever the parse
produced. So a single new song does not append: one landing at position 49
shifts 3,867 ids — 99% of the catalogue — by one. Correcting a title moves it in
the sort and does the same.

Deploys are unaffected: no CI runs the pipeline, and Vercel runs `next build`
against the committed `catalogue.json`. Only re-running `parse_songlist` renumbers.

`lib/routes.ts` already refuses to put facet indices in URLs for exactly this
reason — an index "would silently point at a different artist after a rebuild".
Song ids have the same defect and are used far more widely.

### This is not only a favourites problem

`resolutions` maps `song_id → video_id`, and `songs` upserts with
`ON CONFLICT(id) DO UPDATE SET title=...`. A re-parse after any addition would
rewrite each row's title to the next song's while its resolution stayed put,
reassigning nearly every video to the wrong song — silently, with nothing to
detect it afterwards. That hazard exists today, independent of this feature.

### Prerequisite: an id ledger

`data/song_ids.json`, committed, mapping `normalise(title)|normalise(film)` to an
id. `parse_songlist` consults it, reuses the id for any song it has seen before,
assigns `max + 1` for new ones, and never reuses a retired id.

Ids become append-only, which is what the rest of the pipeline already assumes
they are. **This lands before favourites ships**, because writing positional ids
to users' disks would make a latent corruption bug permanent.

The alternative considered and rejected: deriving a key from title and film in
the web app instead. It needs no pipeline change and costs about 133 KB of
storage, but it leaves the resolutions hazard entirely in place.

## Storage

One module, `web/lib/favourites.ts`, owns all of it.

- Key `mehfil:favourites:v1`. The version is in the key so a future format
  change can be a new key rather than a migration.
- Value: a JSON array of song ids, in the order they were liked.

Read through `useSyncExternalStore` rather than a context provider. localStorage
genuinely is external state, so the hook's server-snapshot path handles the
server render without a `mounted` flag; and rows subscribe individually, so
liking one song re-renders that row instead of the whole list.

### Interface

    useIsFavourite(id: number): boolean
    useFavouriteIds(): readonly number[]
    toggleFavourite(id: number): void

Anything needing the songs themselves resolves ids against the catalogue at the
call site. The module knows about ids and nothing else.

### Failure modes

Two, both real, both handled rather than assumed away.

**`setItem` can throw.** Private browsing and a full disk both do it. Caught: the
in-memory set stays correct so the session behaves normally, and the like simply
does not persist. Failing the toggle instead would make the app appear broken
over a storage quota.

**A second tab silently eats likes.** Tab A likes a song and writes the array.
Tab B, holding a copy from before that write, likes a different song and writes
*its* array — and tab A's like is gone. A `storage` event listener re-reads and
re-broadcasts, which makes this a data-loss fix rather than a nicety.

## Where the control appears

- **Track row** — a heart in the existing right-hand column, muted when unliked
  and filled when liked. Always rendered, so nothing shifts when the state
  changes, and it is reachable on a phone where there is no hover. The row is
  itself the play button, so the heart stops propagation.
- **Player bar, collapsed** — beside the title, where music apps put it.
- **Expanded player** — in the secondary actions row, alongside details and
  report.

## The route

`/favourites`, listed in the sidebar and the mobile drawer with a heart icon.

It reuses the `/songs` list and its `setQueue(results)` pattern, so play,
shuffle and auto-advance work with no new playback code. The empty state
explains how to like a song rather than showing an empty list.

**Liked ids whose songs are no longer in the catalogue stay in storage and are
filtered at render.** Pruning them on read would delete a person's likes on any
load where the catalogue fetch failed — the one moment the data looks absent and
is not.

## The burst

Liking plays a short burst of small hearts rising from the button.

### Why it is portalled

The particles cannot live inside the row. The song list is a scroll container,
so hearts rising from a row would be clipped at its edge; and the list is
virtualised, so the row can unmount mid-flight and take the animation with it.

Both are solved the same way: capture the button's position with
`getBoundingClientRect()` at click time, and render the particles through a
portal on `document.body` into a host mounted once by the app frame. A
module-level `burstAt(x, y)` reaches it, so the heart button stays free of
plumbing — the same external-store shape the favourites module already uses.

### How it moves

Six hearts. Each is given its own horizontal drift, rise distance, rotation,
final scale and start delay as CSS custom properties, so every particle differs
while the keyframes remain one static rule.

They fade in leaving the button, drift apart as they climb, then shrink and fade
near the top. About 900 ms end to end. Transform and opacity only — composited,
never touching layout. The heart itself does a short scale overshoot and settles.

### Behaviour

- **Only on liking, never on unliking.** A celebration for removing something
  reads as mockery.
- **Reduced motion gets the fill and no particles.** This is not a lesser
  version: the state change is the information and the particles are decoration.
- **Bursts are capped at four concurrent and self-cleaning**, so rapid toggling
  cannot accumulate DOM — a fifth burst drops the oldest rather than queueing,
  since a stale burst finishing late reads as a glitch. Each removes itself on
  the last `animationend`, with a timeout backstop for a tab backgrounded
  mid-animation, where that event never arrives.
- `aria-hidden` and `pointer-events-none` throughout. A screen reader gets
  `aria-pressed` on the button, which is the real signal.

## Out of scope

No backup or export, no sync, no like counts, no playlists, and no separate
"recently liked" ordering — storing ids in like-order provides that already.

## Verification

The project has no test tooling: `package.json` defines `lint` and `build` only.
Verification is therefore typecheck, lint, build, and exercising the routes,
consistent with the rest of this codebase.

Four things want checking by hand, because none of them are visible to a build:

1. A like survives a reload.
2. Two tabs open, a like in each, both present afterwards.
3. The burst is not clipped by the list, and completes when the row is scrolled
   away immediately after the click.
4. Reduced motion suppresses the particles and keeps the fill.
