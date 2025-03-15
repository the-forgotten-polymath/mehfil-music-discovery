/**
 * What has shipped, and when.
 *
 * Written by hand rather than generated from git. A build on Vercel gets a
 * shallow clone with no tags and no merge history worth reading, and a
 * changelog assembled from commit subjects would say "fix the thing" a hundred
 * times. This is the record a person would want: what arrived, what broke, and
 * what the fix actually was.
 *
 * Every entry traces to a merged pull request on the repository, and the
 * numbers in them are measured rather than remembered — they come from the
 * pull requests themselves.
 *
 * Add a release at the TOP when one ships. Do not renumber old ones.
 */

export type Release = {
  version: string;
  /** ISO date the work reached master. */
  date: string;
  title: string;
  /**
   * The pull request it landed as, where there was one.
   *
   * Kept for whoever maintains this list — it is how you find what a line
   * refers to — but deliberately not rendered. A reader here wants to know
   * what changed, not to be handed a diff, and sending someone from a music
   * app to GitHub is an invitation nobody asked for.
   */
  pr?: number;
  /** What the release brought that was not there before. */
  added?: string[];
  /** What was broken and is not any more. */
  fixed?: string[];
};

export const RELEASES: readonly Release[] = [
  {
    version: "0.9",
    date: "2026-08-09",
    title: "Favourites, backdrop themes, and a welcome",
    pr: 8,
    added: [
      "Favourites: like any song and find it again on its own page, kept on your device in about 20 KB — no account, no server.",
      "Seven animated backdrops behind a Themes page. 12.7 MB of source art became 1.4 MB of video, and only the one you pick is ever downloaded.",
      "Favourites and Themes reachable from the header at every screen size, not just the menu.",
      "Tooltips on every icon control, roughly thirty accessibility fixes, and a description for each page.",
      "A first-run note saying plainly what this app does not own and does not store.",
    ],
    fixed: [
      "Two browser tabs could quietly delete each other's likes — a like made in one was lost when the other saved next.",
      "Unliking the song you were listening to sent playback to the top of the list instead of continuing.",
      "The like button was invisible to screen readers in every song list.",
      "Opening an empty Favourites page stopped playback from advancing for the rest of the session.",
      "Aa Dil Se Dil Mila Le played the 2007 Naqaab song instead of the 1959 Navrang recording by Asha Bhosle.",
    ],
  },
  {
    version: "0.8",
    date: "2026-08-09",
    title: "Permanent song ids",
    pr: 7,
    fixed: [
      "A song's id was its position in an alphabetical list, so adding one new song renumbered 3,867 of 3,916 of them.",
      "Because videos are stored against those ids, the next catalogue rebuild would have handed nearly every song the previous song's recording — silently, with nothing to notice it by.",
      "Ids now come from a permanent ledger and only ever get added to. A check refuses to load or publish a catalogue whose ids disagree with it.",
    ],
  },
  {
    version: "0.7",
    date: "2026-08-09",
    title: "Phones keep the phone layout when turned sideways",
    pr: 6,
    fixed: [
      "Tilting a phone made it wide enough to look like a tablet, so the app rearranged itself into a layout meant for a much taller window.",
      "Screen size is now judged by height as well as width, and installed apps are asked to stay upright.",
    ],
  },
  {
    version: "0.6",
    date: "2026-08-08",
    title: "Lock-screen controls, an animated backdrop, and mobile polish",
    pr: 5,
    added: [
      "Title, artwork and skip controls on the phone's lock screen.",
      "An animated backdrop behind the whole app.",
      "A reworked all-songs card, smaller search results on phones, and a Surprise control with real faces on it.",
    ],
    fixed: [
      "Shuffle could pick the song already playing, which stopped the music while the bar carried on showing it as playing.",
    ],
  },
  {
    version: "0.5",
    date: "2026-08-04",
    title: "Installed apps stopped getting stuck on old builds",
    pr: 4,
    fixed: [
      "An installed app could sit on a months-old version forever: the file that controls updates never changed, so the browser never noticed there was anything new.",
      "This was the real cause of the reported autoplay bug — the phone was running old code.",
      "Offline now says so, rather than looking broken.",
    ],
  },
  {
    version: "0.4",
    date: "2026-08-04",
    title: "Wrong recordings fixed, missing ones found",
    pr: 3,
    added: [
      "A way to report a wrong recording, or send a link for a song we could not find.",
      "Every Saregama channel harvested, so more songs play the catalogue recording.",
    ],
    fixed: [
      "905 more songs play. Hour-long jukeboxes, dead links and silent embeds are gone.",
      "121 songs played the wrong recording. The matcher had been confirming the film or a singer without ever confirming the song.",
      "56 songs are deliberately left unmatched — a wrong recording is worse than a missing one.",
    ],
  },
  {
    version: "0.3",
    date: "2026-08-04",
    title: "A portrait for everyone credited",
    pr: 2,
    added: [
      "Singers, composers, lyricists and actors all have pictures, not just the ones the first pass happened to find.",
    ],
    fixed: [
      "Anyone who only ever acted was rejected outright, so people with perfectly good portraits had none.",
      "Duos were credited as one of their members, so the wrong face appeared.",
      "Parse faults the portraits exposed — names split mid-word, films swallowing other films.",
    ],
  },
  {
    version: "0.2",
    date: "2026-08-03",
    title: "Real routes and a player that survives navigation",
    pr: 1,
    added: [
      "Every station, singer, composer, lyricist, actor and film has its own address you can link to.",
      "A full-screen player.",
    ],
    fixed: [
      "Moving between pages tore down the player and stopped the music. It now lives above the pages rather than inside one.",
    ],
  },
  {
    version: "0.1",
    date: "2026-08-02",
    title: "First working version",
    added: [
      "The Carvaan Gold songlist parsed from the official PDF into 3,916 songs, about 3,011 of which played at this point. Finding the rest took until 0.4.",
      "Browse by station, singer, composer, lyricist, actor, film or mood.",
      "Playback through YouTube, a virtualised song list, and installable as an app.",
    ],
  },
];
