"use client";

import Link from "next/link";
import { ArrowLeft, Play, Shuffle } from "lucide-react";
import { StationPoster } from "@/components/station-poster";
import { artwork, portrait, type Catalogue, type PhotoManifest } from "@/lib/catalogue";
import type { StationPosterManifest } from "@/lib/queries";
import { KIND_LABEL } from "@/lib/routes";

const PERSON_KINDS = new Set(["singer", "composer", "lyricist", "actor"]);

/**
 * Header for a single collection.
 *
 * Back is a real link rather than a history call: on a route the previous page
 * may not be Browse at all — arriving from a shared link means there is no
 * history to go back to — so it points somewhere that always exists.
 */
export function CollectionHeader({
  kind,
  label,
  facet,
  catalogue,
  photos,
  posters,
  songCount,
  sampleVideo,
  onPlay,
  onShuffle,
}: {
  kind: string;
  label: string;
  facet: string;
  catalogue: Catalogue;
  photos: PhotoManifest | null;
  posters: StationPosterManifest | null;
  songCount: number;
  /** Any song in the collection, for artwork of last resort. */
  sampleVideo: string;
  onPlay: () => void;
  onShuffle: () => void;
}) {
  const isStation = kind === "station";
  const face = PERSON_KINDS.has(kind) ? portrait(label, photos) : null;
  const cover = face ?? (sampleVideo ? artwork(sampleVideo, "hq") : "/logo.png");

  return (
    <div className="mb-6 pb-2">
      <Link
        href="/"
        className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] py-1.5 pl-2 pr-3 text-xs text-foreground/80 transition hover:border-white/20 hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Browse
      </Link>

      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
        <div className="size-36 shrink-0 overflow-hidden rounded-xl shadow-2xl sm:size-44">
          {isStation ? (
            <StationPoster
              name={label}
              meta={catalogue.stationMeta?.[label]}
              photos={photos}
              poster={posters?.[label]?.file}
              video={sampleVideo}
            />
          ) : (
            <img
              src={cover}
              alt=""
              className={`size-full object-cover ${face ? "object-top" : ""}`}
            />
          )}
        </div>

        <div className="min-w-0 flex-1 pb-1">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {KIND_LABEL[kind] ?? "Collection"}
          </p>
          {/* Long names must not push the header taller than the artwork. */}
          <h2 className="mt-1 line-clamp-2 text-3xl leading-tight sm:text-4xl">{label}</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {songCount.toLocaleString()} {songCount === 1 ? "song" : "songs"}
          </p>

          {songCount > 0 && (
            <div className="mt-4 flex items-center justify-center gap-2 sm:justify-start">
              <button
                onClick={onPlay}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <Play className="size-4 fill-current" />
                Play
              </button>
              <button
                onClick={onShuffle}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium transition hover:bg-white/10"
              >
                <Shuffle className="size-4" />
                Shuffle
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
