"use client";

import Link from "next/link";
import { StationPoster } from "@/components/station-poster";
import {
  artwork,
  portrait,
  searchFacetCards,
  type Catalogue,
  type FacetCard,
  type PhotoManifest,
} from "@/lib/catalogue";
import type { StationPosterManifest } from "@/lib/queries";
import { collectionHref, KIND_BY_FACET, KIND_LABEL } from "@/lib/routes";

const PERSON_FACETS = new Set(["artists", "composer", "lyricist", "actor"]);

/**
 * People and collections whose names match the search.
 *
 * Searching a name previously only reached songs crediting it, so looking up
 * an artist meant scrolling a track list instead of landing on their page.
 */
export function SearchMatches({
  catalogue,
  cardsByFacet,
  query,
  photos,
  posters,
}: {
  catalogue: Catalogue;
  cardsByFacet: Record<string, FacetCard[]>;
  query: string;
  photos: PhotoManifest | null;
  posters: StationPosterManifest | null;
}) {
  const all = searchFacetCards(cardsByFacet, query);

  /**
   * Collapse a station onto the person it is named after.
   *
   * "Manna Dey" the singer and "MANNA DEY" the station are separate rows in
   * the catalogue — one is every song crediting him, the other Saregama's
   * curation of them — but they are one person to anyone searching, and
   * offering both reads as a bug.
   *
   * The person entry wins: it is the complete set, while the station is a
   * selection from it. A station named after nobody, like Romance, is
   * untouched.
   */
  const people = new Set(
    all
      .filter(({ facet }) => PERSON_FACETS.has(facet))
      .map(({ card }) => card.label.toLowerCase())
  );

  const matches = all
    .filter(({ facet, card }) => {
      if (facet !== "stations") return true;
      const person = catalogue.stationMeta?.[card.label]?.person;
      return !person || !people.has(person.toLowerCase());
    })
    .slice(0, 8);

  if (matches.length === 0) return null;

  return (
    <section className="pb-6">
      <h3 className="pb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Artists &amp; collections
      </h3>

      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {matches.map(({ facet, card }) => {
          const isStation = facet === "stations";
          const face = PERSON_FACETS.has(facet) ? portrait(card.label, photos) : null;

          return (
            <Link
              key={`${facet}-${card.index}`}
              href={collectionHref(facet, card.label)}
              // Compact on a phone, where eight of these wrap into a wall
              // before the songs they sit above are reached. Full size from sm.
              className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] py-1 pl-1 pr-3 transition hover:border-white/20 hover:bg-white/[0.09] sm:gap-2.5 sm:py-1.5 sm:pl-1.5 sm:pr-4"
            >
              <span className="size-7 shrink-0 overflow-hidden rounded-full sm:size-9">
                {isStation ? (
                  <StationPoster
                    name={card.label}
                    meta={catalogue.stationMeta?.[card.label]}
                    photos={photos}
                    poster={posters?.[card.label]?.file}
                    video={card.video}
                  />
                ) : (
                  <img
                    src={face ?? artwork(card.video)}
                    alt=""
                    loading="lazy"
                    className={`size-full object-cover ${face ? "object-top" : ""}`}
                  />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] leading-tight sm:text-sm">
                  {card.label}
                </span>
                <span className="block text-[10px] leading-tight text-muted-foreground sm:text-[11px]">
                  {KIND_LABEL[KIND_BY_FACET[facet]] ?? "Collection"} ·{" "}
                  {card.count.toLocaleString()} songs
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
