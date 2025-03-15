"use client";

import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { TrackRow } from "@/components/track-row";
import { hydrate, type Catalogue, type RawSong } from "@/lib/catalogue";
import { flattenPages, usePagedItems } from "@/lib/queries";

export function SongList({
  catalogue,
  songs,
  filterKey,
  currentId,
  playing,
  scrollParent,
  onPlay,
}: {
  catalogue: Catalogue;
  songs: RawSong[];
  filterKey: string;
  currentId: number | null;
  playing: boolean;
  scrollParent: HTMLElement | null;
  onPlay: (id: number) => void;
}) {
  const paged = usePagedItems(songs, filterKey);
  const loaded = useMemo(() => flattenPages<RawSong>(paged.data?.pages), [paged.data]);

  // Virtuoso measures against the page's own scroll container, so the list
  // stays part of the normal document flow rather than owning a scrollbar.
  if (!scrollParent || songs.length === 0) return null;

  return (
    <Virtuoso
      customScrollParent={scrollParent}
      data={loaded}
      // Fired as the end of the loaded range comes into view. This is what
      // replaces the load-more button: scrolling is the only trigger.
      endReached={() => {
        if (paged.hasNextPage && !paged.isFetchingNextPage) paged.fetchNextPage();
      }}
      // Start pulling slightly before the true end so the next page is ready
      // by the time it is needed.
      increaseViewportBy={{ top: 0, bottom: 600 }}
      computeItemKey={(_, song) => song.id}
      itemContent={(index, raw) => {
        const song = hydrate(raw, catalogue.facets);
        return (
          <TrackRow
            song={song}
            index={index}
            active={song.id === currentId}
            playing={playing}
            onPlay={() => onPlay(song.id)}
          />
        );
      }}
    />
  );
}
