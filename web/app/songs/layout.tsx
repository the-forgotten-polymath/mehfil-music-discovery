import type { Metadata } from "next";

// The page itself is "use client" — it drives the filter panel and search
// box off client-only state — and metadata can only be exported from a
// Server Component, so it lives here instead. Title and description only:
// everything else (metadataBase, openGraph, robots…) is inherited from the
// root layout, which is how Next's metadata objects merge down the tree.
export const metadata: Metadata = {
  title: "All songs",
  description:
    "Browse every song in the Mehfil catalogue. Filter by singer, composer, " +
    "lyricist, actor, film or mood, or search by title.",
};

export default function SongsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
