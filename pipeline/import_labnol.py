"""Seed YouTube video IDs from the community-maintained labnol/saregama-carvaan tables.

Those markdown tables already pair each Carvaan song with a YouTube video id, so
importing them resolves a large slice of the catalogue at zero API cost. They
date from ~2017-18, so ids are treated as *candidates*: matched here, liveness
checked separately before anything reaches the player.

    python3 pipeline/import_labnol.py <labnol_dir> data/carvaan.db
"""

import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store

# Cover-art cell, then "[ Title](url)|Film|Artiste". The video id appears in the
# youtu.be link; grab it from the title cell rather than the thumbnail.
ROW_RE = re.compile(
    r"^\[!\[.*?\]\(.*?\)\]\(.*?\)\s*\|\s*"
    r"\[\s*(?P<title>[^\]]+?)\s*\]\(https?://youtu\.be/(?P<vid>[\w-]{11})[^)]*\)\s*\|\s*"
    r"(?P<film>[^|]*?)\s*\|\s*(?P<artist>.*?)\s*$"
)


def parse_file(path):
    rows = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            match = ROW_RE.match(line.strip())
            if match:
                rows.append(
                    {
                        "video_id": match.group("vid"),
                        "title": match.group("title").strip(),
                        "film": match.group("film").strip(),
                        "artist": match.group("artist").strip(),
                    }
                )
    return rows


def main(labnol_dir, db_path):
    rows, per_file = [], {}
    for path in sorted(glob.glob(os.path.join(labnol_dir, "*.md"))):
        parsed = parse_file(path)
        per_file[os.path.basename(path)] = len(parsed)
        rows.extend(parsed)

    for name, count in per_file.items():
        print(f"  {name:24s} {count:5d} rows")

    # One video id can appear under several artiste files; keep it once.
    unique = {}
    for row in rows:
        unique.setdefault((row["video_id"], store.normalise(row["title"])), row)
    print(f"\nparsed rows      : {len(rows)}")
    print(f"unique title+vid : {len(unique)}")
    print(f"distinct video ids: {len({r['video_id'] for r in rows})}")

    conn = store.connect(db_path)

    # Index the catalogue by title key, and by title+film key for tighter hits.
    by_title, by_pair = {}, {}
    for song in conn.execute("SELECT id, title_key, film_key FROM songs"):
        by_title.setdefault(song["title_key"], []).append(song["id"])
        by_pair.setdefault((song["title_key"], song["film_key"]), song["id"])

    exact = title_only = 0
    conn.execute("BEGIN")
    for row in unique.values():
        tkey, fkey = store.normalise(row["title"]), store.normalise(row["film"])

        song_id = by_pair.get((tkey, fkey))
        if song_id is not None:
            method, confidence = "labnol_title_film", 0.90
            exact += 1
        else:
            candidates = by_title.get(tkey, [])
            # Only trust a title-only match when it is unambiguous.
            if len(candidates) != 1:
                continue
            song_id, method, confidence = candidates[0], "labnol_title", 0.70
            title_only += 1

        conn.execute(
            "INSERT INTO videos (video_id,title,channel_id,published_at,title_key) "
            "VALUES (?,?,?,?,?) ON CONFLICT(video_id) DO NOTHING",
            (row["video_id"], row["title"], None, None, tkey),
        )
        store.record_match(conn, song_id, row["video_id"], confidence, method)
    conn.execute("COMMIT")

    progress = store.progress(conn)
    total = progress["songs"]
    print(f"\ntitle+film matches: {exact}")
    print(f"title-only matches: {title_only}")
    print(f"resolved          : {progress['resolved']} / {total} "
          f"({100 * progress['resolved'] / total:.1f}%)")
    print(f"still pending     : {len(store.pending_songs(conn))}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
