"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Virtuoso } from "react-virtuoso";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";
import { ReportDialog } from "@/components/report-dialog";
import { useFrame } from "@/components/app-frame";
import { flattenPages, usePagedItems } from "@/lib/queries";

type MissingSong = {
  id: number;
  t: string;
  f: string;
  a: string[];
  s: string[];
};

/**
 * The songs the resolver could not place, and a way to hand us the link.
 *
 * These are not absences in the catalogue — every one is a real entry from the
 * songlist. The resolver simply never found an upload that named the song, ran
 * a plausible length and would embed. Some genuinely are not on YouTube; most
 * are just phrased in a way no automatic query reaches, and somebody who knows
 * the song finds it immediately.
 *
 * The whole list is browsable, paged in as it is scrolled. Truncating it would
 * hide the long tail, which is exactly the part nobody has looked at.
 */
export default function ContributePage() {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<MissingSong | null>(null);
  const { scrollEl } = useFrame();

  const { data, isLoading } = useQuery<{ songs: MissingSong[] }>({
    queryKey: ["missing"],
    queryFn: async () => {
      const response = await fetch("/missing-songs.json");
      return response.ok ? response.json() : { songs: [] };
    },
  });

  const songs = useMemo(() => data?.songs ?? [], [data]);
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return songs;
    return songs.filter(
      (song) =>
        song.t.toLowerCase().includes(needle) ||
        song.f.toLowerCase().includes(needle) ||
        song.a.some((name) => name.toLowerCase().includes(needle))
    );
  }, [songs, query]);

  // Keyed on the query so a new search starts from the first page rather than
  // wherever the previous one had been scrolled to — and on the list's length,
  // which is what makes it correct. usePagedItems caches with staleTime
  // Infinity over an array its queryFn closes over, so a key that does not
  // change when the array does keeps serving the first slice it ever computed.
  // Here the first render happens before the fetch resolves, so that slice was
  // of an empty list: the page stayed blank until a keystroke changed the key.
  const paged = usePagedItems(matching, `missing:${query}:${matching.length}`);
  const loaded = useMemo(
    () => flattenPages<MissingSong>(paged.data?.pages),
    [paged.data]
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] py-1.5 pl-2 pr-3 text-xs text-foreground/80 transition hover:bg-white/[0.12]"
      >
        <ArrowLeft className="size-3.5" />
        Back
      </Link>

      <h1 className="text-3xl">Help us find these</h1>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">
        {songs.length
          ? `${songs.length.toLocaleString()} songs in the catalogue have no recording we could confirm.`
          : "Some songs in the catalogue have no recording we could confirm."}{" "}
        Every one is a real entry from the Carvaan songlist. We simply could not
        find an upload that was definitely the right recording. If you know one,
        paste the link and we will check it against the catalogue.
      </p>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">
        Heard something playing the <em>wrong</em> recording instead? There is a
        flag beside the player for that. It is the more useful report of the two,
        because nothing automatic can tell a plausible match from a correct one.
      </p>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">
        Leave your name if you would like to be credited on the song. Blank is
        fine too.
      </p>

      <div className="relative mt-8">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the missing songs by title, film or singer…"
          className="h-11 w-full rounded-full border border-white/10 bg-white/[0.07] pl-10 pr-4 text-sm outline-none transition placeholder:text-muted-foreground/70 hover:border-white/20 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
        />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        {isLoading
          ? "Loading…"
          : query
            ? `${matching.length.toLocaleString()} matching`
            : `${songs.length.toLocaleString()} songs, oldest catalogue entries first`}
      </p>

      {!isLoading && !matching.length && (
        <p className="mt-8 text-sm text-muted-foreground">
          Nothing matching “{query}”. It may already be in the catalogue.
        </p>
      )}

      {/* Measured against the page's own scroll container, so the list stays in
          the document flow instead of owning a second scrollbar. */}
      {scrollEl && matching.length > 0 && (
        <Virtuoso
          customScrollParent={scrollEl}
          data={loaded}
          endReached={() => {
            if (paged.hasNextPage && !paged.isFetchingNextPage) {
              paged.fetchNextPage();
            }
          }}
          computeItemKey={(_, song) => song.id}
          itemContent={(_, song) => (
            <div className="flex items-center gap-3 border-b border-white/[0.06] py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{song.t}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[song.f, song.a.join(", ")].filter(Boolean).join(" · ")}
                </span>
              </span>
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                  `${song.t} ${song.f} ${song.a[0] ?? ""}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Search YouTube for this song"
                aria-label={`Search YouTube for “${song.t}”`}
                className="shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
              >
                <ExternalLink className="size-4" />
              </a>
              <button
                onClick={() => setChosen(song)}
                className="shrink-0 rounded-full border border-primary/30 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/25"
              >
                I have a link
              </button>
            </div>
          )}
        />
      )}

      {chosen && (
        <ReportDialog
          kind="missing-song"
          songId={chosen.id}
          songTitle={chosen.t}
          songFilm={chosen.f}
          onClose={() => setChosen(null)}
        />
      )}
    </div>
  );
}
