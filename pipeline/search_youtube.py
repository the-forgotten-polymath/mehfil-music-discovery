"""Resolve remaining songs by searching YouTube per song via yt-dlp.

The channel harvest covers only what Saregama uploaded to the channels we
enumerated. Everything left needs a targeted search: query by title, film and
credited singer, then apply the same corroboration rule the channel matcher
uses -- a candidate is accepted only if the result title independently confirms
the film or a credited singer, and is not a cover, recreation or compilation.

Searches run concurrently but every accepted match is committed on the main
thread the moment it arrives, so an interrupt loses at most the in-flight
searches. Re-running picks up whatever `pending_songs` still returns.

    python3 pipeline/search_youtube.py data/carvaan.db [--limit N] [--workers N]
"""

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store
from match_videos import RANGE_RE, REJECT_RE, segments

WORKERS = 6
RESULTS_PER_QUERY = 5
SEARCH_TIMEOUT = 60
COMMIT_EVERY = 25


def search(query, limit=RESULTS_PER_QUERY):
    """Return [(video_id, title)] from a yt-dlp search. Metadata only."""
    cmd = [
        "yt-dlp", f"ytsearch{limit}:{query}",
        "--flat-playlist", "--skip-download", "--no-warnings", "--ignore-errors",
        "--print", "%(id)s|%(title)s",
    ]
    try:
        out = subprocess.run(
            cmd, capture_output=True, text=True, timeout=SEARCH_TIMEOUT
        ).stdout
    except subprocess.TimeoutExpired:
        return []
    results = []
    for line in out.splitlines():
        video_id, _, title = line.strip().partition("|")
        if len(video_id) == 11 and title:
            results.append((video_id, title))
    return results


def pick(song, singers, results):
    """Apply the corroboration rule. Returns (video_id, confidence) or None."""
    title_key, film_key = song["title_key"], song["film_key"]
    best = None

    for video_id, raw_title in results:
        if REJECT_RE.search(raw_title) or RANGE_RE.search(raw_title):
            continue
        blob = " ".join(segments(raw_title))
        if title_key not in blob:
            continue

        has_film = bool(film_key) and film_key != title_key and film_key in blob
        has_singer = any(name in blob for name in singers)

        if has_film and has_singer:
            confidence = 0.95
        elif has_film:
            confidence = 0.90
        elif has_singer:
            confidence = 0.82
        else:
            continue

        if best is None or confidence > best[1]:
            best = (video_id, confidence, raw_title)
    return best


def main(db_path, limit=None, workers=WORKERS):
    conn = store.connect(db_path)

    singers_by_song = {}
    for row in conn.execute(
        "SELECT sa.song_id, a.name FROM song_artists sa JOIN artists a ON a.id = sa.artist_id"
    ):
        key = store.normalise(row["name"])
        if len(key) >= 4:
            singers_by_song.setdefault(row["song_id"], []).append(key)

    pending = store.pending_songs(conn, max_attempts=2)
    if limit:
        pending = pending[:limit]
    if not pending:
        print("nothing pending")
        return

    print(f"searching {len(pending)} songs with {workers} workers\n")

    def task(song):
        singers = singers_by_song.get(song["id"], [])
        # Lead with the strongest signals; the singer disambiguates covers.
        query = " ".join(filter(None, [song["title"], song["film"] or "",
                                       singers[0] if singers else ""]))
        return song, pick(song, singers, search(query))

    found = missed = 0
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(task, song) for song in pending]
        conn.execute("BEGIN")
        try:
            for future in as_completed(futures):
                song, best = future.result()
                done += 1
                if best:
                    video_id, confidence, raw_title = best
                    conn.execute(
                        "INSERT INTO videos (video_id,title,channel_id,published_at,title_key) "
                        "VALUES (?,?,?,?,?) ON CONFLICT(video_id) DO NOTHING",
                        (video_id, raw_title, "search", None, store.normalise(raw_title)),
                    )
                    store.record_match(conn, song["id"], video_id, confidence, "yt_search")
                    found += 1
                else:
                    store.record_failure(conn, song["id"], "no corroborated result")
                    missed += 1

                if done % COMMIT_EVERY == 0:
                    conn.execute("COMMIT")
                    conn.execute("BEGIN")
                    print(f"  {done}/{len(pending)}  found={found}  missed={missed}", flush=True)
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("COMMIT")  # keep everything resolved so far
            raise

    progress = store.progress(conn)
    print(f"\nfound   : {found}")
    print(f"missed  : {missed}")
    print(f"resolved: {progress['resolved']} / {progress['songs']} "
          f"({100 * progress['resolved'] / progress['songs']:.1f}%)")
    print("\nRun verify_embeddable.py next -- these are unverified.")


if __name__ == "__main__":
    argv = sys.argv
    limit = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else None
    workers = int(argv[argv.index("--workers") + 1]) if "--workers" in argv else WORKERS
    main(argv[1], limit, workers)
