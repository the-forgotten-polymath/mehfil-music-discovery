# Playback limits worth knowing before changing the player

## Auto-advance does not work in the installed PWA with the screen locked

A track finishes and the next one does not start. Pressing Next plays it
immediately, and with the screen on it advances by itself. It is specifically
the locked screen that stops it.

This is not a broken code path. `onNext` and `onEnded` call the same `step(1)`,
which sets `currentId`, which runs the same load effect and the same explicit
`playVideo()`. There is nothing that runs for one and not the other. It works on
desktop and in a mobile browser tab; it fails in the installed app.

Two causes are plausible and they are not mutually exclusive:

**Media autoplay policy.** `loadVideoById` loads a new source, and changing a
media element's source resets its user activation, so the `play()` that follows
needs a fresh gesture. Desktop grants autoplay anyway through the Media
Engagement Index once a site has been used repeatedly. This explains a browser
tab well and an installed PWA less well, since installed apps usually get more
latitude rather than less.

**Background throttling.** This is the one the reproduction points at. With the
screen locked a phone freezes the page; the YouTube iframe keeps playing audio
on its own, but the advance needs *our* JavaScript — the `onStateChange`
callback, a React state update, then an effect — and a frozen page runs none of
it until the phone is woken.

A media session is now declared, which is how a page tells the platform it is
playback rather than an idle tab, and is the signal the platform weighs when
deciding what to freeze. It also puts the title, artwork and skip controls on
the lock screen, which a music app should have regardless. Whether it is enough
to keep the page alive through a lock is the platform's decision, not ours.

### What would actually fix it

Hand the queue to YouTube as a playlist and let it advance internally. There is
then no `play()` call from us at all: one media session continues instead of a
new one starting, which sidesteps both causes at once.

The cost is real. `loadPlaylist` takes on the order of 200 ids and queues here
reach 3,916, so it needs a rolling window reloaded as it nears the end. Next and
Previous become `nextVideo()` and `previousVideo()`, the queue view has to track
`getPlaylistIndex()` rather than our own `currentId`, and shuffle and repeat have
to be re-expressed in the player's terms. It replaces the part of this app that
has broken most often, so it wants doing deliberately rather than as a fix
attempt.

### What was tried and did not help

- **Explicit `playVideo()` after every load.** Sound insurance, no effect here:
  playback was starting on desktop already, and on mobile the call is what gets
  refused.
- **Requesting 480p.** Worth keeping — this is a music player and the audio is
  identical at every rung — but it addresses buffering, not the advance.

## Auto-advance is slower than pressing Next

Expected, and not ours. The two run identical code. Clicking Next happens
mid-track while the player is warm and streaming; after a track completes the
player has finished its buffer and starts cold.

## Requested quality is a request

`suggestedQuality` and `setPlaybackQuality` have been advisory since 2019 —
YouTube chooses by bandwidth and player size. The reliable lever is player size,
which is why the collapsed player being 256px keeps quality low on its own, and
why expanding to full screen prompts a higher stream and a brief rebuffer.
