"""Re-resolve songs whose match is disqualified, preferring official sources.

The original resolver could only see a video's id and title, because that is
all yt-dlp prints under --flat-playlist. So it accepted a two-and-a-half hour
upload of an entire film as "Pyar Kiye Ja" — the title matched exactly, and
nothing in the pipeline was in a position to ask how long it was. Roughly one
match in ten is a jukebox, a compilation or a whole film.

The search here asks for duration and channel alongside the title, which costs
nothing extra, and uses both:

  Length disqualifies.  A recording of a single song is minutes long. Anything
  outside a plausible window is rejected outright, before scoring, no matter
  how exactly its title matches. This is the check whose absence caused the
  problem, so it is the one that runs first.

  Publisher ranks.  Saregama owns this catalogue, so its channels are searched
  first and preferred when scoring; the established music libraries come next;
  everything else is last and must earn its place on corroboration alone.

  The song is named, or it is not this song.  The video title has to contain a
  recognisable form of the song's own name — across Devanagari, across
  disagreeing romanisations, and allowing for titles that truncate it. An
  earlier version of this script required only that the film or a singer be
  corroborated, on the assumption that searching for a title guarantees the
  results are about it. They are not: "Ab Ke Sajan Sawan Mein" is from the film
  *Chupke Chupke*, so the unrelated song "Chupke Chupke Chal Re Purbaiya"
  corroborated on film and scored 0.98. That mistake accounted for 115 of the
  121 wrong matches in the entire catalogue.

Corroboration still applies on top: the title must ALSO confirm the film or a
credited singer, since covers and re-records carry the song's name too.

Usage:
    python3 pipeline/reresolve_songs.py data/carvaan.db --dry-run --limit 20
    python3 pipeline/reresolve_songs.py data/carvaan.db --bad-only
    python3 pipeline/reresolve_songs.py data/carvaan.db --workers 6
"""

import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store
from match_videos import REJECT_RE, RANGE_RE, segments
from titlematch import names_song, opens_with_song, fold
from verify_embeddable import check as check_embeddable

# A single recording. The lower bound cuts trailers and fragments, the upper
# bound is generous enough for a qawwali or a classical piece while still
# excluding every jukebox we found.
MIN_SECONDS = 60
MAX_SECONDS = 1200
# The range almost every film song actually falls in; a small nudge, not a gate.
TYPICAL = (120, 600)

# Uploads whose titles announce that they are not a single recording. Extends
# the shared list with the forms that slipped past it.
EXTRA_REJECT = re.compile(
    r"\b(full movie|full film|complete movie|movie online|audio jukebox|"
    r"video jukebox|all time hits|superhit collection|golden collection|"
    r"lyrical video jukebox|one hour|1 hour|hour long|marathon|"
    # "5 Top Songs of ..." — the shared list catches "top 5" and misses this.
    r"\d+\s*top songs|top songs|geetmala|vol\.?\s*\d+|volume\s*\d+|"
    # Reworkings that keep the song's name and replace its recording. The
    # shared list has "remix", which does not catch "Trap Mix" — and Saregama
    # publishes a great many of these under the original title.
    r"\bmix\b|trap|house mix|chill|lofi|lo-fi|slowed|reverb|refix|flip|"
    r"synthwave|electro|bass boost|revisited|recreation)\b",
    re.I,
)

# Channels that publish something other than the recording, whoever owns them.
# Checked before the tier bonus: "Saregama Karaoke" is an official channel and
# still the wrong one, and being official was actively promoting it.
WRONG_KIND = ("karaoke", "instrumental", "cover", "lyrics only",
              "sing along", "backing track", "ringtone",
              # Jhankar Beats are the originals re-mastered with added
              # percussion. Saregama publishes them, so the tier bonus was
              # recommending them over the recording they are derived from.
              "jhankar",
              # Catches "remix" and "Saregama Mix Station", a channel whose
              # entire output is reworkings published under the original song's
              # name. Being Saregama's own was promoting it, not disqualifying
              # it, and "Aap Ke Kamre Mein" ended up as a trap mix.
              "mix")

# Saregama owns this catalogue, so its channels rank first. "Filmigaane" was
# here on the assumption that it was one of them; resolving the handle shows it
# is Shemaroo's, so it belongs a tier down with the other libraries. It was
# being given both the confidence bonus and the right to end the search early.
OFFICIAL = ("saregama",)
# Libraries that legitimately hold large parts of this era.
ESTABLISHED = (
    "shemaroo", "ultra", "tips", "venus", "t-series", "tseries", "goldmines",
    "rajshri", "eros", "yash raj", "yrf", "sony music", "zee music",
    "universal music", "hungama", "speed records", "gaane sune ansune",
    "hmv", "polydor", "wave music", "bhakti sagar",
)

WORKERS = 5
SEARCH_TIMEOUT = 90
RESULTS = 8
# How far down the ranking to keep trying when uploads refuse to embed.
MAX_EMBED_CHECKS = 6


