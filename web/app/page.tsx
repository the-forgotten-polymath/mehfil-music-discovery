"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Disc3 } from "lucide-react";
import { BrowseGrid } from "@/components/browse-grid";
import { CatalogueGate } from "@/components/catalogue-gate";
import { useFrame } from "@/components/app-frame";
import { usePlayer } from "@/components/player-provider";
import { artwork, filterSongs, type Catalogue } from "@/lib/catalogue";
import { collectionHref } from "@/lib/routes";
import { useCatalogue } from "@/lib/queries";

export default function BrowsePage() {
  const { data: catalogue, isLoading, isError, error } = useCatalogue();
  const { scrollEl } = useFrame();
  const router = useRouter();
  const { playFirst, playRandom } = usePlayer();

  return (
    <CatalogueGate isLoading={isLoading} isError={isError} error={error}>
      {catalogue && (
        <>
          <h2 className="pb-4 pt-1 text-2xl leading-tight">Browse</h2>

          {/* The rail carries this on desktop; below lg it is the only way to
              reach the whole catalogue from here, so it is worth more than a
              row. Real covers from the catalogue rather than an icon: the card
              is about the size of the collection, and showing some of it says
              that better than a number does. */}
          <div className="relative mb-5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] lg:hidden">
            {/* Covers bleeding in from the right, faded out before the text.
                Evenly spaced through the catalogue rather than the first few,
                which would all be the same letter of the alphabet. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 flex w-2/3 items-center justify-end gap-1 [mask-image:linear-gradient(to_left,#000_35%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_left,#000_35%,transparent_100%)]"
            >
              {[0.18, 0.42, 0.66, 0.9].map((at) => {
                const song = catalogue.songs[Math.floor(catalogue.songs.length * at)];
                return song ? (
                  <img
                    key={song.id}
                    src={artwork(song.v)}
                    alt=""
                    loading="lazy"
                    className="size-24 shrink-0 object-cover"
                  />
                ) : null;
              })}
            </span>

            {/* Warms the covers into the card instead of letting four
                unrelated thumbnails sit on it. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-r from-card via-card/85 to-transparent"
            />

            <div className="relative flex items-center gap-3 p-4">
              <Link href="/songs" className="min-w-0 flex-1">
                <span className="block text-lg leading-tight">All songs</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {catalogue.songs.length.toLocaleString()} tracks · browse, filter or search
                </span>
              </Link>

              {/* A play button that plays. It used to be an icon inside the
                  link, so it looked like the way to start listening and was
                  the way to open a list. */}
              <button
                onClick={() => playRandom(catalogue.songs)}
                title="Shuffle the whole catalogue"
                aria-label="Shuffle the whole catalogue"
                className="group/spin grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_16px_-4px_rgba(214,168,84,0.6)] transition active:scale-95"
              >
                <Disc3 className="size-5 transition-transform duration-[900ms] ease-out group-active/spin:rotate-[360deg]" />
              </button>
            </div>
          </div>

          <BrowseGrid
            catalogue={catalogue}
            scrollParent={scrollEl}
            onPick={(facet, index) =>
              router.push(
                collectionHref(
                  facet,
                  catalogue.facets[facet as keyof Catalogue["facets"]][index]
                )
              )
            }
            onPlay={(facet, index) => {
              // Start immediately and open the collection, so the play button
              // is not merely a slower route link.
              const label = catalogue.facets[facet as keyof Catalogue["facets"]][index];
              playFirst(filterSongs(catalogue, { [facet]: new Set([index]) }, ""));
              router.push(collectionHref(facet, label));
            }}
          />
        </>
      )}
    </CatalogueGate>
  );
}
