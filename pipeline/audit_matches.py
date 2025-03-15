"""Check every playable song against every rule, and list what fails.

Run before committing a change to matching. Each fix in this pipeline has so
far been verified against the fault it targeted and shipped without checking
what it disturbed: the length fix broke title correctness, the title fix broke
short names, the preference for official uploads broke playability. All three
were found by a person noticing a song that used to work. This asks every
question at once instead.

One of the checks is only visible from the whole catalogue. A video used for
several *different* songs is a compilation, however innocent its title — "5 Top
Songs of Raghav Sachar" names four catalogue songs and is the right length for
none of them. No per-candidate rule can see that, because the evidence is the
other songs.

    python3 pipeline/audit_matches.py data/carvaan.db
    python3 pipeline/audit_matches.py data/carvaan.db --write-ids out.txt
"""

import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store
from titlematch import fold, names_song, opens_with_song
from reresolve_songs import MIN_SECONDS, MAX_SECONDS, WRONG_KIND
from verify_embeddable import check as check_embeddable

WORKERS = 14


def shared_videos(rows):
    """video_id -> songs, for videos serving more than one distinct song.

    Two catalogue rows for one song is ordinary — the songlist repeats titles
    across stations, and "Tumse Achcha" and "Tumse Achha" are one song spelled
    twice. Different songs on one video is the compilation.
    """
    by_video = {}
    for row in rows:
        by_video.setdefault(row["video_id"], []).append(row)

    out = {}
    for video_id, songs in by_video.items():
        if len(songs) < 2:
            continue
        distinct = []
        for song in songs:
            title = song["title"]
            # Same test used to match a song to a video, applied between two
            # song names. A substring check is not enough: "Anandamayi
            # Chaitanyamayi" and "Om Anandmayi Chaitanyamayi" are one song, and
            # neither folded key contains the other.
            if not any(names_song(title, seen) or names_song(seen, title)
                       for seen in distinct):
                distinct.append(title)
        if len(distinct) > 1:
            out[video_id] = songs
    return out


def audit(conn, verify_network=True):
    rows = conn.execute(
        "SELECT r.song_id, s.title, s.film, r.video_id, r.method, v.title vt, "
        "v.duration, v.channel_title, v.channel_id "
        "FROM resolutions r JOIN videos v ON v.video_id = r.video_id "
        "JOIN songs s ON s.id = r.song_id WHERE r.embeddable = 1"
    ).fetchall()

    failures = {}

    def fail(reason, row):
        failures.setdefault(reason, []).append(row)

    for row in rows:
        channel = f"{row['channel_title'] or ''} {row['channel_id'] or ''}".lower()
        if any(k in channel for k in WRONG_KIND):
            fail("wrong kind of channel", row)
        elif not MIN_SECONDS <= (row["duration"] or 0) <= MAX_SECONDS:
            fail("implausible length", row)
        elif not names_song(row["title"], row["vt"]):
            fail("does not name the song", row)
        elif row["film"] and fold(row["title"])[:10] == fold(row["film"])[:10] \
                and not opens_with_song(row["title"], row["vt"]):
            fail("title song, named only as the film", row)

    for video_id, songs in shared_videos(rows).items():
        for song in songs:
            fail("compilation: one video, several songs", song)

    if verify_network:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            results = pool.map(check_embeddable, [r["video_id"] for r in rows])
            for (_, ok, _), row in zip(results, rows):
                if ok == 0:
                    fail("will not embed", row)

    return rows, failures


def main(db_path, write_ids=None, verify_network=True):
    conn = store.connect(db_path)
    rows, failures = audit(conn, verify_network)

    bad = {row["song_id"] for group in failures.values() for row in group}
    print(f"{len(rows)} playable songs, {len(bad)} failing\n")
    for reason, group in sorted(failures.items(), key=lambda kv: -len(kv[1])):
        print(f"  {reason:<40} {len(group)}")
        for row in group[:3]:
            print(f"      {row['title'][:30]:<32} -> {row['vt'][:44]}")

    if write_ids:
        with open(write_ids, "w") as handle:
            handle.write("\n".join(str(i) for i in sorted(bad)))
        print(f"\nwrote {len(bad)} song ids to {write_ids}")
    return len(bad)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = None
    for i, a in enumerate(sys.argv):
        if a == "--write-ids" and i + 1 < len(sys.argv):
            out = sys.argv[i + 1]
    sys.exit(1 if main(args[0], out, "--offline" not in sys.argv) else 0)
