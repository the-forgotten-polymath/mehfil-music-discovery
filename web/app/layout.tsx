import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import Script from "next/script";
import { Providers } from "./providers";
import { PlayerProvider } from "@/components/player-provider";
import { OfflineNotice } from "@/components/offline-notice";
import { AppFrame } from "@/components/app-frame";
import { AppBackdrop } from "@/components/app-backdrop";
import "./globals.css";

// Figtree: a geometric sans in the same family as the faces music apps favour.
// Spotify's own Circular is proprietary, and of the free alternatives Figtree
// is the one actually drawn for interfaces — Poppins and Outfit read well large
// but get wide and loose in dense track rows.
//
// One face at several weights rather than a display/body pair: geometric sans
// carry headings on weight and tracking alone, and mixing a serif in would
// undo the look this is going for.
const figtree = Figtree({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Absolute origin for the metadata. Every share card depends on getting this
 * right: og:image is emitted as an absolute URL, so when this falls back to
 * localhost the crawler is handed an address on its own machine, fetches
 * nothing, and renders a card with no image. The card looks broken while the
 * image route it points at is perfectly healthy.
 *
 * Vercel already knows the answer, so it is read from there rather than
 * requiring a variable to be set by hand and remembered on every project:
 *
 *   NEXT_PUBLIC_SITE_URL          an explicit override, if one is ever wanted
 *   VERCEL_PROJECT_PRODUCTION_URL the project's production domain, custom
 *                                 domain included — used even on previews, so
 *                                 a shared preview link still shows the real
 *                                 card rather than a deployment-specific one
 *   VERCEL_URL                    this deployment, before a production domain
 *                                 exists
 */
function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

const SITE_URL = siteUrl();
const DESCRIPTION =
  "Browse and play golden-era Hindi film music by singer, composer, lyricist, " +
  "actor, film and mood. Over 3,000 songs across 66 stations.";

export const metadata: Metadata = {
  // Without metadataBase, Next emits relative og:image URLs, which crawlers
  // cannot resolve — the card renders with no image at all.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Mehfil — Retro Bollywood Songs",
    template: "%s · Mehfil",
  },
  description: DESCRIPTION,
  applicationName: "Mehfil",
  keywords: [
    "retro bollywood songs",
    "old hindi songs",
    "golden era hindi music",
    "Lata Mangeshkar",
    "Mohammed Rafi",
    "Kishore Kumar",
    "R.D. Burman",
    "carvaan",
  ],
  openGraph: {
    type: "website",
    siteName: "Mehfil",
    title: "Mehfil — Retro Bollywood Songs",
    description: DESCRIPTION,
    url: SITE_URL,
    locale: "en_IN",
  },
  twitter: {
    // summary_large_image gives the full-width card; plain "summary" crops to
    // a small square and wastes the artwork.
    card: "summary_large_image",
    title: "Mehfil — Retro Bollywood Songs",
    description: DESCRIPTION,
  },
  // iOS ignores the manifest's display mode and reads these instead, so
  // without them an installed app opens in a Safari chrome rather than
  // standalone. black-translucent lets the dark shell run under the status
  // bar, which is what the theme colour is for everywhere else.
  appleWebApp: {
    capable: true,
    title: "Mehfil",
    statusBarStyle: "black-translucent",
  },
  other: {
    // Next emits the standardised `mobile-web-app-capable`, which Safari does
    // not read. The Apple-prefixed name is deprecated everywhere else and is
    // still the one iOS acts on, so both are present.
    "apple-mobile-web-app-capable": "yes",
  },
  // WhatsApp, Slack and iMessage read the OpenGraph tags above; no separate
  // markup is needed for them.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Tints the browser chrome on mobile to match the shell.
  themeColor: "#1a1613",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${figtree.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-hidden">
        {/* App-wide backdrop. Fixed and behind everything, so it holds still
            while content scrolls over it.

            24%, and that is a balance rather than a maximum: the content area
            lays bg-card/40 over it, so 60% of whatever is set here ends up
            behind the song rows. At 38% the footage read well in the open
            margins but crowded the rows. */}
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
          <AppBackdrop opacity={0.24} />
          {/* Only the bottom, and gently. A gradient from the top would undo
              the opacity chosen above. */}
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background/70 to-transparent" />
        </div>
        {/* PlayerProvider sits in the layout, not a page: layouts persist
            across navigation, so the YouTube iframe — and the music — survive
            moving between browse, a station and the full song list. */}
        <Providers>
          <PlayerProvider>
            <AppFrame>{children}</AppFrame>
            <OfflineNotice />
          </PlayerProvider>
        </Providers>

        {/* Umami: visit counts, and nothing else.
            No cookies, no device or browser fingerprint, no identifier that
            survives the page — so there is no profile of anyone here and
            nothing that could be joined to a person later. It is the least a
            thing can collect and still tell you whether anyone came.

            The website id is public by design: it travels in this script tag
            on every page, so there is nothing to hide in an env var.

            The real production deployment only, and VERCEL_ENV rather than
            NODE_ENV is the distinction that matters: `next build` sets
            NODE_ENV=production for preview builds too, so gating on it would
            report every pull request and branch push into the live numbers —
            the staging traffic this gate exists to keep out. VERCEL_ENV is
            undefined off Vercel, so a local build stays quiet by the same
            rule. */}
        {process.env.VERCEL_ENV === "production" && (
          <Script
            src="https://cloud.umami.is/script.js"
            data-website-id="ff6b113d-a99d-4815-9c06-aa7fb4f6693b"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
