"""Fill remaining portrait gaps from open web image search.

This is the fallback for people Wikidata cannot supply: either it holds no
entity for them, or the entity carries no P18 image. Wikimedia remains the
preferred source and is never overwritten by this script.

Two things follow from searching the open web rather than a curated database,
and both are handled here rather than left to the caller:

  Identity.  A bare name is not a person. Searching "Shankar" returns S. Shankar
  the Tamil director; searching "Roshan" returns Hrithik. Every query is
  therefore built from the name *plus* the role the catalogue credits them
  under, and duo members are searched under the duo. This does not make the
  result certain, only much likelier to be the right face.

  Provenance.  These images carry no verified licence, so they are recorded
  with `provenance: "web"` and no licence field. The about page keys off that
  to list them separately, instead of filing them under the Creative Commons
  credits where they would misstate their own terms.

Usage:
    python3 pipeline/fetch_web_photos.py data/carvaan.db web/public/artists
    python3 pipeline/fetch_web_photos.py ... --only "Chitragupta"
    python3 pipeline/fetch_web_photos.py ... --refetch "Shankar"
    python3 pipeline/fetch_web_photos.py ... --dry-run
"""

import json
import os
import re
import struct
import sys
import time
import urllib.parse
import urllib.request

import store
from fetch_artist_photos import ALIASES, slugify, name_key

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)
HEADERS = {"User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9"}

# What to add to a bare name so the search returns the right person. The
# catalogue's own credit is the only reliable disambiguator we have.
ROLE_HINT = {
    "composer": "Hindi film music director composer",
    "lyricist": "Hindi film lyricist songwriter",
    "singer": "Hindi film playback singer",
    "actor": "Hindi film actor",
    "director": "Hindi film director",
}
# Portraits below this are thumbnails, not faces.
MIN_EDGE = 200
MAX_BYTES = 8 * 1024 * 1024


def fetch(url, referer=None, timeout=30):
    """Raw bytes, or None. Never raises — a miss is normal here."""
    headers = dict(HEADERS)
    if referer:
        headers["Referer"] = referer
    try:
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read(MAX_BYTES + 1)
    except Exception:
        return None


