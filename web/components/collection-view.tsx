"use client";

import { useEffect, useMemo } from "react";
import { notFound } from "next/navigation";
import { CatalogueGate } from "@/components/catalogue-gate";
import { useFrame } from "@/components/app-frame";
import { CollectionHeader } from "@/components/collection-header";
import { usePlayer } from "@/components/player-provider";
import { SongList } from "@/components/song-list";
import { track } from "@/lib/analytics";
import { filterSongs, type Catalogue } from "@/lib/catalogue";
import { useCatalogue, usePhotoManifest, useStationPosters } from "@/lib/queries";
import { FACET_BY_KIND, resolveSlug } from "@/lib/routes";

/**
 * One route for every collection — station, singer, composer, lyricist,
 * actor, film. Six near-identical route files would drift; the kind is just
 * another parameter.
 */
export function CollectionView({ kind, slug }: { kind: string; slug: string }) {
  const { data: catalogue, isLoading, isError, error } = useCatalogue();
  const { data: photos } = usePhotoManifest();
  const { data: posters } = useStationPosters();
  const { scrollEl } = useFrame();
  const { currentId, playing, playOrToggle, playFirst, playRandom, setQueue } = usePlayer();

  const facet = FACET_BY_KIND[kind];

  const resolved = useMemo(() => {
    if (!catalogue || !facet) return null;
    const labels = catalogue.facets[facet as keyof Catalogue["facets"]];
    if (!labels) return null;
    const index = resolveSlug(labels, slug);
    return index < 0 ? null : { index, label: labels[index] };
  }, [catalogue, facet, slug]);

  const results = useMemo(() => {
    if (!catalogue || !resolved) return [];
    return filterSongs(catalogue, { [facet]: new Set([resolved.index]) }, "");
  }, [catalogue, facet, resolved]);

  useEffect(() => setQueue(results), [results, setQueue]);

  useEffect(() => {
    scrollEl?.scrollTo({ top: 0 });
  }, [slug, scrollEl]);

  // The kind, not the slug: that a singer was opened is worth knowing, which
  // singer is nobody's business but the listener's.
  useEffect(() => {
    if (kind) track("collection", { kind });
  }, [kind, slug]);

  // An unknown kind is a bad URL; an unknown slug only after the catalogue has
  // loaded, since before that we simply cannot tell.
  if (!facet) notFound();
  if (catalogue && !resolved) notFound();

  return (
    <CatalogueGate isLoading={isLoading} isError={isError} error={error}>
      {catalogue && resolved && (
        <>
          <CollectionHeader
            kind={kind}
            label={resolved.label}
            facet={facet}
            catalogue={catalogue}
            photos={photos ?? null}
            posters={posters ?? null}
            songCount={results.length}
            sampleVideo={results[0]?.v ?? ""}
            onPlay={() => playFirst(results)}
            onShuffle={() => playRandom(results)}
          />

          {results.length === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              Nothing playable here yet.
            </p>
          ) : (
            <SongList
              catalogue={catalogue}
              songs={results}
              filterKey={`${kind}/${slug}`}
              currentId={currentId}
              playing={playing}
              scrollParent={scrollEl}
              onPlay={playOrToggle}
            />
          )}
        </>
      )}
    </CatalogueGate>
  );
}
