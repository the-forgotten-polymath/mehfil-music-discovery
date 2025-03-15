/**
 * The shared pieces both /curious pages are built from.
 *
 * Server components, no hooks, no state — these pages render once and never
 * change, so there is nothing here to hydrate.
 */

/**
 * A panel with a surface of its own.
 *
 * The pages first shipped with bordered boxes and no fill, which on a dark
 * ground reads as an outline drawn on nothing rather than a card sitting on
 * something. bg-card/40 rather than bg-card: the app's own backdrop plays
 * behind every page, and a solid panel would black it out.
 */
export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-white/[0.07] bg-card/40 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A block of real code, lifted from the repository.
 *
 * Deliberately quoting rather than illustrating: an invented snippet in a page
 * about how something works is the same failure as an invented number.
 *
 * overflow-x-auto on the block itself, so a long line scrolls inside its own
 * box instead of pushing the page sideways — which on a phone is the whole
 * difference between a code sample and a broken layout.
 */
export function Code({ children, caption }: { children: string; caption?: string }) {
  return (
    <figure className="mt-3">
      <pre className="overflow-x-auto rounded-lg border border-white/[0.07] bg-black/40 p-3.5 font-mono text-[11.5px] leading-relaxed text-foreground/75">
        <code>{children}</code>
      </pre>
      {caption && (
        <figcaption className="mt-1.5 text-xs text-muted-foreground/80">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Emphasis that survives without colour.
 *
 * <strong> first, accent second. The brass is what catches the eye, but colour
 * alone cannot carry meaning — anyone reading with a screen reader or without
 * colour still needs to know which words were the load-bearing ones.
 */
export function Key({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-primary">{children}</strong>;
}
