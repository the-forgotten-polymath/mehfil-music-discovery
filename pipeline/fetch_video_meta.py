"""Record how long each matched video actually is, and who published it.

The resolver never knew either. yt-dlp's search prints only id and title under
--flat-playlist, so a thirty-minute jukebox whose description happens to list
the right song looked exactly like a three-minute recording of it. That is the
whole reason wrong-length videos are sitting in the catalogue: nothing in the
pipeline was in a position to notice.

Durations are fetched in batches rather than one request per video. YouTube
will assemble an ad-hoc playlist from a list of ids, and a flat listing of that
playlist carries duration and channel for every entry — turning three thousand
requests into about seventy.

Ids that come back missing are not failures to retry. YouTube omits what it
will not serve, so an absent id is a video that has been removed or made
private, and it is recorded as unplayable so the matcher stops offering it.

Usage:
    python3 pipeline/fetch_video_meta.py data/carvaan.db
    python3 pipeline/fetch_video_meta.py data/carvaan.db --all --workers 6
"""

import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store

# YouTube caps the ad-hoc playlist; staying under it keeps every batch whole.
BATCH = 40
WORKERS = 5
TIMEOUT = 120


def fetch_batch(video_ids):
    """[(id, duration, channel, title)] for one batch. Missing ids are absent."""
    url = "https://www.youtube.com/watch_videos?video_ids=" + ",".join(video_ids)
    cmd = [
        "yt-dlp", url,
        "--flat-playlist", "--skip-download", "--no-warnings", "--ignore-errors",
        "--print", "%(id)s|%(duration)s|%(channel)s|%(title)s",
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT).stdout
    except subprocess.TimeoutExpired:
        return None  # transient: leave the batch for a later run

    rows = []
    for line in out.splitlines():
        parts = line.strip().split("|", 3)
        if len(parts) != 4 or len(parts[0]) != 11:
            continue
        video_id, raw_duration, channel, title = parts
        try:
            duration = int(float(raw_duration))
        except (TypeError, ValueError):
            duration = None
        rows.append((video_id, duration, channel or None, title or None))
    return rows


def main(db_path, refresh_all=False, workers=WORKERS):
    conn = store.connect(db_path)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    if refresh_all:
        sql = "SELECT video_id FROM videos"
    else:
        # Only what the app can actually play, and only what we have not asked
        # about before.
        sql = (
            "SELECT v.video_id FROM videos v "
            "JOIN resolutions r ON r.video_id = v.video_id AND r.embeddable = 1 "
            "WHERE v.meta_checked_at IS NULL"
        )
    pending = [row["video_id"] for row in conn.execute(sql)]
    if not pending:
        print("nothing to fetch")
        return

    batches = [pending[i:i + BATCH] for i in range(0, len(pending), BATCH)]
    print(f"{len(pending)} videos in {len(batches)} batches\n")

    seen = 0
    gone = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch_batch, b): b for b in batches}
        for done, future in enumerate(as_completed(futures), start=1):
            batch = futures[future]
            rows = future.result()
            if rows is None:
                print(f"  batch {done}/{len(batches)}: timed out, will retry next run")
                continue

            found = set()
            for video_id, duration, channel, _title in rows:
                found.add(video_id)
                conn.execute(
                    "UPDATE videos SET duration = ?, channel_title = ?, "
                    "meta_checked_at = ? WHERE video_id = ?",
                    (duration, channel, now, video_id),
                )
            # Absent means YouTube declined to serve it at all.
            for video_id in set(batch) - found:
                conn.execute(
                    "UPDATE videos SET embeddable = 0, meta_checked_at = ? "
                    "WHERE video_id = ?", (now, video_id),
                )
                conn.execute(
                    "UPDATE resolutions SET embeddable = 0 WHERE video_id = ?",
                    (video_id,),
                )
            seen += len(found)
            gone += len(batch) - len(found)
            conn.commit()
            if done % 5 == 0 or done == len(batches):
                print(f"  {done}/{len(batches)} batches  ok={seen} unavailable={gone}",
                      flush=True)

    conn.commit()
    print(f"\n{seen} videos measured, {gone} no longer available")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    workers = WORKERS
    for i, a in enumerate(sys.argv):
        if a == "--workers" and i + 1 < len(sys.argv):
            workers = int(sys.argv[i + 1])
    main(args[0], refresh_all="--all" in sys.argv, workers=workers)
