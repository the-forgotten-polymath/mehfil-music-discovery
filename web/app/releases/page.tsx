import type { Metadata } from "next";
import { Plus, Wrench } from "lucide-react";
import { RELEASES, type Release } from "@/lib/releases";

/**
 * Release notes.
 *
 * The shape every good changelog settles on: the version and its date held in
 * a column of their own, the substance in a wider one beside it, and a rule
 * between entries so a long page still scans as a list. On a phone the two
 * columns stack, because 20rem of screen cannot hold both.
 *
 * Newest first — the question this page answers is almost always "what changed
 * recently", not "how did it begin".
 *
 * Added and fixed stay apart rather than merging into one stream. They answer
 * different questions — what can I do now, and what stopped going wrong — and
 * one undifferentiated list makes the reader do that sorting themselves.
 *
 * No links out to pull requests: see lib/releases.ts. The data still carries
 * the number for whoever maintains the list.
 *
 * A server component: it maps over a constant and has no state, no effects and
 * nothing to hydrate. That is also why its metadata sits here rather than in a
 * layout of its own, as the client pages in this app have to do.
 */
export const metadata: Metadata = {
  title: "Release notes",
  description:
    "Every version of Mehfil so far — what each one added, and what it " +
    "repaired.",
};

export default function ReleasesPage() {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <header className="max-w-prose pb-10 pt-1">
        <h2 className="text-3xl leading-tight">Release notes</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Everything that has shipped, newest first. Mehfil is one person&apos;s
          side project, so this doubles as an honest list of what was wrong for
          a while — the catalogue is stitched together from a printed songlist
          and public uploads, and getting it right has taken some going over.
        </p>
      </header>

      <ol>
        {RELEASES.map((release, index) => (
          <li
            key={release.version}
            className="border-t border-white/[0.07] py-8 first:border-t-0 first:pt-0 lg:grid lg:grid-cols-[10rem_1fr] lg:gap-10"
          >
            {/* Sticky on wide screens: the entries are long, and the version
                you are reading should stay named while you read it. */}
            <div className="lg:sticky lg:top-4 lg:self-start">
              <div className="flex items-center gap-2 lg:flex-col lg:items-start lg:gap-1.5">
                <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-xs tabular-nums text-foreground/90">
                  v{release.version}
                </span>
                <time
                  dateTime={release.date}
                  className="text-xs text-muted-foreground"
                >
                  {formatted(release.date)}
                </time>
                {index === 0 && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                    Latest
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4 min-w-0 lg:mt-0">
              <h3 className="max-w-prose text-lg leading-snug text-foreground">
                {release.title}
              </h3>

              {release.added && (
                <Group
                  label="Added"
                  icon={<Plus className="size-3" />}
                  tone="text-primary"
                  items={release.added}
                />
              )}
              {release.fixed && (
                <Group
                  label="Fixed"
                  icon={<Wrench className="size-3" />}
                  tone="text-heart"
                  items={release.fixed}
                />
              )}
            </div>
          </li>
        ))}
      </ol>

      <p className="border-t border-white/[0.07] pt-8 text-xs text-muted-foreground/70">
        Found something wrong? There is a flag on every song, and a page for
        sending a link when one is missing.
      </p>
    </div>
  );
}

function Group({
  label,
  icon,
  tone,
  items,
}: {
  label: string;
  icon: React.ReactNode;
  /** Colour for the marker and label — the two things that carry the meaning. */
  tone: string;
  items: readonly string[];
}) {
  return (
    <section className="mt-5">
      <h4
        className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest ${tone}`}
      >
        {icon}
        {label}
      </h4>
      {/* A real list with real markers. These were em dashes set in a
          pseudo-element, which meant a screen reader read the run-on and
          nothing announced it as a list at all. */}
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex max-w-prose gap-2.5">
            <span
              aria-hidden
              className={`mt-[0.5rem] size-1 shrink-0 rounded-full bg-current ${tone} opacity-60`}
            />
            <span className="text-sm leading-relaxed text-muted-foreground">
              {item}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "2026-08-09" -> "9 August 2026".
 *
 * Split rather than parsed: `new Date("2026-08-09")` is UTC midnight, which is
 * the previous day west of Greenwich, and a date that renders differently on
 * the server and the client is a hydration mismatch as well as a wrong date.
 */
function formatted(iso: Release["date"]) {
  const [year, month, day] = iso.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}