def tier(channel):
    """0 official, 1 established, 2 everyone else."""
    name = (channel or "").lower()
    if any(k in name for k in OFFICIAL):
        return 0
    if any(k in name for k in ESTABLISHED):
        return 1
    return 2


def search(query, limit=RESULTS):
    """[(id, duration, channel, title)] — duration and channel cost nothing."""
    cmd = [
        "yt-dlp", f"ytsearch{limit}:{query}",
        "--flat-playlist", "--skip-download", "--no-warnings", "--ignore-errors",
        "--print", "%(id)s|%(duration)s|%(channel)s|%(title)s",
    ]
    try:
        out = subprocess.run(
            cmd, capture_output=True, text=True, timeout=SEARCH_TIMEOUT
        ).stdout
    except subprocess.TimeoutExpired:
        return []
    rows = []
    for line in out.splitlines():
        parts = line.strip().split("|", 3)
        if len(parts) != 4 or len(parts[0]) != 11:
            continue
        video_id, raw, channel, title = parts
        try:
            duration = int(float(raw))
        except (TypeError, ValueError):
            continue  # unknown length is not a length we can vouch for
        rows.append((video_id, duration, channel, title))
    return rows


def plausible(duration, title, channel):
    """Reject on length, on self-declared compilations, and on channel kind."""
    if not MIN_SECONDS <= duration <= MAX_SECONDS:
        return False
    if any(k in (channel or "").lower() for k in WRONG_KIND):
        return False
    return not (REJECT_RE.search(title) or RANGE_RE.search(title)
                or EXTRA_REJECT.search(title))


def score(song, candidate):
    """Confidence for one candidate, or None when it is not this song."""
    _, duration, channel, title = candidate
    fields = set(segments(title))
    blob = store.normalise(title)

    # The video must name the song. Corroboration is a second opinion, never a
    # substitute: "Ab Ke Sajan Sawan Mein" is from the film Chupke Chupke, and
    # without this the unrelated song "Chupke Chupke Chal Re Purbaiya" matches
    # on film and scores 0.98. Checked first because it is the expensive one to
    # get wrong.
    if not names_song(song["title"], title):
        return None

    # A title song shares its name with its film, so finding that name proves
    # nothing about which track this is: every upload from the film carries it.
    # "Pyar Kiye Ja" matched "O Meri Maina | ... | Pyar Kiye Jaa" — a different
    # song from the same picture. Where the two names coincide, the song must
    # be named in the leading segment, which is where the song name goes.
    if fold(song["title"])[:10] == fold(song["film"] or "")[:10]:
        if not opens_with_song(song["title"], title):
            return None

    film_key = store.normalise(song["film"] or "")
    film_ok = bool(film_key) and (film_key in fields or film_key in blob)
    singer_ok = any(
        store.normalise(s) and store.normalise(s) in blob for s in song["singers"]
    )

    # A title alone proves nothing either: covers and re-records carry it too.
    if not (film_ok or singer_ok):
        return None

    confidence = 0.90 if (film_ok and singer_ok) else (0.86 if film_ok else 0.80)
    confidence += (0.06, 0.03, 0.0)[tier(channel)]
    if TYPICAL[0] <= duration <= TYPICAL[1]:
        confidence += 0.02
    return min(confidence, 0.98)


def queries(song):
    """Most specific first, and official channels before the open web."""
    title, film = song["title"], song["film"] or ""
    singer = song["singers"][0] if song["singers"] else ""
    out = []
    if film and singer:
        out.append(f"{title} {film} {singer} saregama")
    if film:
        out.append(f"{title} {film} song")
    if singer:
        out.append(f"{title} {singer}")
    out.append(f"{title} {film}".strip())
    return list(dict.fromkeys(q for q in out if q.strip()))


def best_for(song, taken=()):
    """Search progressively; stop as soon as an official-channel match lands.

    `taken` holds videos already serving a different song. One upload cannot be
    two recordings, so a second claim on it means either a compilation or a
    title that happens to name both — either way this song needs its own.
    """
    seen, pool = set(taken), []
    for query in queries(song):
        for candidate in search(query):
            if candidate[0] in seen:
                continue
            seen.add(candidate[0])
            if not plausible(candidate[1], candidate[3], candidate[2]):
                continue
            confidence = score(song, candidate)
            if confidence is None:
                continue
            pool.append((confidence, tier(candidate[2]), candidate))
        # An official upload that corroborates is as good as this gets.
        if any(t == 0 for _, t, _ in pool):
            break
    if not pool:
        return None
    pool.sort(key=lambda item: (-item[0], item[1]))

    # Being the best candidate is not enough — the player has to be allowed to
    # show it. Many uploads disable embedding, Saregama's own among them, and
    # accepting one produces a song that looks resolved and plays nothing. Walk
    # down the ranking until one is actually embeddable.
    for candidate in pool[:MAX_EMBED_CHECKS]:
        if playable(candidate[2][0]):
            return candidate
    return None


