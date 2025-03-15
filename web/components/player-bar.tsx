"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import {
  ChevronDown,
  ChevronUp,
  Flag,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  ListVideo,
  Info,
  MoreVertical,
  Volume2,
  VolumeX,
} from "lucide-react";
import { artwork, type Song } from "@/lib/catalogue";
import {
  setHandlers,
  setNowPlaying,
  setPlaybackState,
  setPosition,
} from "@/lib/media-session";
import { LikeButton } from "@/components/like-button";
import { AppBackdrop } from "@/components/app-backdrop";
import { ReportDialog } from "@/components/report-dialog";
import { SongDetails } from "@/components/song-details";
import { PlayerMenu } from "@/components/player-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCatalogue, useSongCredits } from "@/lib/queries";
import { QueuePanel } from "@/components/queue-panel";

type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(
    id: string | { videoId: string; suggestedQuality?: string }
  ): void;
  setPlaybackQuality?(quality: string): void;
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getIframe?(): HTMLIFrameElement | null;
  destroy?(): void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YTPlayer;
      PlayerState: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

// YouTube's onError codes. 101 and 150 are the same condition reported two
// ways: the owner has disallowed embedded playback.
const ERROR_TEXT: Record<number, string> = {
  2: "Invalid video id",
  5: "Playback failed in this browser",
  100: "Video removed or private",
  101: "Owner disabled embedding",
  150: "Owner disabled embedding",
};

// Only some failures are worth retrying. 100/101/150 are deterministic
// refusals — the video is gone, or its owner disallows embedding — and will
// fail identically every time, so retrying only delays the skip. Code 5 is a
// browser-side player failure, and a stall is usually a network hiccup; both
// often clear on a second attempt.
const RETRYABLE_CODES = new Set([5]);
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [600, 1800];

// A load that never reaches PLAYING is indistinguishable from a slow one
// without a deadline. Long enough not to trip on a genuinely slow network.
const STALL_MS = 15000;

// Travel before a drag counts as a swipe rather than a tap.
const SWIPE_THRESHOLD = 60;

/**
 * Quality asked for on every load. "large" is 480p.
 *
 * This is a music player: the picture is incidental and the audio is identical
 * at every rung, so a higher one buys nothing and costs buffering — which is
 * felt most when a track ends and the next has to start without anybody having
 * touched the page.
 *
 * A request, not a setting. YouTube has ignored playback-quality control since
 * 2019 and picks by bandwidth and player size, so this nudges the initial
 * choice and cannot pin it.
 */
const SUGGESTED_QUALITY = "large";

/**
 * Vertical swipe detection.
 *
 * Hand-rolled rather than using a drawer library: every one of them unmounts
 * its content when closed, which would tear down the player iframe and stop
 * playback. Only the direction is needed here, not a full drag-to-dismiss.
 */
function useSwipe(onSwipe: (direction: "up" | "down") => void) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!start.current) return;
      const t = e.changedTouches[0];
      const dy = t.clientY - start.current.y;
      const dx = t.clientX - start.current.x;
      start.current = null;
      // Ignore mostly-horizontal drags so this never fights a sideways scroll.
      if (Math.abs(dy) < SWIPE_THRESHOLD || Math.abs(dy) < Math.abs(dx)) return;
      onSwipe(dy < 0 ? "up" : "down");
    },
  };
}

let apiPromise: Promise<void> | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    window.onYouTubeIframeAPIReady = () => resolve();
    document.head.appendChild(tag);
  });
  return apiPromise;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Seek and volume control.
 *
 * Built on Base UI's slider rather than hand-rolled pointer maths. The custom
 * version never worked on touch: without `touch-action: none` the browser
 * claims the gesture as a scroll and stops sending move events, so a drag
 * registered as a tap. This also brings keyboard and screen-reader support.
 *
 * `dragging` state exists so the displayed position follows the thumb rather
 * than the player, which would otherwise keep overwriting it mid-drag.
 */
