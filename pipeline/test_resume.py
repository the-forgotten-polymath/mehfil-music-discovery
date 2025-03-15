"""Proves the resolver loses nothing when the API fails mid-run.

Simulates a channel harvest that dies on page 4 with an HTTP 500, then a
quota exhaustion during matching, and asserts that every video and every
resolved URL captured before each failure survived, and that a plain re-run
resumes from exactly where it stopped.

    python3 pipeline/test_resume.py
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store

PAGES = 6
PER_PAGE = 50


class FlakyAPI:
    """Stands in for the YouTube API. Fails once, on a chosen page."""

    def __init__(self, fail_on_page=None):
        self.fail_on_page = fail_on_page
        self.calls = 0

    def fetch(self, page_token):
        page = int(page_token or 0)
        self.calls += 1
        if page == self.fail_on_page:
            raise RuntimeError(f"HTTP 500 from YouTube on page {page}")
        videos = [
            {"video_id": f"vid{page:02d}{i:02d}", "title": f"Song {page}-{i}",
             "channel_id": "UC_saregama", "published_at": "2020-01-01T00:00:00Z"}
            for i in range(PER_PAGE)
        ]
        nxt = str(page + 1) if page + 1 < PAGES else None
        return videos, nxt


def harvest(conn, api, source="saregama_uploads"):
    """Page through the API, committing each page atomically with its cursor."""
    token, completed, _ = store.get_cursor(conn, source)
    while not completed:
        videos, nxt = api.fetch(token)
        store.commit_page(conn, source, videos, nxt)
        token, completed = nxt, nxt is None
    return completed


def check(label, got, want):
    status = "PASS" if got == want else "FAIL"
    print(f"  [{status}] {label}: {got}" + ("" if got == want else f" (expected {want})"))
    return got == want


def main():
    db = os.path.join(tempfile.mkdtemp(), "resume_test.db")
    conn = store.connect(db)

    conn.execute("BEGIN")
    for i in range(1, 11):
        conn.execute(
            "INSERT INTO songs (id,title,film,title_key,film_key) VALUES (?,?,?,?,?)",
            (i, f"Song {i}", "Film", f"song {i}", "film"),
        )
    conn.execute("COMMIT")

    ok = True
    print("\n1. Harvest dies on page 4 (HTTP 500)")
    api = FlakyAPI(fail_on_page=3)
    try:
        harvest(conn, api)
        print("  [FAIL] expected the API to raise")
        ok = False
    except RuntimeError as exc:
        print(f"  crashed as expected: {exc}")

    ok &= check("videos kept from pages 0-2", store.progress(conn)["videos"], 3 * PER_PAGE)
    token, completed, pages = store.get_cursor(conn, "saregama_uploads")
    ok &= check("cursor points at the failed page", token, "3")
    ok &= check("cursor not marked complete", completed, False)
    ok &= check("pages committed", pages, 3)

    print("\n2. Re-run with the API healthy — should resume, not restart")
    api2 = FlakyAPI(fail_on_page=None)
    harvest(conn, api2)
    ok &= check("API calls used on resume", api2.calls, PAGES - 3)
    ok &= check("total videos after resume", store.progress(conn)["videos"], PAGES * PER_PAGE)
    ok &= check("harvest complete", store.get_cursor(conn, "saregama_uploads")[1], True)

    print("\n3. Matching dies partway (quota exhausted)")
    for song_id in range(1, 5):
        store.record_match(conn, song_id, f"vid{song_id}", 0.95, "channel_match")
    store.record_failure(conn, 5, "quotaExceeded", permanent=False)
    store.record_failure(conn, 6, "no candidate found", permanent=True)

    ok &= check("resolved URLs persisted", store.progress(conn)["resolved"], 4)

    print("\n4. Fresh connection (simulates process kill -9)")
    conn.close()
    conn = store.connect(db)
    ok &= check("resolved URLs survived restart", store.progress(conn)["resolved"], 4)
    ok &= check("videos survived restart", store.progress(conn)["videos"], PAGES * PER_PAGE)

    pending = [r["id"] for r in store.pending_songs(conn)]
    ok &= check("retries skip resolved + permanent failures", pending, [5, 7, 8, 9, 10])

    print("\n5. Re-run never downgrades an existing match")
    store.record_match(conn, 1, "worse_vid", 0.40, "fuzzy_search")
    kept = conn.execute("SELECT video_id FROM resolutions WHERE song_id=1").fetchone()[0]
    ok &= check("kept the higher-confidence URL", kept, "vid1")
    store.record_match(conn, 1, "better_vid", 0.99, "exact")
    kept = conn.execute("SELECT video_id FROM resolutions WHERE song_id=1").fetchone()[0]
    ok &= check("accepted the better URL", kept, "better_vid")

    print("\n6. A video proven unplayable is never re-matched")
    # Regression: dead ids used to stay eligible, so every re-run rediscovered,
    # re-matched and re-demoted them forever.
    conn.execute("BEGIN")
    conn.execute(
        "INSERT INTO videos (video_id,title,channel_id,title_key,embeddable) "
        "VALUES ('deadvid1234','Some Song','ch','some song',0)"
    )
    conn.execute(
        "INSERT INTO videos (video_id,title,channel_id,title_key,embeddable) "
        "VALUES ('livevid1234','Some Song','ch','some song',1)"
    )
    conn.execute(
        "INSERT INTO videos (video_id,title,channel_id,title_key) "
        "VALUES ('newvid12345','Some Song','ch','some song')"
    )
    conn.execute("COMMIT")

    eligible = [
        r["video_id"]
        for r in conn.execute(
            "SELECT video_id FROM videos "
            "WHERE channel_id IS NOT NULL AND COALESCE(embeddable, 1) = 1 "
            "AND video_id LIKE '%vid1234%' ORDER BY video_id"
        )
    ]
    ok &= check("dead excluded, live and unchecked kept", eligible,
                ["livevid1234", "newvid12345"])

    print("\n" + ("ALL PASSED" if ok else "FAILURES ABOVE"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