def playable(video_id):
    """True only if YouTube will embed this id. None (unreachable) is not True."""
    return check_embeddable(video_id)[1] == 1


def load_targets(conn, mode, limit, ids_file=None):
    """Songs whose current match is disqualified, worst first."""
    if ids_file:
        with open(ids_file) as handle:
            ids = [int(line) for line in handle if line.strip()]
        return ids[:limit] if limit else ids

    bad_duration = (
        "SELECT r.song_id FROM resolutions r JOIN videos v ON v.video_id = r.video_id "
        f"WHERE r.embeddable = 1 AND (v.duration > {MAX_SECONDS} OR v.duration < {MIN_SECONDS})"
    )
    dead = "SELECT song_id FROM resolutions WHERE embeddable = 0"
    weak = "SELECT song_id FROM resolutions WHERE embeddable = 1 AND confidence <= 0.82"

    # Songs that have never had a match at all, as opposed to a faulty one.
    never = "SELECT id AS song_id FROM songs WHERE id NOT IN (SELECT song_id FROM resolutions)"

    if mode == "pending":
        parts = [never]
    elif mode == "bad-only":
        parts = [bad_duration, dead]
    else:
        parts = [bad_duration, dead, weak]
    ids = []
    for sql in parts:
        ids += [row["song_id"] for row in conn.execute(sql)]
    ids = list(dict.fromkeys(ids))
    return ids[:limit] if limit else ids


def song_row(conn, song_id):
    song = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    singers = [
        row["name"] for row in conn.execute(
            "SELECT a.name FROM song_artists sa JOIN artists a ON a.id = sa.artist_id "
            "WHERE sa.song_id = ?", (song_id,)
        )
    ]
    return {"id": song["id"], "title": song["title"], "film": song["film"],
            "singers": singers}


def main(db_path, mode="all", limit=None, workers=WORKERS, dry_run=False,
         ids_file=None):
    conn = store.connect(db_path)
    targets = load_targets(conn, mode, limit, ids_file)
    print(f"{len(targets)} songs to re-resolve{' (dry run)' if dry_run else ''}\n")

    fixed = failed = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        songs = {song_id: song_row(conn, song_id) for song_id in targets}
        # Videos already serving a song that is NOT being re-resolved here.
        target_set = set(targets)
        taken = {row["video_id"] for row in conn.execute(
            "SELECT song_id, video_id FROM resolutions WHERE embeddable = 1")
            if row["song_id"] not in target_set}
        futures = {pool.submit(best_for, songs[i], taken): i for i in targets}
        for done, future in enumerate(as_completed(futures), start=1):
            song_id = futures[future]
            song = songs[song_id]
            try:
                result = future.result()
            except Exception as exc:
                print(f"  ! {song['title'][:34]}: {exc}")
                result = None

            if not result:
                failed += 1
            else:
                confidence, _, (video_id, duration, channel, title) = result
                print(f"  {song['title'][:30]:<32} {duration//60}:{duration%60:02d} "
                      f"[{channel[:22]}] conf={confidence:.2f}")
                if not dry_run:
                    conn.execute(
                        "INSERT INTO videos (video_id,title,channel_id,title_key,"
                        "embeddable,duration,channel_title) VALUES (?,?,?,?,1,?,?) "
                        "ON CONFLICT(video_id) DO UPDATE SET title=excluded.title, "
                        "embeddable=1, duration=excluded.duration, "
                        "channel_title=excluded.channel_title",
                        (video_id, title, "reresolve", store.normalise(title),
                         duration, channel),
                    )
                    store.replace_match(conn, song_id, video_id, confidence,
                                        "tiered_search")
                    conn.execute(
                        "UPDATE resolutions SET embeddable = 1 WHERE song_id = ?",
                        (song_id,),
                    )
                fixed += 1

            if not dry_run and done % 20 == 0:
                conn.commit()
            if done % 25 == 0:
                print(f"  --- {done}/{len(targets)}  fixed={fixed} unresolved={failed}",
                      flush=True)

    if not dry_run:
        conn.commit()
    print(f"\n{fixed} re-resolved, {failed} left without an acceptable match")


if __name__ == "__main__":
    skip = {"--limit", "--workers", "--ids"}
    args, drop = [], False
    for a in sys.argv[1:]:
        if drop:
            drop = False
            continue
        if a in skip:
            drop = True
        elif not a.startswith("--"):
            args.append(a)
    limit = workers = ids_file = None
    for i, a in enumerate(sys.argv):
        if a == "--limit" and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])
        if a == "--workers" and i + 1 < len(sys.argv):
            workers = int(sys.argv[i + 1])
        if a == "--ids" and i + 1 < len(sys.argv):
            ids_file = sys.argv[i + 1]
    main(args[0],
         mode=("pending" if "--pending" in sys.argv else
               "bad-only" if "--bad-only" in sys.argv else "all"),
         limit=limit, workers=workers or WORKERS,
         dry_run="--dry-run" in sys.argv, ids_file=ids_file)
