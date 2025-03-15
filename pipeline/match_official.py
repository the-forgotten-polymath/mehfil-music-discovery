"""Prefer Saregama's own upload of a song over anyone else's.

Saregama owns this catalogue, so where they have published a recording it is
the one to use: correct audio, correct credits, and the least likely of any
candidate to be taken down. Open search was doing most of the work only because
three channels had ever been harvested — and one of those handles no longer
resolves — so official uploads were largely invisible to the matcher.

The corpus is searched locally, which makes preference cheap: every official
video is already in the database, so proposing a better match for three
thousand songs costs no requests at all. Only the shortlisted candidates need a
network call, and only to learn their length.

A match is replaced only when it is genuinely faulty — missing, unplayable, the
wrong length, or not the song. Coming from somewhere other than Saregama is not
a fault. Treating it as one cost real songs: Saregama disables embedding on many
of its uploads, so preferring them moved "Aa Mere Humjoli Aa" off a Rajshri
video that played onto an official one that would not.

Being official earns a preference between candidates and never an exemption
from the rules. Saregama Karaoke is official and publishes backing tracks;
Saregama Jhankar Beats is official and publishes remasters. Both are excluded,
and every candidate is checked for embedding before it is accepted.

Usage:
    python3 pipeline/match_official.py data/carvaan.db --dry-run
    python3 pipeline/match_official.py data/carvaan.db
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store
from titlematch import fold, names_song, opens_with_song
from match_videos import REJECT_RE, RANGE_RE
from reresolve_songs import (
    MIN_SECONDS, MAX_SECONDS, TYPICAL, EXTRA_REJECT, WRONG_KIND,
)
from fetch_video_meta import fetch_batch, BATCH
from verify_embeddable import check as check_embeddable

# Below this a title fragment matches too much to mean anything.
MIN_KEY = 6


def official_videos(conn):
    rows = conn.execute(
        "SELECT video_id, title, channel_id, duration FROM videos "
        "WHERE channel_id LIKE 'saregama%'"
    ).fetchall()
    # Karaoke is Saregama's too. Official is not the same as right.
    return [
        (fold(row["title"]), row) for row in rows
        if not any(k in (row["channel_id"] or "").lower() for k in WRONG_KIND)
    ]


def current_state(conn):
    """song_id -> (video_id, confidence, channel, duration, video_title)."""
    state = {}
    for row in conn.execute(
        "SELECT r.song_id, r.video_id, r.confidence, r.embeddable, "
        "v.channel_id, v.channel_title, v.duration, v.title "
        "FROM resolutions r LEFT JOIN videos v ON v.video_id = r.video_id"
    ):
        state[row["song_id"]] = row
    return state


def needs_upgrade(song, current):
    """Only replace a match that is missing or actually faulty.

    Preferring Saregama used to be reason enough to displace anything else,
    which cost more than it bought: Saregama disables embedding on many of its
    uploads, so "Aa Mere Humjoli Aa" was moved off a Rajshri video that played
    to an official one that would not. A working, correct match is the goal;
    where it came from is a tiebreaker for choosing between candidates, never a
    fault in a match that already works.
    """
    if current is None or not current["embeddable"]:
        return True
    duration = current["duration"]
    if duration is not None and not MIN_SECONDS <= duration <= MAX_SECONDS:
        return True
    return not names_song(song["title"], current["title"] or "")


def main(db_path, dry_run=False):
    conn = store.connect(db_path)
    corpus = official_videos(conn)
    state = current_state(conn)
    print(f"{len(corpus)} official videos (karaoke excluded)\n")

    songs = conn.execute("SELECT id, title, film FROM songs").fetchall()
    singers = {}
    for row in conn.execute(
        "SELECT sa.song_id, a.name FROM song_artists sa "
        "JOIN artists a ON a.id = sa.artist_id"
    ):
        singers.setdefault(row["song_id"], []).append(row["name"])

    # 1. Propose, locally and for free.
    proposals = {}
    for song in songs:
        key = fold(song["title"])
        if len(key) < MIN_KEY:
            continue
        current = state.get(song["id"])
        if not needs_upgrade({"title": song["title"]}, current):
            continue

        film_key = store.normalise(song["film"] or "")
        title_song = fold(song["title"])[:10] == fold(song["film"] or "")[:10]
        for folded, video in corpus:
            # Cheap reject first, then the real test. The substring alone is not
            # the test: folding is lossy, so "Aa Aa Bhi Ja" reduces to "abhija"
            # and turned up inside "Mer-a Bhi Ja-gjit", replacing a correct match
            # with an unrelated ghazal. names_song compares whole words.
            if key not in folded:
                continue
            title = video["title"]
            if not names_song(song["title"], title):
                continue
            # A title song shares its name with its film, so every upload from
            # that film contains it; it has to lead the title to mean this song.
            if title_song and not opens_with_song(song["title"], title):
                continue
            if REJECT_RE.search(title) or RANGE_RE.search(title) \
                    or EXTRA_REJECT.search(title):
                continue
            blob = store.normalise(title)
            film_ok = bool(film_key) and film_key in blob
            singer_ok = any(
                store.normalise(s) and store.normalise(s) in blob
                for s in singers.get(song["id"], [])
            )
            if not (film_ok or singer_ok):
                continue
            confidence = 0.96 if (film_ok and singer_ok) else (0.92 if film_ok else 0.88)
            best = proposals.get(song["id"])
            if not best or confidence > best[0]:
                proposals[song["id"]] = (confidence, video)

    print(f"{len(proposals)} songs have a better official candidate")

    # 2. Only now spend requests, and only on what was shortlisted.
    unknown = sorted({
        video["video_id"] for _, video in proposals.values()
        if video["duration"] is None
    })
    if unknown:
        print(f"fetching length for {len(unknown)} candidates...")
        for i in range(0, len(unknown), BATCH):
            rows = fetch_batch(unknown[i:i + BATCH]) or []
            for video_id, duration, channel, _title in rows:
                conn.execute(
                    "UPDATE videos SET duration = ?, channel_title = ? "
                    "WHERE video_id = ?", (duration, channel, video_id),
                )
            conn.commit()
            if (i // BATCH) % 5 == 0:
                print(f"  {min(i + BATCH, len(unknown))}/{len(unknown)}", flush=True)

    lengths = {
        row["video_id"]: row["duration"] for row in conn.execute(
            "SELECT video_id, duration FROM videos WHERE duration IS NOT NULL"
        )
    }

    # 3. Apply what survives knowing its length.
    applied = rejected = 0
    for song_id, (confidence, video) in sorted(proposals.items()):
        duration = lengths.get(video["video_id"])
        if duration is None or not MIN_SECONDS <= duration <= MAX_SECONDS:
            rejected += 1
            continue
        if TYPICAL[0] <= duration <= TYPICAL[1]:
            confidence = min(confidence + 0.02, 0.98)
        # Saregama disables embedding on a good many of its uploads. Taking one
        # on trust is how a working song became a silent one.
        if check_embeddable(video["video_id"])[1] != 1:
            rejected += 1
            continue
        applied += 1
        if applied <= 15:
            print(f"  {video['title'][:58]:<60} {duration//60}:{duration%60:02d}")
        if not dry_run:
            store.replace_match(conn, song_id, video["video_id"], confidence,
                                "official_channel")
            conn.execute("UPDATE resolutions SET embeddable = 1 WHERE song_id = ?",
                         (song_id,))
            conn.execute("UPDATE videos SET embeddable = 1 WHERE video_id = ?",
                         (video["video_id"],))

    if not dry_run:
        conn.commit()
    print(f"\n{applied} upgraded to an official upload, "
          f"{rejected} rejected on length{' (dry run)' if dry_run else ''}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0], dry_run="--dry-run" in sys.argv)
