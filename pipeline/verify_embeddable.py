"""Verify that resolved video ids can actually be played in an iframe.

A video id is only useful to us if YouTube will embed it. The oEmbed endpoint is
the cheapest way to ask: 200 means embeddable, 401/403 means embedding is
disabled, 404 means the video is gone. All three of the failure cases are fatal
for an iframe player, so they are treated alike.

Imported ids are an old snapshot, so a large share fail. Anything that fails is
demoted back into the pending queue for the harvest to re-resolve, rather than
being deleted -- we keep the record so we never re-check the same dead id twice.

Results are committed in batches as they arrive, so interrupting this costs at
most the in-flight batch. Re-running skips everything already checked.

    python3 pipeline/verify_embeddable.py data/carvaan.db [--recheck]
"""

import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store

WORKERS = 16
BATCH = 50
TIMEOUT = 15
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"


def known_dead(conn):
    """Video ids already proven unplayable -- never worth re-checking."""
    return {
        row["video_id"]
        for row in conn.execute("SELECT video_id FROM videos WHERE embeddable = 0")
    }


def check(video_id):
    """Return (video_id, embeddable, note). None means inconclusive -- retry later."""
    url = f"https://www.youtube.com/oembed?url=https://youtu.be/{video_id}&format=json"
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        urllib.request.urlopen(request, timeout=TIMEOUT).read()
        return video_id, 1, "ok"
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            return video_id, 0, "embedding disabled"
        if exc.code == 404:
            return video_id, 0, "video removed"
        return video_id, None, f"http {exc.code}"
    except Exception as exc:
        return video_id, None, type(exc).__name__


def main(db_path, recheck=False):
    conn = store.connect(db_path)

    where = "" if recheck else "WHERE embeddable IS NULL"
    todo = [r["video_id"] for r in
            conn.execute(f"SELECT DISTINCT video_id FROM resolutions {where}")]
    if not recheck:
        # Anything already proven dead on a previous run needs no second look.
        todo = [v for v in todo if v not in known_dead(conn)]
    if not todo:
        print("nothing to check")
        return

    print(f"checking {len(todo)} video ids with {WORKERS} workers\n")
    good = bad = unknown = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        batch = []
        for video_id, embeddable, note in pool.map(check, todo):
            batch.append((video_id, embeddable, note))
            if embeddable == 1:
                good += 1
            elif embeddable == 0:
                bad += 1
            else:
                unknown += 1

            if len(batch) >= BATCH:
                flush(conn, batch)
                batch = []
                done = good + bad + unknown
                print(f"  {done}/{len(todo)}  embeddable={good}  unusable={bad}  unknown={unknown}")
        if batch:
            flush(conn, batch)

    # Dead ids stop counting as resolved: clear the match so the harvest retries
    # the song, but keep a failure row so the same id is not re-tried blindly.
    conn.execute("BEGIN")
    demoted = conn.execute(
        "SELECT song_id, video_id FROM resolutions WHERE embeddable = 0"
    ).fetchall()
    for row in demoted:
        store.record_failure(conn, row["song_id"], f"not embeddable: {row['video_id']}")
    conn.execute("DELETE FROM resolutions WHERE embeddable = 0")
    conn.execute("COMMIT")

    progress = store.progress(conn)
    print(f"\nembeddable   : {good}")
    print(f"unusable     : {bad} (demoted back to pending)")
    print(f"inconclusive : {unknown} (will retry)")
    print(f"resolved now : {progress['resolved']} / {progress['songs']} "
          f"({100 * progress['resolved'] / progress['songs']:.1f}%)")
    print(f"pending      : {len(store.pending_songs(conn, max_attempts=99))}")


def flush(conn, batch):
    conn.execute("BEGIN")
    try:
        for video_id, embeddable, _ in batch:
            if embeddable is None:
                continue
            conn.execute(
                "UPDATE resolutions SET embeddable=?, checked_at=? WHERE video_id=?",
                (embeddable, store.now(), video_id),
            )
            # Record it on the video too, so later matchers skip dead ids
            # instead of rediscovering and re-demoting them every run.
            conn.execute(
                "UPDATE videos SET embeddable=? WHERE video_id=?", (embeddable, video_id)
            )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


if __name__ == "__main__":
    main(sys.argv[1], "--recheck" in sys.argv)
