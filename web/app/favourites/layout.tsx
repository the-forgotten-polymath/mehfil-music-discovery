import type { Metadata } from "next";

// See app/songs/layout.tsx for why metadata lives in a layout rather than the
// page: FavouritesPage is a client component and cannot export it directly.
export const metadata: Metadata = {
  title: "Your favourites",
  description:
    "The songs you've liked on Mehfil, kept on this device and ready to play " +
    "or shuffle.",
};

export default function FavouritesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
