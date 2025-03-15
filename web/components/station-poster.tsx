"use client";

import {
  BookOpen,
  CloudRain,
  Feather,
  Flame,
  Heart,
  MessageSquare,
  Music2,
  Music4,
  Sparkles,
  Sun,
  TrendingUp,
  Users,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { artwork, portrait, type PhotoManifest, type StationMeta } from "@/lib/catalogue";

/**
 * Posters for stations that are not named after anyone.
 *
 * Drawn rather than photographed. A stock photo for "Romance" or "Happy" is
 * always somebody's idea of the word and rarely this catalogue's, and every
 * candidate carries its own licence question. A mark on a gradient is exact,
 * costs nothing, and matches the rest of the interface.
 */
const GENERIC: Record<string, { icon: LucideIcon; from: string; to: string }> = {
  ROMANCE: { icon: Heart, from: "#7c2d4a", to: "#2a1420" },
  HAPPY: { icon: Sun, from: "#8a6416", to: "#2a2010" },
  SAD: { icon: CloudRain, from: "#2f4562", to: "#141c28" },
  BHAKTI: { icon: Flame, from: "#8a4a12", to: "#2a1808" },
  SUFI: { icon: Wind, from: "#3f5a52", to: "#16211e" },
  GHAZAL: { icon: Feather, from: "#5a3f6b", to: "#1d1524" },
  GURBANI: { icon: BookOpen, from: "#7a5a1c", to: "#251c0c" },
  "FILM INSTRUMENTAL": { icon: Music2, from: "#3d4a63", to: "#161b24" },
  "HINDUSTANI CLASSICAL (INST)": { icon: Music4, from: "#5c4326", to: "#1f170e" },
  "DUET HITS": { icon: Users, from: "#6b3a52", to: "#231421" },
  "SONGS WITH DIALOGUES": { icon: MessageSquare, from: "#44506b", to: "#171b26" },
  "TOP 300": { icon: TrendingUp, from: "#7d6320", to: "#26200c" },
};

const FALLBACK = { icon: Sparkles, from: "#4a4238", to: "#1a1613" };

/**
 * Fills its container. The card owns the frame — shape, radius, clipping — so
 * this only decides *what* is shown, never how big it is.
 */
export function StationPoster({
  name,
  meta,
  photos,
  poster,
  video,
}: {
  name: string;
  meta: StationMeta | undefined;
  photos: PhotoManifest | null;
  /** Curated photographic poster, where one exists for this station. */
  poster?: string;
  /** Song still, used only when a named person has no portrait yet. */
  video: string;
}) {
  // A photo beats a drawn tile, but only a few were worth keeping: keyword
  // search over openly-licensed images returns plenty that match the word and
  // not the meaning, so the rest were dropped rather than shipped.
  if (poster) {
    return (
      <img
        src={`/stations/${poster}`}
        alt=""
        loading="lazy"
        className="size-full object-cover"
      />
    );
  }

  // Stations named after someone show that person. Falling back to a song
  // still is a last resort — it is an arbitrary frame from one of their
  // tracks, which is what made these posters look accidental.
  if (meta?.person) {
    const face = portrait(meta.person, photos);
    return (
      <img
        src={face ?? artwork(video)}
        alt=""
        loading="lazy"
        className={`size-full object-cover ${face ? "object-top" : ""}`}
      />
    );
  }

  const design = GENERIC[name] ?? FALLBACK;
  const Icon = design.icon;

  return (
    <div
      className="relative grid size-full place-items-center"
      style={{ background: `linear-gradient(145deg, ${design.from}, ${design.to})` }}
    >
      {/* Soft highlight so the flat gradient reads as a surface, not a swatch. */}
      <div
        aria-hidden
        className="absolute -left-1/4 -top-1/4 size-3/4 rounded-full bg-white/10 blur-2xl"
      />
      <Icon className="relative size-1/3 text-white/85" strokeWidth={1.25} />
    </div>
  );
}
