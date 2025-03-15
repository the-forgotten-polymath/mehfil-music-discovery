"use client";

import { backdropSrc, NO_BACKDROP, useBackdrop } from "@/lib/backdrops";

/**
 * The moving backdrop, wherever it appears.
 *
 * A client component because the choice lives in the browser, which is why this
 * is no longer inline in the layout. One definition serves the app frame and
 * the expanded player: they differ only in opacity, and two copies would drift
 * the moment either was touched.
 *
 * Video rather than the GIF each came from: a GIF decodes on the CPU and
 * re-decodes every loop, which is the wrong thing to spend while a YouTube
 * player is already running. The still beside it is both the poster and what
 * anyone who has asked for reduced motion gets instead.
 *
 * `key` on the video is deliberate. Changing a <source> element's src does not
 * reload a video — the browser has already committed to the loaded one — so
 * switching themes without remounting would leave the old footage playing under
 * a new name.
 *
 * Positioning belongs to the caller; this fills whatever box it is given.
 */
export function AppBackdrop({ opacity }: { opacity: number }) {
  const id = useBackdrop();
  if (id === NO_BACKDROP) return null;

  const { video, poster } = backdropSrc(id);

  return (
    <>
      <video
        key={id}
        autoPlay
        muted
        loop
        playsInline
        poster={poster}
        // Fades in rather than appearing. The server renders no backdrop, so
        // there is always a moment before this arrives; easing it in reads as
        // intentional where a pop reads as a glitch.
        className="absolute inset-0 size-full animate-[fade-in_700ms_ease-out_both] object-cover motion-reduce:hidden"
        style={{ opacity }}
      >
        <source src={video} type="video/mp4" />
      </video>
      <img
        src={poster}
        alt=""
        className="absolute inset-0 hidden size-full object-cover motion-reduce:block"
        style={{ opacity }}
      />
      {/* Warm wash, so the backdrop belongs to the brass palette rather than
          merely sitting under it. */}
      <div className="absolute inset-0 bg-[oklch(0.79_0.135_78)]/[0.07]" />
    </>
  );
}
