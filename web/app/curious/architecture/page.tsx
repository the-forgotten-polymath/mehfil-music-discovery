import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { Code, Key, Panel } from "@/components/curious-bits";
import { EVENTS } from "@/lib/analytics";

export const metadata: Metadata = {
  title: "Architecture",
  description:
    "How Mehfil works — a music player with no backend, a catalogue built by " +
    "a Python pipeline, and playback borrowed from YouTube.",
};

const REPO = "https://github.com/shashwa7-dev/mehfil";

/**
 * How the thing is put together, for anyone who wants to know.
 *
 * Numbers here are read from the repository rather than remembered: the song
 * and facet counts from the exported catalogue, the file sizes from disk, the
 * versions from package.json. If they drift, they were true once and the fix
 * is to re-read them, not to soften them into "thousands of songs".
 */
export default function ArchitecturePage() {
  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-3xl leading-tight">Architecture</h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Mehfil has no backend, no database at runtime, and no accounts. It is <Key>a static site that reads one JSON file</Key> and borrows
          YouTube&apos;s player for the sound. Almost every interesting decision here follows
          from that one, and most of the work happens long before anyone visits.
        </p>
      </header>

      <Section title="What ships">
        <Facts
          rows={[
            ["Catalogue", "3,916 songs in a single 632 KB JSON file"],
            ["Facets", "415 singers, 1,379 films, 66 stations, 23 composers, 12 lyricists, 12 moods"],
            ["Framework", "Next.js 16 App Router, React 19, Tailwind v4"],
            ["Server code", "One route — /api/feedback — and nothing else"],
            ["Storage", "Four localStorage keys, no cookies. Seven anonymous counts via Umami — the list is below"],
          ]}
        />
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
          The catalogue is fetched once and cached forever by TanStack Query,
          because it only changes when the pipeline re-exports. Song lists are
          virtualised with react-virtuoso — 3,916 rows is more than a browser
          will draw without complaint.
        </p>
      </Section>

      <Section title="The player lives above the pages">
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Playback is a YouTube iframe, and <Key>an iframe cannot survive being unmounted</Key>. So the player sits in the root layout rather than in any
          page: layouts persist across navigation, pages do not. Moving from a
          station to a singer to the full song list never interrupts the music,
          and that single constraint shapes most of the component tree — the
          bar is rendered by the layout and handed down, not owned by a route.
        </p>
        <Code caption="app/layout.tsx — the player is a sibling of every page, never a child of one">
{`<Providers>            // react-query
  <PlayerProvider>      // owns the YouTube iframe + the queue
    <AppFrame>
      {children}        // ← only this remounts on navigation
    </AppFrame>
  </PlayerProvider>
</Providers>`}
        </Code>

        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          The same reasoning puts the expanded view in a portal on the body.
          A backdrop-blurred footer becomes a containing block for anything
          fixed inside it, so a &ldquo;full screen&rdquo; overlay would have
          resolved against the bar and hung off the bottom of it.
        </p>
      </Section>

      <Section title="The pipeline is where the real work is">
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          <Key>Twenty-four Python scripts</Key> turn a printed songlist into
          something playable. The catalogue starts as the official Carvaan Gold PDF,
          which is a three-column layout that naive extraction bleeds between —
          so it is parsed from word coordinates and sliced into columns by
          x-position before lines are reconstructed at all.
        </p>
        <ol className="mt-4 space-y-2">
          {[
            ["Parse", "The PDF becomes structured records: title, film, credits, and the station each entry sits under."],
            ["Load", "Records go into SQLite — 12.8 MB, committed, so every stage is resumable and nothing is re-fetched."],
            ["Resolve", "Each song is matched to a YouTube video from community data, harvested channel listings, and per-song search, cheapest source first."],
            ["Verify", "Every match is checked for whether it actually embeds. A song that looks resolved and plays nothing is worse than one that is missing."],
            ["Export", "The playable subset becomes the JSON the app reads. Nothing else about the database ever reaches a browser."],
          ].map(([step, body], index) => (
            <li key={step} className="flex gap-3 rounded-lg border border-white/[0.07] bg-card/40 p-4">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.06] font-mono text-xs text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm">{step}</span>
                <span className="mt-1 block max-w-prose text-sm leading-relaxed text-muted-foreground">
                  {body}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <Code caption="the shape of it — the full sequence, including three more resolvers and the portrait pass, is in the README">
{`pdftotext -bbox-layout songlist.pdf full.xml
python3 pipeline/parse_songlist.py    full.xml data/songs.json
# load into SQLite: store.ingest_catalogue(conn, songs, stations)
python3 pipeline/import_labnol.py     <dir> data/carvaan.db   # community
python3 pipeline/harvest_youtube.py   data/carvaan.db         # channels
python3 pipeline/match_videos.py      data/carvaan.db
python3 pipeline/search_youtube.py    data/carvaan.db         # per song
python3 pipeline/verify_embeddable.py data/carvaan.db
python3 pipeline/export_catalogue.py  data/carvaan.db \\
                                      web/public/catalogue.json
python3 pipeline/check_ids.py         # refuses to ship a drifted catalogue`}
        </Code>

        <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Song ids come from a committed ledger and are <Key>append-only</Key>. They used
          to be positions in an alphabetical list, which meant adding one song
          renumbered nearly all of them — and since videos are stored against
          those ids, the next rebuild would have handed almost every song the
          previous song&apos;s recording. Silently. A check now refuses to load
          or publish a catalogue whose ids disagree with the ledger.
        </p>
        <Code caption="pipeline/songids.py — an id is now a name tag, not a line number">
{`# before — the id was wherever the song happened to sort
for song_id, song in enumerate(sorted(catalogue), start=1):
    song["id"] = song_id

# after — the id is whatever it has always been
for song in catalogue:
    key = song_key(song["title"], song["film"])
    if key not in ledger:
        ledger[key] = next_id      # a genuinely new song
        next_id += 1
    song["id"] = ledger[key]       # everyone else keeps theirs`}
        </Code>
      </Section>

      <Section title="What the one server route is for">
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Reporting a wrong recording, or sending a link for a missing song,
          posts to <code className="font-mono text-xs">/api/feedback</code>,
          which forwards to a Google Apps Script that appends a row to a sheet.
          It exists so <Key>the webhook URL stays on the server</Key> — in the browser it
          would be a public write endpoint for anyone who opened dev tools.
        </p>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          <Key>It refuses to say a report was saved unless the sheet confirms it.</Key>
          Apps Script answers with HTTP 200 even when its own handler has
          thrown, reporting the failure in the body, so trusting the status code
          told people their report was recorded when nothing had been written.
        </p>
        <Code caption="app/api/feedback/route.ts — the body is the answer, not the status">
{`const response = await fetch(WEBHOOK, { method: "POST", … });

// 200 is not the same as "a row exists"
const replied = await response.text();
const acknowledged = JSON.parse(replied)?.ok === true;

if (!acknowledged) return error(502);   // say so, do not pretend`}
        </Code>
      </Section>

      <Section title="Offline, and staying current">
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          A service worker makes the app installable and keeps the shell usable
          without a connection. It is network-first for everything except
          fingerprinted build assets, so a deploy is picked up on the next load
          rather than whenever a cache happens to expire. It is registered at a
          URL carrying the build id, because a worker is only replaced when its
          own bytes change — and a static worker file meant installed apps sat
          on a complete, working, months-old build.
        </p>
      </Section>

      <Section title="What is counted">
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Seven events, and this list is not a description of them — it{" "}
          <Key>is</Key> them. The same array renders this table and gates what
          the tracker will send, so an event that is not written here cannot
          fire, and one that fires cannot go undescribed.
        </p>
        <dl className="mt-4 divide-y divide-white/[0.06] rounded-lg border border-white/[0.07] bg-card/40">
          {Object.entries(EVENTS).map(([name, meaning]) => (
            <div key={name} className="flex flex-col gap-1 p-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 font-mono text-xs text-foreground sm:w-28 sm:pt-0.5">
                {name}
              </dt>
              <dd className="min-w-0 text-sm leading-relaxed text-muted-foreground">
                {meaning}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Everything sent is a count or a value from a fixed set — a theme name,
          a collection kind, &ldquo;liked&rdquo; or &ldquo;unliked&rdquo;.{" "}
          <Key>Nothing free-typed ever leaves the browser</Key>: searching is
          counted, what was typed into the box is not. There is no user id, no
          session id and no device fingerprint, so two plays by one person and
          two plays by two people are the same thing here.
        </p>
      </Section>

      <Section title="What it does not do">
        <Panel className="space-y-2 p-4">
          {[
            "Host any music. Every track plays through YouTube's own embedded player.",
            "Store anything about you anywhere but your own browser.",
            "Ask you to sign in, or have anywhere to sign in to.",
            "Build any picture of you. Umami is cookieless and sets no identifier that survives the page. Your IP reaches its servers as it would any host; Umami's stated design is to hash rather than keep it, which is their word rather than something this code can prove.",
          ].map((line) => (
            <li key={line} className="flex max-w-prose gap-2.5">
              <span aria-hidden className="mt-[0.55rem] size-1 shrink-0 rounded-full bg-muted-foreground/50" />
              <span className="text-sm leading-relaxed text-muted-foreground">{line}</span>
            </li>
          ))}
        </Panel>
      </Section>

      <section className="rounded-xl border border-primary/25 bg-primary/[0.06] p-5">
        <h2 className="text-lg leading-snug">Come and have a look</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          All of it is open, pipeline included — the parser, the matcher, the
          id ledger and the scripts that found the wrong recordings. If you
          spot something wrong, or want to make it better, the door is open.
          Corrections to the catalogue are just as welcome as code.
        </p>
        <a
          href={REPO}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          The repository on GitHub
          <ArrowUpRight className="size-4" />
        </a>
      </section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg leading-snug">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.07] bg-card/40">
      {rows.map(([term, detail]) => (
        <div key={term} className="flex flex-col gap-1 p-3 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-sm sm:w-32">{term}</dt>
          <dd className="min-w-0 text-sm leading-relaxed text-muted-foreground">
            {detail}
          </dd>
        </div>
      ))}
    </dl>
  );
}
