"use client";

import { useSyncExternalStore } from "react";
import { Check, ImageOff } from "lucide-react";
import {
  BACKDROPS,
  backdropSrc,
  NO_BACKDROP,
  setBackdrop,
  useBackdrop,
} from "@/lib/backdrops";

/**
 * Pick what the app wears.
 *
 * There is no preview pane, because the page itself is the preview: choosing
 * applies immediately and the panel this grid sits on is translucent, so the
 * chosen backdrop is already visible behind the choice being made.
 *
 * The cards show stills rather than the videos. Seven autoplaying clips to
 * choose one is a great deal of decoding for a decision, and the live backdrop
 * behind the page is the moving version already.
 */
export default function ThemesPage() {
  // Before hydration the store reports "none", which for AppBackdrop means
  // "draw nothing" but here would read as "None is your choice" — and would
  // ship in the prerendered HTML with the check badge on it. Until the real
  // value arrives, nothing is selected.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const chosen = useBackdrop();
  const selectedId = hydrated ? chosen : null;

  return (
    // The same reading column as /about and /releases. These three are the
    // app's settled-down pages — read rather than browsed — and running the
    // grid to the full width of a desktop made this one feel like a different
    // section of the site.
    <div className="mx-auto max-w-3xl">
      <div className="pb-5">
        <h2 className="pt-1 text-3xl leading-tight">Themes</h2>
        <p className="text-xs text-muted-foreground">
          Kept on this device · applies straight away
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 pb-8 sm:grid-cols-3">
        {BACKDROPS.map((backdrop) => {
          const selected = selectedId === backdrop.id;
          return (
            <button
              key={backdrop.id}
              onClick={() => setBackdrop(backdrop.id)}
              aria-pressed={selected}
              className={`group overflow-hidden rounded-xl border text-left transition ${
                selected
                  ? "border-primary/60 ring-1 ring-primary/40"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <span className="relative block aspect-video overflow-hidden bg-black/40">
                <img
                  src={backdropSrc(backdrop.id).poster}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover transition duration-500 group-hover:scale-105"
                />
                {selected && (
                  <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3.5" />
                  </span>
                )}
              </span>
              <span className="block px-3 py-2.5">
                <span className="block truncate text-sm">{backdrop.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {backdrop.note}
                </span>
              </span>
            </button>
          );
        })}

        {/* Absence, offered as plainly as the rest. A moving backdrop is not to
            everyone's taste and should not need a browser setting to escape. */}
        <button
          onClick={() => setBackdrop(NO_BACKDROP)}
          aria-pressed={selectedId === NO_BACKDROP}
          className={`group overflow-hidden rounded-xl border text-left transition ${
            selectedId === NO_BACKDROP
              ? "border-primary/60 ring-1 ring-primary/40"
              : "border-white/10 hover:border-white/25"
          }`}
        >
          <span className="relative grid aspect-video place-items-center bg-black/30">
            <ImageOff className="size-6 text-muted-foreground" />
            {selectedId === NO_BACKDROP && (
              <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3.5" />
              </span>
            )}
          </span>
          <span className="block px-3 py-2.5">
            <span className="block text-sm">None</span>
            <span className="block text-[11px] text-muted-foreground">
              Just the dark room
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
