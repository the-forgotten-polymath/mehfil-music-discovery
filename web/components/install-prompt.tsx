"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";

/**
 * Shared with InstallCard, which is what writes it now.
 *
 * Exported rather than repeated: two copies of a storage key is how one of
 * them quietly stops matching the other, and the failure — a nudge that will
 * not stay dismissed — looks like a bug in the dialog rather than a typo.
 */
export const DISMISSED_KEY = "mehfil.installDismissed";

/** What came of asking. "instructions" is iOS, where nothing can be known. */
export type InstallOutcome = "accepted" | "dismissed" | "instructions" | "unavailable";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Module-level capture of `beforeinstallprompt`.
 *
 * The event fires once, and Chrome commonly fires it before React has
 * hydrated. Listening from inside an effect therefore misses it outright, and
 * Android falls back to manual instructions even though a real install was
 * available. Listening at import time is early enough to catch it, and the
 * event is stashed so any component mounting later can still use it.
 */
let capturedPrompt: InstallEvent | null = null;
const promptListeners = new Set<(e: InstallEvent | null) => void>();

function setCapturedPrompt(event: InstallEvent | null) {
  capturedPrompt = event;
  promptListeners.forEach((fn) => fn(event));
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Held back so our own control can open the dialog on demand.
    e.preventDefault();
    setCapturedPrompt(e as InstallEvent);
  });
  window.addEventListener("appinstalled", () => setCapturedPrompt(null));
}

/**
 * Install state, shared by the banner and any other install control.
 *
 * Chromium fires `beforeinstallprompt` and lets us open the real dialog on
 * demand. Safari fires nothing and exposes no API, so iOS can only be given
 * instructions for Share -> Add to Home Screen. Both branches are needed or
 * one platform silently gets no prompt at all.
 */
export function useInstall() {
  // Seeded from the module-level capture, so a prompt that arrived before this
  // component mounted is still available.
  const [deferred, setDeferred] = useState<InstallEvent | null>(capturedPrompt);
  const [isIOS, setIsIOS] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) {
      // display-mode is a browser query, unreadable during render or on the
      // server, so this state can only be set once mounted.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstalled(true);
      return;
    }

    const ua = window.navigator.userAgent;
    // iPadOS reports as a Mac, so touch support is what separates them.
    setIsIOS(
      /iphone|ipod|ipad/i.test(ua) ||
        (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
    );

    // Pick up a prompt that arrives after mount, and clear it once installed.
    setDeferred(capturedPrompt);
    promptListeners.add(setDeferred);
    const onInstalled = () => setInstalled(true);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      promptListeners.delete(setDeferred);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  /**
   * Returns what actually happened, rather than that it was asked.
   *
   * The browser's own dialog is the thing that decides, and its answer used to
   * be read and thrown away — so a caller could only know the button had been
   * pressed, which is a different and much weaker fact than an install. On iOS
   * there is no answer to have: the instructions open and whether anyone
   * follows them is not observable, so it says so instead of guessing.
   */
  const install = useCallback(async (): Promise<InstallOutcome> => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      // The event is single-use; a declined prompt cannot be replayed.
      setCapturedPrompt(null);
      if (outcome === "accepted") setInstalled(true);
      return outcome;
    }
    // No programmatic path on iOS — show the manual steps instead.
    if (isIOS) {
      setShowIOSHelp(true);
      return "instructions";
    }
    return "unavailable";
  }, [deferred, isIOS]);

  return {
    install,
    installed,
    isIOS,
    showIOSHelp,
    dismissIOSHelp: () => setShowIOSHelp(false),
    // Offer the control whenever installing is actually possible.
    canInstall: !installed && (Boolean(deferred) || isIOS),
  };
}

/** Steps for Safari, which has no install API. */
export function IOSInstallHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full min-w-0 max-w-sm rounded-xl border border-white/10 bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" width={40} height={40} className="size-10 rounded-lg" />
            <div>
              <p className="text-sm font-medium">Install Mehfil</p>
              <p className="text-xs text-muted-foreground">Two taps in Safari</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <ol className="mt-4 space-y-3 text-sm">
          <li className="flex items-center gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs">
              1
            </span>
            Tap <Share className="size-4 text-primary" /> in the toolbar
          </li>
          <li className="flex items-center gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs">
              2
            </span>
            Choose <SquarePlus className="size-4 text-primary" /> Add to Home Screen
          </li>
        </ol>
      </div>
    </div>
  );
}

/**
 * Permanent install control for the drawer.
 *
 * Always rendered unless already installed. Gating it on `canInstall` meant it
 * was invisible on any browser that had not fired `beforeinstallprompt`, which
 * is most of them — so the entry point people look for simply was not there.
 * Where no programmatic install exists, it explains the manual route instead
 * of doing nothing.
 */
export function InstallButton({ className = "" }: { className?: string }) {
  const { install, installed, isIOS, canInstall, showIOSHelp, dismissIOSHelp } =
    useInstall();
  const [showHelp, setShowHelp] = useState(false);

  if (installed) return null;

  /**
   * The permanent way in, and deliberately quiet.
   *
   * The nudging is InstallCard's job — a card, shown once, on a visit after
   * the welcome. This row is what remains afterwards for anyone who said not
   * now and then changed their mind, so it reads like its neighbours rather
   * than competing with them.
   */
  return (
    <>
      <button
        onClick={() => (canInstall ? install() : setShowHelp(true))}
        className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground ${className}`}
      >
        <Download className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Install Mehfil</span>
      </button>
      {showIOSHelp && <IOSInstallHelp onClose={dismissIOSHelp} />}
      {showHelp && !isIOS && <ManualInstallHelp onClose={() => setShowHelp(false)} />}
    </>
  );
}

/** Fallback for browsers with no install API and no prompt event. */
function ManualInstallHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full min-w-0 max-w-sm rounded-xl border border-white/10 bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" width={40} height={40} className="size-10 rounded-lg" />
            <div>
              <p className="text-sm font-medium">Install Mehfil</p>
              <p className="text-xs text-muted-foreground">From your browser menu</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
          <li>
            <span className="text-foreground">Chrome / Edge</span> — the install icon
            in the address bar, or menu → Install
          </li>
          <li>
            <span className="text-foreground">Android</span> — menu → Add to Home screen
          </li>
          <li>
            <span className="text-foreground">Firefox</span> — menu → Install
          </li>
        </ul>

        <p className="mt-4 text-xs text-muted-foreground">
          If none appear, the browser may not support installing web apps.
        </p>
      </div>
    </div>
  );
}

