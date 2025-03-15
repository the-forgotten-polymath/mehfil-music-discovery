"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  /**
   * Service worker registration and update handling.
   *
   * Registration alone is what makes the app installable, but an installed PWA
   * can sit open for days, so it also has to notice new deploys. Three parts:
   *
   *   updateViaCache: "none"  the worker script itself is never served from
   *                           the HTTP cache, or a new deploy could go
   *                           unnoticed for up to 24 hours.
   *   update() on focus       installed apps rarely reload on their own, so
   *                           returning to the tab is the natural check point.
   *   controllerchange        a new worker has taken over, meaning the page is
   *                           running against a superseded build — reload once
   *                           so the user lands on the current one.
   */
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Never in development. The worker caches build assets, which change on
    // every edit, so it serves stale chunks and makes changes appear not to
    // land. Any worker left over from a previous dev session is unregistered
    // and its caches dropped, since it would otherwise keep intercepting.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
      if ("caches" in window) {
        caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
      }
      return;
    }

    // Captured before registering: on a first install `controllerchange` also
    // fires, and reloading then would be a pointless refresh on first visit.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    let registration: ServiceWorkerRegistration | undefined;

    const onControllerChange = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };

    const checkForUpdate = () => {
      if (document.visibilityState === "visible") registration?.update().catch(() => {});
    };

    const register = () => {
      // Versioned URL. A worker is only replaced when its own bytes change,
      // and sw.js is static — identical between deploys — so without this the
      // browser never installed a new one and never ran the activation that
      // clears old caches. An installed app could stay on a stale build
      // indefinitely while looking perfectly healthy.
      const url = `/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}`;
      navigator.serviceWorker
        .register(url, { updateViaCache: "none" })
        .then((reg) => {
          registration = reg;

          // controllerchange alone only fires once a new worker has taken
          // over, which needs the old one to release. Watching the incoming
          // worker reach "installed" while a controller exists is what
          // actually says a newer build is ready and waiting.
          reg.addEventListener("updatefound", () => {
            const incoming = reg.installing;
            if (!incoming) return;
            incoming.addEventListener("statechange", () => {
              if (
                incoming.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                // skipWaiting in the worker means it takes over on its own,
                // and controllerchange below does the reload. Asking again is
                // harmless and covers a worker that somehow stayed waiting.
                incoming.postMessage?.({ type: "SKIP_WAITING" });
              }
            });
          });
        })
        .catch(() => {});
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", checkForUpdate);

    // Wait for load so registration never competes with the first paint.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);

  /**
   * Ask an installed app to stay upright.
   *
   * The manifest already declares portrait, but a manifest is read at install
   * time: an app installed before that change keeps the orientation it was
   * installed with until it is reinstalled. This reaches those.
   *
   * It resolves only where the platform has an orientation to lock — an
   * installed app or a fullscreen document. A browser tab rejects, which is
   * correct rather than a failure: a tab has no business locking the device,
   * and the height-guarded breakpoints are what handle a tab being turned.
   * iOS does not implement lock at all, hence the check before calling.
   */
  useEffect(() => {
    // lock() is absent from the DOM types this project builds against, and it
    // is genuinely absent at runtime on iOS, so the declaration is optional and
    // the check below is a real one rather than a formality.
    const orientation = window.screen?.orientation as
      | (ScreenOrientation & { lock?: (to: "portrait") => Promise<void> })
      | undefined;
    if (typeof orientation?.lock !== "function") return;

    // try/catch around the call as well as .catch on the promise. The spec
    // says lock() rejects when the platform will not honour it, but not every
    // engine agrees — some throw outright — and this effect runs inside the
    // provider that wraps the entire app. A cosmetic orientation request must
    // not be able to take the app down with it.
    try {
      orientation.lock("portrait").catch(() => {});
    } catch {
      // Nothing to do: the layout does not depend on this succeeding.
    }
  }, []);

  // Created in state so the client is stable across re-renders but never
  // shared between requests.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The catalogue is a static asset that only changes when the
            // pipeline re-exports, so there is nothing to revalidate against.
            staleTime: Infinity,
            gcTime: Infinity,
            refetchOnWindowFocus: false,
            retry: 2,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      {/* One provider for every tooltip in the app, mounted here rather than
          per-component: Base UI's tooltip needs exactly one Provider as a
          shared ancestor, and this is already the client boundary everything
          else renders inside. */}
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
