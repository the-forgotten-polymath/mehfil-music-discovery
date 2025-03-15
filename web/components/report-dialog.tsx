"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { track } from "@/lib/analytics";
import { Check, Loader2, X } from "lucide-react";
import { sendReport, type Report, type ReportKind } from "@/lib/feedback";

/**
 * Form for telling us a track is wrong, or supplying one we could not find.
 *
 * A link is the whole point. "This song is wrong" leaves the same search that
 * already failed; a link settles it, and the catalogue has a mechanism that
 * takes exactly that — a corrected id is applied above every automated match
 * and survives re-resolution. So the field is prominent, and required when the
 * song is missing altogether.
 */
export function ReportDialog({
  kind,
  songId,
  songTitle,
  songFilm,
  currentVideoId,
  onClose,
}: {
  kind: ReportKind;
  songId: number;
  songTitle: string;
  songFilm?: string;
  currentVideoId?: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [trap, setTrap] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [mounted, setMounted] = useState(false);

  const wrong = kind === "wrong-track";

  // Portalled to the body. The player bar carries a backdrop-blur, which makes
  // it the containing block for any fixed descendant — so rendered in place the
  // dialog centred itself inside the bar and was clipped by it rather than
  // covering the screen.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Escape closes it, as any dialog should.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);

    const report: Report = {
      kind,
      songId,
      songTitle,
      songFilm,
      currentVideoId,
      suggestedUrl: url,
      note,
      reporterName: name,
    };
    const failure = await sendReport(report, trap);
    setSending(false);
    if (failure) {
      setError(failure);
      return;
    }
    // Only on a confirmed write. Counting attempts would tell us how often
    // people try, which is a different and less useful number than how often
    // the catalogue actually gets a correction out of it.
    track("report", { kind });
    setSent(true);
    setTimeout(onClose, 1600);
  }

  if (!mounted) return null;

  return createPortal(
    <div
      // Flex, not grid. `grid place-items-center` gives the card an implicit
      // column sized to its own max-content, so `w-full` on the card resolved
      // against that instead of the screen: a long song title made the column
      // wider than the viewport and the whole dialog hung off the right edge.
      // A flex centre sizes the child against the container, which is what the
      // max-width was always meant to be measured from.
      className="fixed inset-0 z-[95] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full min-w-0 max-w-md overflow-y-auto rounded-xl border border-white/10 bg-card p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {wrong ? "Report the wrong recording" : "Add a link for this song"}
            </p>
            <p className="truncate text-xs text-muted-foreground">{songTitle}</p>
            {songFilm && (
              <p className="truncate text-xs text-muted-foreground/70">{songFilm}</p>
            )}
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="rounded-full p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {sent ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-primary">
            <Check className="size-4" /> Thank you, that has been recorded.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3.5">
            {wrong && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                A link is the most useful thing you can give us. Without one we
                are left running the same search that already went wrong.
              </p>
            )}
            <label className="block">
              <span className="block text-xs leading-tight text-muted-foreground">
                {wrong ? "Link to the correct recording" : "YouTube link"}
                {wrong && (
                  <span className="text-muted-foreground/60"> (optional)</span>
                )}
              </span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                autoFocus
                className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.06] px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
              />
            </label>

            <label className="block">
              <span className="block text-xs leading-tight text-muted-foreground">
                Anything else worth knowing
                <span className="text-muted-foreground/60"> (optional)</span>
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder={
                  wrong
                    ? "e.g. this is a remix, or a different singer"
                    : "e.g. which film it is really from"
                }
                className="mt-1 w-full resize-none rounded-md border border-white/10 bg-white/[0.06] px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
              />
            </label>

            <label className="block">
              <span className="block text-xs leading-tight text-muted-foreground">
                Your name
                <span className="text-muted-foreground/60">
                  {" "}(optional, shown as a credit on the song)
                </span>
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                placeholder="Leave blank to stay anonymous"
                className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.06] px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
              />
            </label>

            {/* Honeypot. Hidden from people and from screen readers; left in the
                DOM because a bot that fills the form by field name fills it. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              value={trap}
              onChange={(event) => setTrap(event.target.value)}
              className="pointer-events-none absolute -left-[9999px] size-0 opacity-0"
            />

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending}
                className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {sending && <Loader2 className="size-3.5 animate-spin" />}
                Send
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
