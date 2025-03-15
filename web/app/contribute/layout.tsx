import type { Metadata } from "next";

// See app/songs/layout.tsx for why metadata lives in a layout rather than the
// page: ContributePage is a client component and cannot export it directly.
export const metadata: Metadata = {
  title: "Help us find these",
  description:
    "Songs in the Carvaan catalogue with no confirmed recording yet. Point us " +
    "to the right YouTube upload and we'll check it in.",
};

export default function ContributeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
