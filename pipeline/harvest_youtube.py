"""Harvest video ids + titles from Saregama's official channels via yt-dlp.

Enumerates channel listings only -- `--flat-playlist --skip-download` fetches
metadata (id and title) and never touches audio or video streams.

yt-dlp has no page-token cursor, so resumption uses the item offset: the number
of entries already committed becomes `--playlist-start` on the next run. Batches
commit as they stream in, so killing this mid-run costs at most BATCH entries.

    python3 pipeline/harvest_youtube.py data/carvaan.db [--limit N]
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store

BATCH = 200

# Saregama's own channels, verified by resolving each handle rather than
# assumed: @SaregamaClassics no longer exists, and @FilmiGaane — which reads
# like a Saregama property — belongs to Shemaroo. Carvaan and Hindustani
# Classical were missing entirely, and Carvaan is this catalogue's own channel.
#
# Karaoke is deliberately absent. It is genuinely Saregama's, and publishes
# backing tracks rather than recordings, so being official makes it worse
# rather than better.
SOURCES = [
    ("saregama_music", "https://www.youtube.com/@saregamamusic/videos"),
    # By id: Saregama Carvaan has no @handle that resolves.
    ("saregama_carvaan",
     "https://www.youtube.com/channel/UCFIMVKiJIEXCciTXqcF727Q/videos"),
    ("saregama_classical", "https://www.youtube.com/@SaregamaHindustaniClassical/videos"),
    ("saregama_bhakti", "https://www.youtube.com/@saregamabhakti/videos"),
    ("saregama_ghazal", "https://www.youtube.com/@saregamaghazal/videos"),
    ("saregama_sufi", "https://www.youtube.com/@saregamasufi/videos"),
    ("saregama_mix", "https://www.youtube.com/@SaregamaMixStation/videos"),
    ("saregama_marathi", "https://www.youtube.com/@SaregamaMarathi/videos"),
    ("saregama_bengali", "https://www.youtube.com/@SaregamaBengali/videos"),
    ("saregama_punjabi", "https://www.youtube.com/@SaregamaPunjabi/videos"),
    ("saregama_gujarati", "https://www.youtube.com/@SaregamaGujarati/videos"),
    ("saregama_tamil", "https://www.youtube.com/@SaregamaTamil/videos"),
    ("saregama_malayalam", "https://www.youtube.com/@SaregamaMalayalam/videos"),
]


def harvest(conn, name, url, limit=None):
    token, completed, _ = store.get_cursor(conn, name)
    offset = int(token or 0)
    if completed:
        print(f"  {name}: already complete, skipping")
        return 0

    cmd = [
        "yt-dlp", "--flat-playlist", "--skip-download", "--ignore-errors",
        # Duration costs nothing here and is what lets the matcher tell a
        # recording from a jukebox. Harvesting without it is why entire films
        # ended up in the catalogue.
        "--no-warnings", "--print", "%(id)s|%(duration)s|%(title)s",
        "--playlist-start", str(offset + 1),
    ]
    if limit:
        cmd += ["--playlist-end", str(offset + limit)]
    cmd.append(url)

    print(f"  {name}: resuming at item {offset + 1}")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            text=True, bufsize=1)

    batch, added = [], 0
    try:
        for line in proc.stdout:
            line = line.strip()
            if "|" not in line:
                continue
            parts = line.split("|", 2)
            if len(parts) != 3:
                continue
            video_id, raw_duration, title = parts
            if len(video_id) != 11 or not title:
                continue
            try:
                duration = int(float(raw_duration))
            except (TypeError, ValueError):
                duration = None
            batch.append({"video_id": video_id, "title": title,
                          "channel_id": name, "duration": duration})

            if len(batch) >= BATCH:
                offset += len(batch)
                store.commit_page(conn, name, batch, str(offset), units=0)
                added += len(batch)
                batch = []
                print(f"    {added} harvested (offset {offset})", flush=True)
        exhausted = proc.wait() == 0 and not limit
    finally:
        if batch:
            offset += len(batch)
            store.commit_page(conn, name, batch, str(offset), units=0)
            added += len(batch)
        proc.terminate()

    # A clean exit with no page cap means the listing ran out: mark it done so
    # later runs skip it. Passing None is what flips `completed` in the store.
    if exhausted:
        store.commit_page(conn, name, [], None, units=0)

    if added == 0 and offset == 0:
        # An unreachable handle yields nothing and would otherwise look like a
        # harvested-but-empty channel. Say so loudly.
        print(f"  {name}: WARNING no videos returned -- is {url} a valid channel?")

    return added


def main(db_path, limit=None):
    conn = store.connect(db_path)
    total = 0
    for name, url in SOURCES:
        try:
            total += harvest(conn, name, url, limit)
        except Exception as exc:
            # A failing channel must not lose the ones already harvested.
            print(f"  {name}: FAILED ({type(exc).__name__}: {exc}) -- progress kept")
    print(f"\nharvested this run : {total}")
    print(f"videos in store    : {store.progress(conn)['videos']}")


if __name__ == "__main__":
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    main(sys.argv[1], limit)
