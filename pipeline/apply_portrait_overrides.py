"""Apply hand-supplied portraits from data/portrait_overrides.json.

Run last. Everything before it guesses; this is the one pass that is told, so
it beats a Wikimedia match, a web-search result, or a recorded absence alike.

It exists for the failure the automatic passes cannot see. A missing portrait
announces itself as a blank card, but a *wrong* one looks exactly like a right
one: Wikidata's "Shankar" is S. Shankar the Tamil director, an exact name match
with entirely plausible occupations, and no amount of retrying finds the error.
Only a person can say which face is which.

Usage:
    python3 pipeline/apply_portrait_overrides.py web/public/artists
    python3 pipeline/apply_portrait_overrides.py web/public/artists --dry-run
"""

import json
import os
import sys

from fetch_web_photos import fetch, extension, image_size, MIN_EDGE
from fetch_artist_photos import slugify, name_key

OVERRIDES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "portrait_overrides.json",
)


def main(out_dir, dry_run=False):
    manifest_path = os.path.join(out_dir, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    overrides = {
        k: v for k, v in json.load(open(OVERRIDES, encoding="utf-8")).items()
        if not k.startswith("_")
    }

    print(f"{len(overrides)} overrides{' (dry run)' if dry_run else ''}\n")
    applied = 0
    for name, spec in overrides.items():
        url = spec["url"]
        blob = fetch(url)
        if not blob:
            print(f"  {name}: download failed, left as-is")
            continue

        ext = extension(blob)
        if not ext:
            print(f"  {name}: not a recognised image, left as-is")
            continue
        size = image_size(blob)
        if not size or min(size) < MIN_EDGE:
            print(f"  {name}: too small {size}, left as-is")
            continue

        # A stale file under the old extension would otherwise sit there
        # unreferenced once the manifest points at the new one.
        previous = (manifest.get(name) or {}).get("file")
        filename = f"{slugify(name)}{ext}"
        if previous and previous != filename and not dry_run:
            stale = os.path.join(out_dir, previous)
            if os.path.exists(stale):
                os.remove(stale)

        entry = {
            "file": filename,
            "provenance": "web",
            "page": url,
            "manual": True,
        }
        subject = spec.get("subject")
        if subject and name_key(subject) != name_key(name):
            entry["subject"] = subject

        if not dry_run:
            with open(os.path.join(out_dir, filename), "wb") as fh:
                fh.write(blob)
        was = "replacing" if manifest.get(name) else "adding"
        print(f"  {name}: {was} -> {filename} ({size[0]}x{size[1]})")
        manifest[name] = entry
        applied += 1

    if not dry_run:
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f"\napplied {applied} / {len(overrides)}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0], dry_run="--dry-run" in sys.argv)
