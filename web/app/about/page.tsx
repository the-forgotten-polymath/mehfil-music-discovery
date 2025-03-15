"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { usePhotoManifest, useStationPosters } from "@/lib/queries";

/**
 * What this is, what it does not own, and who made the images.
 *
 * The credits are generated from the same manifests the app renders from, so
 * they cannot drift out of step with what is actually being shown — which is
 * the usual failure of a hand-written attribution page.
 */
export default function AboutPage() {
  const { data: photos } = usePhotoManifest();
  const { data: posters } = useStationPosters();

  const allPortraits = Object.entries(photos ?? {})
    .filter(([, value]) => value)
    .map(([name, value]) => ({ name, ...value! }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Split by source. Only the Wikimedia set has a licence to state; listing the
  // rest alongside them would attach terms to images that do not carry them.
  const portraitCredits = allPortraits.filter((p) => p.provenance !== "web");
  const webPortraits = allPortraits.filter((p) => p.provenance === "web");

  const posterCredits = Object.entries(posters ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return (
    <div className="relative mx-auto max-w-3xl">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] py-1.5 pl-2 pr-3 text-xs text-foreground/80 transition hover:bg-white/[0.12]"
      >
        <ArrowLeft className="size-3.5" />
        Back
      </Link>

      <h1 className="text-3xl">About Mehfil</h1>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">
        A personal project for browsing golden-era Hindi film music by singer,
        composer, lyricist, film and mood. It is a way to navigate a catalogue —
        not a music service.
      </p>

      <Section title="What this does not own">
        <p>
          <strong className="text-foreground">No music is hosted here.</strong>{" "}
          Nothing is uploaded, stored, or served by this site. Every track plays
          through YouTube&apos;s official embedded player, from videos published on
          YouTube by their respective rights holders. Playback, advertising and
          view counts all remain with YouTube.
        </p>
        <p>
          Song titles, film names and performer credits are factual catalogue
          information, compiled from a songlist published publicly by Saregama.
          Recordings, compositions and lyrics remain the property of their
          respective owners.
        </p>
        <p>
          This project is <strong className="text-foreground">not affiliated
          with, endorsed by, or connected to</strong> Saregama India Ltd.,
          YouTube, or any label, artist or estate. Product and company names are
          the trademarks of their respective owners.
        </p>
      </Section>

      <Section title="Images">
        <p>
          Song artwork is shown using YouTube&apos;s own video thumbnails. Station
          artwork comes from Openverse and most artist portraits from Wikimedia
          Commons, each under an open licence and credited in full below.
        </p>
        <p>
          Where neither source held a photograph, the portrait was found through
          a general web search and is shown here for identification only. Those
          images are <strong className="text-foreground">not openly licensed</strong>,
          are listed separately below with a link to where each was found, and
          remain the property of their photographers.
        </p>
        <p>
          The backdrops offered under Themes are illustrated loops, re-encoded
          and warmed to sit with the rest of the palette. We have not been able
          to identify who made them. They are used decoratively, at low
          opacity, and for nothing else. If you made one, or hold the rights to
          one, tell us and we will credit it or take it down — whichever you
          would prefer.
        </p>
        <p>
          Decorative artwork elsewhere in the interface may include film poster
          imagery reproduced at low fidelity for illustrative purposes. Any image
          here is removed on request, without argument.
        </p>
      </Section>

      <Section title="Requests and corrections">
        <p>
          If you own rights to something shown here and would like it removed, or
          you have spotted a credit that is wrong, please get in touch at{" "}
          <a
            href="https://shashwa7.in"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            shashwa7.in
          </a>
          . Requests are honoured promptly and without argument.
        </p>
      </Section>

      {posterCredits.length > 0 && (
        <Section title="Station artwork">
          <ul className="space-y-2.5">
            {posterCredits.map(([station, credit]) => (
              <li key={station} className="text-xs leading-6">
                <span className="text-foreground">{station}</span> —{" "}
                {credit.title || "Untitled"}
                {credit.creator ? ` by ${credit.creator}` : ""} ·{" "}
                <span className="uppercase">{credit.license}</span>
                {credit.source && (
                  <a
                    href={credit.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Source for ${station} artwork`}
                    className="ml-1 inline-flex text-primary hover:underline"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {portraitCredits.length > 0 && (
        <Section title={`Portraits (${portraitCredits.length})`}>
          <p className="text-xs">
            From Wikimedia Commons. Licences shown per image; several require
            attribution, given here.
          </p>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {portraitCredits.map((credit) => (
              <li key={credit.name} className="text-xs leading-6">
                <span className="text-foreground">{credit.name}</span>
                {/* Duos are one entry per member in the catalogue but share a
                    single portrait, so the credit names what it really shows. */}
                {credit.subject && (
                  <span className="text-muted-foreground/70">
                    {" "}
                    (pictured: {credit.subject})
                  </span>
                )}{" "}
                · {credit.license}
                {credit.author ? ` · ${credit.author}` : ""}
                {credit.source && (
                  <a
                    href={credit.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Source for ${credit.name} portrait`}
                    className="ml-1 inline-flex text-primary hover:underline"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {webPortraits.length > 0 && (
        <Section title={`Portraits found by search (${webPortraits.length})`}>
          <p className="text-xs">
            No open-licence photograph was available for these. Each links to
            the page it was found on. Shown for identification only; rights stay
            with the photographer, and any of them comes down on request.
          </p>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {webPortraits.map((credit) => (
              <li key={credit.name} className="text-xs leading-6">
                <span className="text-foreground">{credit.name}</span>
                {credit.subject && (
                  <span className="text-muted-foreground/70">
                    {" "}
                    (pictured: {credit.subject})
                  </span>
                )}
                {credit.page && (
                  <a
                    href={credit.page}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Where the ${credit.name} portrait was found`}
                    className="ml-1 inline-flex text-primary hover:underline"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="mt-14 border-t border-white/[0.06] pt-6 text-xs text-muted-foreground">
        Made with <span className="text-primary">♥</span> by{" "}
        <a
          href="https://shashwa7.in"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          shashwa7.in
        </a>
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-lg tracking-tight">{title}</h2>
      <div className="mt-3 space-y-4 text-sm leading-7 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
