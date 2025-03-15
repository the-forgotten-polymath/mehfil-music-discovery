"use client";

import { useMemo, useState } from "react";
import { VirtuosoGrid } from "react-virtuoso";
import { Play } from "lucide-react";
import {
  artwork,
  facetCards,
  portrait,
  PERSON_FACETS,
  type Catalogue,
  type FacetCard,
} from "@/lib/catalogue";
import { StationPoster } from "@/components/station-poster";
import {
  flattenPages,
  usePagedItems,
  usePhotoManifest,
  useStationPosters,
} from "@/lib/queries";

const TABS: { facet: string; label: string }[] = [
  { facet: "stations", label: "Stations" },
  { facet: "artists", label: "Singers" },
  { facet: "composer", label: "Composers" },
  { facet: "lyricist", label: "Lyricists" },
  { facet: "actor", label: "On screen" },
  { facet: "films", label: "Films" },
];

export function BrowseGrid({
  catalogue,
  scrollParent,
  onPick,
  onPlay,
}: {
  catalogue: Catalogue;
  scrollParent: HTMLElement | null;
  onPick: (facet: string, index: number) => void;
  onPlay: (facet: string, index: number) => void;
}) {
  const [tab, setTab] = useState(TABS[0]);
  const { data: photos } = usePhotoManifest();
  const { data: posters } = useStationPosters();

  const cards = useMemo(() => facetCards(catalogue, tab.facet), [catalogue, tab]);
  const paged = usePagedItems(cards, tab.facet);
  const loaded = useMemo(() => flattenPages<FacetCard>(paged.data?.pages), [paged.data]);

  const isPerson = PERSON_FACETS.has(tab.facet);
  const isStation = tab.facet === "stations";

  return (
    <div>
      {/* Negative margin lets the strip run to the container edges so the fade
          sits where the content actually gets clipped. */}
      <div className="no-scrollbar fade-x -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
        {TABS.map((t) => (
          <button
            key={t.facet}
            onClick={() => setTab(t)}
            // The selected tab was previously colour alone (bg-primary vs a
            // neutral fill) — invisible to anything that cannot see colour.
            aria-pressed={t.facet === tab.facet}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              t.facet === tab.facet
                ? "bg-primary text-primary-foreground"
                : "bg-white/[0.07] text-foreground/80 hover:bg-white/[0.12]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {scrollParent && (
        <VirtuosoGrid
          customScrollParent={scrollParent}
          data={loaded}
          // Columns come from CSS rather than measurement, so the layout stays
          // responsive without tracking container width by hand.
          // Column count keeps climbing with width rather than stopping at
          // five, so cards stay a readable size instead of stretching on a
          // wide screen. Gutters widen with them.
          listClassName="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7"
          endReached={() => {
            if (paged.hasNextPage && !paged.isFetchingNextPage) paged.fetchNextPage();
          }}
          increaseViewportBy={{ top: 0, bottom: 800 }}
          computeItemKey={(_, card) => `${tab.facet}-${card.index}`}
          itemContent={(_, card) => (
            <div
              onClick={() => onPick(tab.facet, card.index)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(tab.facet, card.index);
                }
              }}
              role="button"
              tabIndex={0}
              className="group relative aspect-square cursor-pointer overflow-hidden rounded-xl bg-white/[0.04] outline-none ring-white/10 transition hover:ring-1 focus-visible:ring-1"
            >
              {/* Image fills the card; the label sits on it rather than under
                  it, which is what makes the grid read as posters. */}
              <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.04]">
                {isStation ? (
                  <StationPoster
                    name={card.label}
                    meta={catalogue.stationMeta?.[card.label]}
                    photos={photos ?? null}
                    poster={posters?.[card.label]?.file}
                    video={card.video}
                  />
                ) : (
                  <img
                    src={
                      (isPerson && portrait(card.label, photos ?? null)) || artwork(card.video)
                    }
                    alt=""
                    loading="lazy"
                    className={`size-full object-cover ${isPerson ? "object-top" : ""}`}
                  />
                )}
              </div>

              {/* Scrim rather than a flat overlay. Explicit stops instead of
                  a two-colour gradient: near-solid under the text, then a long
                  slow ramp, so the label always has contrast without the whole
                  picture being dimmed. Bright or busy artwork is what a gentler
                  fade fails on. */}
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-4/5 bg-[linear-gradient(to_top,rgba(0,0,0,0.98)_0%,rgba(0,0,0,0.92)_18%,rgba(0,0,0,0.6)_45%,rgba(0,0,0,0.25)_72%,transparent_100%)]"
              />

              <div className="absolute inset-x-0 bottom-0 p-3">
                <div className="truncate text-sm font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
                  {card.label}
                </div>
                <div className="text-xs text-white/75 [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
                  {card.count.toLocaleString()} songs
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay(tab.facet, card.index);
                }}
                title={`Play ${card.label}`}
                aria-label={`Play ${card.label}`}
                // Bottom-right, sliding up on hover. Sitting above the label
                // rather than over the artwork's focal point, which on a
                // portrait is the face.
                className="absolute bottom-14 right-2.5 grid size-11 translate-y-2 place-items-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-xl transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100"
              >
                <Play className="size-4 translate-x-px fill-current" />
              </button>
            </div>
          )}
        />
      )}
    </div>
  );
}
