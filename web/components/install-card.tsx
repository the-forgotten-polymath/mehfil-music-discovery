"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, Share } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DISMISSED_KEY,
  IOSInstallHelp,
  useInstall,
} from "@/components/install-prompt";
import { track } from "@/lib/analytics";
import { hasSeenWelcome, onWelcomeSeen } from "@/lib/welcome";

/**
 * The install invitation, as a card rather than a coloured row.
 *
 * Built on the same shape as the welcome — media above, a line of reasoning,
 * one action — because they are the same kind of moment and two different
 * treatments would read as two different apps.
 *
 * It never shares a screen with the welcome. That one is the first thing anyone
 * sees, and asking to install in the same breath is asking for something before
 * having given anything. So this waits for the welcome to be dismissed and then
 * counts five seconds — long enough for the song it started to be playing, which
 * is the first moment anyone has a reason to want the app rather than the page.
 */

/** Long enough to be listening, short enough to still be the same thought. */
const DELAY_MS = 5000;

export function InstallCard() {
  const pathname = usePathname();
  const { install, installed, isIOS, canInstall, showIOSHelp, dismissIOSHelp } =
    useInstall();
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false);

  // Armed when the welcome is out of the way: either it was seen on an earlier
  // visit, or it is dismissed while this is mounted. Subscribing rather than
  // re-reading storage because a write from this same tab fires no storage
  // event, so polling would be the only alternative.
  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      // No storage means no way to remember a refusal, and a nudge that cannot
      // be refused would return on every load. Better never to ask.
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasSeenWelcome()) setArmed(true);
    return onWelcomeSeen(() => {
      // Re-checked on every notification, not just at mount. /about reopens the
      // welcome on every visit, so without this a refusal made earlier in the
      // session is undone the moment someone reads the about page and dismisses
      // that welcome again — the card returns five seconds later having already
      // been told no.
      try {
        if (localStorage.getItem(DISMISSED_KEY)) return;
      } catch {
        return;
      }
      setArmed(true);
    });
  }, []);

  // The wait starts when everything else is already true, so the five seconds
  // are five seconds of the app being used, not five seconds of a catalogue
  // still loading or a prompt the browser has not offered yet.
  //
  // Route is deliberately not a dependency. Making it one restarts the timer on
  // every navigation, so anyone browsing while it counts would never reach the
  // end of it — the one person most likely to want the app. Where they are is
  // handled at render instead.
  useEffect(() => {
    if (!armed || !canInstall || installed) return;
    const timer = window.setTimeout(() => setOpen(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [armed, canInstall, installed]);

  async function accept() {
    // After, not before. The browser's dialog is what decides, and recording
    // "accepted" on the click recorded a fact we did not have yet — someone
    // could press this, dismiss the real prompt, and be counted as installed.
    const outcome = await install();
    track("install", { action: outcome });
    close();
  }

  function close() {
    setOpen(false);
    setArmed(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to write to; eligible is already false in that case.
    }
  }

  return (
    <>
    <AlertDialog
      // /about reopens the welcome on every visit, so this stays out of the way
      // there. Holding it at the render rather than the timer means someone who
      // happens to be on /about when the wait ends still gets it on the next
      // page, instead of the nudge being lost to where they were standing.
      open={open && pathname !== "/about"}
      onOpenChange={(next) => {
        if (!next) {
          if (open) track("install", { action: "not-now" });
          close();
        }
      }}
    >
      {/* Same geometry as the welcome: capped on dvh, wider than the
          primitive's presets, and scrolling nothing at this level. See
          notice-dialog.tsx for why each of those is what it is. */}
      <AlertDialogContent className="flex max-h-[85dvh] flex-col overflow-hidden data-[size=default]:max-w-[calc(100vw-2rem)] data-[size=default]:sm:max-w-[475px]">
        {/* A still, not a loop. The artwork is a lit phone in the dark, which
            is the thing being offered rather than a decoration beside it, and
            it holds without motion — so there is no video to decode, no poster
            to pair, and nothing for reduced-motion to suppress. 64K became 22K.

            Only 54px of it is cropped: the source is 1.73:1 against a 2.16:1
            box, so covering barely bites, and the face sits below the middle
            anyway — which is why the position is nudged down rather than
            centred. The mask fades it into the card, as the welcome's does. */}
        <div className="-mx-4 -mt-4 overflow-hidden rounded-t-xl [mask-image:linear-gradient(to_bottom,#000_0%,#000_60%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,#000_0%,#000_60%,transparent_100%)]">
          <img
            src="/install.jpg"
            alt=""
            aria-hidden
            className="h-[220px] w-full object-cover object-[center_60%] [@media(max-height:500px)]:h-24"
          />
        </div>

        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle className="text-xl leading-tight">
            Keep Mehfil on your {isIOS ? "home screen" : "device"}
          </AlertDialogTitle>
          <AlertDialogDescription
            render={<div className="space-y-3 text-left" />}
          >
            <p>
              It opens in its own window with no browser bars, keeps your
              favourites and your chosen backdrop, and starts where you left
              off.
            </p>
            <p>
              <strong className="font-medium text-primary">
                Completely safe.
              </strong>{" "}
              It is the same page you are on, in a window of its own. It asks
              for no permissions and reaches nothing else on your device.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="sm:justify-start">
          {/* Closes itself either way. On Android and desktop the native
              dialog answers and leaving this one up would ask again for
              something just granted; on iOS install() only opens the
              instructions, and they are rendered outside this dialog precisely
              so they survive it closing. Dismissing here also records the
              refusal key, which is right: whichever way it went, there is
              nothing left to nudge about. */}
          <AlertDialogAction className="gap-2" onClick={() => void accept()}>
            {isIOS ? <Share className="size-4" /> : <Download className="size-4" />}
            {isIOS ? "Show me how" : "Install"}
          </AlertDialogAction>
          {/* Cancel rather than a second action: declining should be the plain
              one of the two, and this is the only way out on a phone — an
              alert dialog refuses outside-press by design. */}
          <AlertDialogCancel onClick={close}>Not now</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {/* A sibling of the dialog, not a child. Safari has no install API, so this
        is the whole of the iOS path — and it has to keep standing after the
        card closes, which a child of the card could not. */}
    {showIOSHelp && <IOSInstallHelp onClose={dismissIOSHelp} />}
    </>
  );
}
