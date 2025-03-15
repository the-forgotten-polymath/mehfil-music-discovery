"""Match harvested channel videos against songs that still need a URL.

Upload titles are pipe-delimited and noisy -- "Song - Audio | Film | Actor |
Singer" -- so each title is split into segments, stripped of production
qualifiers, and every segment is tried as a candidate song title. A film name
appearing in any other segment corroborates the match and raises confidence.

Only unambiguous matches are written. Anything that maps to several catalogue
songs with no corroborating film is skipped rather than guessed, because a
wrong id is worse than a missing one: it plays the wrong song silently.

    python3 pipeline/match_videos.py data/carvaan.db
"""

import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store

# Production noise that appears alongside the song name.
QUALIFIER_RE = re.compile(
    r"\b(official|lyrical|full|audio|video|song|songs|hd|4k|remastered|revival|"
    r"cover|version|teaser|trailer|promo|jukebox|mashup|reprise|live|"
    r"with lyrics|lyrics|out now|special|status|shorts)\b",
    re.I,
)
BRACKET_RE = re.compile(r"[\(\[\{][^\)\]\}]*[\)\]\}]")

MIN_TITLE_CHARS = 6

# Videos that carry the right song name but are not the catalogue recording:
# modern re-records, covers, and multi-song compilations. Matching these plays
# the wrong audio while looking correct, so they are excluded outright.
REJECT_RE = re.compile(
    r"\b(recreation|recreated|cover|unplugged|remix|remake|medley|mashup|"
    r"jukebox|nonstop|non stop|back to back|top \d+|best of|hits of|"
    r"all songs|full album|compilation|collection|instrumental|karaoke|"
    r"dance|remixed|tribute|reprise|piano|flute|sitar|santoor|"
    r"guitar|violin|orchestra|brian silas|superhit songs|evergreen songs)\b",
    re.I,
)

# Compilations often signal themselves with a decade or year range in the title
# ("50s se 70s", "1960-1975") rather than a keyword.
RANGE_RE = re.compile(r"\b(19\d0s?\s*[-–to]+\s*19\d0s?|\d0s\s*se\s*\d0s)\b", re.I)


def segments(title):
    """Split an upload title into candidate fields, cleaned of noise."""
    cleaned = BRACKET_RE.sub(" ", title)
    parts = re.split(r"[|｜]", cleaned)
    out = []
    for part in parts:
        part = QUALIFIER_RE.sub(" ", part)
        part = re.sub(r"\s*[-–—]\s*$", "", part.strip())
        key = store.normalise(part)
        if len(key) >= MIN_TITLE_CHARS:
            out.append(key)
    return out


def main(db_path):
    conn = store.connect(db_path)

    pending = store.pending_songs(conn, max_attempts=99)
    if not pending:
        print("nothing pending")
        return

    # Credited singers per song: the strongest signal that an upload is the
    # catalogue recording rather than someone else's version of the same song.
    singers = defaultdict(list)
    for row in conn.execute(
        "SELECT sa.song_id, a.name FROM song_artists sa JOIN artists a ON a.id = sa.artist_id"
    ):
        key = store.normalise(row["name"])
        if len(key) >= 4:
            singers[row["song_id"]].append(key)

    by_title = defaultdict(list)
    for song in pending:
        by_title[song["title_key"]].append((song["id"], song["film_key"]))

    # COALESCE keeps unchecked videos in play while excluding proven-dead ones.
    videos = conn.execute(
        "SELECT video_id, title FROM videos "
        "WHERE channel_id IS NOT NULL AND COALESCE(embeddable, 1) = 1"
    ).fetchall()
    print(f"pending songs : {len(pending)}")
    print(f"channel videos: {len(videos)}\n")

    matched, ambiguous, rejected, uncorroborated = {}, 0, 0, 0

    for video in videos:
        if REJECT_RE.search(video["title"]) or RANGE_RE.search(video["title"]):
            rejected += 1
            continue

        segs = segments(video["title"])
        if not segs:
            continue
        blob = " ".join(segs)

        for position, seg in enumerate(segs):
            candidates = by_title.get(seg)
            if not candidates:
                continue

            # A title alone is never enough -- too many songs share one, and
            # covers reuse them verbatim. Require the film or a credited
            # singer to appear in the same upload title.
            scored = []
            for song_id, film in candidates:
                has_film = bool(film) and film != seg and film in blob
                has_singer = any(name in blob for name in singers.get(song_id, ()))
                if has_film and has_singer:
                    scored.append((0.95, song_id))
                elif has_film:
                    scored.append((0.90, song_id))
                elif has_singer:
                    scored.append((0.82, song_id))

            if not scored:
                uncorroborated += 1
                continue

            scored.sort(reverse=True)
            best = scored[0][0]
            if sum(1 for c, _ in scored if c == best) > 1:
                ambiguous += 1
                continue

            confidence, song_id = scored[0]
            if position > 0:
                confidence -= 0.04
            if song_id in matched and matched[song_id][1] >= confidence:
                break
            matched[song_id] = (video["video_id"], confidence)
            break

    conn.execute("BEGIN")
    for song_id, (video_id, confidence) in matched.items():
        store.record_match(conn, song_id, video_id, confidence, "channel_match")
    conn.execute("COMMIT")

    progress = store.progress(conn)
    print(f"new matches         : {len(matched)}")
    print(f"rejected (cover/mix): {rejected}")
    print(f"uncorroborated      : {uncorroborated}")
    print(f"ambiguous skipped   : {ambiguous}")
    print(f"resolved total      : {progress['resolved']} / {progress['songs']} "
          f"({100 * progress['resolved'] / progress['songs']:.1f}%)")
    print("\nNote: new matches are unverified until verify_embeddable.py runs.")


if __name__ == "__main__":
    main(sys.argv[1])
