"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Flag,
  Info,
  ListVideo,
  Maximize2,
  Repeat,
  Shuffle,
  X,
} from "lucide-react";

/**
 * The player controls that do not fit on a phone.
 *
 * The bar can hold the transport and the title and nothing else at that width,
 * so queue, repeat, shuffle, credits and reporting were simply absent below md
 * — present on a desktop and unreachable on the device most people are using.
 *
 * A sheet from the bottom rather than a dropdown: it is within reach of a thumb,
 * and the toggles need room to show their state, which a dense menu row does
 * not give them.
 */
export function PlayerMenu({
  open,
  onClose,
  repeat,
  shuffle,
  onToggleRepeat,
  onToggleShuffle,
  onQueue,
  onCredits,
  onReport,
  onExpand,
}: {
  open: boolean;
  onClose: () => void;
  repeat: boolean;
  shuffle: boolean;
  onToggleRepeat: () => void;
  onToggleShuffle: () => void;
  onQueue: () => void;
  onCredits: () => void;
  onReport: () => void;
  onExpand: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  // Closes on its way out for anything that opens a surface of its own, so the
  // sheet is never left sitting behind a dialog.
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  const row =
    "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm transition hover:bg-white/[0.07]";

  return createPortal(
    <div
      className="fixed inset-0 z-[96] flex flex-col justify-end bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="rounded-t-2xl border-t border-white/10 bg-card p-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Grab handle, so the sheet reads as something that came up from the
            bottom rather than a panel that appeared. */}
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20" />

        <div className="flex items-center justify-between px-3 pb-1">
          <span className="text-xs text-muted-foreground">Player</span>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="rounded-full p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <button onClick={run(onExpand)} className={row}>
          <Maximize2 className="size-4 text-muted-foreground" /> Open full player
        </button>
        <button onClick={run(onQueue)} className={row}>
          <ListVideo className="size-4 text-muted-foreground" /> Queue
        </button>
        <button onClick={run(onCredits)} className={row}>
          <Info className="size-4 text-muted-foreground" /> Credits for this song
        </button>

        <div className="my-1 h-px bg-white/[0.06]" />

        {/* Toggles stay open: they change state here rather than sending you
            somewhere, and turning both on is one gesture that way. */}
        <button onClick={onToggleShuffle} aria-pressed={shuffle} className={row}>
          <Shuffle className={`size-4 ${shuffle ? "text-primary" : "text-muted-foreground"}`} />
          Shuffle
          <span className={`ml-auto text-xs ${shuffle ? "text-primary" : "text-muted-foreground"}`}>
            {shuffle ? "On" : "Off"}
          </span>
        </button>
        <button onClick={onToggleRepeat} aria-pressed={repeat} className={row}>
          <Repeat className={`size-4 ${repeat ? "text-primary" : "text-muted-foreground"}`} />
          Repeat one
          <span className={`ml-auto text-xs ${repeat ? "text-primary" : "text-muted-foreground"}`}>
            {repeat ? "On" : "Off"}
          </span>
        </button>

        <div className="my-1 h-px bg-white/[0.06]" />

        <button onClick={run(onReport)} className={row}>
          <Flag className="size-4 text-muted-foreground" /> Wrong recording?
        </button>
      </div>
    </div>,
    document.body
  );
}