def image_size(blob):
    """(width, height) from the header alone, or None if unrecognised.

    Enough of a parse to reject thumbnails and non-images without pulling in an
    imaging library for a job this small.
    """
    if len(blob) < 24:
        return None
    # PNG
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", blob[16:24])
    # GIF
    if blob[:6] in (b"GIF87a", b"GIF89a"):
        return struct.unpack("<HH", blob[6:10])
    # WebP
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        chunk = blob[12:16]
        if chunk == b"VP8X":
            w = int.from_bytes(blob[24:27], "little") + 1
            h = int.from_bytes(blob[27:30], "little") + 1
            return w, h
        if chunk == b"VP8 ":
            return struct.unpack("<HH", blob[26:30])
        if chunk == b"VP8L":
            bits = int.from_bytes(blob[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        return None
    # JPEG: walk the segments to a start-of-frame
    if blob[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(blob):
            if blob[i] != 0xFF:
                i += 1
                continue
            marker = blob[i + 1]
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            length = int.from_bytes(blob[i + 2 : i + 4], "big")
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", blob[i + 5 : i + 9])
                return w, h
            i += 2 + length
    return None


def extension(blob):
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return ".webp"
    if blob[:2] == b"\xff\xd8":
        return ".jpg"
    if blob[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    return None


def ddg_images(query, limit=12):
    """DuckDuckGo image results. Needs a one-time token from the HTML page."""
    quoted = urllib.parse.quote(query)
    page = fetch(f"https://duckduckgo.com/?q={quoted}&iax=images&ia=images")
    if not page:
        return []
    match = re.search(rb"vqd=\"([^\"]+)\"", page) or re.search(
        rb"vqd=([\d-]+)&", page
    )
    if not match:
        return []
    vqd = match.group(1).decode()
    data = fetch(
        f"https://duckduckgo.com/i.js?l=us-en&o=json&q={quoted}&vqd={vqd}&f=,,,&p=1",
        referer="https://duckduckgo.com/",
    )
    if not data:
        return []
    try:
        results = json.loads(data).get("results", [])
    except Exception:
        return []
    return [
        {
            "image": r.get("image"),
            "page": r.get("url"),
            "title": r.get("title", ""),
            "width": r.get("width", 0),
            "height": r.get("height", 0),
        }
        for r in results[:limit]
        if r.get("image")
    ]


def bing_images(query, limit=12):
    """Fallback when DuckDuckGo declines to answer."""
    quoted = urllib.parse.quote(query)
    page = fetch(f"https://www.bing.com/images/search?q={quoted}&form=HDRSC2")
    if not page:
        return []
    out = []
    for raw in re.findall(rb"m=\"({[^\"]+})\"", page)[: limit * 3]:
        try:
            meta = json.loads(raw.decode("unicode_escape").replace("&quot;", '"'))
        except Exception:
            continue
        if meta.get("murl"):
            out.append(
                {
                    "image": meta["murl"],
                    "page": meta.get("purl", ""),
                    "title": meta.get("t", ""),
                    "width": 0,
                    "height": 0,
                }
            )
        if len(out) >= limit:
            break
    return out


def build_query(name, roles):
    """Name plus the role that disambiguates it, duos under the duo name."""
    subject = ALIASES.get(name, name)
    hint = ""
    for role in ("composer", "lyricist", "singer", "actor", "director"):
        if role in roles:
            hint = ROLE_HINT[role]
            break
    return f"{subject} {hint}".strip(), subject


# Hosts whose images are almost never portraits. Video thumbnails dominate
# these searches and a 16:9 still crops badly into a circular card.
THUMBNAIL_HOSTS = ("i.ytimg.com", "img.youtube.com", "i.vimeocdn.com")

# Stock agencies, rejected outright rather than merely ranked down. Their
# previews are the ones with a watermark burned across the middle, so they are
# useless as portraits regardless of any other consideration — and these are
# the rightsholders most likely to object to the result.
BLOCKED_HOSTS = (
    "gettyimages",
    "shutterstock",
    "alamy",
    "istockphoto",
    "dreamstime",
    "depositphotos",
    "123rf",
    "agefotostock",
    "stock.adobe",
    "picfair",
)


def blocked(result):
    haystack = f"{result.get('image', '')} {result.get('page', '')}".lower()
    return any(host in haystack for host in BLOCKED_HOSTS)


def rank(result):
    """Lower sorts first. Prefers a head-and-shoulders shape over a wide still."""
    url = (result.get("image") or "").lower()
    penalty = 10 if any(host in url for host in THUMBNAIL_HOSTS) else 0

    width, height = result.get("width") or 0, result.get("height") or 0
    if not width or not height:
        return penalty + 5  # unknown shape: after the known-good, before the bad

    ratio = height / width
    if ratio < 0.75:            # letterbox: a scene, not a face
        penalty += 4
    elif ratio > 2.2:           # a strip, usually a banner
        penalty += 3
    elif 0.95 <= ratio <= 1.6:  # square to portrait: what a portrait looks like
        penalty -= 2
    if min(width, height) < 300:
        penalty += 1
    return penalty


def grab(name, roles, out_dir, dry_run=False):
    """Try to place one portrait. Returns the manifest entry, or None."""
    query, subject = build_query(name, roles)
    results = ddg_images(query) or bing_images(query)
    if not results:
        return None

    results = sorted([r for r in results if not blocked(r)], key=rank)
    for result in results:
        blob = fetch(result["image"], referer=result.get("page") or None)
        if not blob or len(blob) > MAX_BYTES:
            continue
        ext = extension(blob)
        if not ext:
            continue
        size = image_size(blob)
        if not size or min(size) < MIN_EDGE:
            continue

        entry = {
            "file": f"{slugify(name)}{ext}",
            "provenance": "web",
            "query": query,
            "page": result.get("page", ""),
            "image": result["image"],
            "width": size[0],
            "height": size[1],
        }
        if name_key(subject) != name_key(name):
            entry["subject"] = subject
        if not dry_run:
            with open(os.path.join(out_dir, entry["file"]), "wb") as fh:
                fh.write(blob)
        return entry
    return None


def main(db_path, out_dir, only=None, refetch=None, limit=None, dry_run=False):
    conn = store.connect(db_path)
    manifest_path = os.path.join(out_dir, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8"))

    roles_by_person = {}
    for row in conn.execute(
        "SELECT a.name FROM song_artists sa JOIN artists a ON a.id = sa.artist_id "
        "JOIN resolutions r ON r.song_id = sa.song_id AND r.embeddable = 1 "
        "GROUP BY a.name"
    ):
        roles_by_person.setdefault(row["name"], set()).add("singer")
    for row in conn.execute(
        "SELECT person, role FROM song_roles sr "
        "JOIN resolutions r ON r.song_id = sr.song_id AND r.embeddable = 1 "
        "GROUP BY person, role"
    ):
        roles_by_person.setdefault(row["person"], set()).add(row["role"])

    if refetch:
        targets = list(refetch)
    elif only:
        targets = list(only)
    else:
        # Everyone with no portrait. A Wikimedia portrait always wins, so those
        # are left alone; only the verified-nothing and the never-tried remain.
        targets = [n for n in roles_by_person if not manifest.get(n)]

    print(f"{len(targets)} to search{' (dry run)' if dry_run else ''}\n")
    found = 0
    for i, name in enumerate(targets[: limit or len(targets)], start=1):
        existing = manifest.get(name)
        # Never displace a portrait that is already better sourced than this
        # pass can manage: a Wikimedia match, or one a person chose by hand.
        # Only an explicit --refetch of that name overrides the rule.
        settled = existing and (
            existing.get("provenance") != "web" or existing.get("manual")
        )
        if settled and name not in (refetch or []):
            continue
        entry = grab(name, roles_by_person.get(name, set()), out_dir, dry_run)
        if entry:
            manifest[name] = entry
            found += 1
            print(f"  [{i}] {name}  <- {entry['query']}  ({entry['width']}x{entry['height']})")
        else:
            print(f"  [{i}] {name}  -- nothing usable")
        if not dry_run and i % 5 == 0:
            with open(manifest_path, "w", encoding="utf-8") as fh:
                json.dump(manifest, fh, ensure_ascii=False, indent=1)
        time.sleep(1.2)  # search endpoints throttle aggressively

    if not dry_run:
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f"\nfound {found} / {len(targets[: limit or len(targets)])}")


def _values(flag):
    """Repeatable --flag "value" arguments."""
    out = []
    for i, arg in enumerate(sys.argv):
        if arg == flag and i + 1 < len(sys.argv):
            out.append(sys.argv[i + 1])
    return out


if __name__ == "__main__":
    positional = []
    skip = False
    for i, arg in enumerate(sys.argv[1:], start=1):
        if skip:
            skip = False
            continue
        if arg in ("--only", "--refetch", "--limit"):
            skip = True
        elif not arg.startswith("--"):
            positional.append(arg)

    limits = _values("--limit")
    main(
        positional[0],
        positional[1],
        only=_values("--only"),
        refetch=_values("--refetch"),
        limit=int(limits[0]) if limits else None,
        dry_run="--dry-run" in sys.argv,
    )