function Scrubber({
  value,
  onCommit,
  disabled,
  className = "",
  large = false,
  edge = false,
}: {
  value: number; // 0..1
  onCommit: (fraction: number) => void;
  disabled?: boolean;
  className?: string;
  large?: boolean;
  /** Hairline along the bar's top edge. Desktop only — see the bar below. */
  edge?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(0);
  const shown = dragging ? preview : value;

  return (
    <SliderPrimitive.Root
      value={shown * 1000}
      min={0}
      max={1000}
      disabled={disabled}
      thumbAlignment="edge"
      onValueChange={(v) => {
        setDragging(true);
        setPreview((Array.isArray(v) ? v[0] : v) / 1000);
      }}
      onValueCommitted={(v) => {
        setDragging(false);
        onCommit((Array.isArray(v) ? v[0] : v) / 1000);
      }}
      // Width comes entirely from the caller. Defaulting to w-full here made
      // the volume control ignore its own w-24 and stretch across the bar.
      className={className}
    >
      {/* Fixed height, not padding: the track thickens on hover, and without a
          locked height that growth reflows everything above the bar. The extra
          height is also the real hit target — the finger and cursor land here,
          not on the thin visible track. */}
      <SliderPrimitive.Control
        // items-center matters: Base UI positions the thumb at `top: 50%` of
        // this control as an inline style, so the track has to sit at the
        // control's middle for the two to meet. No translate utility can
        // correct a mismatch — Tailwind v4 compiles those to the `translate`
        // property, which is the property Base UI sets inline, and inline wins.
        className={`group/scrub relative flex w-full cursor-pointer touch-none select-none items-center data-disabled:cursor-not-allowed data-disabled:opacity-50 ${
          edge ? "h-3" : large ? "h-9" : "h-8"
        }`}
      >
        <SliderPrimitive.Track
          className={`relative w-full grow overflow-hidden rounded-full transition-all ${
            edge
              ? "h-[3px] bg-white/15 group-hover/scrub:h-[5px]"
              : `bg-white/25 ${
                  large ? "h-2 group-hover/scrub:h-2.5" : "h-1.5 group-hover/scrub:h-2"
                }`
          }`}
        >
          <SliderPrimitive.Indicator
            className={`h-full rounded-full transition-colors ${
              edge ? "bg-primary" : "bg-foreground group-hover/scrub:bg-primary"
            }`}
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className={`block shrink-0 cursor-grab rounded-full shadow transition-opacity after:absolute after:-inset-3 active:cursor-grabbing ${
            edge
              // Revealed on point: a permanent dot on a hairline is clutter,
              // and this variant only exists where there is a cursor to point.
              ? "size-3 bg-primary opacity-0 group-hover/scrub:opacity-100"
              : `bg-foreground ${large ? "size-4" : "size-3.5"}`
          }`}
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

/**
 * An icon-only transport control.
 *
 * The bar has a dozen of these, and every one needs both a tooltip (for the
 * mouse, which has no other clue what a bare glyph does) and an accessible
 * name (for a screen reader, which may never surface the tooltip at all).
 * Wiring both from a single `label` prop is what keeps them from drifting
 * apart the way the old `title`-only buttons never could.
 */
function ControlButton({
  label,
  onClick,
  disabled,
  pressed,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Only for genuine toggles — shuffle, repeat, mute. Omitted elsewhere. */
  pressed?: boolean;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          disabled ? (
            // A natively `disabled` <button> never gets the pointer/mouse-enter
            // events the tooltip's hover interaction listens for, so the tooltip
            // would otherwise never open here — unlike the `title` this replaced,
            // which still showed on hover of a disabled control. This span is
            // nothing but a hover surface standing in for the dead button: no
            // styling, tabindex or role of its own, so it adds neither a tab stop
            // nor an accessible name of its own — `aria-label` stays on the real
            // button underneath. Resist deleting this as a stray wrapper; the
            // enabled branch right below is the plain button on its own.
            <span>
              <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                aria-label={label}
                aria-pressed={pressed}
                className={className}
              >
                {children}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={onClick}
              disabled={disabled}
              aria-label={label}
              aria-pressed={pressed}
              className={className}
            />
          )
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function PlayerBar({
  song,
  shuffle,
  repeat,
  onToggleShuffle,
  onToggleRepeat,
  onNext,
  onPrev,
  onEnded,
  onPlayingChange,
  onUnplayable,
  ambient,
  onToggleAmbient,
  toggleSignal,
}: {
  song: Song | null;
  shuffle: boolean;
  repeat: boolean;
  ambient: boolean;
  onToggleAmbient: () => void;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onNext: () => void;
  onPrev: () => void;
  onEnded: () => void;
  onPlayingChange: (playing: boolean) => void;
  onUnplayable: (songId: number, reason: string) => void;
  /** Bumped by the provider when a row's control asks for the current song to
   *  be toggled rather than (re)started. See `toggle` below. */
  toggleSignal: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: songCredits } = useSongCredits();
  const credit = song ? songCredits?.[String(song.id)] : undefined;
  const { data: catalogue } = useCatalogue();
  const barSwipe = useSwipe((d) => d === "up" && setExpanded(true));
  const stageSwipe = useSwipe((d) => d === "down" && setExpanded(false));
  // The video layer portals to <body>, which only exists after mount. The
  // extra render this costs is the point: there is no way to know we are on
  // the client during the first one.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount detection
  useEffect(() => setMounted(true), []);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);

  /**
   * Latest values for the YouTube callbacks.
   *
   * Those callbacks are created once, when the player is constructed, and
   * close over that render's scope — so they need a ref to read anything
   * current. The refs are filled in an effect rather than during render:
   * writing to a ref while rendering is not safe under concurrent rendering,
   * where a render can be started and thrown away.
   */
  const endedRef = useRef(onEnded);
  const playingRef = useRef(onPlayingChange);
  const unplayableRef = useRef(onUnplayable);
  const songRef = useRef<Song | null>(song);

  useEffect(() => {
    endedRef.current = onEnded;
    playingRef.current = onPlayingChange;
    unplayableRef.current = onUnplayable;
    songRef.current = song;
  });

  // Attempts spent on the song currently loaded, reset whenever it changes.
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const [retrying, setRetrying] = useState(0);

  // A pending retry outliving the component would call into a torn-down
  // player. Cleared on the song change too, but that path never runs on
  // unmount.
  useEffect(
    () => () => {
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    },
    []
  );

  /**
   * Single funnel for every failure: retry the ones that can plausibly
   * succeed on a second try, give up immediately on the ones that cannot.
   */
  const handleFailure = useRef<(reason: string, retryable: boolean) => void>(() => {});

  // Assigned in an effect, not during render: everything it touches is a ref
  // or a setter, so it never needs to be current *within* a render — only by
  // the time a player callback fires, which is always after one.
  useEffect(() => {
    handleFailure.current = (reason, retryable) => {
      const failed = songRef.current;
      if (!failed) return;

      if (retryable && attemptsRef.current < MAX_ATTEMPTS) {
        const delay = RETRY_BACKOFF_MS[attemptsRef.current - 1] ?? 1800;
        attemptsRef.current += 1;
        setRetrying(attemptsRef.current);
        setFailure(`${reason} — retrying`);
        retryTimerRef.current = window.setTimeout(() => {
          // The song may have changed while the retry was pending.
          if (songRef.current?.id !== failed.id) return;
          setFailure(null);
          setLoading(true);
          playerRef.current?.loadVideoById({
            videoId: failed.video,
            suggestedQuality: SUGGESTED_QUALITY,
          });
        }, delay);
        return;
      }

      setLoading(false);
      setPlaying(false);
      setRetrying(0);
      playingRef.current(false);
      setFailure(reason);
      unplayableRef.current(failed.id, reason);
    };
  });

  useEffect(() => {
    // hostRef lives inside the portal, so there is nothing to attach to until
    // the portal has rendered.
    if (!mounted) return;
    let cancelled = false;
    loadYouTubeAPI().then(() => {
      if (cancelled || !hostRef.current) return;
      // A player whose iframe has been detached is unrecoverable: every call
      // silently does nothing and the UI waits forever. `playerRef` being set
      // is not proof the player is alive, so check the iframe is still in the
      // document and rebuild if it is not.
      if (playerRef.current) {
        const iframe = playerRef.current.getIframe?.();
        if (iframe && document.contains(iframe)) return;
        playerRef.current.destroy?.();
        playerRef.current = null;
        setReady(false);
      }
      playerRef.current = new window.YT!.Player(hostRef.current, {
        height: "100%",
        width: "100%",
        playerVars: { autoplay: 0, controls: 0, rel: 0, playsinline: 1 },
        events: {
          onReady: () => {
            // Ignored by the player more often than not, but free to ask and
            // it does take effect on some clients.
            playerRef.current?.setPlaybackQuality?.(SUGGESTED_QUALITY);
            setReady(true);
          },
          onStateChange: (event: { data: number }) => {
            const state = window.YT!.PlayerState;

            const isPlaying = event.data === state.PLAYING;
            setPlaying(isPlaying);
            playingRef.current(isPlaying);

            // Advancing happens after the state is reported, not before. Run
            // first, its play() set the provider playing while the lines below
            // immediately set it back to false for the track that had just
            // ended — the new song inherited the outgoing one's state.
            if (event.data === state.ENDED) endedRef.current();

            // Buffering and unstarted both mean "not audible yet". Anything
            // else means the load resolved one way or the other.
            setLoading(
              event.data === state.BUFFERING || event.data === state.UNSTARTED
            );
            if (isPlaying) setFailure(null);
          },
          // Without this a refused video is indistinguishable from a slow one:
          // the bar simply sits at 0:00 forever.
          onError: (event: { data: number }) => {
            const reason = ERROR_TEXT[event.data] ?? `Playback error ${event.data}`;
            handleFailure.current(reason, RETRYABLE_CODES.has(event.data));
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [mounted]);

  useEffect(() => {
    if (!ready || !song || !playerRef.current) return;
    // A new song gets a fresh attempt budget, and any pending retry for the
    // previous one is abandoned.
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    attemptsRef.current = 1;
    setRetrying(0);
    playerRef.current.loadVideoById({
      videoId: song.video,
      suggestedQuality: SUGGESTED_QUALITY,
    });
    // loadVideoById is documented to start playback, and mostly does. After a
    // track ends it sometimes loads and waits instead, which reads as the queue
    // stopping — the next song is cued, the bar shows it, and nothing plays
    // until Next is pressed, which does no more than this line. Asking costs
    // nothing when it was going to play anyway.
    playerRef.current.playVideo();
    setElapsed(0);
    setDuration(0);
    setFailure(null);
    setLoading(true);
    // Keyed on the song as well as the video. Seventeen videos legitimately
    // serve two catalogue entries — the songlist repeats a title across
    // stations — and advancing between two of those changes the song without
    // changing the video, so keying on the video alone left the queue sitting
    // there having loaded nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, song?.id, song?.video]);

  /**
   * Re-issue the very first load if nothing has started.
   *
   * The API reports ready slightly before it will reliably accept a command,
   * so the first loadVideoById after construction is sometimes swallowed
   * outright — no error, no state change. It only affects the first play of a
   * session, which is exactly the "first song fails, then it's fine" symptom.
   * A single nudge well before the stall deadline recovers it invisibly.
   */
  const nudgedRef = useRef(false);
  useEffect(() => {
    if (!ready || !song || nudgedRef.current) return;
    const timer = window.setTimeout(() => {
      const player = playerRef.current;
      if (!player || nudgedRef.current) return;
      if (player.getCurrentTime() > 0) {
        nudgedRef.current = true;
        return;
      }
      nudgedRef.current = true;
      player.loadVideoById({
        videoId: song.video,
        suggestedQuality: SUGGESTED_QUALITY,
      });
      player.playVideo();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [ready, song]);

  // Some failures never fire onError -- the player just never starts. Give the
  // load a deadline so it reports rather than hanging at 0:00 indefinitely.
  useEffect(() => {
    if (!loading || !song) return;
    const timer = window.setTimeout(() => {
      if (playerRef.current && playerRef.current.getCurrentTime() > 0) return;
      // A stall is usually a network hiccup rather than a dead video, so it
      // gets the same retry budget as a browser-side player error.
      handleFailure.current("Timed out — the video never started", true);
    }, STALL_MS);
    return () => window.clearTimeout(timer);
  }, [loading, song, retrying]);

  useEffect(() => {
    playerRef.current?.setVolume(muted ? 0 : Math.round(volume * 100));
  }, [volume, muted, ready]);

  // The IFrame API emits no time events, so poll while playing.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      setElapsed(player.getCurrentTime());
      setDuration(player.getDuration());
    }, 400);
    return () => window.clearInterval(id);
  }, [playing]);

  // Escape closes the expanded view, matching every other overlay on the web.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  /**
   * Back should close the expanded view, not leave the app.
   *
   * Expanding pushes a history entry, so the system back gesture pops it and
   * collapses instead. Collapsing by any other route (chevron, Escape, swipe)
   * pops that entry itself, so the stack never accumulates.
   */
  useEffect(() => {
    if (!expanded) return;
    // Preserve whatever else is on the entry (the view hook stores its state
    // here too), so popping back to it does not lose the current filters.
    window.history.pushState(
      { ...(window.history.state ?? {}), mehfilPlayer: true },
      ""
    );
    const onPop = () => setExpanded(false);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Only unwind the entry we added; if this cleanup ran *because* of a
      // popstate, the entry is already gone.
      if (window.history.state?.mehfilPlayer) window.history.back();
    };
  }, [expanded]);

  const toggle = () => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) player.pauseVideo();
    else player.playVideo();
  };

  // A row's play button cannot call toggle() directly — it lives outside this
  // file — so the provider bumps toggleSignal instead and this effect is the
  // relay. `toggle` is recreated every render (it closes over `playing`), so
  // it goes in a ref rather than the dependency array: depending on it
  // directly would rerun this effect, and refire the toggle, on every
  // unrelated render. Same problem `skipRef` below solves for onNext/onPrev.
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  });

  // Skipped on the first run: toggleSignal starts at 0, and without this
  // guard mounting the bar would immediately "toggle" a song that was never
  // playing yet.
  const skippedFirstToggleRef = useRef(false);
  useEffect(() => {
    if (!skippedFirstToggleRef.current) {
      skippedFirstToggleRef.current = true;
      return;
    }
    toggleRef.current();
  }, [toggleSignal]);

  const seek = useCallback(
    (fraction: number) => {
      const player = playerRef.current;
      if (!player || duration <= 0) return;
      player.seekTo(fraction * duration, true);
      setElapsed(fraction * duration);
    },
    [duration]
  );

  // What the lock screen shows, and the reason it stays lit at all: a page
  // that has declared a media session is one the platform knows is playback.
  useEffect(() => {
    setNowPlaying(
      song
        ? {
            title: song.title,
            artist: song.artists.join(", ") || "Unknown artist",
            album: song.film ?? undefined,
            artwork: artwork(song.video, "hq"),
          }
        : null
    );
  }, [song]);

  useEffect(() => {
    setPlaybackState(playing);
  }, [playing]);

  // Only while playing. Writing a position for a paused or loading track means
  // writing zeros, which draws a lock-screen scrubber that keeps resetting.
  useEffect(() => {
    if (!playing) return;
    setPosition(elapsed, duration);
  }, [playing, elapsed, duration]);

  // Only next and previous need a ref: they are props and change identity,
  // while the handlers the OS holds are registered once and would otherwise
  // close over the first ones forever.
  const skipRef = useRef({ next: onNext, prev: onPrev });
  useEffect(() => {
    skipRef.current = { next: onNext, prev: onPrev };
  });

  useEffect(() => {
    return setHandlers({
      // Explicitly play and pause, never toggle. The OS sends the action it
      // wants, and its idea of the state can differ from ours for a moment —
      // a lock-screen play while already playing would toggle to a pause,
      // which is the opposite of what was asked for.
      play: () => playerRef.current?.playVideo(),
      pause: () => playerRef.current?.pauseVideo(),
      next: () => skipRef.current.next(),
      previous: () => skipRef.current.prev(),
      seek: (seconds) => {
        const player = playerRef.current;
        if (!player) return;
        player.seekTo(seconds, true);
        setElapsed(seconds);
      },
    });
  }, []);

  // A faint disc appears under the icon on hover, so the secondary controls
  // acknowledge the pointer without competing with the play button, which is
  // the only one that carries a fill at rest.
  // Secondary actions in the expanded view: labelled from sm, icon-only on a
  // narrow phone where four labels would not fit on one line.
  const secondaryAction =
    "flex items-center gap-1.5 rounded-full px-3 py-2 text-xs text-muted-foreground transition hover:bg-white/[0.07] hover:text-foreground active:scale-95";

  const iconButton =
    "grid size-9 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:bg-white/[0.08] hover:text-foreground active:scale-90 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground";

  // Rendered in both the bar and the expanded view, so the controls are always
  // reachable. `large` scales it up for the full-screen layout.
  // Only the expanded view uses this now: the compact bar lays its controls
  // out along the left edge instead, so there is no shared shape to abstract.
  const transport = () => (
    <div className="flex w-full flex-col items-center">
      {/* Generous gaps and a large play button: this is the one surface with
          room for the controls to be sized for a thumb rather than a cursor. */}
      <div className="flex items-center gap-5 sm:gap-7">
        <ControlButton
          label="Shuffle"
          onClick={onToggleShuffle}
          pressed={shuffle}
          className={`${iconButton} ${shuffle ? "text-primary hover:text-primary" : ""}`}
        >
          <Shuffle className="size-5" />
        </ControlButton>
        <ControlButton label="Previous" onClick={onPrev} disabled={!song} className={iconButton}>
          <SkipBack className="size-5 fill-current" />
        </ControlButton>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={toggle}
                disabled={!song || !ready}
                aria-label={playing ? "Pause" : "Play"}
                // The one filled control, so it carries the weight: a soft brass ring
                // and a lift on hover rather than a flat disc. active:scale keeps the
                // press physical instead of instantaneous.
                className="grid size-16 place-items-center rounded-full bg-foreground text-background shadow-[0_4px_20px_-4px_rgba(0,0,0,0.6)] ring-1 ring-primary/20 transition-all duration-200 hover:scale-105 hover:shadow-[0_6px_26px_-4px_rgba(214,168,84,0.5)] hover:ring-primary/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
              />
            }
          >
            {loading ? (
              <Loader2 className="size-6 animate-spin" />
            ) : playing ? (
              <Pause className="size-6 fill-current" />
            ) : (
              <Play className="size-6 translate-x-0.5 fill-current" />
            )}
          </TooltipTrigger>
          <TooltipContent>{playing ? "Pause" : "Play"}</TooltipContent>
        </Tooltip>
        <ControlButton label="Next" onClick={onNext} disabled={!song} className={iconButton}>
          <SkipForward className="size-5 fill-current" />
        </ControlButton>
        <ControlButton
          label="Repeat one"
          onClick={onToggleRepeat}
          pressed={repeat}
          className={`${iconButton} ${repeat ? "text-primary hover:text-primary" : ""}`}
        >
          <Repeat className="size-5" />
        </ControlButton>
      </div>

    </div>
  );

  /**
   * The video always lives in a portal on <body>.
   *
   * It cannot live in the footer: `backdrop-blur` there makes the footer a
   * containing block for fixed-position descendants, so a "full screen"
   * overlay would resolve against the bar and hang off the bottom. And the
   * portal must be unconditional — toggling it would move the node, tearing
   * down the iframe and restarting the song.
   */
  const videoLayer = (
    <div
      {...(expanded ? stageSwipe : {})}
      className={
        expanded
          ? "fixed inset-0 z-[70] flex flex-col overflow-hidden bg-background"
          : "pointer-events-none fixed -left-[9999px] top-0 h-36 w-64 overflow-hidden"
      }
    >
      {/* The app's own backdrop, carried into the full-screen view so it does
          not read as a different application. The layer below is opaque, so
          the one behind the app cannot show through and this is a second copy.

          Desktop only, and deliberately: a second video decode alongside the
          one the player is already running is not something to spend on a
          phone, where the expanded view is full-bleed video and there is no
          margin for a backdrop to occupy anyway. Reduced motion gets the
          still, as everywhere else. */}
      {expanded && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-20 hidden md:block"
        >
          <AppBackdrop opacity={0.2} />
        </div>
      )}

      {/* Ambient wash — room tone. A diffuse full-screen tint that colours the
          space the video sits in; the spill that reads as light coming off the
          screen is the tighter halo around the frame further down. Kept low so
          the two do not sum into a single flat haze.

          The iframe is cross-origin so its frames cannot be sampled to a
          canvas, but a heavily blurred copy of the thumbnail gives the same
          bloom for nothing — no pixel access, no timers. */}
      {expanded && ambient && song && (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          {/* Blurred small and then scaled up, rather than blurred at full
              size. A 100px blur across a full-screen element is a filter over
              two million pixels every frame it is composited; the same look
              comes from blurring a 320px square and scaling it, which is a
              fraction of the work and indistinguishable once out of focus.

              No key, so changing songs swaps the src on one element instead of
              tearing down an image and mounting another — the old frame stays
              up until the new one has decoded, rather than leaving a gap. And
              the source is the small thumbnail: it is about to be destroyed by
              a blur, so the larger one only costs decode time. */}
          <img
            src={artwork(song.video)}
            alt=""
            className="absolute left-1/2 top-1/2 size-80 -translate-x-1/2 -translate-y-1/2 scale-[4] object-cover opacity-40 blur-2xl saturate-[1.8] transition-opacity duration-700"
          />
          {/* Keeps text legible over whatever the artwork happens to be, while
              leaving the middle open so the video sits inside its own glow. */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/55 to-background/35" />
        </div>
      )}

      {expanded && (
        // Constrained to the same column as the video and the controls below
        // it. Spanning the window pushed these to the far edges of a wide
        // screen, so they read as browser chrome rather than part of the view.
        <div className="relative z-10 mx-auto flex w-full max-w-4xl shrink-0 items-center gap-3 px-4 py-4 sm:px-0">
          {/* Collapse leads, as the way out of a full-screen view. A chevron
              alone was easy to miss against the picture behind it. */}
          <ControlButton
            label="Collapse"
            onClick={() => setExpanded(false)}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-foreground/80 backdrop-blur transition hover:bg-white/[0.14] hover:text-foreground"
          >
            <ChevronDown className="size-5" />
          </ControlButton>

          <span className="flex-1 truncate text-center text-[11px] uppercase tracking-widest text-muted-foreground">
            Now playing
          </span>

          {/* Balances the collapse button so "Now playing" sits centred. */}
          <span className="size-9 shrink-0" aria-hidden />
        </div>
      )}

      <div
        className={
          expanded
            // Padding from the smallest size up, not only from md. The cabinet
            // ran edge to edge on a phone, so its sides were cut off by the
            // viewport rather than sitting within it.
            ? "flex min-h-0 flex-1 items-center justify-center md:px-10 md:py-4"
            : "size-full"
        }
      >
        {/* Below md the stage covers the whole screen (see .video-stage); from
            md it is a plain 16:9 card, height-driven so a short viewport
            shrinks the video rather than pushing it into the text below.

            The CRT cabinet is gone. It was a picture the video had to be
            registered against by measured percentages, which meant every change
            to the surrounding box risked putting the two out of alignment —
            and it spent most of a wide screen on furniture rather than on the
            thing being watched. */}
        {/* Wraps the stage only so the halo has something frame-shaped to size
            itself against — `absolute -inset-N` needs a box that already has
            the video's dimensions, and the stage's width comes from its aspect
            ratio, so nothing further out knows it.

            `contents` everywhere but md: the collapsed player and the phone's
            full-bleed stage both position against ancestors further up, and a
            wrapper that generated a box would become their containing block and
            move them. Display contents generates none. */}
        <div
          className={
            expanded
              // max-w-full stays on the wrapper as well as the stage. The
              // stage's own max-width now resolves against this box, whose
              // width comes from the stage — so without a clamp that reaches
              // the real container, a tall viewport could size the video wider
              // than the space it sits in.
              ? "contents md:relative md:flex md:h-full md:max-w-full md:items-center"
              : "contents"
          }
        >
          {/* Light spill. The same artwork as the wash above, but held close to
              the frame and stronger, so it reads as the screen illuminating
              what surrounds it rather than as a tinted background — which is
              the whole difference between this and a backdrop.

              Sized from the frame by negative inset, so it tracks the video at
              any viewport instead of being a fixed blob the stage happens to
              sit near. Desktop only: the phone's stage is full-bleed, so there
              is no surround for light to fall on. */}
          {expanded && ambient && song && (
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-10 -z-10 hidden md:block"
            >
              <img
                src={artwork(song.video)}
                alt=""
                className="size-full scale-105 object-cover opacity-70 blur-3xl saturate-[1.7] transition-opacity duration-700"
              />
            </div>
          )}

          <div
            className={
              expanded
                // Shadow rather than a ring, and warm rather than black. A
                // large soft cast shadow gives the frame weight and a light
                // source above it; the flat hairline on all four sides
                // described an outline instead, which nothing lit actually
                // has. The warm tone keeps it inside the brass palette rather
                // than punching a neutral hole in it.
                ? "video-stage absolute inset-0 bg-black md:relative md:inset-auto md:aspect-video md:h-full md:max-h-full md:w-auto md:max-w-full md:overflow-hidden md:rounded-2xl md:bg-black md:shadow-[0_45px_90px_-30px_rgb(14_8_2_/_0.95),0_16px_36px_-16px_rgb(0_0_0_/_0.65)]"
                : "size-full"
            }
          >
            {/* Positioning and clipping live on this wrapper, not on the host
                below: the player replaces that node with an iframe and the
                replacement keeps none of its classes, so anything set there is
                destroyed the moment playback attaches. */}
            <div className="size-full overflow-hidden">
              <div ref={hostRef} className="size-full" />
            </div>

            {/* The lit edge, on its own layer above the video. It cannot be an
                inset shadow on the stage: inset shadows paint over the
                background but under the content, and the iframe is content, so
                it would be covered the moment playback attached.

                Bright along the top, dark along the bottom, barely there around
                the sides. That is what an edge catching light from above looks
                like, and it is what makes the frame read as an object with a
                thickness rather than a rectangle with a border. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 hidden rounded-2xl md:block md:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.20),inset_0_-1px_0_rgb(0_0_0_/_0.55),inset_0_0_0_1px_rgb(255_255_255_/_0.04)]"
            />
          </div>
        </div>
      </div>

      {/* Scrims keep the header and controls legible over the picture, and are
          only needed where the video runs edge to edge. The lower one covers
          three-fifths of the screen: it was sized for a title and a row of
          controls, and the view below now carries a title, the credits, a
          scrubber, the transport and a row of secondary actions. Solid under
          the text and easing away well before the middle, so the picture is
          still the picture. */}
      {expanded && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-background via-background/80 to-transparent md:hidden" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-background from-35% via-background/90 to-transparent md:hidden" />
        </>
      )}

      {expanded && (
        <div className="relative z-10 shrink-0 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 md:pt-8">
          {/* One column, read top to bottom: what is playing, how far through
              it is, the controls, then everything secondary. Narrow enough that
              the eye does not have to travel across a wide screen to follow
              that order. */}
          <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
            {song && (
              <div className="min-w-0 text-center">
                <h2 className="truncate text-[22px] font-semibold leading-tight md:text-3xl">
                  {song.title}
                </h2>
                {/* The singers are the second thing anyone reads, so they get
                    body size; the film is context and is set back from it. */}
                <p className="mt-1.5 truncate text-sm text-foreground/70 md:text-base">
                  {song.artists.join(", ") || "Unknown artist"}
                </p>
                {song.film && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground md:text-sm">
                    {song.film}
                  </p>
                )}
                {credit && (
                  <p className="mt-2 truncate text-xs text-primary/80">
                    {credit.kind === "corrected" ? "Corrected by" : "Found by"}{" "}
                    {credit.name}
                  </p>
                )}
              </div>
            )}

            {/* Seeking lives here, where the scrubber has the width to be
                dragged accurately — the bar upstairs only reports position. */}
            <div className="flex items-center gap-3">
              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {formatTime(elapsed)}
              </span>
              <Scrubber
                value={duration > 0 ? elapsed / duration : 0}
                onCommit={seek}
                disabled={!song || duration <= 0}
                className="flex-1"
                large
              />
              <span className="w-10 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {formatTime(duration)}
              </span>
            </div>

            {transport()}

            {/* Everything that is not playback, on one line and set quietly.
                Above they competed with the controls; the ambient toggle in
                particular sat in the header as though it were a way out of the
                view. */}
            <div className="flex items-center justify-center gap-1">
              {song && (
                <LikeButton songId={song.id} size={16} className={secondaryAction} />
              )}
              {/* The label beside each icon is `hidden sm:inline` — gone from
                  the accessibility tree as well as from view below sm, not
                  merely styled out of sight — so aria-label carries the name
                  at every width rather than only where there happens to be
                  room to print it. No tooltip here: from sm up the label is
                  already on screen, and a tooltip repeating it would be noise. */}
              <button
                onClick={() => setDetailsOpen(true)}
                title="Credits for this song"
                aria-label="Credits for this song"
                className={secondaryAction}
              >
                <Info className="size-4" />
                <span className="hidden sm:inline" aria-hidden>Credits</span>
              </button>
              <button
                onClick={() => setQueueOpen(true)}
                title="Queue"
                aria-label="Queue"
                className={secondaryAction}
              >
                <ListVideo className="size-4" />
                <span className="hidden sm:inline" aria-hidden>Queue</span>
              </button>
              <button
                onClick={onToggleAmbient}
                role="switch"
                aria-checked={ambient}
                aria-label={ambient ? "Turn ambient off" : "Turn ambient on"}
                title={ambient ? "Turn ambient off" : "Turn ambient on"}
                className={`${secondaryAction} ${ambient ? "text-primary hover:text-primary" : ""}`}
              >
                <Sparkles className="size-4" />
                <span className="hidden sm:inline" aria-hidden>Ambient</span>
              </button>
              <button
                onClick={() => setReportOpen(true)}
                title="Wrong recording? Tell us"
                aria-label="Wrong recording? Tell us"
                className={secondaryAction}
              >
                <Flag className="size-4" />
                <span className="hidden sm:inline" aria-hidden>Report</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // The portal must keep the same position in the returned tree at all times.
  // Returning a different root shape when nothing is playing (a fragment vs a
  // footer) makes React remount the portal's children, which destroys the
  // iframe while playerRef still points at it — the player then appears to
  // load forever. So the root is always this fragment with the portal first,
  // and only the bar below it is conditional.
  return (
    <>
      {mounted && createPortal(videoLayer, document.body)}

      {song && (
        // Sits inside the content column, so it needs no manual offset —
        // the frame's flex layout already keeps it clear of the rail.
        // No overflow-hidden here. The scrubber's handle sits astride the top
        // edge, so clipping the footer cut its upper half off and left it
        // looking like it hung below the line. Only the ambient wash actually
        // needs clipping, and it now clips itself.
        <footer
          aria-label="Player"
          className="relative z-50 shrink-0 border-t bg-card/80 backdrop-blur lg:rounded-lg lg:border"
        >
      {/* Ambient wash from the current track, so the bar picks up its colour.
          A child rather than a background image on the footer: it has to paint
          over the footer's own surface, and the veil above it is what keeps
          the controls legible against bright artwork. */}
      {ambient && song && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden lg:rounded-lg"
        >
          {/* Same reasoning as the expanded wash: small source, no key, and
              the blur kept off a full-width element. */}
          <img
            src={artwork(song.video)}
            alt=""
            className="size-full object-cover opacity-40 blur-2xl saturate-[1.6] transition-opacity duration-700"
          />
          <div className="absolute inset-0 bg-card/70" />
        </div>
      )}

      {/* Two treatments, because the two inputs are not comparable.

          A cursor can hit a three-pixel line, so the desktop keeps the real
          scrubber: click anywhere to seek, drag the handle, exactly as before.

          A fingertip cannot. Every attempt to make it touchable made something
          else worse — enlarging the target put half of it over the scrolling
          list, which is where a thumb aiming at the line actually lands. So on
          a phone it reports position and nothing else, and tapping it opens the
          full player, where the scrubber has the room to be dragged. */}
      <button
        onClick={() => setExpanded(true)}
        title="Open the full player"
        aria-label="Open the full player"
        className="group/prog absolute inset-x-0 top-0 z-30 h-2.5 md:hidden"
      >
        <span className="absolute inset-x-0 top-0 h-[3px] overflow-hidden rounded-full bg-white/15">
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-linear"
            style={{ width: `${duration > 0 ? (elapsed / duration) * 100 : 0}%` }}
          />
        </span>
      </button>

      {/* Pulled up by half the control less half the track, so the centred
          track lands on the bar's top edge and the handle straddles it. Inset
          from lg, where the bar takes a rounded corner a square-ended track
          would overhang. */}
      <div className="absolute inset-x-0 -top-[4.5px] z-30 hidden md:block lg:inset-x-2">
        <Scrubber
          value={duration > 0 ? elapsed / duration : 0}
          onCommit={seek}
          disabled={!song || duration <= 0}
          className="w-full"
          edge
        />
      </div>

      {/* 1fr on both sides and a fixed centre, so the now-playing block sits in
          the middle of the *bar* rather than the middle of whatever space the
          controls leave over. With a flexible centre column the thumbnail slid
          left and right as titles changed length, which is the jumping. */}
      {/* Even padding. The progress is a 10px strip at the top now rather than
          the 20px control it replaced, so the row no longer needs to be pushed
          clear of it — and pushing it left the controls against the bottom
          instead of centred in the bar. */}
      <div className="relative grid grid-cols-[1fr_auto] items-center gap-2 py-3 pl-0 pr-2 md:grid-cols-[1fr_auto_1fr] md:gap-4 md:px-4">
        {/* Transport, at the left edge where the hand goes first. Desktop
            only: the phone puts the title first and the controls after it. */}
        <div className="hidden items-center gap-0.5 md:flex md:gap-1">
          <ControlButton label="Previous" onClick={onPrev} disabled={!song} className={iconButton}>
            <SkipBack className="size-4 fill-current" />
          </ControlButton>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={toggle}
                  disabled={!song || !ready}
                  aria-label={playing ? "Pause" : "Play"}
                  className="grid size-10 place-items-center rounded-full bg-foreground text-background shadow-[0_2px_10px_-2px_rgba(0,0,0,0.5)] ring-1 ring-primary/20 transition-all duration-200 hover:scale-105 hover:shadow-[0_4px_18px_-2px_rgba(214,168,84,0.45)] hover:ring-primary/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
                />
              }
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : playing ? (
                <Pause className="size-4 fill-current" />
              ) : (
                <Play className="size-4 translate-x-px fill-current" />
              )}
            </TooltipTrigger>
            <TooltipContent>{playing ? "Pause" : "Play"}</TooltipContent>
          </Tooltip>
          <ControlButton label="Next" onClick={onNext} disabled={!song} className={iconButton}>
            <SkipForward className="size-4 fill-current" />
          </ControlButton>
          {/* Elapsed and total together, beside the controls rather than under
              the scrubber — the scrubber has no labels now that it is an edge. */}
          {/* Fixed width as well as tabular figures: the digits are even, but
              crossing ten minutes adds one, which would nudge everything. */}
          <span className="ml-1 hidden w-[6.5rem] whitespace-nowrap text-xs tabular-nums text-muted-foreground lg:block">
            {formatTime(elapsed)} / {formatTime(duration)}
          </span>
        </div>

        {/* Now playing. The video host is rendered unconditionally: the player
            is constructed against it on mount, so gating it behind `song`
            would mean the player is never created at all. */}
        {/* The whole now-playing region expands, not just the thumbnail, and
            a swipe up does the same on touch. */}
        <button
          {...barSwipe}
          onClick={() => setExpanded(true)}
          title="Expand to video"
          // A fixed width, so the block occupies the same space whatever is
          // playing. Titles here range from "Aa" to a full line of Devanagari,
          // and letting the box follow them is what moved the thumbnail around
          // between tracks. Full width below md, where it is the only thing on
          // the row.
          className="group/np flex min-w-0 items-center gap-0 pl-[4.25rem] text-left md:w-[19rem] md:gap-3 md:pl-0 lg:w-[24rem]"
        >
          {/* On a phone the artwork bleeds off the bar's left edge and fades
              into it, so the picture reads as the bar's surface rather than a
              tile with the title beside it. From md it goes back to a tile: the
              transport occupies that edge there, and the two cannot both have
              it. Padding on the button keeps the text clear of the bleed. */}
          <span className="pointer-events-none absolute inset-y-0 left-0 w-[4.75rem] overflow-hidden [mask-image:linear-gradient(to_right,#000_0%,rgba(0,0,0,0.75)_30%,transparent_88%)] [-webkit-mask-image:linear-gradient(to_right,#000_0%,rgba(0,0,0,0.75)_30%,transparent_88%)] md:hidden">
            {/* The fade begins early and the picture is held back, because the
                title crosses it. Two gentle reductions rather than one steep
                one: a hard edge in the mask is as visible as the artwork it was
                meant to hide. */}
            <img
              src={artwork(song.video)}
              alt=""
              loading="lazy"
              className="size-full object-cover opacity-70"
            />
          </span>

          <span className="relative hidden size-10 shrink-0 overflow-hidden rounded shadow-sm ring-1 ring-white/10 md:block">
            <img
              src={artwork(song.video)}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
            <span className="absolute inset-0 grid place-items-center bg-black/55 text-white opacity-0 transition group-hover/np:opacity-100 group-focus-visible/np:opacity-100">
              <Maximize2 className="size-4" />
            </span>
          </span>

          {/* Overflow dissolves rather than ending in an ellipsis. The mask
              covers the box, so a title short enough to stop before the
              gradient is left alone — only the ones that run on get faded. */}
          <span className="fade-r min-w-0 flex-1 overflow-hidden">
            {/* Announced on its own: this text changes exactly when the song
                does, unlike the line below it, which also flickers through
                "Loading…" and failure text on every retry — wrapping those in
                the same live region would turn a track change into a string
                of unrelated announcements. */}
            <span aria-live="polite" className="block whitespace-nowrap text-sm font-medium">
              {song.title}
            </span>
            <span className="block whitespace-nowrap text-xs text-muted-foreground">
              {failure ? (
                <span className="text-destructive">{failure}</span>
              ) : loading ? (
                "Loading…"
              ) : (
                song.artists.join(", ") || "Unknown artist"
              )}
            </span>
          </span>
        </button>

        {/* The phone's transport, after the title rather than before it. Its
            own cluster instead of reordering the desktop one: the two hold
            different controls. Shuffle and repeat moved into the "More" menu
            below to make room here for the one control that belongs beside
            play/next on a phone: the heart. */}
        <div className="flex items-center justify-self-end md:hidden">
          {/* Tooltips never show on touch — there is no hover to trigger them
              — but the same control is reachable with a mouse on a narrow
              desktop window, and the aria-label they carry matters on touch
              regardless, via a screen reader. */}
          <ControlButton
            label="Previous"
            onClick={onPrev}
            disabled={!song}
            className="grid size-8 place-items-center rounded-full text-foreground transition active:scale-90 disabled:opacity-40"
          >
            <SkipBack className="size-[18px] fill-current" />
          </ControlButton>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={toggle}
                  disabled={!song || !ready}
                  aria-label={playing ? "Pause" : "Play"}
                  className="mx-0.5 grid size-11 place-items-center rounded-full bg-foreground text-background shadow-[0_2px_10px_-2px_rgba(0,0,0,0.5)] transition active:scale-95 disabled:opacity-40"
                />
              }
            >
              {loading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : playing ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="size-5 translate-x-px fill-current" />
              )}
            </TooltipTrigger>
            <TooltipContent>{playing ? "Pause" : "Play"}</TooltipContent>
          </Tooltip>
          <ControlButton
            label="Next"
            onClick={onNext}
            disabled={!song}
            className="grid size-8 place-items-center rounded-full text-foreground transition active:scale-90 disabled:opacity-40"
          >
            <SkipForward className="size-[18px] fill-current" />
          </ControlButton>
          <LikeButton songId={song.id} size={18} className="size-8" />
          <ControlButton
            label="More"
            onClick={() => setMenuOpen(true)}
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition active:scale-90"
          >
            <MoreVertical className="size-[18px]" />
          </ControlButton>
        </div>

        {/* Everything that modifies playback rather than driving it. */}
        <div className="hidden items-center justify-end gap-1 md:flex">
          {song && song.confidence < 0.85 && (
            <span
              title="Matched on singer alone — this may not be the catalogue recording"
              className="rounded border border-primary/40 px-1.5 py-0.5 text-[10px] text-primary"
            >
              unverified
            </span>
          )}
          <LikeButton songId={song.id} size={16} className="size-9" />
          {/* Credits and reporting sit next to the track they are about. The
              bar has room for a title and a line of singers, so the composer
              and lyricist are one press away rather than absent. */}
          <ControlButton label="Credits for this song" onClick={() => setDetailsOpen(true)} className={iconButton}>
            <Info className="size-4" />
          </ControlButton>
          <ControlButton label="Wrong recording? Tell us" onClick={() => setReportOpen(true)} className={iconButton}>
            <Flag className="size-4" />
          </ControlButton>
          <ControlButton label="Queue" onClick={() => setQueueOpen(true)} className={iconButton}>
            <ListVideo className="size-4" />
          </ControlButton>
          {/* Label follows the icon rather than staying "Mute" once already
              muted — the same reasoning as the like button: a control whose
              own state changes what it would do next should say so. */}
          <ControlButton
            label={muted || volume === 0 ? "Unmute" : "Mute"}
            onClick={() => setMuted((m) => !m)}
            pressed={muted}
            className={iconButton}
          >
            {muted || volume === 0 ? (
              <VolumeX className="size-4" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </ControlButton>
          <Scrubber
            value={muted ? 0 : volume}
            onCommit={(f) => {
              setVolume(f);
              setMuted(false);
            }}
            className="w-24"
          />
          <ControlButton
            label="Repeat one"
            onClick={onToggleRepeat}
            pressed={repeat}
            className={`${iconButton} ${repeat ? "text-primary hover:text-primary" : ""}`}
          >
            <Repeat className="size-4" />
          </ControlButton>
          <ControlButton
            label="Shuffle"
            onClick={onToggleShuffle}
            pressed={shuffle}
            className={`${iconButton} ${shuffle ? "text-primary hover:text-primary" : ""}`}
          >
            <Shuffle className="size-4" />
          </ControlButton>
          <ControlButton label="Expand" onClick={() => setExpanded(true)} className={iconButton}>
            <ChevronUp className="size-5" />
          </ControlButton>
          </div>
        </div>
          <PlayerMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            repeat={repeat}
            shuffle={shuffle}
            onToggleRepeat={onToggleRepeat}
            onToggleShuffle={onToggleShuffle}
            onQueue={() => setQueueOpen(true)}
            onCredits={() => setDetailsOpen(true)}
            onReport={() => setReportOpen(true)}
            onExpand={() => setExpanded(true)}
          />
          {detailsOpen && song && (
            <SongDetails song={song} onClose={() => setDetailsOpen(false)} />
          )}
          {reportOpen && song && (
            <ReportDialog
              kind="wrong-track"
              songId={song.id}
              songTitle={song.title}
              songFilm={song.film ?? undefined}
              currentVideoId={song.video}
              onClose={() => setReportOpen(false)}
            />
          )}
          {catalogue && (
            <QueuePanel
              catalogue={catalogue}
              open={queueOpen}
              onClose={() => setQueueOpen(false)}
            />
          )}
        </footer>
      )}
    </>
  );
}
