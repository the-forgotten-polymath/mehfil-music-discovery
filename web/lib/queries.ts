"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Catalogue, PhotoManifest, RawSong } from "@/lib/catalogue";

export const PAGE_SIZE = 120;

/** The exported catalogue. A real network fetch, so a real query. */
export function useCatalogue() {
  return useQuery<Catalogue>({
    queryKey: ["catalogue"],
    queryFn: async () => {
      const response = await fetch("/catalogue.json");
      if (!response.ok) throw new Error(`catalogue ${response.status}`);
      return response.json();
    },
  });
}

/** Portrait manifest. Absent until the photo pipeline has run, which is fine. */
export function usePhotoManifest() {
  return useQuery<PhotoManifest>({
    queryKey: ["photos"],
    queryFn: async () => {
      const response = await fetch("/artists/manifest.json");
      return response.ok ? response.json() : {};
    },
  });
}

/** Who found or corrected a song, by song id. Empty until someone is credited. */
export type CreditManifest = Record<string, { name: string; kind: string }>;

export function useSongCredits() {
  return useQuery<CreditManifest>({
    queryKey: ["songCredits"],
    queryFn: async () => {
      const response = await fetch("/song-credits.json");
      return response.ok ? response.json() : {};
    },
    staleTime: Infinity,
  });
}

export type StationPosterManifest = Record<
  string,
  { file: string; title: string; license: string; source: string; creator: string }
>;

/** Photographic posters for the handful of stations that have a good one. */
export function useStationPosters() {
  return useQuery<StationPosterManifest>({
    queryKey: ["stationPosters"],
    queryFn: async () => {
      const response = await fetch("/stations/manifest.json");
      return response.ok ? response.json() : {};
    },
  });
}

/**
 * Progressive reveal over an already-loaded array.
 *
 * The catalogue arrives in one payload, so there is no server to paginate
 * against. This still goes through useInfiniteQuery rather than a bare
 * `useState` counter because it gives one consistent way to express "how much
 * is currently revealed", resets cleanly when the key changes, and hands the
 * virtualizer a flat list to measure. `initialPageParam`/`getNextPageParam`
 * do the paging; the queryFn just slices.
 */
export function usePagedItems<T>(items: T[], key: unknown) {
  return useInfiniteQuery({
    queryKey: ["paged", key],
    // Slicing local data needs no await, but the queryFn signature is async.
    queryFn: async ({ pageParam }: { pageParam: number }) => ({
      items: items.slice(pageParam * PAGE_SIZE, (pageParam + 1) * PAGE_SIZE),
      page: pageParam,
    }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      (last.page + 1) * PAGE_SIZE < items.length ? last.page + 1 : undefined,
    staleTime: Infinity,
    gcTime: 60_000,
  });
}

/** Flatten paged results back into one array for the virtualizer. */
export function flattenPages<T>(
  pages: { items: T[] }[] | undefined
): T[] {
  return pages?.flatMap((p) => p.items) ?? [];
}

export type PagedSongs = ReturnType<typeof usePagedItems<RawSong>>;
