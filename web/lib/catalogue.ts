// Shapes mirror pipeline/export_catalogue.py. Songs reference facet values by
// index into `facets` to keep the payload small; `hydrate` turns one back into
// plain strings for rendering.

export type FacetKey =
  | "artists"
  | "films"
  | "stations"
  | "moods"
  | "composer"
  | "lyricist"
  | "actor"
  | "singer"
  | "director";

export type RawSong = {
  id: number;
  t: string;
  f: number | null;
  v: string;
  c: number;
  a: number[];
  s: number[];
  m: number[];
  cr: number[]; // composer
  lt: number[]; // lyricist
  ar: number[]; // actor
  sr: number[]; // singer
  dr: number[]; // director
};

/** What a station is named after, so its poster can be chosen sensibly. */
export type StationMeta = {
  kind: "singer" | "composer" | "lyricist" | "actor" | "director" | "mood" | "genre" | "format";
  person: string | null;
};

export type Catalogue = {
  facets: Record<FacetKey, string[]>;
  songs: RawSong[];
  stationMeta?: Record<string, StationMeta>;
};

export type Song = {
  id: number;
  title: string;
  film: string | null;
  video: string;
  confidence: number;
  artists: string[];
  stations: string[];
  moods: string[];
  // The rest of the credits the songlist carries. Present on every song and
  // previously dropped in hydration, so nothing could show who wrote a song
  // even though the catalogue knew.
  composers: string[];
  lyricists: string[];
  actors: string[];
  directors: string[];
};

// Which song field backs each filterable facet.
export const FACET_FIELD: Record<string, keyof RawSong> = {
  stations: "s",
  moods: "m",
  artists: "a",
  composer: "cr",
  lyricist: "lt",
  actor: "ar",
  films: "f",
};

export const FACET_LABEL: Record<string, string> = {
  stations: "Station",
  moods: "Mood & Genre",
  artists: "Singer",
  composer: "Composer",
  lyricist: "Lyricist",
  actor: "On screen",
  films: "Film",
};

/**
 * Cover art for a song. Every resolved song has a video id, and YouTube serves
 * a still for each one, so the catalogue gets artwork without storing any.
 * `mq` (320x180) is enough for rows; `hq` (480x360) for the large player art.
 */
export function artwork(videoId: string, size: "mq" | "hq" = "mq"): string {
  return `https://i.ytimg.com/vi/${videoId}/${size}default.jpg`;
}

export function hydrate(song: RawSong, facets: Catalogue["facets"]): Song {
  return {
    id: song.id,
    title: song.t,
    film: song.f === null ? null : facets.films[song.f],
    video: song.v,
    confidence: song.c,
    artists: song.a.map((i) => facets.artists[i]),
    stations: song.s.map((i) => facets.stations[i]),
    moods: song.m.map((i) => facets.moods[i]),
    composers: (song.cr ?? []).map((i) => facets.composer?.[i]).filter(Boolean),
    lyricists: (song.lt ?? []).map((i) => facets.lyricist?.[i]).filter(Boolean),
    actors: (song.ar ?? []).map((i) => facets.actor?.[i]).filter(Boolean),
    directors: (song.dr ?? []).map((i) => facets.director?.[i]).filter(Boolean),
  };
}

/** Songs matching every active facet plus the free-text query. */
export function filterSongs(
  catalogue: Catalogue,
  selected: Record<string, Set<number>>,
  query: string
): RawSong[] {
  const q = query.trim().toLowerCase();
  const active = Object.entries(selected).filter(([, v]) => v.size > 0);

  return catalogue.songs.filter((song) => {
    for (const [facet, chosen] of active) {
      const field = FACET_FIELD[facet];
      const value = song[field];
      if (field === "f") {
        if (song.f === null || !chosen.has(song.f)) return false;
      } else if (!(value as number[]).some((i) => chosen.has(i))) {
        return false;
      }
    }
    if (!q) return true;
    const film = song.f === null ? "" : catalogue.facets.films[song.f];
    if (song.t.toLowerCase().includes(q) || film.toLowerCase().includes(q)) return true;
    return song.a.some((i) => catalogue.facets.artists[i].toLowerCase().includes(q));
  });
}

export type FacetCard = {
  index: number;
  label: string;
  count: number;
  video: string;
};

/** Facets whose values are people, and so can carry a real portrait. */
export const PERSON_FACETS = new Set(["artists", "composer", "lyricist", "actor"]);

