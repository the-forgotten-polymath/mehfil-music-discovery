/**
 * Shape of what people send us about a song, shared by the form and the route
 * that receives it.
 *
 * Two things get reported, and they are the two the pipeline cannot judge for
 * itself. A wrong track passes every automated check — right title, right film,
 * right credits, plausible length, plays fine — and is simply not the recording
 * anyone means; only a listener knows. A missing song is one the resolver could
 * not find, which is usually a search-phrasing problem rather than an absence.
 *
 * Both are far more useful with a link than without, so the form asks for one
 * and the id is extracted here rather than left as free text to be untangled
 * later.
 */

export type ReportKind = "wrong-track" | "missing-song";

export type Report = {
  kind: ReportKind;
  songId: number;
  songTitle: string;
  songFilm?: string;
  /** What is playing now, for a wrong-track report. */
  currentVideoId?: string;
  /** The link they suggest, as typed. */
  suggestedUrl?: string;
  note?: string;
  /** Optional, for crediting. Blank means they would rather stay anonymous. */
  reporterName?: string;
};

/**
 * Pull the video id out of whatever form of YouTube link was pasted.
 *
 * People paste what the share button gives them, which carries playlist and
 * radio parameters — the link in a report of this kind is typically
 * `watch?v=ID&list=RDID&start_radio=1`. Storing the whole thing means untangling
 * it by hand later, so it is reduced to the id at the point of entry, where it
 * can also be checked.
 */
/** Hosts a YouTube video can legitimately be linked from. */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

export function youtubeId(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;

  // A bare id, pasted without the surrounding link.
  if (/^[\w-]{11}$/.test(raw)) return raw;

  // Parsed rather than pattern-matched, so the host is actually checked. A
  // regex looking for "?v=" anywhere accepts https://evil.example.com/?v=ID —
  // it finds a real-looking id in a URL pointing somewhere else entirely, and
  // that URL is what gets stored and later opened. An exact host match also
  // rejects youtube.com.attacker.net, which a substring test would not.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  const fromQuery = url.searchParams.get("v");
  if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) return fromQuery;

  // youtu.be/ID, /embed/ID, /shorts/ID, /live/ID — the id is the path segment.
  const path = url.pathname.split("/").filter(Boolean);
  const last = path[path.length - 1];
  if (last && /^[\w-]{11}$/.test(last)) return last;

  return null;
}

/** Human-readable reason a report cannot be sent, or null if it can. */
export function validateReport(report: Report): string | null {
  if (!report.songTitle?.trim()) return "Missing song.";
  if (report.kind === "missing-song" && !report.suggestedUrl?.trim()) {
    return "Please paste a YouTube link.";
  }
  if (report.suggestedUrl?.trim() && !youtubeId(report.suggestedUrl)) {
    return "That does not look like a YouTube link.";
  }
  if ((report.note?.length ?? 0) > 500) return "Note is too long.";
  return null;
}

/** Send a report. Resolves to an error message, or null when it went through. */
export async function sendReport(
  report: Report,
  /** Honeypot: a real person never fills this in, a bot fills in everything. */
  trap = ""
): Promise<string | null> {
  const invalid = validateReport(report);
  if (invalid) return invalid;

  try {
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...report, trap }),
    });
    if (response.ok) return null;
    const body = await response.json().catch(() => ({}));
    return body.error || `Could not send (${response.status}).`;
  } catch {
    return "Could not reach the server. Please try again.";
  }
}
