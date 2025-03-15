"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Heart } from "lucide-react";

/**
 * Small hearts rising from a tap.
 *
 * Portalled onto document.body rather than rendered where the tap happened,
 * for two independent reasons that have the same fix. The song list is a scroll
 * container, so particles rising out of a row would be clipped at its edge; and
 * the list is virtualised, so the row can unmount mid-flight and take the
 * animation with it. Positioned from the button's screen coordinates, captured
 * at click time, they are subject to neither.
 *
 * The host is mounted once by the app frame and renders nothing until a burst
 * fires. A module-level emitter reaches it, so a button does not need to be
 * wired to anything.
 */

type Particle = {
  dx: string;
  dy: string;
  rot: string;
  scale: string;
  delay: string;
  size: number;
};

type Burst = { key: number; x: number; y: number; particles: Particle[] };

const COUNT = 6;
/** Longest a particle can still be on screen: duration + the largest delay. */
const LIFETIME = 1100;
/**
 * Four at once is plenty. A fifth drops the oldest rather than queueing —
 * queued bursts arrive after the tap that caused them and read as lag.
 */
const MAX = 4;

/** Frozen and hoisted: React compares successive getServerSnapshot results by
 *  reference during hydration, so returning a fresh array each call trips its
 *  "should be cached to avoid an infinite loop" check. */
const NONE: readonly Burst[] = Object.freeze([]);

let sequence = 0;
let bursts: readonly Burst[] = NONE;
const listeners = new Set<() => void>();

function publish(next: Burst[]) {
  bursts = Object.freeze(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function particle(): Particle {
  // Signed drift so they fan out either side, biased upward by the rise.
  const dx = Math.round((Math.random() - 0.5) * 90);
  const dy = -Math.round(70 + Math.random() * 70);
  return {
    dx: `${dx}px`,
    dy: `${dy}px`,
    rot: `${Math.round((Math.random() - 0.5) * 90)}deg`,
    scale: (0.4 + Math.random() * 0.4).toFixed(2),
    delay: `${Math.round(Math.random() * 120)}ms`,
    size: 10 + Math.round(Math.random() * 8),
  };
}

/**
 * Fire a burst at a point on screen.
 *
 * Silently does nothing under reduced motion. That is not a lesser version of
 * the feature: the heart filling is the information, and this is decoration.
 */
export function burstAt(x: number, y: number) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const key = ++sequence;
  const next = [
    ...bursts,
    { key, x, y, particles: Array.from({ length: COUNT }, particle) },
  ].slice(-MAX);
  publish(next);

  // A timer rather than animationend. The end event would arrive six times per
  // burst and the last one is not identifiable without tracking them, whereas
  // the duration is a number we chose. It also survives a tab backgrounded
  // mid-animation, where animation events never arrive at all.
  window.setTimeout(() => {
    // The cap can have evicted this burst already, in which case removing it
    // again is a no-op that would still allocate a fresh array and notify
    // every listener for a change nobody can observe.
    if (!bursts.some((burst) => burst.key === key)) return;
    publish(bursts.filter((burst) => burst.key !== key));
  }, LIFETIME);
}

export function LikeBurstHost() {
  const active = useSyncExternalStore(
    subscribe,
    () => bursts,
    () => NONE
  );

  // Nothing to draw, and — because the server snapshot is always empty — this
  // is also what keeps createPortal away from a document that does not exist
  // during the server render. A burst can only come from a click.
  if (active.length === 0) return null;

  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[95]">
      {active.map((burst) =>
        burst.particles.map((p, i) => (
          <Heart
            key={`${burst.key}-${i}`}
            className="absolute fill-primary text-primary"
            style={
              {
                left: burst.x,
                top: burst.y,
                width: p.size,
                height: p.size,
                "--dx": p.dx,
                "--dy": p.dy,
                "--rot": p.rot,
                "--end-scale": p.scale,
                animation: `like-rise 900ms cubic-bezier(0.22, 0.61, 0.36, 1) ${p.delay} both`,
              } as React.CSSProperties
            }
          />
        ))
      )}
    </div>,
    document.body
  );
}
