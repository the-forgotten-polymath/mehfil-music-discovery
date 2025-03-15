import type { Metadata } from "next";

// See app/songs/layout.tsx for why metadata lives in a layout rather than the
// page: AboutPage is a client component and cannot export it directly.
export const metadata: Metadata = {
  title: "About & credits",
  description:
    "What Mehfil is, what it does not own, and full credits for station " +
    "artwork and artist portraits.",
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
