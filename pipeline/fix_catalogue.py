"""Repair artefacts the songlist parse left in the catalogue.

Three faults, all originating in the PDF rather than in anything downstream, so
they are fixed here at the source instead of being worked around by every
consumer.

  Split people.  "Lata mangeshkar" is a second artist beside "Lata Mangeshkar",
  differing only in case, and "Moha mmed Rafi" is "Mohammed Rafi" with a space
  dropped into the middle of the word. Each carries one song away from a
  performer who has hundreds, so the catalogue shows a duplicate card with a
  single track on it.

  A collapsed row.  Song 3708 is what happens when the parser loses its place:
  one row absorbed nine consecutive songlist entries, giving it eleven film
  names in its film field and six "artists" whose names are really fragments of
  the list ("Kishore Kumar 1006. Tere Naina Kyon Bhar Aaye ..."). Every song it
  swallowed exists correctly elsewhere, and the row itself duplicates song
  3707, so nothing is lost by removing it.

Both kinds are identified structurally where possible — a name holding a
numbered list marker is unambiguously an artefact — and named explicitly where
a typo cannot be detected by rule. The script is idempotent: a second run finds
nothing to do.

Usage:
    python3 pipeline/fix_catalogue.py data/carvaan.db --dry-run
    python3 pipeline/fix_catalogue.py data/carvaan.db
"""

import re
import sys

import store

# Typos no normalisation rule can catch, so they are named. A rule loose enough
# to fold "Moha mmed" into "Mohammed" would also fold apart names that differ
# for real reasons.
ARTIST_MERGES = {
    "Lata mangeshkar": "Lata Mangeshkar",
    "Moha mmed Rafi": "Mohammed Rafi",
    "Various Artists(Dialogue)": "Various Artists (Dialogue)",
}

# "1006. " and the like: a songlist entry number that ended up inside a name.
ARTEFACT = re.compile(r"\b\d{3,4}\.\s")

# Every table holding a song_id, so removing a song leaves nothing behind.
SONG_TABLES = (
    "song_artists",
    "song_stations",
    "song_roles",
    "resolutions",
    "resolve_failures",
)


def merge_artists(conn, dry_run):
    """Fold duplicate spellings into the canonical artist."""
    done = 0
    for wrong, right in ARTIST_MERGES.items():
        bad = conn.execute("SELECT id FROM artists WHERE name = ?", (wrong,)).fetchone()
        if not bad:
            continue
        good = conn.execute("SELECT id FROM artists WHERE name = ?", (right,)).fetchone()

        moved = conn.execute(
            "SELECT COUNT(*) c FROM song_artists WHERE artist_id = ?", (bad["id"],)
        ).fetchone()["c"]
        print(f"  merge {wrong!r} -> {right!r} ({moved} song link(s))")
        if dry_run:
            done += 1
            continue

        if good:
            # OR IGNORE covers a song already credited to both spellings; the
            # leftover row is then dropped rather than left dangling.
            conn.execute(
                "UPDATE OR IGNORE song_artists SET artist_id = ? WHERE artist_id = ?",
                (good["id"], bad["id"]),
            )
            conn.execute("DELETE FROM song_artists WHERE artist_id = ?", (bad["id"],))
            conn.execute("DELETE FROM artists WHERE id = ?", (bad["id"],))
        else:
            # Nothing to merge into: correcting the spelling is the whole fix.
            conn.execute("UPDATE artists SET name = ? WHERE id = ?", (right, bad["id"]))
        done += 1
    return done


def drop_collapsed_rows(conn, dry_run):
    """Remove rows built from a lost parser position, and their fake artists."""
    artefacts = [
        row for row in conn.execute("SELECT id, name FROM artists")
        if ARTEFACT.search(row["name"])
    ]
    if not artefacts:
        return 0

    ids = {row["id"] for row in artefacts}
    placeholders = ",".join("?" * len(ids))
    songs = [
        row["song_id"] for row in conn.execute(
            f"SELECT DISTINCT song_id FROM song_artists WHERE artist_id IN ({placeholders})",
            tuple(ids),
        )
    ]

    removed = 0
    for song_id in songs:
        song = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
        resolved = conn.execute(
            "SELECT COUNT(*) c FROM resolutions WHERE song_id = ?", (song_id,)
        ).fetchone()["c"]
        twin = conn.execute(
            "SELECT id FROM songs WHERE title_key = ? AND id != ?",
            (song["title_key"], song_id),
        ).fetchone()

        # Only remove a row that is both unplayable and already represented by a
        # clean one. Anything else is a real song and would be a real loss.
        if resolved or not twin:
            print(f"  keep song {song_id} {song['title']!r}: "
                  f"{'has a resolution' if resolved else 'no clean duplicate'}")
            continue

        print(f"  drop song {song_id} {song['title']!r} "
              f"(film field held {song['film'].count(' ') + 1} words; "
              f"clean row is {twin['id']})")
        if not dry_run:
            for table in SONG_TABLES:
                conn.execute(f"DELETE FROM {table} WHERE song_id = ?", (song_id,))
            conn.execute("DELETE FROM songs WHERE id = ?", (song_id,))
        removed += 1

    for row in artefacts:
        still_used = conn.execute(
            "SELECT COUNT(*) c FROM song_artists WHERE artist_id = ?", (row["id"],)
        ).fetchone()["c"]
        # After the collapsed rows go, these names belong to nothing.
        if still_used and not dry_run:
            print(f"  keep artist {row['id']}: still credited on {still_used} song(s)")
            continue
        print(f"  drop artist {row['id']} {row['name'][:52]!r}...")
        if not dry_run:
            conn.execute("DELETE FROM artists WHERE id = ?", (row["id"],))
        removed += 1
    return removed


def main(db_path, dry_run=False):
    conn = store.connect(db_path)
    print(f"repairing {db_path}{' (dry run)' if dry_run else ''}\n")

    print("duplicate spellings:")
    merged = merge_artists(conn, dry_run)
    if not merged:
        print("  nothing to merge")

    print("\ncollapsed rows:")
    dropped = drop_collapsed_rows(conn, dry_run)
    if not dropped:
        print("  nothing to drop")

    if not dry_run:
        conn.commit()
    print(f"\n{merged} merge(s), {dropped} removal(s)"
          f"{' — nothing written' if dry_run else ' committed'}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0], dry_run="--dry-run" in sys.argv)
