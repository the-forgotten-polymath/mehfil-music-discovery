"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PlayerBar } from "@/components/player-bar";
import { hydrate, type Catalogue, type RawSong } from "@/lib/catalogue";
import { track } from "@/lib/analytics";
import { useCatalogue } from "@/lib/queries";

type PlayerApi = {
  currentId: number | null;
  playing: boolean;
  ambient: boolean;
  /** Songs the player advances through. Set by whichever route is showing. */
  setQueue: (songs: RawSong[]) => void;
  /** The same list, observable, so the queue view can render it. */
  queue: RawSong[];
  /**
   * The queue panel's own entry, and its only consumer.
   *
   * Named for where it is used rather than exposed as a bare `play`, because
   * a bare one is how a route into playback ends up uncounted: it looks like
   * the obvious thing to reach for and carries no label with it.
   */
  playQueued: (id: number) => void;
  /**
   * What a row's own play/pause control should call instead of `play`.
   *
   * `play(id)` on the song already current and playing sets state to the
   * value it already holds, so nothing re-renders and nothing pauses — the
   * row's button would claim to pause and silently fail. This tells the bar
   * to toggle instead, via `toggleSignal`, for exactly that one case; any
   * other id is a plain play.
   */
  playOrToggle: (id: number) => void;
  playFirst: (songs: RawSong[]) => void;
  playRandom: (songs: RawSong[]) => void;
  toggleAmbient: () => void;
  /** Ids the player could not start this session, for the list to mark. */
  unplayable: Record<number, string>;
};

const PlayerContext = createContext<PlayerApi | null>(null);

/** The player bar element, so the frame can place it in the content column. */
const PlayerBarContext = createContext<React.ReactNode>(null);

export function usePlayerBar() {
  return useContext(PlayerBarContext);
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used inside PlayerProvider");
  return context;
}

