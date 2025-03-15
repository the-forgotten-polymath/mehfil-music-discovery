"""Song identity, and the ledger that keeps ids attached to it.

An id used to be a position: `parse_songlist` sorted the catalogue by title and
numbered from one. That makes an id a statement about where a song sits rather
than which song it is, so inserting a single new title renumbered everything
after it — measured against the real catalogue, one song at position 49 moved
3,867 of 3,916 ids by one.

Nothing downstream survives that. `resolutions` maps song_id to a video and a
re-parse does not rewrite it, while `songs` upserts ON CONFLICT(id) DO UPDATE
SET title, so every row would hold the previous song's video under the next
song's name. Silently: the app loads, every page renders, and the songs play the
wrong recordings.

So ids come from a committed ledger keyed by identity, and they are append-only.
A song that leaves the catalogue keeps its number rather than donating it — a
reissued id would resurrect stale references onto an unrelated song, including
ones written to other people's devices, which we cannot reach to correct.

This module exists so that every stage computes identity the same way. It was
three copies of one function before, and three copies that must agree are the
same hazard the ledger is here to remove.

One consequence to know about: identity is the title and film, so *changing a
title changes which song it is*. A re-parse that renames one gives it a fresh id
with no resolution attached, while the row under the old title keeps both its id
and its video. Since only resolved songs are published, the visible effect is
that the correction appears to do nothing rather than that anything breaks. If a
title ever does need correcting, the ledger entry has to be repointed by hand —
deliberately, because the alternative is guessing that two differently-named
songs are the same one.
"""

import json
import os
import re
import unicodedata

LEDGER_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "song_ids.json"
)


def normalise(text):
    """Fold to a comparison key: strip accents, punctuation, case, extra spaces."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^\w\s]", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def song_key(title, film):
    """The identity of a song: the pair already used to collapse duplicate rows."""
    return f"{normalise(title)}|{normalise(film)}"


def load_ledger(path=LEDGER_PATH):
    """Read the ledger, or explain what is wrong with it.

    Every stage now depends on this file, so a raw FileNotFoundError or a
    JSONDecodeError from four call sites is a poor way to learn that it was lost
    to a bad merge. It is committed; if it is gone, restoring it from git is the
    fix, and losing it is never something to work around by regenerating.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        raise SystemExit(
            f"missing id ledger at {path}\n"
            "It is committed — restore it with: git checkout data/song_ids.json\n"
            "Do not regenerate it: new ids would not match the ones already in "
            "the database, in the published catalogue, and on people's devices."
        )
    except json.JSONDecodeError as err:
        raise SystemExit(f"id ledger at {path} is not valid JSON: {err}")


def assign_ids(catalogue, path=LEDGER_PATH):
    """Give each song the id it has always had; new songs get the next free one.

    Returns the titles that were newly numbered, so a run says plainly what it
    added rather than leaving it to be inferred from a count.
    """
    ledger = load_ledger(path)
    next_id = max(ledger.values(), default=0) + 1

    added = []
    for song in catalogue:
        key = song_key(song["title"], song["film"])
        if key not in ledger:
            ledger[key] = next_id
            added.append(song["title"])
            next_id += 1
        song["id"] = ledger[key]

    # Two songs sharing an id would be merged by every table keyed on song_id.
    # Cheaper to fail here than to find it in the catalogue later.
    ids = [song["id"] for song in catalogue]
    if len(set(ids)) != len(ids):
        raise SystemExit("song ids are not unique — the ledger is inconsistent")

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(ledger, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    return added


def disagreements(songs, path=LEDGER_PATH):
    """Songs whose id is not the one the ledger holds for them.

    Empty means the ids in hand are the ids of record. Anything else means the
    file was produced by an older numbering, and loading or publishing it would
    move songs under ids that other data still points at.
    """
    ledger = load_ledger(path)
    return [
        (song["title"], song["id"], ledger.get(song_key(song["title"], song["film"])))
        for song in songs
        if ledger.get(song_key(song["title"], song["film"])) != song["id"]
    ]


def require_agreement(songs, source, path=LEDGER_PATH):
    """Abort unless every song carries its ledger id. Called at each door.

    The two doors are ingest, which writes ids into the database, and export,
    which writes them into the file the app ships. Drift that passes both is
    invisible until someone notices a song playing the wrong recording.
    """
    bad = disagreements(songs, path)
    if not bad:
        return
    print(f"{source}: {len(bad)} song(s) carry an id the ledger disagrees with")
    for title, had, expected in bad[:10]:
        print(f"  {title!r}: has {had}, ledger says {expected}")
    if len(bad) > 10:
        print(f"  ... and {len(bad) - 10} more")
    raise SystemExit(
        "refusing to continue: re-run parse_songlist.py to renumber against the ledger"
    )
