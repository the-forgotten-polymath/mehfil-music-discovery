"""Durable store for the catalogue and the YouTube resolution state.

Everything the resolver learns is committed to SQLite as it is learned, never
held in memory until the end. A crash, a quota exhaustion, or an API 500 costs
at most the single in-flight batch; every URL resolved before it survives.

Design rules that keep that true:
  * WAL journal mode, so a kill -9 cannot corrupt a half-written page.
  * Writes are UPSERTs. No stage ever DROPs or DELETEs resolved rows, so a
    re-run can only add information, never destroy it.
  * The channel harvest checkpoints its pagination cursor in the same
    transaction as the videos from that page, so the cursor can never point
    past data that failed to land.
  * Failures are recorded per song with an attempt counter, so permanent
    misses stop being retried while transient ones resume naturally.
"""

import json
import re
import os
import sqlite3
import sys
import unicodedata
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import songids  # noqa: E402

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS songs (
    id        INTEGER PRIMARY KEY,
    title     TEXT NOT NULL,
    film      TEXT,
    title_key TEXT NOT NULL,
    film_key  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS songs_keys ON songs(title_key, film_key);

CREATE TABLE IF NOT EXISTS artists (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS song_artists (
    song_id   INTEGER NOT NULL REFERENCES songs(id),
    artist_id INTEGER NOT NULL REFERENCES artists(id),
    PRIMARY KEY (song_id, artist_id)
);

CREATE TABLE IF NOT EXISTS stations (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS song_stations (
    song_id    INTEGER NOT NULL REFERENCES songs(id),
    station_id INTEGER NOT NULL REFERENCES stations(id),
    PRIMARY KEY (song_id, station_id)
);

-- Roles back-filled from station membership (composer, lyricist, actor, ...).
CREATE TABLE IF NOT EXISTS song_roles (
    song_id INTEGER NOT NULL REFERENCES songs(id),
    role    TEXT NOT NULL,
    person  TEXT NOT NULL,
    PRIMARY KEY (song_id, role, person)
);
CREATE INDEX IF NOT EXISTS song_roles_lookup ON song_roles(role, person);

-- Videos harvested wholesale from official channels (1 quota unit per 50).
-- `embeddable` is remembered on the video, not just the match: once a video is
-- known unplayable, every later matcher must skip it. Without this a dead id
-- gets rediscovered, re-matched and re-demoted on every run.
CREATE TABLE IF NOT EXISTS videos (
    video_id     TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    channel_id   TEXT,
    published_at TEXT,
    title_key    TEXT NOT NULL,
    embeddable   INTEGER
);
CREATE INDEX IF NOT EXISTS videos_title_key ON videos(title_key);

-- Pagination checkpoint, committed atomically with the page it describes.
CREATE TABLE IF NOT EXISTS harvest_cursor (
    source          TEXT PRIMARY KEY,
    next_page_token TEXT,
    completed       INTEGER NOT NULL DEFAULT 0,
    pages_done      INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT
);

-- One row per resolved song. Written the moment a match is made.
CREATE TABLE IF NOT EXISTS resolutions (
    song_id    INTEGER PRIMARY KEY REFERENCES songs(id),
    video_id   TEXT NOT NULL,
    confidence REAL NOT NULL,
    method     TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Failures, so permanent misses stop retrying and transient ones resume.
CREATE TABLE IF NOT EXISTS resolve_failures (
    song_id    INTEGER PRIMARY KEY REFERENCES songs(id),
    attempts   INTEGER NOT NULL DEFAULT 0,
    permanent  INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at TEXT
);

-- Append-only audit of API spend, so quota use is inspectable after a crash.
CREATE TABLE IF NOT EXISTS quota_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    units    INTEGER NOT NULL,
    at       TEXT NOT NULL
);
"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalise(text):
    """Comparison key: strip accents and punctuation, fold case and spacing."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^\w\s]", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def _add_column(conn, table, column, decl):
    """Idempotent ALTER: SQLite has no ADD COLUMN IF NOT EXISTS."""
    existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def connect(path):
    conn = sqlite3.connect(path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    # Migrations for databases created before these columns existed.
    _add_column(conn, "videos", "embeddable", "INTEGER")
    _add_column(conn, "resolutions", "embeddable", "INTEGER")
    _add_column(conn, "resolutions", "checked_at", "TEXT")
    # How long a video is, and who published it. Without these the matcher
    # cannot tell a three-minute recording from a two-hour upload of the whole
    # film, which is how entire films ended up behind song titles.
    _add_column(conn, "videos", "duration", "INTEGER")
    _add_column(conn, "videos", "channel_title", "TEXT")
    _add_column(conn, "videos", "meta_checked_at", "TEXT")
    return conn


# ---------------------------------------------------------------- ingest

def ingest_catalogue(conn, songs_path, stations_path):
    """Load parsed songs + the station role taxonomy. Idempotent."""
    songs = json.load(open(songs_path, encoding="utf-8"))
    taxonomy = json.load(open(stations_path, encoding="utf-8"))

    # The first of the two doors an id passes through. Songs are upserted here
    # ON CONFLICT(id) DO UPDATE SET title, while resolutions keyed by the same
    # id are left untouched — so loading a file numbered under an older scheme
    # would leave every row holding the previous song's video under the next
    # song's name, with nothing to show for it afterwards.
    songids.require_agreement(songs, os.path.basename(songs_path))

    station_kind, station_people = {}, {}
    for kind, entries in taxonomy.items():
        if kind.startswith("_"):
            continue
        for station, people in entries.items():
            station_kind[station] = kind
            station_people[station] = people

    conn.execute("BEGIN")
    for song in songs:
        conn.execute(
            "INSERT INTO songs (id,title,film,title_key,film_key) VALUES (?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET title=excluded.title, film=excluded.film",
            (song["id"], song["title"], song["film"],
             normalise(song["title"]), normalise(song["film"] or "")),
        )
        for artist in song["artists"]:
            conn.execute("INSERT OR IGNORE INTO artists (name) VALUES (?)", (artist,))
            conn.execute(
                "INSERT OR IGNORE INTO song_artists (song_id,artist_id) "
                "VALUES (?, (SELECT id FROM artists WHERE name=?))",
                (song["id"], artist),
            )
        for station in song["stations"]:
            kind = station_kind.get(station, "other")
            conn.execute(
                "INSERT OR IGNORE INTO stations (name,kind) VALUES (?,?)", (station, kind)
            )
            conn.execute(
                "INSERT OR IGNORE INTO song_stations (song_id,station_id) "
                "VALUES (?, (SELECT id FROM stations WHERE name=?))",
                (song["id"], station),
            )
            # Back-fill the role this station implies, unless it is a mood or
            # format label rather than a credited person.
            if kind in ("singer", "composer", "lyricist", "actor", "director"):
                for person in station_people.get(station, []):
                    conn.execute(
                        "INSERT OR IGNORE INTO song_roles (song_id,role,person) VALUES (?,?,?)",
                        (song["id"], kind, person),
                    )
    conn.execute("COMMIT")


# ------------------------------------------------------- harvest checkpoint

def get_cursor(conn, source):
    """Return (next_page_token, completed, pages_done) for a harvest source."""
    row = conn.execute(
        "SELECT next_page_token, completed, pages_done FROM harvest_cursor WHERE source=?",
        (source,),
    ).fetchone()
    if row is None:
        return None, False, 0
    return row["next_page_token"], bool(row["completed"]), row["pages_done"]


def commit_page(conn, source, videos, next_page_token, units=1):
    """Persist one harvested page and advance the cursor in ONE transaction.

    Coupling them is what makes the harvest safe to interrupt: the cursor can
    never advance past videos that failed to write, and the videos can never
    land without the cursor moving. Either both happen or neither does.
    """
    conn.execute("BEGIN")
    try:
        for video in videos:
            conn.execute(
                "INSERT INTO videos "
                "(video_id,title,channel_id,published_at,title_key,duration) "
                "VALUES (?,?,?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET "
                # Fill in a length we did not have before. Everything else is
                # left alone: a re-harvest must not undo what later passes
                # learned about a video.
                "duration=COALESCE(videos.duration, excluded.duration)",
                (video["video_id"], video["title"], video.get("channel_id"),
                 video.get("published_at"), normalise(video["title"]),
                 video.get("duration")),
            )
        conn.execute(
            "INSERT INTO harvest_cursor (source,next_page_token,completed,pages_done,updated_at) "
            "VALUES (?,?,?,1,?) ON CONFLICT(source) DO UPDATE SET "
            "next_page_token=excluded.next_page_token, "
            "completed=excluded.completed, "
            "pages_done=harvest_cursor.pages_done+1, "
            "updated_at=excluded.updated_at",
            (source, next_page_token, 0 if next_page_token else 1, now()),
        )
        conn.execute(
            "INSERT INTO quota_log (endpoint,units,at) VALUES (?,?,?)",
            ("playlistItems.list", units, now()),
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


# ------------------------------------------------------------- resolution

def record_match(conn, song_id, video_id, confidence, method):
    """Commit one resolved song immediately. Never overwrites a better match."""
    conn.execute(
        "INSERT INTO resolutions (song_id,video_id,confidence,method,updated_at) "
        "VALUES (?,?,?,?,?) ON CONFLICT(song_id) DO UPDATE SET "
        "video_id=excluded.video_id, confidence=excluded.confidence, "
        "method=excluded.method, updated_at=excluded.updated_at "
        "WHERE excluded.confidence > resolutions.confidence",
        (song_id, video_id, confidence, method, now()),
    )
    conn.execute("DELETE FROM resolve_failures WHERE song_id=?", (song_id,))


def replace_match(conn, song_id, video_id, confidence, method):
    """Overwrite a match outright, whatever its confidence.

    record_match refuses to displace a higher-confidence match, which is what
    keeps a weak later pass from undoing a strong earlier one. That rule is
    wrong in exactly one case: when the existing match has been *disqualified*
    rather than merely outscored. A two-and-a-half hour upload of a whole film
    scored 0.9 because its title matched exactly, and no correct three-minute
    recording could ever outrank it. Disqualification is a separate judgement
    from confidence, so it gets a separate door.
    """
    conn.execute(
        "INSERT INTO resolutions (song_id,video_id,confidence,method,updated_at) "
        "VALUES (?,?,?,?,?) ON CONFLICT(song_id) DO UPDATE SET "
        "video_id=excluded.video_id, confidence=excluded.confidence, "
        "method=excluded.method, updated_at=excluded.updated_at",
        (song_id, video_id, confidence, method, now()),
    )
    conn.execute("DELETE FROM resolve_failures WHERE song_id=?", (song_id,))


def record_failure(conn, song_id, error, permanent=False):
    conn.execute(
        "INSERT INTO resolve_failures (song_id,attempts,permanent,last_error,updated_at) "
        "VALUES (?,1,?,?,?) ON CONFLICT(song_id) DO UPDATE SET "
        "attempts=resolve_failures.attempts+1, permanent=excluded.permanent, "
        "last_error=excluded.last_error, updated_at=excluded.updated_at",
        (song_id, int(permanent), str(error)[:500], now()),
    )


def pending_songs(conn, max_attempts=3):
    """Songs still needing a URL: never resolved, not permanently failed,
    and not already retried past the cap. This is the resume query — rerunning
    the resolver after any crash simply picks up whatever this returns."""
    return conn.execute(
        "SELECT s.id, s.title, s.film, s.title_key, s.film_key FROM songs s "
        "LEFT JOIN resolutions r ON r.song_id = s.id "
        "LEFT JOIN resolve_failures f ON f.song_id = s.id "
        "WHERE r.song_id IS NULL "
        "  AND COALESCE(f.permanent,0) = 0 "
        "  AND COALESCE(f.attempts,0) < ? "
        "ORDER BY s.id",
        (max_attempts,),
    ).fetchall()


def progress(conn):
    q = lambda sql: conn.execute(sql).fetchone()[0]
    return {
        "songs": q("SELECT COUNT(*) FROM songs"),
        "resolved": q("SELECT COUNT(*) FROM resolutions"),
        "failed": q("SELECT COUNT(*) FROM resolve_failures WHERE permanent=1"),
        "retryable": q("SELECT COUNT(*) FROM resolve_failures WHERE permanent=0"),
        "videos": q("SELECT COUNT(*) FROM videos"),
        "quota_units": q("SELECT COALESCE(SUM(units),0) FROM quota_log"),
    }