/**
 * Owns playback for the whole app.
 *
 * Rendered in the root layout rather than in a page, because a layout persists
 * across navigation while a page remounts. Anywhere else, moving between
 * routes would tear down the YouTube iframe and stop the music mid-song —
 * which is the constraint that shapes this entire structure.
 */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { data: catalogue } = useCatalogue();

  const [currentId, setCurrentId] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [ambient, setAmbient] = useState(true);
  const [unplayable, setUnplayable] = useState<Record<number, string>>({});
  // A counter rather than a boolean: the bar's effect fires on every change,
  // including two toggles in a row, which a boolean flipped back and forth
  // could coalesce away if the second click landed before the effect ran.
  const [toggleSignal, setToggleSignal] = useState(0);

  // Mirrored into state as well as a ref. The ref keeps next/previous cheap
  // and free of stale closures; the state is what lets the queue view show
  // what is coming without polling.
  const queueRef = useRef<RawSong[]>([]);
  // The songs either side of the current one, remembered by id while it is
  // still in the queue. Ids survive a queue changing under us in a way an
  // index cannot: unliking the playing song on /favourites removes it from
  // the queue, and this is what lets playback continue to its old neighbour
  // rather than jumping to the top of the list. When neither neighbour is in
  // the new queue either — navigating to an unrelated collection, say — there
  // is genuinely nothing to resume from, and the queue's own start is right.
  const neighboursRef = useRef<{ next: number | null; prev: number | null }>({
    next: null,
    prev: null,
  });
  const [queue, setQueueState] = useState<RawSong[]>([]);
  const setQueue = useCallback((songs: RawSong[]) => {
    queueRef.current = songs;
    setQueueState(songs);
  }, []);

  // The songs either side of the current one, kept up to date as it plays.
  //
  // Recorded here rather than inside step(), which only ever sees the song it
  // is leaving — by the time that value would be needed it describes the wrong
  // song, and playback started by a direct click never passes through step()
  // at all. This effect fires wherever the current song settles, which is the
  // only place that knows what is actually beside it.
  //
  // When the song is no longer in the queue the previous value is kept: that
  // is precisely the case these ids exist for — unliking the playing song on
  // /favourites removes it, and its old neighbours are how playback continues
  // in the right place rather than jumping to the top of the list.
  useEffect(() => {
    const at = queue.findIndex((s) => s.id === currentId);
    if (at === -1) return;
    neighboursRef.current = {
      next: queue[(at + 1) % queue.length]?.id ?? null,
      prev: queue[(at - 1 + queue.length) % queue.length]?.id ?? null,
    };
  }, [currentId, queue]);

  const play = useCallback((id: number) => {
    setCurrentId(id);
    setPlaying(true);
  }, []);

  // Every start goes through here, and each says where it came from. play()
  // itself stays a bare state setter: wrapping the counting around it rather
  // than inside it keeps the one function that must never grow a side effect
  // free of one, and makes the label a decision at each call rather than a
  // guess made in the middle.
  const playFrom = useCallback(
    (id: number, from: string) => {
      track("play", { from });
      play(id);
    },
    [play]
  );

  // Rows call this rather than play(): pressing the control on the row that
  // is already playing should pause it, and play() cannot — it only ever
  // sets state that is already set. Anything else is a plain play.
  const playOrToggle = useCallback(
    (id: number) => {
      if (id === currentId) setToggleSignal((n) => n + 1);
      else playFrom(id, "row");
    },
    [currentId, playFrom]
  );

  const playQueued = useCallback(
    (id: number) => playFrom(id, "queue"),
    [playFrom]
  );

  const playFirst = useCallback(
    (songs: RawSong[]) => {
      if (songs.length === 0) return;
      setQueue(songs);
      playFrom(
        shuffle ? songs[Math.floor(Math.random() * songs.length)].id : songs[0].id,
        "list"
      );
    },
    [playFrom, setQueue, shuffle]
  );

  const playRandom = useCallback(
    (songs: RawSong[]) => {
      if (songs.length === 0) return;
      setQueue(songs);
      playFrom(songs[Math.floor(Math.random() * songs.length)].id, "shuffle");
    },
    [playFrom, setQueue]
  );

  const step = useCallback(
    (delta: number, from = delta > 0 ? "next" : "previous") => {
      const queue = queueRef.current;
      if (queue.length === 0) return;
      if (shuffle && delta > 0) {
        // Anything but the song already playing. Picking it again sets
        // currentId to the value it already holds, which changes nothing, so
        // the load effect never runs: the player stops while the bar goes on
        // showing it as playing. Shuffling onto the current track would be
        // wrong even if it did work.
        const elsewhere = queue.filter((s) => s.id !== currentId);
        const pool = elsewhere.length > 0 ? elsewhere : queue;
        playFrom(pool[Math.floor(Math.random() * pool.length)].id, from);
        return;
      }
      const at = queue.findIndex((s) => s.id === currentId);
      let targetIndex: number;
      if (at !== -1) {
        targetIndex = (at + delta + queue.length) % queue.length;
      } else {
        // The current song is no longer in the queue — most often because it
        // was just unliked while playing. Look its remembered neighbour up by
        // id in the (possibly quite different) current queue; if it is not
        // there either, there is nothing to resume from and the queue's own
        // start is the fallback.
        const wanted = delta > 0 ? neighboursRef.current.next : neighboursRef.current.prev;
        const found = wanted === null ? -1 : queue.findIndex((s) => s.id === wanted);
        targetIndex = found === -1 ? 0 : found;
      }
      const next = queue[targetIndex] ?? queue[0];
      playFrom(next.id, from);
    },
    [currentId, playFrom, shuffle]
  );

  const onEnded = useCallback(() => {
    if (repeat && currentId !== null) {
      // Clearing then restoring re-triggers the load effect for the same id.
      const id = currentId;
      setCurrentId(null);
      window.setTimeout(() => setCurrentId(id), 0);
      return;
    }
    step(1, "auto");
  }, [repeat, currentId, step]);

  const handleUnplayable = useCallback(
    (songId: number, reason: string) => {
      setUnplayable((prev) => (prev[songId] ? prev : { ...prev, [songId]: reason }));
      // A late failure from a track the user already left must not hijack
      // whatever is playing now.
      if (songId !== currentId) return;
      const queue = queueRef.current;
      const at = queue.findIndex((s) => s.id === songId);
      for (let i = 1; i <= queue.length; i++) {
        const candidate = queue[(at + i) % queue.length];
        if (!candidate || candidate.id === songId) break;
        if (!unplayable[candidate.id]) {
          playFrom(candidate.id, "skip");
          return;
        }
      }
    },
    [currentId, playFrom, unplayable]
  );

  const currentSong = useMemo(() => {
    if (!catalogue || currentId === null) return null;
    const raw = catalogue.songs.find((s) => s.id === currentId);
    return raw ? hydrate(raw, catalogue.facets as Catalogue["facets"]) : null;
  }, [catalogue, currentId]);

  const api = useMemo<PlayerApi>(
    () => ({
      currentId,
      playing,
      ambient,
      setQueue,
      queue,
      playQueued,
      playOrToggle,
      playFirst,
      playRandom,
      toggleAmbient: () => setAmbient((v) => !v),
      unplayable,
    }),
    [
      currentId,
      playing,
      ambient,
      setQueue,
      queue,
      playQueued,
      playOrToggle,
      playFirst,
      playRandom,
      unplayable,
    ]
  );

  // Rendered by the frame rather than here, so the bar can sit inside the
  // content column while this component stays pure state.
  const bar = (
    <PlayerBar
      song={currentSong}
      shuffle={shuffle}
      repeat={repeat}
      ambient={ambient}
      toggleSignal={toggleSignal}
      onToggleShuffle={() => setShuffle((v) => !v)}
      onToggleRepeat={() => setRepeat((v) => !v)}
      onToggleAmbient={() => setAmbient((v) => !v)}
      onNext={() => step(1)}
      onPrev={() => step(-1)}
      onEnded={onEnded}
      onPlayingChange={setPlaying}
      onUnplayable={handleUnplayable}
    />
  );

  return (
    <PlayerContext.Provider value={api}>
      <PlayerBarContext.Provider value={bar}>{children}</PlayerBarContext.Provider>
    </PlayerContext.Provider>
  );
}
