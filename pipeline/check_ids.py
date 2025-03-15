"""Verify that everything keyed by song id still agrees about what those ids mean.

A song id is not a fact about a song — it is a reference held in four places
that are written at different times by different scripts:

    data/song_ids.json     the ledger, which assigns them
    data/songs.json        the parse output
    data/carvaan.db        songs, and resolutions keyed by song_id
    web/public/...json     the published catalogue the app reads

Nothing enforces that they still match. When they drift, they drift silently:
the app loads, every page renders, and songs simply play the wrong recording.
That is the failure this exists to catch, because there is no other symptom.

The drift is not hypothetical. Ids were once assigned by position — sorting the
catalogue by title and numbering from one — so a single new song renumbered
everything after it while `resolutions` kept pointing at the old numbers. The
ledger fixed the cause; this checks the result.

Usage:
    python3 pipeline/check_ids.py
"""

import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from songids import load_ledger, song_key  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARSED = os.path.join(ROOT, "data", "songs.json")
DB = os.path.join(ROOT, "data", "carvaan.db")
CATALOGUE = os.path.join(ROOT, "web", "public", "catalogue.json")


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    failures = []

    def check(name, ok, detail=""):
        print(f"  {'ok  ' if ok else 'FAIL'}  {name}{'' if ok else f'  {detail}'}")
        if not ok:
            failures.append(name)

    ledger = load_ledger()
    parsed = load(PARSED)

    print("ledger")
    ids = list(ledger.values())
    check("ids are unique", len(set(ids)) == len(ids),
          f"{len(ids) - len(set(ids))} duplicated")

    # Every parsed song must resolve through the ledger to the id it carries.
    wrong = [s["title"] for s in parsed
             if ledger.get(song_key(s["title"], s["film"])) != s["id"]]
    check("every parsed song matches its ledger entry", not wrong,
          f"{len(wrong)} disagree, e.g. {wrong[:3]}")

    # Ids may be retired but never reassigned, so the ledger only ever grows.
    check("ledger covers the parse", len(ledger) >= len(parsed),
          f"ledger {len(ledger)} < parse {len(parsed)}")

    print("\ndatabase")
    conn = sqlite3.connect(DB)
    db_songs = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT id,title,film FROM songs")}
    par_songs = {s["id"]: (s["title"], s["film"]) for s in parsed}

    mismatch = [i for i in db_songs if i in par_songs and db_songs[i] != par_songs[i]]
    check("song rows match the parse", not mismatch,
          f"{len(mismatch)} rows differ, e.g. {[(i, par_songs[i][0], db_songs[i][0]) for i in mismatch[:2]]}")

    orphans = [s for (s,) in conn.execute("SELECT song_id FROM resolutions") if s not in db_songs]
    check("every resolution points at a song that exists", not orphans,
          f"{len(orphans)} orphaned")

    print("\npublished catalogue")
    catalogue = load(CATALOGUE)
    films = catalogue["facets"]["films"]
    published = {
        s["id"]: (s["t"], films[s["f"]] if s.get("f") is not None else None)
        for s in catalogue["songs"]
    }
    drifted = [i for i in published if i in par_songs and published[i][0] != par_songs[i][0]]
    check("titles match the parse", not drifted,
          f"{len(drifted)} differ, e.g. {[(i, par_songs[i][0], published[i][0]) for i in drifted[:2]]}")

    unknown = [i for i in published if i not in par_songs]
    check("no published song is missing from the parse", not unknown,
          f"{len(unknown)} unknown ids")

    print()
    if failures:
        print(f"{len(failures)} check(s) failed — ids have drifted, do not ship")
        return 1
    print(f"all checks passed — {len(parsed)} songs, {len(ledger)} ledger entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
