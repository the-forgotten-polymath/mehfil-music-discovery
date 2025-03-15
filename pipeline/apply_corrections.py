"""Apply manual video id fixes on top of whatever the resolver produced.

Automated matching gets some songs wrong in ways no heuristic will catch — a
web series episode sharing a song's name, a cover credited like the original.
Editing the database by hand fixes it until the next resolver run overwrites
it, so corrections live in a file and are reapplied as the last pipeline step.

Recorded at confidence 1.0, which is above anything the matchers produce, so
`record_match`'s confidence guard also protects them within a run.

    python3 pipeline/apply_corrections.py data/carvaan.db data/corrections.json
"""

import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store
from fetch_video_meta import fetch_batch

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}


def embeddable(video_id):
    """A correction that cannot be embedded would be demoted on the next
    verify pass, so it is worth knowing before writing it."""
    url = f"https://www.youtube.com/oembed?url=https://youtu.be/{video_id}&format=json"
    try:
        urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15).read()
        return True
    except urllib.error.HTTPError:
        return False
    except Exception:
        return None  # inconclusive; do not block on a network blip


def main(db_path, corrections_path):
    conn = store.connect(db_path)
    corrections = json.load(open(corrections_path, encoding="utf-8"))

    applied = skipped = missing = 0
    for key, value in corrections.items():
        if key.startswith("_"):
            continue

        title, _, film = key.partition(" | ")
        row = conn.execute(
            "SELECT id FROM songs WHERE title_key = ? AND film_key = ?",
            (store.normalise(title), store.normalise(film)),
        ).fetchone()
        if row is None:
            print(f"  MISSING  {key}")
            missing += 1
            continue

        video_id = value["video_id"]
        ok = embeddable(video_id)
        if ok is False:
            print(f"  NOT EMBEDDABLE  {key} -> {video_id}")
            skipped += 1
            continue

        # Fetch the real title, length and channel rather than filing the song's
        # own title against the id. Without a length the audit reads a corrected
        # video as zero seconds and flags the one match that is certainly right.
        meta = fetch_batch([video_id]) or []
        duration, channel, real_title = None, None, title
        for got_id, got_duration, got_channel, got_title in meta:
            if got_id == video_id:
                duration, channel = got_duration, got_channel
                real_title = got_title or title

        conn.execute("BEGIN")
        conn.execute(
            "INSERT INTO videos "
            "(video_id,title,channel_id,published_at,title_key,duration,channel_title) "
            "VALUES (?,?,?,?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET "
            "embeddable=1, title=excluded.title, title_key=excluded.title_key, "
            "duration=COALESCE(excluded.duration, videos.duration), "
            "channel_title=COALESCE(excluded.channel_title, videos.channel_title)",
            (video_id, real_title, "correction", None, store.normalise(real_title),
             duration, channel),
        )
        conn.execute("UPDATE videos SET embeddable=1 WHERE video_id=?", (video_id,))
        # Replace outright rather than going through record_match: the point of
        # a correction is to override whatever is there, including a match that
        # scored higher.
        conn.execute(
            "INSERT INTO resolutions (song_id,video_id,confidence,method,updated_at,embeddable) "
            "VALUES (?,?,?,?,?,1) ON CONFLICT(song_id) DO UPDATE SET "
            "video_id=excluded.video_id, confidence=excluded.confidence, "
            "method=excluded.method, updated_at=excluded.updated_at, embeddable=1",
            (row["id"], video_id, 1.0, "manual_correction", store.now()),
        )
        conn.execute("DELETE FROM resolve_failures WHERE song_id=?", (row["id"],))
        conn.execute("COMMIT")
        print(f"  applied  {key} -> {video_id}")
        applied += 1

    print(f"\napplied {applied}, skipped {skipped}, missing {missing}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
