"""Export the resolved catalogue to a static JSON the web app reads.

Only songs with a verified-embeddable video id are exported -- the player has
no fallback for a dead id, so an unplayable row is worse than an absent one.

Facet values are emitted as sorted lists and songs reference them by index,
which keeps the payload small enough to ship as a static asset.

    python3 pipeline/export_catalogue.py data/carvaan.db web/public/catalogue.json
"""

import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import songids  # noqa: E402
import store

ROLE_KINDS = ("composer", "lyricist", "actor", "singer", "director")
# Station kinds that name a person, and so can carry a portrait.
PERSON_KINDS = frozenset(ROLE_KINDS)


def main(db_path, out_path, stations_path="data/stations.json"):
    conn = store.connect(db_path)

    # The second door an id passes through. Everything exported below is written
    # for other people to load, and a wrong id here reaches devices we cannot
    # correct afterwards.
    #
    # Checked first, before any of the work: the export cannot write a bad
    # catalogue either way, but failing at the start says so in a second rather
    # than after building the whole payload. The rows being exported are what is
    # checked, not a file alongside them — anything else would verify one thing
    # and publish another.
    songids.require_agreement(
        [
            {"id": r[0], "title": r[1], "film": r[2]}
            for r in conn.execute("SELECT id,title,film FROM songs")
        ],
        "data/carvaan.db",
    )

    rows = conn.execute(
        "SELECT s.id, s.title, s.film, r.video_id, r.confidence "
        "FROM songs s JOIN resolutions r ON r.song_id = s.id "
        "WHERE r.embeddable = 1 ORDER BY s.title"
    ).fetchall()

    song_ids = {row["id"] for row in rows}

    artists = defaultdict(list)
    for row in conn.execute(
        "SELECT sa.song_id, a.name FROM song_artists sa JOIN artists a ON a.id = sa.artist_id"
    ):
        if row["song_id"] in song_ids:
            artists[row["song_id"]].append(row["name"])

    stations, moods = defaultdict(list), defaultdict(list)
    for row in conn.execute(
        "SELECT ss.song_id, st.name, st.kind FROM song_stations ss "
        "JOIN stations st ON st.id = ss.station_id"
    ):
        if row["song_id"] not in song_ids:
            continue
        stations[row["song_id"]].append(row["name"])
        if row["kind"] in ("mood", "genre", "format"):
            moods[row["song_id"]].append(row["name"].title())

    roles = defaultdict(lambda: defaultdict(list))
    for row in conn.execute("SELECT song_id, role, person FROM song_roles"):
        if row["song_id"] in song_ids and row["role"] in ROLE_KINDS:
            roles[row["song_id"]][row["role"]].append(row["person"])

    # Build the facet vocabularies, then index songs into them.
    vocab = {k: set() for k in ("artists", "films", "stations", "moods", *ROLE_KINDS)}
    for row in rows:
        sid = row["id"]
        vocab["artists"].update(artists[sid])
        vocab["stations"].update(stations[sid])
        vocab["moods"].update(moods[sid])
        if row["film"]:
            vocab["films"].add(row["film"])
        for kind in ROLE_KINDS:
            vocab[kind].update(roles[sid][kind])

    lists = {k: sorted(v) for k, v in vocab.items()}
    index = {k: {name: i for i, name in enumerate(v)} for k, v in lists.items()}

    songs = []
    for row in rows:
        sid = row["id"]
        songs.append({
            "id": sid,
            "t": row["title"],
            "f": index["films"].get(row["film"]) if row["film"] else None,
            "v": row["video_id"],
            "c": round(row["confidence"], 2),
            "a": sorted(index["artists"][n] for n in set(artists[sid])),
            "s": sorted(index["stations"][n] for n in set(stations[sid])),
            "m": sorted(index["moods"][n] for n in set(moods[sid])),
            **{
                kind[0] + kind[-1]: sorted(index[kind][n] for n in set(roles[sid][kind]))
                for kind in ROLE_KINDS
            },
        })

    # Station posters need to know what a station *is*. A station named after a
    # person can borrow that person's portrait; a mood or format has no face,
    # so the UI renders a designed tile instead of an arbitrary song still.
    taxonomy = json.load(open(stations_path, encoding="utf-8"))
    station_meta = {}
    for kind, entries in taxonomy.items():
        if kind.startswith("_"):
            continue
        for station, people in entries.items():
            if station not in index["stations"]:
                continue
            station_meta[station] = {
                "kind": kind,
                # First name only: it is the poster subject, not the credit.
                "person": people[0] if kind in PERSON_KINDS and people else None,
            }

    payload = {"facets": lists, "songs": songs, "stationMeta": station_meta}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(out_path) / 1024
    print(f"exported {len(songs)} playable songs -> {out_path} ({size:.0f} KB)")
    for key, values in lists.items():
        print(f"  {key:10s} {len(values)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
