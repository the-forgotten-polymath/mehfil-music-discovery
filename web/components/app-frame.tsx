"use client";

import { createContext, useContext, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Compass,
  Code2,
  ScrollText,
  Disc3,
  Heart,
  HeartHandshake,
  Info,
  ListMusic,
  Menu,
  Palette,
  Search,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InstallButton } from "@/components/install-prompt";
import { InstallCard } from "@/components/install-card";
import { LikeBurstHost } from "@/components/like-burst";
import { NoticeDialog } from "@/components/notice-dialog";
import { track } from "@/lib/analytics";
import { facetCards, portrait } from "@/lib/catalogue";
import { usePlayer, usePlayerBar } from "@/components/player-provider";
import { useCatalogue, usePhotoManifest } from "@/lib/queries";

type Frame = {
  /** Scroll container the virtualised lists measure against. */
  scrollEl: HTMLElement | null;
  /** Portal target for the current route's filter panel. */
  filterSlot: HTMLElement | null;
  query: string;
  setQuery: (value: string) => void;
};

const FrameContext = createContext<Frame | null>(null);

export function useFrame() {
  const context = useContext(FrameContext);
  if (!context) throw new Error("useFrame must be used inside AppFrame");
  return context;
}

/**
 * The application chrome, rendered once in the root layout.
 *
 * Living in the layout rather than in each page means the rail keeps its full
 * height beside the player and does not remount on navigation. Routes are only
 * responsible for their content.
 *
 * The filter panel is route-specific, so the rail exposes a slot that pages
 * portal into. A portal rather than shared state: passing React nodes upward
 * through context invites render loops, and this needs neither.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const { data: catalogue } = useCatalogue();
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [filterSlot, setFilterSlot] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const playerBar = usePlayerBar();
  const { playRandom } = usePlayer();
  const { data: photos } = usePhotoManifest();

  // The three voices this catalogue is really made of. Named rather than
  // ranked: ranking by catalogue share puts Asha Bhosle third and leaves
  // Kishore Kumar out, and these three together say what the collection is at
  // a glance. Anyone missing a portrait is dropped rather than drawn blank,
  // and if none resolve the control simply shows no faces.
  const faces = useMemo(
    () =>
      ["Lata Mangeshkar", "Kishore Kumar", "Mohammed Rafi"]
        .map((name) => ({ name, src: portrait(name, photos ?? null) }))
        .filter((face): face is { name: string; src: string } => Boolean(face.src)),
    [photos]
  );

  const onBrowse = pathname === "/";
  // The about page has nothing to search and its own back control, so the
  // header would be an empty bar. Mobile still needs the menu, which only
  // lives there, so the row stays below lg with the search removed.
  const hideSearch = pathname === "/about" || pathname === "/contribute";

  const navClass = (active: boolean) =>
    `flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition ${
      active ? "bg-white/[0.09] text-foreground" : "text-muted-foreground hover:text-foreground"
    }`;

  const brandAndNav = (
    <>
      <div className="shrink-0 px-4 pb-3 pt-4">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/logo.png" alt="" width={36} height={36} className="size-9 rounded-lg" />
          <span>
            <span className="block text-lg leading-tight tracking-tight">Mehfil</span>
            {catalogue && (
              <span className="block text-xs text-muted-foreground">
                {catalogue.songs.length.toLocaleString()} songs ·{" "}
                {catalogue.facets.stations.length} stations
              </span>
            )}
          </span>
        </Link>
      </div>

      {/* A real nav, not a div: this is the app's primary way to move between
          routes, and the rail and the mobile drawer both render it. */}
      <nav aria-label="Primary" className="shrink-0 space-y-0.5 px-2 pb-2">
        <Link href="/" className={navClass(onBrowse)}>
          <Compass className="size-4" /> Browse
        </Link>
        <Link href="/songs" className={navClass(pathname === "/songs")}>
          <ListMusic className="size-4" /> All songs
        </Link>
        <Link href="/favourites" className={navClass(pathname === "/favourites")}>
          <Heart className="size-4" /> Your favourites
        </Link>
        <Link href="/contribute" className={navClass(pathname === "/contribute")}>
          <HeartHandshake className="size-4" /> Help us find songs
        </Link>
        <InstallButton />
      </nav>
    </>
  );

  // One definition for both the rail and the mobile menu: they are the same
  // surface at different sizes, and two copies would drift.
  const railTexture = (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 top-1/3 [mask-image:linear-gradient(to_top,#000_0%,#000_35%,transparent_100%)]"
    >
      <img
        src="/collage.jpg"
        alt=""
        className="size-full object-cover opacity-[0.20] saturate-[0.55] sepia-[0.35]"
      />
    </div>
  );

  // The rail's secondary rows: the same shape as navClass, one step quieter,
  // so they read as a group beneath the main nav rather than competing with it.
  const subNavClass = (active: boolean) =>
    `flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition ${
      active
        ? "bg-white/[0.08] text-foreground"
        : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
    }`;

  const credit = (
    // Opaque backing: the collage is anchored to the bottom of the rail, so it
    // sits directly behind this text. Without it the smallest type in the app
    // is the one competing with a busy image.
    <div className="shrink-0 border-t border-white/[0.06] bg-sidebar/95 px-2 py-2 backdrop-blur-sm">
      {/* Rows, not a stack of footnote-sized text.
          These were three lines of 11px muted type with nothing to say they
          could be pressed and nothing to aim at on a touchscreen. They lead to
          real pages, so they now look and behave like the nav above them: a
          hit area, an icon, a hover state. Only the attribution stays small
          and quiet — it is the one line here that is a credit rather than a
          destination. */}
      <div className="space-y-0.5">
        <Link href="/themes" className={subNavClass(pathname === "/themes")}>
          <Palette className="size-3.5 shrink-0" /> Themes
        </Link>
        <Link href="/releases" className={subNavClass(pathname === "/releases")}>
          <ScrollText className="size-3.5 shrink-0" /> Release notes
        </Link>
        <Link
          href="/curious/design"
          className={subNavClass(pathname.startsWith("/curious"))}
        >
          <Code2 className="size-3.5 shrink-0" /> For the curious
        </Link>
        <Link href="/about" className={subNavClass(pathname === "/about")}>
          <Info className="size-3.5 shrink-0" /> About &amp; credits
        </Link>
      </div>

      <p className="px-2 pb-1 pt-2.5 text-[10px] leading-snug text-muted-foreground/60">
        Music streams from YouTube. Nothing is hosted here.
      </p>
      <a
        href="https://shashwa7.in"
        target="_blank"
        rel="noopener noreferrer"
        className="block px-2 pb-1 text-[10px] text-muted-foreground/60 underline-offset-2 transition hover:text-muted-foreground hover:underline"
      >
        made with <span className="text-heart">&#9829;</span> by shashwa7.in
      </a>
    </div>
  );

  return (
    <FrameContext.Provider value={{ scrollEl, filterSlot, query, setQuery }}>
      <div className="flex h-[100dvh] gap-0 p-0 lg:gap-2 lg:p-2">
        {/* Full height, beside the player rather than above it. */}
        <aside className="relative hidden w-72 shrink-0 flex-col overflow-hidden rounded-lg bg-sidebar lg:flex">
          {/* Texture for the space the filter panel leaves empty: masked out
              well before the navigation and pulled toward the brass palette,
              so it reads as a surface rather than a picture competing with the
              controls in front of it. */}
          {railTexture}

          {/* Above the texture, or the controls sit behind it. */}
          <div className="relative z-10 flex min-h-0 flex-1 flex-col">
            {brandAndNav}
            <div ref={setFilterSlot} className="min-h-0 flex-1 overflow-hidden" />
            {credit}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-0 lg:gap-2">
          <main
            ref={setScrollEl}
            className="scroll-slim min-h-0 flex-1 overflow-y-auto rounded-none bg-card/40 lg:rounded-lg"
          >
            {/* Gutter must match the content below exactly, or the search box
                sits on a different edge from everything it sits above. */}
            <div
              className={`sticky top-0 z-20 items-center gap-2 bg-background/70 px-4 pb-2 pt-3 backdrop-blur sm:px-6 lg:px-8 ${
                hideSearch ? "flex lg:hidden" : "flex"
              }`}
            >
              {/* Shown at every width below lg: brandAndNav's Browse row
                  points at `/` too, but the logo is the brand mark and the
                  one tap-target that reliably reads as "home" on a phone, so
                  it stays even where every pixel is contested. The room for
                  it came from Themes below, not from hiding this again. */}
              <Link href="/" className="flex shrink-0 items-center gap-2 lg:hidden">
                <img src="/logo.png" alt="" width={32} height={32} className="size-8 rounded-lg" />
              </Link>

              {!hideSearch && (
              <div className="relative min-w-0 flex-1 md:max-w-lg">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors" />
                <input
                  value={query}
                  onChange={(e) => {
                    // Once per search, on the empty-to-typed edge. Gating this
                    // on the redirect below meant searching was only ever
                    // counted when it moved you to /songs — so every search
                    // made once you were already there, which is most of them,
                    // went unrecorded. Still no query text, only that it began.
                    if (!query.trim() && e.target.value.trim()) track("search");
                    setQuery(e.target.value);
                    // Searching from anywhere lands on the list that can show
                    // results, rather than silently doing nothing.
                    if (pathname !== "/songs" && e.target.value) {
                      router.push("/songs");
                    }
                  }}
                  placeholder="Search songs, films, singers…"
                  className="h-10 w-full rounded-full border border-white/10 bg-white/[0.07] pl-10 pr-9 text-sm outline-none transition placeholder:text-muted-foreground/70 hover:border-white/20 hover:bg-white/[0.09] focus:border-primary/50 focus:bg-white/[0.1] focus:ring-4 focus:ring-primary/10"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              )}

              {/* Favourites, one glance away at any width. It already lives
                  in the rail/drawer nav, but that is only a touchpoint once a
                  phone user opens the drawer — this is the fix for that. Not
                  gated on hideSearch: hideSearch only retires the search box
                  (nothing to search on /about or /contribute), it says
                  nothing about this, and hiding it there would remove the
                  one touchpoint mobile still has on those routes. The row
                  itself already collapses to lg:hidden on those pages, so on
                  desktop this disappears with the rest of the row rather than
                  needing its own check. ml-auto moves here from the Surprise
                  button below: this is now the first element of the group
                  that gets pushed to the right edge, and Surprise/the menu
                  trigger ride along after it instead of pushing themselves. */}
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {/* aria-label carries the accessible name regardless of what a
                    screen reader does with the tooltip; the tooltip is only
                    there for the sighted mouse user who has nothing else to
                    go on before clicking an icon-only link. */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        href="/favourites"
                        aria-label="Your favourites"
                        // The one nav control that carries a colour of its
                        // own. It is a heart, and a heart in brass is filed
                        // with the furniture — this is the entry point the
                        // owner wanted noticed, so it keeps the accent even
                        // when the route is not active, and deepens rather
                        // than switches colour when it is.
                        className={`grid size-9 place-items-center rounded-full border transition ${
                          pathname === "/favourites"
                            ? "border-heart/40 bg-heart/15 text-heart"
                            : "border-white/10 bg-white/[0.06] text-heart/75 hover:border-heart/30 hover:bg-heart/10 hover:text-heart"
                        }`}
                      />
                    }
                  >
                    <Heart className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>Your favourites</TooltipContent>
                </Tooltip>
                {/* Hidden below sm: this is what paid for the logo's return.
                    Themes is a preference visited occasionally, not a
                    destination like Favourites, and it stays reachable from
                    the drawer (via the credit block) at every width — this
                    icon is only ever the second-fastest way to it. */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        href="/themes"
                        aria-label="Themes"
                        className={`hidden size-9 place-items-center rounded-full border transition sm:grid ${
                          pathname === "/themes"
                            ? "border-primary/30 bg-primary/15 text-primary"
                            : "border-white/10 bg-white/[0.06] text-muted-foreground hover:text-foreground"
                        }`}
                      />
                    }
                  >
                    <Palette className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>Themes</TooltipContent>
                </Tooltip>
              </div>

              {/* Fills the empty right side with the one action that needs no
                  prior choice: drop into the catalogue at random. */}
              {catalogue && !hideSearch && (
                // "Surprise" already labels the button, but not what it does —
                // the tooltip carries that, which is why this keeps a tooltip
                // despite the visible text.
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => playRandom(catalogue.songs)}
                        className="group/surprise hidden shrink-0 items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-4 py-2 text-xs font-semibold text-primary shadow-[0_0_0_0_rgba(214,168,84,0)] transition-[background-color,border-color,box-shadow] duration-300 hover:border-primary/50 hover:bg-primary/25 hover:shadow-[0_0_20px_-2px_rgba(214,168,84,0.45)] lg:inline-flex"
                      />
                    }
                  >
                    {/* A record, not a shuffle glyph: this plays music at
                        random rather than reordering a list. A full revolution
                        ends where it began — the old half turn stopped upside
                        down and read as a glitch. */}
                    <Disc3 className="size-4 shrink-0 transition-transform duration-[900ms] ease-out motion-safe:group-hover/surprise:rotate-[360deg]" />
                    Surprise

                    {/* The faces fan out on hover. Transform only, never margin:
                        margins are laid out, so animating one reflows the button
                        every frame — which is both why this was not smooth and
                        why the control grew as it played. A transform is composited
                        and moves nothing around it. */}
                    {faces.length > 0 && (
                      <span className="flex shrink-0 -space-x-2">
                        {faces.map((face, index) => (
                          <img
                            key={face.name}
                            src={face.src}
                            alt=""
                            loading="lazy"
                            style={
                              {
                                "--fan": `${index * 5}px`,
                                transitionDelay: `${index * 45}ms`,
                              } as React.CSSProperties
                            }
                            className="size-5 rounded-full object-cover object-top ring-2 ring-card transition-transform duration-300 ease-out motion-safe:group-hover/surprise:translate-x-[var(--fan)]"
                          />
                        ))}
                      </span>
                    )}
                  </TooltipTrigger>
                  <TooltipContent>Play something at random</TooltipContent>
                </Tooltip>
              )}

              {/* Keyed on the route, and otherwise uncontrolled. Navigating
                  changes the key, React discards this Sheet and mounts a fresh
                  one, and a fresh one is closed — so following a link closes
                  the drawer without anything here having to drive its open
                  state. Driving it was the previous attempt and it stopped the
                  trigger opening at all. */}
              <Sheet key={pathname}>
                <SheetTrigger
                  render={
                    <button
                      title="Menu"
                      aria-label="Menu"
                      className="relative grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-muted-foreground transition hover:text-foreground lg:hidden"
                    />
                  }
                >
                  <Menu className="size-4" />
                </SheetTrigger>
                {/* No `relative` here. These classes are merged over the base
                    ones, and it would beat the `fixed` that positions the
                    panel — taking `inset-y-0 left-0 h-full` with it and
                    collapsing the drawer to nothing. `fixed` already anchors
                    the absolutely-positioned texture inside. */}
                <SheetContent
                  side="left"
                  className="flex w-[19rem] flex-col overflow-hidden bg-sidebar p-0"
                >
                  <SheetTitle className="sr-only">Menu</SheetTitle>
                  {railTexture}

                  <div className="relative z-10 flex min-h-0 flex-1 flex-col">
                    {brandAndNav}
                    <div className="min-h-0 flex-1" />
                    {credit}
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            {/* One place sets the page gutter and bottom room, so routes only
                decide their own vertical rhythm and cannot drift apart. The
                gap below the header comes from the header itself, so this
                needs no top padding of its own. */}
            <div className="px-4 pb-16 pt-4 sm:px-6 sm:pt-5 lg:px-8">{children}</div>
          </main>

          {playerBar}
        </div>
      </div>

      {/* Mounted once here, regardless of route, so any heart in the app can
          fire into it. */}
      <LikeBurstHost />
      <InstallCard />

      {/* Same reasoning: one instance, always present, so it can open itself
          on first run or on /about regardless of which route the app landed
          on. */}
      <NoticeDialog />
    </FrameContext.Provider>
  );
}
