import type { Metadata } from "next";

// See app/songs/layout.tsx for why metadata lives in a layout rather than the
// page: ThemesPage is a client component and cannot export it directly.
export const metadata: Metadata = {
  title: "Themes",
  description:
    "Pick a moving backdrop for Mehfil. Applies immediately and is kept on " +
    "this device.",
};

export default function ThemesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
