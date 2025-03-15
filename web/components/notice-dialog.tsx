"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Play } from "lucide-react";
import { usePlayer } from "@/components/player-provider";
import { hasSeenWelcome, markWelcomeSeen } from "@/lib/welcome";
import { useCatalogue } from "@/lib/queries";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * The one-time welcome: what this app does not own, and what it does not store.
 *
 * Framed as a greeting rather than a consent gate, because that is what it is —
 * nothing here needs agreeing to, and there is no version of this someone can
 * decline. Saying it warmly costs nothing and reads as courtesy instead of
 * paperwork.
 *
 * Unlike lib/favourites.ts and lib/backdrops.ts, this reads localStorage once,
 * from one component, so useSyncExternalStore's subscriber machinery buys
 * nothing here. A plain effect after mount is enough, and there is no
 * `mounted` flag either — the dialog starts closed, closed is also what the
 * server rendered, so there is no state to reconcile before the effect runs.
 *
 * /about is the deliberate exception: it reopens the dialog on every visit,
 * seen key or not, because that is where the project owner wants the notice
 * repeatable on demand rather than left to a first-run localStorage.
 */

export function NoticeDialog() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { playRandom } = usePlayer();
  const { data: catalogue } = useCatalogue();

  useEffect(() => {
    // Read after mount, same as offline-notice.tsx: the server has no notion
    // of localStorage or the current route's storage state, so this can only
    // be decided once the client is up.
    if (pathname === "/about") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
      return;
    }
    if (!hasSeenWelcome()) setOpen(true);
  }, [pathname]);

  // Any close — the OK button, Escape — counts as having been shown. On
  // /about that write is a no-op the next time this effect runs, since the
  // route check above short-circuits before the stored key is even read.
  // On /about the notice is being re-read on purpose, so "Let the music play"
  // is answering a question nobody asked — the music is already going and the
  // page they wanted is behind the dialog. There it is an acknowledgement; the
  // first time, it is an invitation.
  const revisiting = pathname === "/about";

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) markWelcomeSeen();
  }

  /**
   * The button does what it says.
   *
   * "Let the music play" that only closed a dialog was a label describing an
   * intention rather than an action. Starting something here is also the one
   * moment the browser will allow it: autoplay needs a user gesture, and this
   * press is the first one a new visitor makes, so it is the cheapest possible
   * route from arriving to hearing something.
   *
   * Not on /about, where the button is an acknowledgement and the music is
   * usually already playing — hijacking it there would replace what someone
   * chose with something random.
   *
   * If the catalogue has not arrived yet the dialog just closes. A first-run
   * visitor on a slow connection can reach this before the fetch resolves, and
   * a button that does nothing visible is better than one that throws.
   */
  function dismiss() {
    if (!revisiting && catalogue?.songs.length) playRandom(catalogue.songs);
    handleOpenChange(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {/* Capped in height, wider than the primitive, and scrolling nothing
          itself.

          Nothing scrolls here because scrolling the popup would carry the
          picture and the OK button off with the text, which is how a confirm
          button ends up somewhere the eye has to go looking for it. The cap
          stays so a short viewport cannot push the dialog past the screen
          edges; the text below handles its own overflow.

          The width override exists because the primitive's presets top out at
          20rem on a phone and 24rem from sm — sized for a sentence and a pair
          of buttons, which with a picture above the text reads as a column. It
          has to repeat the data-[size] variant rather than set a bare max-w-*:
          tailwind-merge treats differently-modified utilities as unrelated, so
          a plain one would leave both in place and lose to the attribute
          selector's specificity.

          flex flex-col replaces the primitive's own `grid` (both are bare
          display utilities with no modifier, so tailwind-merge treats them as
          the same slot and the later one wins — confirmed by grepping the
          compiled CSS for `alert-dialog-content` and checking `display` is
          `flex`, not `grid`, in the class this component actually renders).
          With that, media, header and footer stack in document order and the
          description is the only child asked to size itself against
          whatever's left, via flex-1 below, rather than every child guessing
          a share of the viewport up front.

          dvh, not vh, for the same reason the media below hides at
          `max-height:500px` rather than a Tailwind breakpoint: mobile
          Safari's `vh` is the *large* viewport — the address bar counted as
          hidden — so `85vh` overstates what is actually on screen the moment
          the bar is showing, which is exactly the moment a first-run dialog
          appears. */}
      <AlertDialogContent className="flex max-h-[85dvh] flex-col overflow-hidden data-[size=default]:max-w-[calc(100vw-2rem)] data-[size=default]:sm:max-w-[475px]">
        {/* Full-bleed thumbnail, first inside the content so it sits above
            the header. AlertDialogContent pads and gaps its children (p-4,
            gap-4) for the header/footer case; -mx-4 -mt-4 cancels that same
            padding on this one edge, the same trick AlertDialogFooter already
            uses at the opposite edge to sit flush with the popup's own
            bottom. rounded-t-xl + overflow-hidden then re-clip the video to
            match the popup's own top corners, since escaping the padding
            also escapes the popup's own clip.
            Same video-with-poster-fallback pattern as AppBackdrop, but fixed
            to this one clip rather than reading from the theme store — a
            notice illustration has no "current backdrop" to key off, and
            importing AppBackdrop here would wire this dialog to state it has
            no business depending on. 200px against a 475px card; on a short
            (landscape-phone) viewport it drops to 96px so the media doesn't
            dominate what little height max-h-[85dvh] leaves — the text is the
            part with the acknowledgement in it. */}
        {/* Faded out at the bottom rather than stopped. A picture that ends on
            a hard horizontal line reads as a banner bolted above the text; the
            same picture dissolving into the card's own background reads as
            part of it. The same trick the player bar uses on its artwork and
            song-details uses on its corner wash. */}
        <div className="relative -mx-4 -mt-4">
          <div className="overflow-hidden rounded-t-xl [mask-image:linear-gradient(to_bottom,#000_0%,#000_55%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,#000_0%,#000_55%,transparent_100%)]">
            <video
              autoPlay
              muted
              loop
              playsInline
              poster="/notice.jpg"
              aria-hidden
              className="h-[200px] w-full object-cover motion-reduce:hidden [@media(max-height:500px)]:h-24"
            >
              <source src="/notice.mp4" type="video/mp4" />
            </video>
            <img
              src="/notice.jpg"
              alt=""
              aria-hidden
              className="hidden h-[200px] w-full object-cover motion-reduce:block [@media(max-height:500px)]:h-24"
            />
          </div>

          {/* The badge, sitting on the corner of the picture.
              A sibling of the masked element rather than a child of it: the
              mask fades everything inside to transparent at the bottom, which
              is exactly where this sits, so nested it would fade away with the
              image. Out here it keeps its own opacity while the picture
              dissolves behind it, which is the whole effect — the mark anchors
              the seam where the image becomes the card. */}
          <img
            src="/logo.png"
            alt=""
            aria-hidden
            className="absolute bottom-2 right-4 size-11 rounded-xl shadow-lg ring-1 ring-white/15"
          />
        </div>
        {/* Left at every width. The primitive centres the header below sm and
            only switches to text-left from there, which left the title centred
            over left-aligned paragraphs on a phone. One alignment for the whole
            card, and left is the one the body text needs. */}
        <AlertDialogHeader className="place-items-start text-left">
          {/* The primitive's title is text-base font-medium — the same size as
              the body beneath it, so it reads as a first line rather than a
              title. text-xl against the description's text-sm gives it
              somewhere to stand, and leading-tight matches the page headings
              elsewhere. The badge lives on the thumbnail now, not in here. */}
          <AlertDialogTitle className="text-xl leading-tight">
            Welcome to Mehfil
          </AlertDialogTitle>
          {/* A div rather than the default <p>, so two paragraphs can sit
              inside without nesting a <p> in a <p>. The description id, and so
              the aria-describedby wiring, moves with the render override, so
              both are still announced as the dialog's description.

              This is the only thing that scrolls, and now the only thing that
              is asked to give something up when space is short. min-h-0
              overrides the grid item's own automatic minimum size — without
              it a scrollable child still refuses to shrink below its content,
              which is the same clipping bug wearing a different hat — and
              flex-1 asks for whatever the header has left over after the
              title. There is no max-h-[38vh] any more: that was a guess at a
              fraction of the viewport, and guesses are how a footer ends up
              needing 590px of screen to stay on screen. Sizing to "whatever
              is actually left" needs no guess. */}
          <AlertDialogDescription
            render={<div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-left" />}
          >
            {/* <strong> rather than a coloured span. The accent is what draws
                the eye, but colour alone is not a way to carry meaning — the
                emphasis has to survive for anyone reading this with a screen
                reader or without colour, and strong is what does that. */}
            <p>
              Nearly four thousand songs from the golden age of Hindi film
              music, and{" "}
              <strong className="font-medium text-primary">
                not one of them ours
              </strong>
              . They play through YouTube&apos;s own player and the cover art is
              theirs. The backdrops are illustrations we could not trace; tell
              us if one is yours and we will credit it or remove it.
            </p>
            <p>
              <strong className="font-medium text-primary">
                There is no account and nothing to sign in to.
              </strong>{" "}
              Your favourites and your chosen backdrop stay in this browser. We
              count a little of what happens here — visits, plays, searches —{" "}
              <strong className="font-medium text-primary">
                without cookies and without anything that identifies you
              </strong>
              . The full list is on the For the curious page, and it is short.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* Under the text it belongs to, on the same edge. The primitive pushes
            it right from sm, which is right for a confirm/cancel pair and wrong
            for one button on a card that reads left to right. */}
        <AlertDialogFooter className="sm:justify-start">
          {/* An invitation rather than an acknowledgement. "OK" asks someone to
              confirm they have read terms; this is a welcome, and the only
              thing waiting on the other side of it is the music. The icon is
              filled to match the play controls it is about to hand them. */}
          <AlertDialogAction className="gap-2" onClick={dismiss}>
            {/* gap-2 explicitly: the button base sets items-center and sizes
                svg children, but no gap, so an icon beside a label would sit
                flush against it. The other icon-and-text buttons in the app
                set their own for the same reason. */}
            {revisiting ? (
              <Check className="size-4" />
            ) : (
              <Play className="size-4 fill-current" />
            )}
            {revisiting ? "Got it" : "Let the music play"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
