"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { FACET_LABEL, facetCounts, type Catalogue, type RawSong } from "@/lib/catalogue";

// Rows shown before "show all". Six is enough to cover the values that matter
// in most facets — the long tail is what search is for.
const PREVIEW_ROWS = 6;
const EXPANDED_ROWS = 40;

type Option = { label: string; index: number; count: number };

function FacetSection({
  facet,
  options,
  selected,
  forceOpen,
  onToggle,
  onClearFacet,
}: {
  facet: string;
  options: Option[];
  selected: Set<number>;
  forceOpen: boolean;
  onToggle: (facet: string, index: number) => void;
  onClearFacet: (facet: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (options.length === 0) return null;

  // Everything starts closed. Seven open sections of fifty rows each is a wall
  // of text that hides the one control the user came for.
  const expanded = forceOpen || open || selected.size > 0;
  const visible = showAll || forceOpen ? options.slice(0, EXPANDED_ROWS) : options.slice(0, PREVIEW_ROWS);

  return (
    <div className="border-b border-white/[0.06] last:border-0">
      <div className="flex items-center">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 px-4 py-2.5 text-left transition hover:bg-white/[0.04]"
        >
          <ChevronDown
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
              expanded ? "" : "-rotate-90"
            }`}
          />
          <span className="flex-1 text-xs font-medium text-foreground/80">
            {FACET_LABEL[facet]}
          </span>
          {selected.size > 0 ? (
            <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {selected.size}
            </span>
          ) : (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {options.length}
            </span>
          )}
        </button>
        {selected.size > 0 && (
          <button
            onClick={() => onClearFacet(facet)}
            title={`Clear ${FACET_LABEL[facet]}`}
            aria-label={`Clear ${FACET_LABEL[facet]} filters`}
            className="px-3 text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-1.5 pb-2">
          {visible.map((option) => {
            const on = selected.has(option.index);
            return (
              <button
                key={option.index}
                onClick={() => onToggle(facet, option.index)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition hover:bg-white/[0.06] ${
                  on ? "text-primary" : "text-foreground/85"
                }`}
              >
                <span
                  className={`grid size-3.5 shrink-0 place-items-center rounded-[3px] border transition ${
                    on ? "border-primary bg-primary" : "border-white/25"
                  }`}
                >
                  {on && <Check className="size-2.5 text-primary-foreground" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">{option.label}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {option.count.toLocaleString()}
                </span>
              </button>
            );
          })}

          {!forceOpen && options.length > PREVIEW_ROWS && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="px-2 py-1.5 text-[11px] text-primary transition hover:underline"
            >
              {showAll
                ? "Show fewer"
                : `Show ${Math.min(options.length, EXPANDED_ROWS) - PREVIEW_ROWS} more`}
            </button>
          )}
          {showAll && options.length > EXPANDED_ROWS && (
            <p className="px-2 py-1 text-[10px] text-muted-foreground">
              {(options.length - EXPANDED_ROWS).toLocaleString()} more — use search
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function FacetPanel({
  catalogue,
  results,
  selected,
  onToggle,
  onClear,
}: {
  catalogue: Catalogue;
  results: RawSong[];
  selected: Record<string, Set<number>>;
  onToggle: (facet: string, index: number) => void;
  onClear: () => void;
}) {
  const [needle, setNeedle] = useState("");
  const active = Object.values(selected).reduce((n, s) => n + s.size, 0);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(FACET_LABEL).map((facet) => [facet, facetCounts(results, facet)])
      ),
    [results]
  );

  const query = needle.trim().toLowerCase();

  const optionsByFacet = useMemo(() => {
    const out: Record<string, Option[]> = {};
    for (const facet of Object.keys(FACET_LABEL)) {
      const values = catalogue.facets[facet as keyof Catalogue["facets"]];
      const chosen = selected[facet] ?? new Set<number>();
      let list = values
        .map((label, index) => ({ label, index, count: counts[facet].get(index) ?? 0 }))
        .filter((o) => o.count > 0 || chosen.has(o.index));
      list.sort(
        (a, b) =>
          Number(chosen.has(b.index)) - Number(chosen.has(a.index)) ||
          b.count - a.count ||
          a.label.localeCompare(b.label)
      );
      if (query) list = list.filter((o) => o.label.toLowerCase().includes(query));
      out[facet] = list;
    }
    return out;
  }, [catalogue, counts, selected, query]);

  const chips = useMemo(
    () =>
      Object.entries(selected).flatMap(([facet, set]) =>
        [...set].map((index) => ({
          facet,
          index,
          label: catalogue.facets[facet as keyof Catalogue["facets"]][index],
        }))
      ),
    [catalogue, selected]
  );

  const clearFacet = (facet: string) => {
    for (const index of selected[facet] ?? []) onToggle(facet, index);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-white/[0.06] px-3 py-2.5">
        {/* One search across every facet, so the sections can stay shut. Per
            section search boxes were a second layer of chrome doing the same
            job. */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder="Filter by artist, film, mood…"
            className="h-8 w-full rounded-md border border-white/10 bg-white/[0.05] pl-7 pr-6 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/40"
          />
          {needle && (
            <button
              onClick={() => setNeedle("")}
              aria-label="Clear filter search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((chip) => (
              <button
                key={`${chip.facet}-${chip.index}`}
                onClick={() => onToggle(chip.facet, chip.index)}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary transition hover:bg-primary/25"
              >
                <span className="truncate">{chip.label}</span>
                <X className="size-2.5 shrink-0" />
              </button>
            ))}
            {active > 1 && (
              <button
                onClick={onClear}
                className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
        {Object.keys(FACET_LABEL).map((facet) => (
          <FacetSection
            key={facet}
            facet={facet}
            options={optionsByFacet[facet]}
            selected={selected[facet] ?? new Set()}
            forceOpen={query.length > 0}
            onToggle={onToggle}
            onClearFacet={clearFacet}
          />
        ))}
      </div>
    </div>
  );
}
