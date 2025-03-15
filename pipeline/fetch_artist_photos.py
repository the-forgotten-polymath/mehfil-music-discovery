"""Fetch real portraits for the catalogue's people from Wikidata / Wikimedia Commons.

Song thumbnails are a poor stand-in for a person, and Commons is the right
source: openly licensed, stable, and with an API that lets us confirm we have
the right individual before trusting a photo.

Identity is verified rather than assumed. A name search alone happily returns a
different person with the same name, so a candidate is accepted only if
Wikidata says it is a human (P31=Q5) whose occupations (P106) include a musical
role. Anything unverified is skipped, leaving the UI to fall back to song art.

Images are downloaded locally rather than hot-linked, which is what Wikimedia
asks for, and each one's licence and author are recorded so attribution is
possible.

    python3 pipeline/fetch_artist_photos.py data/carvaan.db web/public/artists
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store

UA = {"User-Agent": "CarvaanPersonalProject/1.0 (personal, local use)"}
API = "https://www.wikidata.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"
THUMB_WIDTH = 400
# Passes over the still-unresolved names within a single invocation.
MAX_PASSES = 4

HUMAN = "Q5"

# Occupations that qualify someone, per the role they are credited under here.
#
# The gate is per-role because the roles disagree about what counts. A composer
# who only ever composed is the right person for the composer grid; an actor who
# only ever acted is the right person for the actor grid. An earlier single
# global rule demanded a *musical* occupation of everyone, so a pure film actor
# could never pass it — Sadhana Shivdasani has a portrait and the occupations
# "actor, film actor, film director", and was rejected by all three.
ROLE_QIDS = {
    "singer": {
        "Q177220",   # singer
        "Q1415090",  # playback singer
        "Q639669",   # musician
        "Q36834",    # composer
    },
    "composer": {
        "Q36834",    # composer
        "Q486748",   # songwriter
        "Q158852",   # conductor
        "Q639669",   # musician
    },
    "lyricist": {
        "Q753110",   # songwriter/lyricist
        "Q49757",    # poet
        "Q486748",   # songwriter
        "Q214917",   # playwright
        "Q36180",    # writer
    },
    "actor": {
        "Q33999",    # actor
        "Q10800557", # film actor
    },
    "director": {
        "Q2526255",  # film director
        "Q3282637",  # film producer
    },
}
# Used when we do not know why a person is in the catalogue.
ANY_ROLE = set().union(*ROLE_QIDS.values())

ALIAS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "artist_aliases.json",
)


def load_aliases():
    """Hand-checked catalogue-name -> Wikidata-name corrections."""
    if not os.path.exists(ALIAS_PATH):
        return {}
    data = json.load(open(ALIAS_PATH, encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


ALIASES = load_aliases()


def get_json(url, retries=5):
    """Fetch JSON, backing off on failure. None means every attempt failed."""
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=30
            ) as response:
                return json.load(response)
        except Exception:
            if attempt == retries - 1:
                return None
            # Wikimedia throttles bursts; widen the gap each time.
            time.sleep(2.0 * (attempt + 1))
    return None


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def name_key(name):
    """Fold a name for comparison: lowercase, letters and digits only.

    Keeps "R.D. Burman" == "R. D. Burman" while still separating "Anand" from
    "Anand Bakshi".
    """
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def names_match(query, labels):
    """True only when the entity is actually called what we searched for.

    Wikidata search is fuzzy: "Abhas" returns Kishore Kumar (whose birth name
    was Abhas Kumar Ganguly) and "Benny" returns Benny Andersson of ABBA.
    Occupation checks do not catch either, because both are real musicians.
    Requiring the name itself to match is what rejects them.
    """
    target = name_key(query)
    return any(name_key(label) == target for label in labels)


def query_terms(name):
    """Search strings to try for a person, best first.

    Wikidata's search is literal about punctuation: "S.D. Burman" returns
    nothing at all, while "S. D. Burman" finds the entity. Spacing runs of
    initials is therefore not cosmetic — it is the difference between a hit and
    silence for every name written in the catalogue's compact style.
    """
    terms = []
    alias = ALIASES.get(name)
    if alias:
        terms.append(alias)
    terms.append(name)
    spaced = re.sub(r"\b([A-Za-z])\.(?=[A-Za-z])", r"\1. ", name)
    if spaced != name:
        terms.append(spaced)
    # Preserve order, drop repeats.
    return list(dict.fromkeys(terms))


class LookupFailed(Exception):
    """The API did not answer. Distinct from 'this person has no photo'.

    Conflating the two is how a momentary rate-limit permanently blacklists
    someone: the null gets cached in the manifest and never retried.
    """


def find_person(name, accept=None):
    """Return (qid, image_filename, subject) for the right person, else None.

    `accept` is the set of occupations that qualify this person, chosen from
    the role they are credited under. Raises LookupFailed if the API could not
    be reached, so the caller can leave the person out of the manifest and
    retry on the next run rather than recording a permanent "no photo".
    """
    accept = accept or ANY_ROLE
    # An entry in the alias file is a human judgement about which entity this
    # is, so the occupation and instance-of checks have already been made by a
    # person. They still have to bear the name we look them up by.
    curated = name in ALIASES

    for term in query_terms(name):
        result = _search_one(term, accept, curated)
        if result:
            return result
    return None


def _search_one(name, accept, curated):
    """One search term. Raises LookupFailed on an unreachable API."""
    query = urllib.parse.quote(name)
    found = get_json(
        f"{API}?action=wbsearchentities&search={query}&language=en&format=json&limit=5"
    )
    if found is None:
        raise LookupFailed(name)
    if not found.get("search"):
        return None

    ids = [hit["id"] for hit in found["search"]]
    entities = get_json(
        f"{API}?action=wbgetentities&ids={'|'.join(ids)}"
        f"&props=claims|labels|aliases&languages=en&format=json"
    )
    if entities is None:
        raise LookupFailed(name)
    if "entities" not in entities:
        raise LookupFailed(name)

    for qid in ids:  # search order is relevance order
        entity = entities.get("entities", {}).get(qid, {})
        claims = entity.get("claims", {})

        # The entity must actually bear this name, not merely be a fuzzy hit.
        labels = [entity.get("labels", {}).get("en", {}).get("value", "")]
        labels += [a["value"] for a in entity.get("aliases", {}).get("en", [])]
        if not names_match(name, labels):
            continue

        # Curated names skip these two gates: the entity was chosen by hand, and
        # some targets are duos rather than people, so "instance of human" is
        # false for them by design.
        if not curated:
            instances = {
                c["mainsnak"]["datavalue"]["value"]["id"]
                for c in claims.get("P31", [])
                if "datavalue" in c["mainsnak"]
            }
            if HUMAN not in instances:
                continue

            roles = {
                c["mainsnak"]["datavalue"]["value"]["id"]
                for c in claims.get("P106", [])
                if "datavalue" in c["mainsnak"]
            }
            if not roles & accept:
                continue

        images = claims.get("P18", [])
        if not images or "datavalue" not in images[0]["mainsnak"]:
            continue
        label = entity.get("labels", {}).get("en", {}).get("value", "") or name
        return qid, images[0]["mainsnak"]["datavalue"]["value"], label

    return None


def image_meta(filename):
    """Thumbnail URL plus licence and author, straight from Commons."""
    title = urllib.parse.quote(f"File:{filename}")
    data = get_json(
        f"{COMMONS}?action=query&titles={title}&prop=imageinfo"
        f"&iiprop=url|extmetadata&iiurlwidth={THUMB_WIDTH}&format=json"
    )
    if not data:
        return None
    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        info = (page.get("imageinfo") or [{}])[0]
        if not info:
            continue
        extra = info.get("extmetadata", {})
        return {
            "url": info.get("thumburl") or info.get("url"),
            "license": (extra.get("LicenseShortName", {}) or {}).get("value", "unknown"),
            "author": re.sub(
                r"<[^>]+>", "", (extra.get("Artist", {}) or {}).get("value", "")
            ).strip()[:120],
            "descriptionurl": info.get("descriptionurl", ""),
        }
    return None


def download(url, path):
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers=UA), timeout=40
        ) as response:
            data = response.read()
        if len(data) < 1000:  # a stub or error page, not a real image
            return False
        with open(path, "wb") as fh:
            fh.write(data)
        return True
    except Exception:
        return False


def main(db_path, out_dir, retry_none=False):
    conn = store.connect(db_path)
    os.makedirs(out_dir, exist_ok=True)
    manifest_path = os.path.join(out_dir, "manifest.json")

    manifest = {}
    if os.path.exists(manifest_path):
        manifest = json.load(open(manifest_path, encoding="utf-8"))

    # A recorded null is never revisited, which is right for ordinary reruns and
    # wrong after the matching rules change: every person the old rules turned
    # away stays turned away, and the fix looks like it did nothing. Dropping
    # the nulls re-opens exactly those, leaving found portraits untouched.
    if retry_none:
        dropped = [k for k, v in manifest.items() if v is None]
        for k in dropped:
            del manifest[k]
        print(f"retrying {len(dropped)} previously recorded as having no photo")

    # People worth a portrait: credited singers, plus the roles the browse grid
    # shows as circular cards.
    people = {}
    # What each person is credited as, so the occupation check can ask for the
    # right thing. Someone credited both ways qualifies under either.
    roles_by_person = {}
    for row in conn.execute(
        "SELECT a.name, COUNT(*) n FROM song_artists sa "
        "JOIN artists a ON a.id = sa.artist_id "
        "JOIN resolutions r ON r.song_id = sa.song_id AND r.embeddable = 1 "
        "GROUP BY a.name ORDER BY n DESC"
    ):
        people[row["name"]] = row["n"]
        roles_by_person.setdefault(row["name"], set()).add("singer")
    for row in conn.execute(
        "SELECT person, role, COUNT(DISTINCT sr.song_id) n FROM song_roles sr "
        "JOIN resolutions r ON r.song_id = sr.song_id AND r.embeddable = 1 "
        "GROUP BY person, role ORDER BY n DESC"
    ):
        people.setdefault(row["person"], row["n"])
        roles_by_person.setdefault(row["person"], set()).add(row["role"])

    def accepted_roles(name):
        roles = roles_by_person.get(name, set())
        qids = set().union(*(ROLE_QIDS.get(r, set()) for r in roles)) if roles else set()
        return qids or ANY_ROLE

    def save():
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=1)

    def attempt(name):
        """One person. Returns True if resolved either way, False to retry."""
        slug = slugify(name)
        path = os.path.join(out_dir, f"{slug}.jpg")

        try:
            result = find_person(name, accepted_roles(name))
        except LookupFailed:
            return False

        if not result:
            manifest[name] = None  # verified: no suitable entity
            return True

        qid, filename, subject = result
        meta = image_meta(filename)
        # A failed lookup or download is a network problem, not proof the
        # person has no photo. Recording null here is what previously turned
        # a transient blip into a permanent gap.
        if meta is None:
            return False
        if not meta["url"] or not download(meta["url"], path):
            return False

        manifest[name] = {
            "file": f"{slug}.jpg",
            "qid": qid,
            "license": meta["license"],
            "author": meta["author"],
            "source": meta["descriptionurl"],
        }
        # Only when the portrait is filed under a different name — a duo, or a
        # fuller form. Recording it keeps the credits from implying the picture
        # shows one member of Laxmikant-Pyarelal on his own.
        if name_key(subject) != name_key(name):
            manifest[name]["subject"] = subject
        return True

    # Several passes, because a run that leaves failures for "next time" only
    # converges if something re-runs it. The first pass previously dropped 177
    # of 396 people and nothing ever came back for them.
    print(f"{len(people)} people, {len(manifest)} already recorded\n")
    for attempt_no in range(1, MAX_PASSES + 1):
        pending = [n for n in people if n not in manifest]
        if not pending:
            break
        print(f"pass {attempt_no}: {len(pending)} to fetch")

        for i, name in enumerate(pending, start=1):
            attempt(name)
            if i % 10 == 0 or i == len(pending):
                save()
                have = sum(1 for v in manifest.values() if v)
                print(f"  {i}/{len(pending)}  photos={have}", flush=True)
            time.sleep(0.15)  # be polite to the Wikimedia APIs

        save()
        if len([n for n in people if n not in manifest]) == len(pending):
            print("  no progress this pass, stopping")
            break
        time.sleep(3)  # let any throttling subside before the next pass

    save()
    have = sum(1 for v in manifest.values() if v)
    unresolved = [n for n in people if n not in manifest]
    print(f"\nportraits   : {have} / {len(people)} people")
    print(f"verified none: {sum(1 for v in manifest.values() if v is None)}")
    print(f"unresolved  : {len(unresolved)} (network failures, retry to finish)")
    print(f"-> {out_dir}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0], args[1], retry_none="--retry-none" in sys.argv)
