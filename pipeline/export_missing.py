"""Export the songs with no playable match, for the contribute page.

These are the catalogue entries the resolver could not place: nothing it found
named the song, ran a plausible length and would embed. Some have no upload at
all; many are obscure enough that no search phrasing reaches them. A person who
knows the song finds it in seconds.

Deliberately small — title, film and credits are all that is needed to
recognise a song, and the file is fetched by a public page.

    python3 pipeline/export_missing.py data/carvaan.db web/public/missing-songs.json
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store


def main(db_path, out_path):
    conn = store.connect(db_path)

    rows = conn.execute(
        "SELECT s.id, s.title, s.film FROM songs s "
        "WHERE s.id NOT IN (SELECT song_id FROM resolutions WHERE embeddable = 1) "
        "ORDER BY s.title"
    ).fetchall()

    artists = {}
    for row in conn.execute(
        "SELECT sa.song_id, a.name FROM song_artists sa "
        "JOIN artists a ON a.id = sa.artist_id"
    ):
        artists.setdefault(row["song_id"], []).append(row["name"])

    stations = {}
    for row in conn.execute(
        "SELECT ss.song_id, st.name FROM song_stations ss "
        "JOIN stations st ON st.id = ss.station_id"
    ):
        stations.setdefault(row["song_id"], []).append(row["name"])

    songs = [
        {
            "id": row["id"],
            "t": row["title"],
            "f": row["film"] or "",
            "a": artists.get(row["id"], []),
            "s": stations.get(row["id"], []),
        }
        for row in rows
    ]

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump({"songs": songs}, handle, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(out_path) / 1024
    print(f"exported {len(songs)} unmatched songs -> {out_path} ({size:.0f} KB)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
