"use client";

import { Loader2 } from "lucide-react";

/**
 * Loading and failure screens for the catalogue fetch.
 *
 * Every route needs the same two states, and duplicating them per page is how
 * they drift apart. Rendered as a gate rather than inside the shell, because
 * the shell itself needs the catalogue to draw its counts and filters.
 */
export function CatalogueGate({
  isLoading,
  isError,
  error,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="relative grid h-[100dvh] place-items-center overflow-hidden px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]"
        />
        <div className="relative flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt=""
            width={88}
            height={88}
            className="size-22 animate-pulse rounded-2xl shadow-2xl"
          />
          <h1 className="mt-5 text-2xl tracking-tight">Mehfil</h1>
          <p className="mt-1 text-xs text-muted-foreground">Retro Bollywood songs</p>
          <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading catalogue…
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="grid h-[100dvh] place-items-center px-6 text-center">
        <div className="flex flex-col items-center">
          <img
            src="/logo.png"
            alt=""
            width={64}
            height={64}
            className="size-16 rounded-2xl opacity-60 grayscale"
          />
          <p className="mt-5 text-sm">Could not load the catalogue.</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 rounded-full border border-white/15 px-4 py-2 text-xs transition hover:border-white/30"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