/** Manifest written by pipeline/fetch_artist_photos.py; null means no verified photo. */
/**
 * One portrait, from one of two sources.
 *
 * Wikimedia entries carry a verified licence and must be credited. Web-search
 * entries carry none, so they are marked `provenance: "web"` and the licence
 * fields are absent rather than guessed — the about page splits on exactly
 * this, and filing an unlicensed image under the Creative Commons list would
 * be a false statement about its terms.
 */
export type PhotoCredit = {
  file: string;
  /**
   * Who the picture is actually of, when that is not simply this person —
   * a composing duo, or a fuller form of the name. Absent for the usual case.
   */
  subject?: string;

  /** Wikimedia. */
  qid?: string;
  license?: string;
  author?: string;
  source?: string;

  /** Web search. */
  provenance?: "web";
  page?: string;
  query?: string;
};

export type PhotoManifest = Record<string, PhotoCredit | null>;

/**
 * Short stamp of where a portrait came from, used to bust caches.
 *
 * Correcting a portrait usually replaces the bytes at an existing path —
 * `shankar.jpg` went from a photograph of the wrong Shankar to the right one
 * without changing its name. Nothing in the URL changed, so browsers kept
 * serving the old face indefinitely. Keying off the source means the URL moves
 * whenever the picture does.
 */
function sourceStamp(entry: PhotoCredit): string {
  const seed = entry.page || entry.source || entry.qid || entry.file;
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function portrait(name: string, manifest: PhotoManifest | null): string | null {
  const entry = manifest?.[name];
  return entry ? `/artists/${entry.file}?v=${sourceStamp(entry)}` : null;
}

/**
 * Browsable cards for one facet: every value with its song count and a cover
 * borrowed from one of its songs, so stations and artists get artwork without
 * any being stored.
 */
export function facetCards(
  catalogue: Catalogue,
  facet: string,
  limit?: number
): FacetCard[] {
  const field = FACET_FIELD[facet];
  const labels = catalogue.facets[facet as keyof Catalogue["facets"]];
  const counts = new Map<number, number>();
  const cover = new Map<number, string>();

  for (const song of catalogue.songs) {
    const indices =
      field === "f" ? (song.f === null ? [] : [song.f]) : (song[field] as number[]);
    for (const i of indices) {
      counts.set(i, (counts.get(i) ?? 0) + 1);
      if (!cover.has(i)) cover.set(i, song.v);
    }
  }

  const cards = [...counts.entries()]
    .map(([index, count]) => ({
      index,
      count,
      label: labels[index],
      video: cover.get(index)!,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return limit ? cards.slice(0, limit) : cards;
}

/**
 * Facet values whose name matches a query — the people and collections behind
 * the songs, so searching "gulzar" offers his page rather than only the tracks
 * that happen to credit him.
 *
 * Takes prebuilt cards so the per-facet scan happens once for a catalogue
 * rather than once per keystroke.
 */
export function searchFacetCards(
  cardsByFacet: Record<string, FacetCard[]>,
  query: string,
  perFacet = 4
): { facet: string; card: FacetCard }[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const results: { facet: string; card: FacetCard; rank: number }[] = [];
  for (const [facet, cards] of Object.entries(cardsByFacet)) {
    const hits = [];
    for (const card of cards) {
      const label = card.label.toLowerCase();
      const at = label.indexOf(needle);
      if (at < 0) continue;
      // A name starting with the query beats one merely containing it, and a
      // bigger collection beats a smaller one.
      hits.push({ facet, card, rank: (at === 0 ? 0 : 1) * 1e6 - card.count });
      if (hits.length >= perFacet) break;
    }
    results.push(...hits);
  }
  return results.sort((a, b) => a.rank - b.rank).map(({ facet, card }) => ({ facet, card }));
}

/** Facet values present in the current result set, ordered by frequency. */
export function facetCounts(songs: RawSong[], facet: string): Map<number, number> {
  const field = FACET_FIELD[facet];
  const counts = new Map<number, number>();
  for (const song of songs) {
    const value = song[field];
    if (field === "f") {
      if (song.f !== null) counts.set(song.f, (counts.get(song.f) ?? 0) + 1);
    } else {
      for (const i of value as number[]) counts.set(i, (counts.get(i) ?? 0) + 1);
    }
  }
  return counts;
}
