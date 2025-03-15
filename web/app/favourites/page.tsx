"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Heart, Play, Shuffle } from "lucide-react";
import { CatalogueGate } from "@/components/catalogue-gate";
import { useFrame } from "@/components/app-frame";
import { usePlayer } from "@/components/player-provider";
import { SongList } from "@/components/song-list";
import { useFavouriteIds, useFavouritesRevision } from "@/lib/favourites";
import { useCatalogue } from "@/lib/queries";

export default function FavouritesPage() {
  const { data: catalogue, isLoading, isError, error } = useCatalogue();
  const { scrollEl } = useFrame();
  const { currentId, playing, playOrToggle, playFirst, playRandom, setQueue } = usePlayer();
  const ids = useFavouriteIds();
  const revision = useFavouritesRevision();

  // Keyed on the catalogue alone: it only changes on a fetch, whereas ids
  // changes on every like and unlike, and rebuilding a 3,900-entry Map for
  // that would be work with nothing to show for it.
  const byId = useMemo(() => {
    if (!catalogue) return null;
    return new Map(catalogue.songs.map((song) => [song.id, song]));
  }, [catalogue]);

  const results = useMemo(() => {
    if (!byId) return [];
    // Newest first, and ids missing from the catalogue are skipped rather than
    // removed from storage: a failed catalogue fetch would otherwise look
    // exactly like every song having been deleted.
    return ids
      .map((id) => byId.get(id))
      .filter((song): song is NonNullable<typeof song> => Boolean(song))
      .reverse();
  }, [byId, ids]);

  // Only when there is something to play. An empty list would replace a queue
  // that is currently playing with nothing, and the player has no way back
  // from that — Next, Previous and auto-advance all stop for the session.
  // Someone landing on an empty /favourites has almost certainly got music
  // going from somewhere else, and it should keep going.
  useEffect(() => {
    if (results.length > 0) setQueue(results);
  }, [results, setQueue]);

  return (
    <CatalogueGate isLoading={isLoading} isError={isError} error={error}>
      {catalogue && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3 pb-4">
            <div className="min-w-0">
              <h2 className="truncate pt-1 text-2xl leading-tight">Your favourites</h2>
              <p className="text-xs text-muted-foreground">
                {results.length.toLocaleString()}{" "}
                {results.length === 1 ? "song" : "songs"} · kept on this device
              </p>
            </div>
            {results.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => playRandom(results)}
                  title="Shuffle"
                  aria-label="Shuffle favourites"
                  className="grid size-10 place-items-center rounded-full border border-white/15 transition hover:bg-white/10"
                >
                  <Shuffle className="size-4" />
                </button>
                <button
                  onClick={() => playFirst(results)}
                  title="Play"
                  aria-label="Play favourites"
                  className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105"
                >
                  <Play className="size-5 translate-x-px fill-current" />
                </button>
              </div>
            )}
          </div>

          {results.length === 0 ? (
            <div className="py-20 text-center">
              <Heart className="mx-auto size-8 text-muted-foreground/40" />
              <p className="mt-4 text-sm text-muted-foreground">
                Nothing here yet. Tap the heart beside any song and it will be
                waiting for you.
              </p>
              <Link
                href="/songs"
                className="mt-4 inline-block rounded-full border border-white/15 px-4 py-2 text-xs transition hover:bg-white/10"
              >
                Browse all songs
              </Link>
            </div>
          ) : (
            <SongList
              catalogue={catalogue}
              songs={results}
              filterKey={`favourites:${revision}`}
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
