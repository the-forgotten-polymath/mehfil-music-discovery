/**
 * Mapping between facets and collection URLs.
 *
 * `/station/lata-mangeshkar` rather than `/?s=27`: an index is tied to one
 * export and would silently point at a different artist after a rebuild, so
 * the slug is derived from the label and resolved back by comparison.
 */

export const FACET_BY_KIND: Record<string, string> = {
  station: "stations",
  singer: "artists",
  composer: "composer",
  lyricist: "lyricist",
  actor: "actor",
  film: "films",
  mood: "moods",
};

export const KIND_BY_FACET: Record<string, string> = Object.fromEntries(
  Object.entries(FACET_BY_KIND).map(([kind, facet]) => [facet, kind])
);

/** Human-readable name for each kind, shown above a collection title. */
export const KIND_LABEL: Record<string, string> = {
  station: "Station",
  singer: "Singer",
  composer: "Composer",
  lyricist: "Lyricist",
  actor: "On screen",
  film: "Film",
  mood: "Mood",
};

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function collectionHref(facet: string, label: string): string {
  const kind = KIND_BY_FACET[facet];
  return kind ? `/${kind}/${slugify(label)}` : "/songs";
}

/**
 * Find the facet value a slug refers to.
 *
 * Slugs are lossy — "R.D. Burman" and "R D Burman" collapse to the same string
 * — so this returns the first label that matches, which is stable for as long
 * as the catalogue does not gain a genuine collision.
 */
export function resolveSlug(labels: string[], slug: string): number {
  return labels.findIndex((label) => slugify(label) === slug);
}
