import type { Metadata } from "next";
import { CuriousTabs } from "@/components/curious-tabs";

export const metadata: Metadata = {
  title: "For the curious",
  description:
    "How Mehfil is built — the design system it draws from, and the " +
    "architecture behind a music player with no backend.",
};

export default function CuriousLayout({ children }: { children: React.ReactNode }) {
  // The same reading column as /about, /themes and /releases: this is a page
  // to be read, not browsed.
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <CuriousTabs />
      {children}
    </div>
  );
}
