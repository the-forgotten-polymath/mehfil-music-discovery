"""Stage 1: parse the official Carvaan Gold songlist PDF into structured records.

The PDF is a 3-column layout. Naive line-based extraction bleeds text between
columns, so we work from word coordinates (`pdftotext -bbox-layout`) and slice
each page into columns by x-position before reconstructing lines.

Extracts factual catalogue metadata only: song title, film, performer credits,
and the station each entry appears under.

Usage:
    pdftotext -bbox-layout songlist.pdf full.xml
    python3 parse_songlist.py full.xml songs.json
"""

import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from songids import assign_ids, normalise  # noqa: E402

# Column gutters, from the x-position histogram: entry numbers sit at x≈21/211/401
# and their text at x≈44/233/423, with empty bands at 180-210 and 360-400.
COLUMN_BOUNDS = (195.0, 385.0)

# Station headers render at 18.5pt near the top of the page; body text is 13.93pt.
HEADER_MIN_HEIGHT = 16.0
HEADER_MAX_Y = 45.0

# Words on one visual line share a baseline; allow a little slack for rounding.
LINE_TOLERANCE = 3.0

PAGE_RE = re.compile(r'<page width="[^"]*" height="[^"]*">(.*?)</page>', re.S)
WORD_RE = re.compile(
    r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>'
)
ENTRY_RE = re.compile(r"^(\d{1,3})\.\s+(.*)$")
FILM_RE = re.compile(r"^Film:\s*(.*)$", re.I)
ARTIST_RE = re.compile(r"^Artistes?:\s*(.*)$", re.I)

XML_ENTITIES = {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'"}


def unescape(text):
    for entity, char in XML_ENTITIES.items():
        text = text.replace(entity, char)
    return text


def iter_pages(xml_text):
    for match in PAGE_RE.finditer(xml_text):
        words = []
        for x0, y0, x1, y1, raw in WORD_RE.findall(match.group(1)):
            token = unescape(raw).strip()
            if token:
                words.append((float(x0), float(y0), float(x1), float(y1), token))
        yield words


def column_of(x):
    if x < COLUMN_BOUNDS[0]:
        return 0
    if x < COLUMN_BOUNDS[1]:
        return 1
    return 2


def group_lines(words):
    """Collapse words into visual lines, ordered top-to-bottom then left-to-right."""
    lines = []
    for word in sorted(words, key=lambda w: (w[1], w[0])):
        if lines and abs(word[1] - lines[-1][0]) <= LINE_TOLERANCE:
            lines[-1][1].append(word)
        else:
            lines.append([word[1], [word]])
    return [" ".join(w[4] for w in sorted(ws, key=lambda w: w[0])) for _, ws in lines]


def extract_header(words):
    tall = [w for w in words if (w[3] - w[1]) >= HEADER_MIN_HEIGHT and w[1] < HEADER_MAX_Y]
    if not tall:
        return None
    text = " ".join(w[4] for w in sorted(tall, key=lambda w: w[0]))
    return re.sub(r"\s+", " ", text).strip() or None


def split_artists(raw):
    """Credits are comma-separated; '&' also appears in a handful of entries."""
    parts = re.split(r",|\s+&\s+", raw)
    return [p.strip(" .,") for p in parts if p.strip(" .,")]


def parse_entries(lines, station, page_no):
    """Walk a single column's lines, accumulating one record per numbered entry.

    Credits wrap mid-name across lines ("... Kishore" / "Kumar, Mohammed Rafi"),
    so each field accumulates raw fragments and is only split once, at flush.
    """
    entries, current, field = [], None, None

    def flush():
        if not current or not current["title"]:
            return
        entry = {
            "index": current["index"],
            "title": re.sub(r"\s+", " ", " ".join(current["title"])).strip(),
            "film": re.sub(r"\s+", " ", " ".join(current["film"])).strip() or None,
            "artists": split_artists(" ".join(current["artists"])),
            "station": station,
            "page": page_no,
        }
        entries.append(entry)

    for line in lines:
        entry_match = ENTRY_RE.match(line)
        if entry_match:
            flush()
            current = {
                "index": int(entry_match.group(1)),
                "title": [entry_match.group(2).strip()],
                "film": [],
                "artists": [],
            }
            field = "title"
            continue

        if current is None:
            continue

        # Tight line spacing occasionally collapses "Film: X" and "Artiste: Y"
        # into one reconstructed line; split them back apart before matching.
        inline = re.match(r"^(.*?)\s+(Artistes?:\s*.*)$", line, re.I)
        parts = [inline.group(1), inline.group(2)] if inline and FILM_RE.match(line) else [line]

        for part in parts:
            film_match = FILM_RE.match(part)
            if film_match:
                current["film"].append(film_match.group(1).strip())
                field = "film"
                continue

            artist_match = ARTIST_RE.match(part)
            if artist_match:
                current["artists"].append(artist_match.group(1).strip())
                field = "artists"
                continue

            # Unlabelled line: a wrapped continuation of whichever field came last.
            if field:
                current[field].append(part.strip())

    flush()
    return entries


def main(xml_path, out_path):
    xml_text = open(xml_path, encoding="utf-8", errors="replace").read()

    rows = []
    station = None
    pages_without_station = 0

    for page_no, words in enumerate(iter_pages(xml_text), start=1):
        if not words:
            continue
        header = extract_header(words)
        if header:
            station = header
        if station is None:
            pages_without_station += 1
            continue

        body = [w for w in words if (w[3] - w[1]) < HEADER_MIN_HEIGHT]
        by_column = defaultdict(list)
        for word in body:
            by_column[column_of(word[0])].append(word)

        for col in sorted(by_column):
            rows.extend(parse_entries(group_lines(by_column[col]), station, page_no))

    # Collapse the same recording appearing under several stations into one song.
    songs = {}
    for row in rows:
        key = (normalise(row["title"]), normalise(row["film"] or ""))
        song = songs.get(key)
        if song is None:
            songs[key] = song = {
                "title": row["title"],
                "film": row["film"],
                "artists": list(row["artists"]),
                "stations": [],
                "pages": [],
            }
        for artist in row["artists"]:
            if artist not in song["artists"]:
                song["artists"].append(artist)
        if row["station"] not in song["stations"]:
            song["stations"].append(row["station"])
        song["pages"].append(row["page"])

    # Still sorted by title, for a readable diff — but the order no longer says
    # anything about identity, which is the point of the ledger below.
    catalogue = sorted(songs.values(), key=lambda s: (s["title"].lower(), s["film"] or ""))
    added = assign_ids(catalogue)

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(catalogue, fh, ensure_ascii=False, indent=1)

    stations = {s for row in rows for s in [row["station"]]}
    multi = sum(1 for s in catalogue if len(s["stations"]) > 1)
    print(f"raw entries         : {len(rows)}")
    print(f"unique songs        : {len(catalogue)}")
    print(f"stations            : {len(stations)}")
    print(f"multi-station songs : {multi}")
    print(f"new ids assigned    : {len(added)}")
    for title in added[:10]:
        print(f"  + {title}")
    if len(added) > 10:
        print(f"  ... and {len(added) - 10} more")
    print(f"missing film        : {sum(1 for s in catalogue if not s['film'])}")
    print(f"missing artists     : {sum(1 for s in catalogue if not s['artists'])}")
    if pages_without_station:
        print(f"pages before 1st header: {pages_without_station}")
    print(f"-> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
