"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Virtuoso } from "react-virtuoso";
import { X } from "lucide-react";
import { artwork, hydrate, type Catalogue } from "@/lib/catalogue";
import { usePlayer } from "@/components/player-provider";

const UPCOMING_LIMIT = 300;

/**
 * What is playing and what follows it.
 *
 * The queue is whatever list the current route is showing, so this reflects
 * the station or filter the user is in rather than a separately managed list.
 *
 * Portalled to the body: the player bar sits inside the content column, and a
 * panel anchored there would be trapped beside the rail rather than covering
 * the window.
 */
export function QueuePanel({
  catalogue,
  open,
  onClose,
}: {
  catalogue: Catalogue;
  open: boolean;
  onClose: () => void;
}) {
  const { queue, currentId, playQueued } = usePlayer();

  const { current, upcoming } = useMemo(() => {
    const at = queue.findIndex((song) => song.id === currentId);
    return {
      current: at >= 0 ? queue[at] : null,
      // Wraps, because playback does — at the end of a station the next track
      // is the first one, and showing nothing there would misrepresent it.
      upcoming:
        at >= 0
          ? [...queue.slice(at + 1), ...queue.slice(0, at)].slice(0, UPCOMING_LIMIT)
          : queue.slice(0, UPCOMING_LIMIT),
    };
  }, [queue, currentId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[75] bg-black/60 backdrop-blur-sm"
      />

      <aside className="fixed inset-y-0 right-0 z-[76] flex w-full max-w-sm flex-col border-l border-white/10 bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">Queue</h2>
            <p className="text-xs text-muted-foreground">
              {upcoming.length.toLocaleString()} up next
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close queue"
            className="rounded-full p-2 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {current && (
          <div className="shrink-0 border-b border-white/[0.08] px-4 py-3">
            <p className="pb-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              Now playing
            </p>
            <Row song={hydrate(current, catalogue.facets)} active />
          </div>
        )}

        <div className="min-h-0 flex-1">
          {upcoming.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">Nothing queued.</p>
          ) : (
            // Virtualised: a station queue runs to several hundred rows.
            <Virtuoso
              data={upcoming}
              className="scroll-slim h-full"
              computeItemKey={(_, song) => song.id}
              itemContent={(index, song) => (
                <button
                  onClick={() => playQueued(song.id)}
                  className="flex w-full items-center gap-3 px-4 py-1.5 text-left transition hover:bg-white/[0.06]"
                >
                  <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <Row song={hydrate(song, catalogue.facets)} />
                </button>
              )}
            />
          )}
        </div>
      </aside>
    </>,
    document.body
  );
}

function Row({
  song,
  active = false,
}: {
  song: ReturnType<typeof hydrate>;
  active?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <img
        src={artwork(song.video)}
        alt=""
        loading="lazy"
        className="size-9 shrink-0 rounded object-cover"
      />
      <span className="min-w-0">
        <span
          className={`block truncate text-sm ${active ? "text-primary" : "text-foreground"}`}
        >
          {song.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {song.artists.join(", ") || "Unknown artist"}
          {song.film ? ` · ${song.film}` : ""}
        </span>
      </span>
    </span>
  );
}
