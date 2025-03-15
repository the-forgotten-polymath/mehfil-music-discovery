import type { MetadataRoute } from "next";

/**
 * PWA manifest. Replaces the generator's placeholder ("MyWebSite", white
 * theme), which would have shown the wrong name on an installed icon and
 * flashed a white splash before the dark UI painted.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mehfil — Retro Bollywood Songs",
    short_name: "Mehfil",
    description:
      "Browse and play golden-era Hindi film music by singer, composer, lyricist, film and mood.",
    start_url: "/",
    // Everything is under the origin root. Stated rather than left to default,
    // so a link outside it opens in the browser instead of silently inside the
    // installed app with no way back.
    scope: "/",
    display: "standalone",
    // Matched to the app shell so the splash screen does not flash white.
    background_color: "#1a1613",
    theme_color: "#1a1613",
    // Phones stay upright. The layout is built for a tall narrow window and
    // there is nothing a 400px-tall one can show well; tilting produced a
    // wider, shorter version of a design that needed the height. Honoured by
    // installed apps only — a browser tab still rotates, which is why the
    // breakpoints in globals.css carry a height condition as well.
    orientation: "portrait",
    categories: ["music", "entertainment"],
    icons: [
      // "any" and "maskable" are listed separately: Android crops maskable
      // icons to its own shape, which would cut into the badge's border if it
      // were the only entry.
      {
        src: "/web-app-manifest-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
