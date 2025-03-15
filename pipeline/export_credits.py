"""Export contributor credits, keyed by song id for the app to look up.

The file people edit is keyed by "title | film", matching corrections.json, so
a credit can be written straight from a report without knowing internal ids.
The app wants ids, so the mapping happens here — and resolving it at export time
means a credit naming a song that does not exist fails loudly now rather than
silently displaying nothing later.

Names only appear when someone gave one. Most will not, and an empty credit line
reads worse than no credit at all.

    python3 pipeline/export_credits.py data/carvaan.db data/song_credits.json \\
        web/public/song-credits.json
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store


def main(db_path, credits_path, out_path):
    conn = store.connect(db_path)
    raw = json.load(open(credits_path, encoding="utf-8"))

    credits = {}
    unknown = []
    for key, value in raw.items():
        if key.startswith("_"):
            continue
        name = (value.get("name") or "").strip()
        if not name:
            continue

        title, _, film = key.partition(" | ")
        row = conn.execute(
            "SELECT id FROM songs WHERE title_key = ? AND film_key = ?",
            (store.normalise(title), store.normalise(film)),
        ).fetchone()
        if row is None:
            unknown.append(key)
            continue

        credits[str(row["id"])] = {
            "name": name,
            "kind": value.get("kind") or "found",
        }

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(credits, handle, ensure_ascii=False, separators=(",", ":"))

    for key in unknown:
        print(f"  NO SUCH SONG  {key}")
    print(f"exported {len(credits)} credits -> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
