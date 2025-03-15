"""Fetch poster images for the stations that are not named after a person.

Moods, genres and formats have no face to show, so they need imagery. Sources
from Openverse restricted to CC0 and Public Domain Mark: unlike CC BY or
CC BY-SA, those carry no attribution obligation, which keeps these posters free
of the requirement still outstanding for the Commons portraits.

Images are downloaded and squared locally rather than hot-linked, so a poster
cannot vanish when someone re-hosts or deletes the original.

    python3 pipeline/fetch_station_posters.py web/public/stations
"""

import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

API = "https://api.openverse.org/v1/images/"
UA = {"User-Agent": "MehfilPersonalProject/1.0 (personal, local use)"}
SIZE = 640

# Search terms chosen to read at thumbnail size and to suit a golden-era Hindi
# film catalogue rather than generic stock symbolism.
# Several terms per station, tried in order. The CC0-only pool is small, so a
# precise phrase often returns nothing where a single noun succeeds; the list
# degrades from specific imagery to a broad but still apt fallback.
STATIONS = {
    "ROMANCE": ["red rose", "roses", "romance"],
    "HAPPY": ["golden sunset", "sunflower", "sunshine"],
    "SAD": ["rain window", "rain", "fog"],
    "BHAKTI": ["oil lamp", "diya", "temple"],
    "SUFI": ["desert dunes", "desert", "dervish"],
    "GHAZAL": ["antique book", "calligraphy", "quill"],
    "GURBANI": ["golden temple", "amritsar", "sikh temple"],
    "FILM INSTRUMENTAL": ["violin", "orchestra", "strings instrument"],
    "HINDUSTANI CLASSICAL (INST)": ["sitar", "tabla", "indian instrument"],
    "DUET HITS": ["vintage microphone", "microphone", "recording studio"],
    "SONGS WITH DIALOGUES": ["film reel", "cinema projector", "movie theatre"],
    "TOP 300": ["vinyl record", "gramophone", "turntable"],
}


def slugify(name):
    return "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")


def search(term, tries=3):
    """CC0 / public-domain images only. Returns candidate result dicts."""
    query = urllib.parse.urlencode(
        {
            "q": term,
            "license": "cc0,pdm",
            "page_size": 8,
            "mature": "false",
        }
    )
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(
                urllib.request.Request(f"{API}?{query}", headers=UA), timeout=30
            ) as response:
                return json.load(response).get("results", [])
        except Exception:
            if attempt == tries - 1:
                return []
            time.sleep(2.0 * (attempt + 1))
    return []


def download(url, path):
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers=UA), timeout=45
        ) as response:
            data = response.read()
        if len(data) < 5000:  # too small to be a usable photo
            return False
        with open(path, "wb") as fh:
            fh.write(data)
        return True
    except Exception:
        return False


def square(path):
    """Centre-crop to a square and resize, so every tile matches the grid."""
    try:
        probe = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
            capture_output=True, text=True, timeout=30,
        ).stdout
        dims = [int(l.split(":")[1]) for l in probe.splitlines() if ":" in l and l.split(":")[1].strip().isdigit()]
        if len(dims) < 2:
            return False
        side = min(dims)
        subprocess.run(["sips", "-c", str(side), str(side), path, "--out", path],
                       capture_output=True, timeout=30)
        subprocess.run(["sips", "-Z", str(SIZE), path, "--out", path],
                       capture_output=True, timeout=30)
        return True
    except Exception:
        return False


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    manifest_path = os.path.join(out_dir, "manifest.json")
    manifest = {}
    if os.path.exists(manifest_path):
        manifest = json.load(open(manifest_path, encoding="utf-8"))

    for station, terms in STATIONS.items():
        if manifest.get(station):
            print(f"  {station:30s} already have")
            continue

        slug = slugify(station)
        path = os.path.join(out_dir, f"{slug}.jpg")

        for term in terms:
            for result in search(term):
                url = result.get("url")
                if not url or not download(url, path):
                    continue
                if not square(path):
                    if os.path.exists(path):
                        os.remove(path)
                    continue
                # Openverse returns explicit nulls for absent fields, so a
                # dict default never fires — coalesce instead of relying on it.
                title = (result.get("title") or "")[:120]
                manifest[station] = {
                    "file": f"{slug}.jpg",
                    "title": title,
                    "license": f"{result.get('license') or ''}/{result.get('license_version') or ''}",
                    "source": result.get("foreign_landing_url") or "",
                    "creator": (result.get("creator") or "")[:80],
                }
                print(f"  {station:30s} {manifest[station]['license']:9s} {term:22s} {title[:30]}")
                break
            if manifest.get(station):
                break
            time.sleep(0.3)
        else:
            print(f"  {station:30s} nothing usable for {terms}")

        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=1)
        time.sleep(0.4)  # be polite

    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f"\nposters: {len(manifest)} / {len(STATIONS)}")
    print(f"-> {out_dir}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "web/public/stations")
