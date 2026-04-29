"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type BeatEvent, buildBpmLaneMap, filterDifficulty, type TileKind } from "@/lib/beatMaps";

declare global {
  interface Window {
    YT?: {
      Player: new (id: string, opts: Record<string, unknown>) => YTPlayer;
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YTPlayer = {
  destroy: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
};

function isYTPlayerLike(v: unknown): v is YTPlayer {
  if (!v || typeof v !== "object") return false;
  const x = v as Record<string, unknown>;
  return (
    typeof x.playVideo === "function" &&
    typeof x.pauseVideo === "function" &&
    typeof x.loadVideoById === "function" &&
    typeof x.seekTo === "function" &&
    typeof x.setVolume === "function" &&
    typeof x.getVolume === "function" &&
    typeof x.getCurrentTime === "function" &&
    typeof x.getDuration === "function" &&
    typeof x.getPlayerState === "function"
  );
}

async function waitForYTPlayerRef(
  getPlayer: () => unknown,
  timeoutMs = 12000,
): Promise<YTPlayer | null> {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const candidate = getPlayer();
    if (isYTPlayerLike(candidate)) return candidate;
    await new Promise((r) => window.setTimeout(r, 50));
  }
  return null;
}

/**
 * Scroll distance vs time: 0 = constant speed so on-screen spacing matches steady beats (BPM grid).
 * (Non-zero ramp keeps time-accurate line-crossing but warps visual spacing between notes.)
 */
const SPEED_RAMP = 0;
const SPAWN_TOP_Y = -72;

type Mood = "emotional" | "edm" | "pop" | "latin";
type Difficulty = "easy" | "hard";

/** Relaxed timing so notes feel musical, not punishing. */
const TIMING_BY_DIFF: Record<Difficulty, { hitEarly: number; hitLate: number; releaseEarly: number; releaseLate: number }> = {
  easy: { hitEarly: 0.42, hitLate: 0.5, releaseEarly: 0.18, releaseLate: 0.44 },
  hard: { hitEarly: 0.26, hitLate: 0.34, releaseEarly: 0.12, releaseLate: 0.3 },
};
type Screen = "menu" | "playing" | "paused" | "gameover" | "complete";

type Song = {
  id: string;
  title: string;
  inspiredBy: string;
  mood: Mood;
  bpm: number;
  youtubeId: string;
  /** Seconds until first downbeat in the file (align chart to the real track). */
  beatOffsetSec?: number;
  /** Hand-timed chart (recommended). When omitted, a deterministic BPM grid is used; tune BPM/offset to match your file. */
  beatMap?: BeatEvent[];
  /** Cyclic lane indices for BPM-generated charts (never random). */
  lanePattern: readonly number[];
  /** Every N beats, add a wrong tile (deterministic) on an adjacent lane. */
  wrongEvery?: number;
  wrongPhase?: number;
  wrongLaneOffset?: number;
  scrollMult?: number;
  holdEvery?: number;
  holdBeats?: number;
  holdPhase?: number;
};

/** Runtime tile: `y` / `heightPx` updated each frame from chart + audio clock. */
type Tile = {
  id: number;
  lane: number;
  beat: number;
  kind: TileKind;
  hitAtSec: number;
  holdEndSec?: number;
  y: number;
  heightPx: number;
};
type MusicPhase = "intro" | "build" | "chorus" | "drop" | "bridge" | "outro";

type SaveData = {
  bestBySong: Record<string, number>;
  favorites: string[];
  dashboardVolume: number;
  gameVolume: number;
};

const DASHBOARD_YT_ID = "DCYmJDO2_IE"; // Lana Del Rey — Cinnamon Girl (official audio, Topic)
const REMOTE_BG = {
  flower: "https://raw.githubusercontent.com/mdn/interactive-examples/main/live-examples/media/cc0-videos/flower.mp4",
  friday: "https://raw.githubusercontent.com/mdn/interactive-examples/main/live-examples/media/cc0-videos/friday.mp4",
} as const;
const BG_VIDEO_BY_MOOD: Record<Mood, string> = {
  emotional: REMOTE_BG.flower,
  edm: REMOTE_BG.friday,
  pop: REMOTE_BG.flower,
  latin: REMOTE_BG.flower,
};

/** Uses YouTube IDs so exact songs stream without local MP3 files. */
const SONGS: Song[] = [
  {
    id: "faded",
    title: "Inspired by Faded",
    inspiredBy: "slow piano · full track",
    mood: "emotional",
    bpm: 72,
    youtubeId: "60ItHLz5WEA",
    beatOffsetSec: 0,
    lanePattern: [0, 1, 2, 3, 2, 1],
    wrongEvery: 10,
    scrollMult: 0.9,
  },
  {
    id: "unity",
    title: "Inspired by Unity",
    inspiredBy: "melodic piano · full track",
    mood: "emotional",
    bpm: 70,
    youtubeId: "n8X9_MgEdCg",
    beatOffsetSec: 0.02,
    lanePattern: [1, 0, 2, 3, 3, 2],
    wrongEvery: 9,
    wrongPhase: 4,
    scrollMult: 0.88,
  },
  {
    id: "stay",
    title: "Inspired by Stay",
    inspiredBy: "calm keys · full track",
    mood: "emotional",
    bpm: 68,
    youtubeId: "kTJczUoc26U",
    beatOffsetSec: 0,
    lanePattern: [2, 1, 0, 1, 2, 3],
    wrongEvery: 11,
    scrollMult: 0.86,
  },
  {
    id: "closer",
    title: "Inspired by Closer",
    inspiredBy: "gentle arpeggios · full track",
    mood: "emotional",
    bpm: 74,
    youtubeId: "0zGcUoRlhmw",
    beatOffsetSec: 0.04,
    lanePattern: [0, 0, 1, 2, 3, 2],
    wrongEvery: 8,
    scrollMult: 0.9,
  },
  {
    id: "perfect",
    title: "Inspired by Perfect",
    inspiredBy: "soft ballad piano · full track",
    mood: "emotional",
    bpm: 66,
    youtubeId: "2Vv-BfVoq4g",
    beatOffsetSec: 0,
    lanePattern: [3, 2, 1, 0, 1, 2],
    wrongEvery: 12,
    scrollMult: 0.84,
  },
  {
    id: "all-of-me",
    title: "Inspired by All of Me",
    inspiredBy: "slow emotional · full track",
    mood: "emotional",
    bpm: 64,
    youtubeId: "450p7goxZqg",
    beatOffsetSec: 0.03,
    lanePattern: [1, 2, 3, 2, 1, 0],
    wrongEvery: 9,
    scrollMult: 0.82,
  },
  {
    id: "blinding",
    title: "Inspired by Blinding Lights",
    inspiredBy: "light melodic · full track",
    mood: "emotional",
    bpm: 76,
    youtubeId: "4NRXx6U8ABQ",
    beatOffsetSec: 0,
    lanePattern: [0, 2, 1, 3, 2, 0],
    wrongEvery: 10,
    scrollMult: 0.9,
  },
  {
    id: "counting",
    title: "Inspired by Counting Stars",
    inspiredBy: "reflective piano · full track",
    mood: "emotional",
    bpm: 71,
    youtubeId: "hT_nvWreIhg",
    beatOffsetSec: 0.05,
    lanePattern: [2, 3, 1, 0, 2, 1],
    wrongEvery: 7,
    wrongLaneOffset: 2,
    scrollMult: 0.87,
  },
  {
    id: "shape",
    title: "Inspired by Shape of You",
    inspiredBy: "steady gentle rhythm · full track",
    mood: "emotional",
    bpm: 73,
    youtubeId: "JGwWNGJdvx8",
    beatOffsetSec: 0,
    lanePattern: [1, 3, 2, 0, 3, 1],
    wrongEvery: 11,
    scrollMult: 0.89,
  },
  {
    id: "see-you",
    title: "Inspired by See You Again",
    inspiredBy: "sparse emotional keys · full track",
    mood: "emotional",
    bpm: 69,
    youtubeId: "RgKAFK5djSk",
    beatOffsetSec: 0.02,
    lanePattern: [0, 1, 3, 2, 2, 3],
    wrongEvery: 10,
    scrollMult: 0.85,
  },
  {
    id: "spectre",
    title: "Spectre — Alan Walker",
    inspiredBy: "electro pulse · full track",
    mood: "edm",
    bpm: 128,
    youtubeId: "p7nIEJ1vpFM",
    beatOffsetSec: 0.02,
    lanePattern: [0, 2, 1, 3, 1, 2],
    wrongEvery: 12,
    scrollMult: 0.92,
  },
  {
    id: "sing-me-to-sleep",
    title: "Sing Me to Sleep — Alan Walker",
    inspiredBy: "melodic vocal edm · full track",
    mood: "emotional",
    bpm: 84,
    youtubeId: "2i2khp_npdE",
    beatOffsetSec: 0.03,
    lanePattern: [1, 0, 2, 3, 2, 1],
    wrongEvery: 10,
    scrollMult: 0.9,
  },
  {
    id: "the-spectre",
    title: "The Spectre — Alan Walker",
    inspiredBy: "anthemic drop · full track",
    mood: "edm",
    bpm: 128,
    youtubeId: "wJnBTPUQS5A",
    beatOffsetSec: 0.02,
    lanePattern: [0, 1, 3, 2, 1, 2],
    wrongEvery: 11,
    scrollMult: 0.94,
  },
  {
    id: "lost-control",
    title: "Lost Control — Alan Walker",
    inspiredBy: "dark melodic groove · full track",
    mood: "edm",
    bpm: 93,
    youtubeId: "vi6v0MOWp2Q",
    beatOffsetSec: 0.03,
    lanePattern: [2, 1, 0, 3, 1, 2],
    wrongEvery: 11,
    scrollMult: 0.9,
  },
  {
    id: "diamond-heart",
    title: "Diamond Heart — Alan Walker",
    inspiredBy: "uplifting anthem · full track",
    mood: "edm",
    bpm: 90,
    youtubeId: "sJXZ9Dok7u8",
    beatOffsetSec: 0.04,
    lanePattern: [1, 3, 2, 0, 2, 1],
    wrongEvery: 10,
    scrollMult: 0.9,
  },
  {
    id: "night-changes",
    title: "Night Changes — One Direction",
    inspiredBy: "pop ballad flow · full track",
    mood: "pop",
    bpm: 120,
    youtubeId: "syFZfO_wfMQ",
    beatOffsetSec: 0.03,
    lanePattern: [0, 1, 2, 3, 2, 1],
    wrongEvery: 12,
    scrollMult: 0.88,
  },
  {
    id: "let-me-down-slowly",
    title: "Let Me Down Slowly — Alec Benjamin",
    inspiredBy: "soft vocal rhythm · full track",
    mood: "emotional",
    bpm: 75,
    youtubeId: "50VNCymT-Cs",
    beatOffsetSec: 0.03,
    lanePattern: [1, 2, 0, 3, 2, 1],
    wrongEvery: 11,
    scrollMult: 0.86,
  },
  {
    id: "someone-you-loved",
    title: "Someone You Loved — Lewis Capaldi",
    inspiredBy: "slow emotional piano · full track",
    mood: "emotional",
    bpm: 110,
    youtubeId: "zABLecsR5UE",
    beatOffsetSec: 0.03,
    lanePattern: [0, 2, 1, 3, 1, 2],
    wrongEvery: 12,
    scrollMult: 0.88,
  },
  {
    id: "hymn-weekend",
    title: "Hymn for the Weekend — Coldplay",
    inspiredBy: "colorful pop groove · full track",
    mood: "pop",
    bpm: 90,
    youtubeId: "YykjpeuMNEk",
    beatOffsetSec: 0.03,
    lanePattern: [1, 3, 0, 2, 1, 2],
    wrongEvery: 10,
    scrollMult: 0.9,
  },
  {
    id: "shivers",
    title: "Shivers — Ed Sheeran",
    inspiredBy: "upbeat pop pulse · full track",
    mood: "pop",
    bpm: 141,
    youtubeId: "Il0S8BoucSA",
    beatOffsetSec: 0.03,
    lanePattern: [0, 2, 3, 1, 2, 0],
    wrongEvery: 9,
    scrollMult: 0.96,
  },
  {
    id: "darkside",
    title: "Darkside — Alan Walker",
    inspiredBy: "cinematic electro · full track",
    mood: "edm",
    bpm: 92,
    youtubeId: "M-P4QBt-FWw",
    beatOffsetSec: 0.03,
    lanePattern: [2, 0, 1, 3, 1, 2],
    wrongEvery: 10,
    scrollMult: 0.9,
  },
];

const STORE_KEY = "beat-tiles-web-v3";
const LANES = 4;
const TILE_H = 74;
const HIT_TOP_RATIO = 0.75;
const HIT_BOTTOM_RATIO = 0.94;
const FALLBACK_SONG_SEC = 180;
const START_GRACE_SEC = 1.25;

const APPROACH_BEATS: Record<Difficulty, number> = {
  easy: 2.8,
  hard: 2.3,
};
const MOOD_BG: Record<Mood, string> = {
  emotional: "from-fuchsia-900/40 via-indigo-900/40 to-black",
  edm: "from-cyan-700/30 via-blue-900/45 to-black",
  pop: "from-purple-700/30 via-pink-900/35 to-black",
  latin: "from-orange-700/35 via-red-900/40 to-black",
};

/** In-game arena: gradient + inset glow per song section (smooth class transitions). */
const ARENA_PHASE: Record<MusicPhase, { grad: string; glow: string }> = {
  intro: {
    grad: "bg-gradient-to-b from-slate-950 via-slate-900 to-black",
    glow: "shadow-[inset_0_0_80px_rgba(15,23,42,0.55)]",
  },
  build: {
    grad: "bg-gradient-to-b from-indigo-950 via-violet-950/95 to-black",
    glow: "shadow-[inset_0_0_100px_rgba(99,102,241,0.18)]",
  },
  chorus: {
    grad: "bg-gradient-to-b from-fuchsia-950/95 via-purple-900 to-black",
    glow: "shadow-[inset_0_0_120px_rgba(217,70,239,0.22)]",
  },
  drop: {
    grad: "bg-gradient-to-b from-cyan-950 via-fuchsia-900/85 to-black",
    glow: "shadow-[inset_0_0_140px_rgba(34,211,238,0.28),0_0_48px_rgba(236,72,153,0.28)]",
  },
  bridge: {
    grad: "bg-gradient-to-b from-slate-900 via-rose-950/90 to-black",
    glow: "shadow-[inset_0_0_100px_rgba(244,63,94,0.14)]",
  },
  outro: {
    grad: "bg-gradient-to-b from-zinc-950 via-slate-900 to-black",
    glow: "shadow-[inset_0_0_80px_rgba(148,163,184,0.12)]",
  },
};

/** Softer in-arena phases for emotional / piano tracks. */
const ARENA_PHASE_EMOTIONAL: Record<MusicPhase, { grad: string; glow: string }> = {
  intro: {
    grad: "bg-gradient-to-b from-slate-950 via-indigo-950/80 to-black",
    glow: "shadow-[inset_0_0_90px_rgba(30,27,75,0.45)]",
  },
  build: {
    grad: "bg-gradient-to-b from-violet-950/90 via-slate-900 to-black",
    glow: "shadow-[inset_0_0_100px_rgba(139,92,246,0.12)]",
  },
  chorus: {
    grad: "bg-gradient-to-b from-rose-950/80 via-indigo-950/90 to-black",
    glow: "shadow-[inset_0_0_110px_rgba(244,114,182,0.14)]",
  },
  drop: {
    grad: "bg-gradient-to-b from-fuchsia-950/85 via-violet-950 to-black",
    glow: "shadow-[inset_0_0_120px_rgba(192,132,252,0.2),0_0_36px_rgba(244,114,182,0.18)]",
  },
  bridge: {
    grad: "bg-gradient-to-b from-slate-900 via-blue-950/85 to-black",
    glow: "shadow-[inset_0_0_95px_rgba(59,130,246,0.1)]",
  },
  outro: {
    grad: "bg-gradient-to-b from-zinc-950 via-slate-950 to-black",
    glow: "shadow-[inset_0_0_75px_rgba(148,163,184,0.1)]",
  },
};

function resolveBeatMap(song: Song, durationSec: number, difficulty: Difficulty): BeatEvent[] {
  if (song.beatMap && song.beatMap.length > 0) {
    return [...song.beatMap].sort((a, b) => a.t - b.t || a.lane - b.lane);
  }
  const beatDur = 60 / song.bpm;
  const approachSec = beatDur * APPROACH_BEATS[difficulty];
  const baseOffset = (song.beatOffsetSec ?? 0) + approachSec + 0.04;
  const targetGapSec = difficulty === "easy" ? 1.0 : 0.82;
  const stride = Math.max(1, Math.min(3, Math.round(targetGapSec / beatDur)));
  return buildBpmLaneMap(durationSec, song.bpm, baseOffset, song.lanePattern, {
    beatStride: stride,
  });
}

function integratedScrollDist(t0: number, t1: number, dur: number, v0: number): number {
  if (t1 <= t0) return 0;
  const k = SPEED_RAMP;
  const d = Math.max(dur, 1e-6);
  return v0 * ((t1 - t0) + (k / (2 * d)) * (t1 * t1 - t0 * t0));
}

function noteBottomY(songTime: number, hitAtSec: number, hitLineY: number, dur: number, v0: number): number {
  return hitLineY - integratedScrollDist(songTime, hitAtSec, dur, v0);
}

function tileRect(
  kind: TileKind,
  hitAtSec: number,
  _holdEndSec: number | undefined,
  songTime: number,
  hitLineY: number,
  dur: number,
  v0: number,
): { top: number; height: number; bottomY: number } {
  const bottomY = noteBottomY(songTime, hitAtSec, hitLineY, dur, v0);
  void kind;
  return { top: bottomY - TILE_H, height: TILE_H, bottomY };
}

function fadeYTVolume(player: YTPlayer, to01: number, ms: number): Promise<void> {
  const from = clamp(player.getVolume() / 100, 0, 1);
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (t: number) => {
      const p = clamp((t - start) / ms, 0, 1);
      const v = from + (to01 - from) * p;
      player.setVolume(Math.round(clamp(v, 0, 1) * 100));
      if (p < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** After loadVideoById, duration/state are async; chart + sync need a real duration. */
function waitForYTPlaybackReady(player: YTPlayer, yt: NonNullable<Window["YT"]>, timeoutMs = 15000): Promise<number> {
  const PS = yt.PlayerState;
  const PLAYING = PS.PLAYING;
  const BUFFERING = PS.BUFFERING ?? 3;
  const PAUSED = PS.PAUSED;
  const CUED = PS.CUED ?? 5;
  const t0 = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const d = player.getDuration();
      const st = player.getPlayerState();
      const durationOk = Number.isFinite(d) && d > 1;
      const stateOk = st === PLAYING || st === BUFFERING || st === PAUSED || st === CUED;
      if (durationOk && stateOk) {
        resolve(d);
        return;
      }
      if (performance.now() - t0 >= timeoutMs) {
        resolve(durationOk ? d : FALLBACK_SONG_SEC);
        return;
      }
      try {
        player.playVideo();
      } catch {
        /* ignore */
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

function songProgress01(currentSec: number, durationSec: number): number {
  const d = durationSec > 0 && Number.isFinite(durationSec) ? durationSec : FALLBACK_SONG_SEC;
  return clamp(currentSec / d, 0, 1);
}

function phaseFromProgress(p: number, mood: Mood): MusicPhase {
  if (mood === "emotional") {
    if (p < 0.14) return "intro";
    if (p < 0.32) return "build";
    if (p < 0.52) return "chorus";
    if (p < 0.7) return "drop";
    if (p < 0.88) return "bridge";
    return "outro";
  }
  if (p < 0.1) return "intro";
  if (p < 0.28) return "build";
  if (p < 0.48) return "chorus";
  if (p < 0.68) return "drop";
  if (p < 0.86) return "bridge";
  return "outro";
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function getSongTimeSec(p: YTPlayer | null, ytReady: boolean, fallback: number): number {
  if (p && ytReady) {
    const t = p.getCurrentTime();
    if (Number.isFinite(t)) return Math.max(0, t);
  }
  return fallback;
}

function isWithinHitWindow(songTime: number, hitAtSec: number, difficulty: Difficulty): boolean {
  const { hitEarly, hitLate } = TIMING_BY_DIFF[difficulty];
  return songTime >= hitAtSec - hitEarly && songTime <= hitAtSec + hitLate;
}

function readSave(): SaveData {
  if (typeof window === "undefined") {
    return { bestBySong: {}, favorites: [], dashboardVolume: 0.24, gameVolume: 0.72 };
  }
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return { bestBySong: {}, favorites: [], dashboardVolume: 0.24, gameVolume: 0.72 };
  try {
    const p = JSON.parse(raw) as Partial<SaveData>;
    return {
      bestBySong: p.bestBySong ?? {},
      favorites: p.favorites ?? [],
      dashboardVolume: clamp(p.dashboardVolume ?? 0.24, 0, 1),
      gameVolume: clamp(p.gameVolume ?? 0.72, 0, 1),
    };
  } catch {
    return { bestBySong: {}, favorites: [], dashboardVolume: 0.24, gameVolume: 0.72 };
  }
}

function saveStore(data: SaveData) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [selectedSongId, setSelectedSongId] = useState(SONGS[0]!.id);
  const [showSettings, setShowSettings] = useState(false);
  /** Browser blocked embed playback — user must tap once to start audio. */
  const [audioStalled, setAudioStalled] = useState(false);
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);
  const [bgVideoOk, setBgVideoOk] = useState(true);

  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const tilesRef = useRef<Tile[]>([]);
  tilesRef.current = tiles;
  const [musicPhase, setMusicPhase] = useState<MusicPhase>("intro");
  const [hitFx, setHitFx] = useState<{ lane: number; token: number; tier: number } | null>(null);
  const hitFxToken = useRef(0);
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;
  const selectedSongRef = useRef<Song>(SONGS[0]!);
  const screenRef = useRef<Screen>("menu");
  screenRef.current = screen;
  const selectedSongIdRef = useRef(selectedSongId);
  selectedSongIdRef.current = selectedSongId;

  const musicPhaseRef = useRef<MusicPhase>("intro");
  const activeBeatMapRef = useRef<BeatEvent[]>([]);
  const nextEventIdxRef = useRef(0);
  const completeLevelRef = useRef<() => Promise<void>>(async () => {});
  const lastSongTimeRef = useRef(0);
  const runStartMsRef = useRef(0);
  const holdActiveRef = useRef<{ tileId: number; endSec: number; lane: number } | null>(null);
  const holdPointerCleanupRef = useRef<(() => void) | null>(null);
  const holdStartedIdsRef = useRef<Set<number>>(new Set());
  const levelOutcomeRef = useRef<"none" | "fail" | "complete">("none");

  const [save, setSave] = useState<SaveData>({
    bestBySong: {},
    favorites: [],
    dashboardVolume: 0.24,
    gameVolume: 0.72,
  });
  const saveRef = useRef(save);
  saveRef.current = save;

  const selectedSong = useMemo(() => SONGS.find((s) => s.id === selectedSongId) ?? SONGS[0]!, [selectedSongId]);
  selectedSongRef.current = selectedSong;

  const sortedSongs = useMemo(() => {
    const fav = new Set(save.favorites);
    return [...SONGS].sort((a, b) => {
      const af = fav.has(a.id) ? 0 : 1;
      const bf = fav.has(b.id) ? 0 : 1;
      if (af !== bf) return af - bf;
      return a.title.localeCompare(b.title);
    });
  }, [save.favorites]);

  const arenaRef = useRef<HTMLDivElement | null>(null);
  const arenaH = useRef(560);
  const rafRef = useRef<number | null>(null);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const tileId = useRef(1);

  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const ytReadyRef = useRef(false);
  const ytCurrentVideoRef = useRef<string>(DASHBOARD_YT_ID);

  const currentBest = save.bestBySong[selectedSong.id] ?? 0;
  const globalBest = useMemo(() => Object.values(save.bestBySong).reduce((a, b) => Math.max(a, b), 0), [save.bestBySong]);

  useEffect(() => {
    setSave(readSave());
  }, []);

  useEffect(() => {
    saveStore(save);
  }, [save]);

  useEffect(() => {
    const measure = () => {
      if (arenaRef.current) arenaH.current = arenaRef.current.clientHeight;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const createPlayer = () => {
      if (!window.YT || ytPlayerRef.current) return;
      ytPlayerRef.current = new window.YT.Player("yt-player-host", {
        width: "1",
        height: "1",
        videoId: DASHBOARD_YT_ID,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          loop: 1,
          playlist: DASHBOARD_YT_ID,
          playsinline: 1,
          enablejsapi: 1,
          origin: typeof window !== "undefined" ? window.location.origin : "",
        },
        events: {
          onReady: () => {
            ytReadyRef.current = true;
            ytCurrentVideoRef.current = DASHBOARD_YT_ID;
            ytPlayerRef.current?.setVolume(Math.round(saveRef.current.dashboardVolume * 100));
            try {
              ytPlayerRef.current?.playVideo();
            } catch {
              /* browser may block until gesture */
            }
          },
          onStateChange: (ev: { data: number }) => {
            if (!window.YT) return;
            if (ev.data !== window.YT.PlayerState.ENDED) return;
            if (screenRef.current === "menu") {
              ytPlayerRef.current?.seekTo(0, true);
              ytPlayerRef.current?.playVideo();
              return;
            }
            if (screenRef.current === "playing") void completeLevelRef.current();
          },
        },
      });
    };

    if (window.YT?.Player) {
      createPlayer();
    } else {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.body.appendChild(script);
      window.onYouTubeIframeAPIReady = createPlayer;
    }

    return () => {
      ytPlayerRef.current?.destroy();
      ytPlayerRef.current = null;
      ytReadyRef.current = false;
    };
  }, []);

  useEffect(() => {
    const raw = ytPlayerRef.current;
    const p = isYTPlayerLike(raw) ? raw : null;
    if (!ytReadyRef.current || !p) return;
    if (screen === "menu") p.setVolume(Math.round(save.dashboardVolume * 100));
  }, [save.dashboardVolume, screen]);

  useEffect(() => {
    const raw = ytPlayerRef.current;
    const p = isYTPlayerLike(raw) ? raw : null;
    if (!ytReadyRef.current || !p) return;
    if (screen !== "menu") p.setVolume(Math.round(save.gameVolume * 100));
  }, [save.gameVolume, screen]);

  const stopLoop = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  /** Game over: stop playback immediately (no fade), keep time at the miss. */
  const pauseGameAudioImmediate = () => {
    const raw = ytPlayerRef.current;
    const p = isYTPlayerLike(raw) ? raw : null;
    p?.pauseVideo();
  };

  const gotoMenuAudio = async () => {
    const raw = ytPlayerRef.current;
    const p = isYTPlayerLike(raw) ? raw : null;
    const ytApi = window.YT;
    if (!p || !ytReadyRef.current || !ytApi) return;
    ytCurrentVideoRef.current = DASHBOARD_YT_ID;
    p.loadVideoById(DASHBOARD_YT_ID, 0);
    p.setVolume(0);
    try {
      p.playVideo();
      await waitForYTPlaybackReady(p, ytApi);
      await fadeYTVolume(p, saveRef.current.dashboardVolume, 300);
    } catch {
      /* ignore */
    }
  };

  const startGameAudio = async () => {
    const song = selectedSongRef.current;
    activeBeatMapRef.current = filterDifficulty(
      resolveBeatMap(song, FALLBACK_SONG_SEC, difficultyRef.current)
    );
    nextEventIdxRef.current = 0;
    const raw = ytPlayerRef.current;
    const p = isYTPlayerLike(raw) ? raw : null;
    const ytApi = window.YT;
    if (!p || !ytReadyRef.current || !ytApi) {
      // Keep gameplay alive even if YT API is still warming up.
      activeBeatMapRef.current = filterDifficulty(resolveBeatMap(song, FALLBACK_SONG_SEC, difficultyRef.current));
      nextEventIdxRef.current = 0;
      setAudioStalled(true);
      return;
    }

    ytCurrentVideoRef.current = song.youtubeId;
    p.loadVideoById(song.youtubeId, 0);
    p.setVolume(0);
    p.playVideo();

    const dur = await waitForYTPlaybackReady(p, ytApi);
    // Rewind to true run-start so first notes and music begin together.
    p.seekTo(0, true);
    p.playVideo();
    lastSongTimeRef.current = 0;
    activeBeatMapRef.current = filterDifficulty(resolveBeatMap(song, dur, difficultyRef.current));
    nextEventIdxRef.current = 0;

    try {
      await fadeYTVolume(p, saveRef.current.gameVolume, 340);
    } catch {
      /* ignore */
    }
  };

  const unlockGameAudio = async () => {
    let raw = ytPlayerRef.current;
    let p = isYTPlayerLike(raw) ? raw : null;
    if (!p || !ytReadyRef.current) {
      const ensured = await waitForYTPlayerRef(() => ytPlayerRef.current, 6000);
      if (ensured) ytPlayerRef.current = ensured;
      raw = ytPlayerRef.current;
      p = isYTPlayerLike(raw) ? raw : null;
      if (!p || !ytReadyRef.current) {
        setAudioStalled(true);
        return;
      }
    }
    try {
      const song = selectedSongRef.current;
      p.loadVideoById(song.youtubeId, Math.max(0, lastSongTimeRef.current));
      p.playVideo();
      await fadeYTVolume(p, saveRef.current.gameVolume, 220);
      setAudioStalled(false);
    } catch {
      /* ignore */
      setAudioStalled(true);
    }
  };

  const failRun = async () => {
    levelOutcomeRef.current = "fail";
    holdPointerCleanupRef.current?.();
    holdPointerCleanupRef.current = null;
    holdActiveRef.current = null;
    holdStartedIdsRef.current.clear();
    pauseGameAudioImmediate();
    stopLoop();
    setScreen("gameover");
    const best = save.bestBySong[selectedSong.id] ?? 0;
    if (scoreRef.current > best) {
      setSave((prev) => ({
        ...prev,
        bestBySong: { ...prev.bestBySong, [selectedSong.id]: scoreRef.current },
      }));
    }
  };

  const completeLevel = async () => {
    if (levelOutcomeRef.current !== "none") return;
    levelOutcomeRef.current = "complete";
    holdPointerCleanupRef.current?.();
    holdPointerCleanupRef.current = null;
    holdActiveRef.current = null;
    holdStartedIdsRef.current.clear();
    stopLoop();
    setTiles([]);
    setScreen("complete");
    const sid = selectedSongIdRef.current;
    const sc = scoreRef.current;
    setSave((prev) => {
      const best = prev.bestBySong[sid] ?? 0;
      if (sc <= best) return prev;
      return { ...prev, bestBySong: { ...prev.bestBySong, [sid]: sc } };
    });
    const raw = ytPlayerRef.current;
    const p = isYTPlayerLike(raw) ? raw : null;
    if (p) {
      p.pauseVideo();
      p.seekTo(0, true);
      p.setVolume(Math.round(saveRef.current.gameVolume * 100));
    }
  };

  completeLevelRef.current = completeLevel;

  const tick = () => {
    if (screenRef.current !== "playing") return;

    const song = selectedSongRef.current;
    const raw = ytPlayerRef.current;
    const p = isYTPlayerLike(raw) ? raw : null;
    let dur = FALLBACK_SONG_SEC;
    if (p) {
      const d = p.getDuration();
      if (Number.isFinite(d) && d > 0) dur = d;
    }
    const state = p ? p.getPlayerState() : -1;
    const trackEnded = Boolean(window.YT && state === window.YT.PlayerState.ENDED);
    const fallbackSongTime = Math.max(
      0,
      (performance.now() - runStartMsRef.current) / 1000
    );
    let songTime = fallbackSongTime;
    if (p) {
      const ct = p.getCurrentTime();
      if (Number.isFinite(ct) && ct >= 0) songTime = Math.max(0, ct);
    }
    lastSongTimeRef.current = songTime;

    const progressSec = trackEnded && dur > 0 ? dur : songTime >= 0 ? songTime : 0;
    const progress01 = songProgress01(progressSec, dur);
    const phase = phaseFromProgress(progress01, song.mood);
    if (phase !== musicPhaseRef.current) {
      musicPhaseRef.current = phase;
      setMusicPhase(phase);
    }

    const h = arenaH.current;
    const hitLineY = h * (HIT_TOP_RATIO + HIT_BOTTOM_RATIO) * 0.5;
    const beatDur = 60 / Math.max(song.bpm, 1);
    const approachSec = beatDur * APPROACH_BEATS[difficultyRef.current];
    const distToHitPx = hitLineY + TILE_H + 8;
    const baseSpeed = distToHitPx / Math.max(approachSec, 0.1);
    const v0 = clamp(baseSpeed * (song.scrollMult ?? 1), difficultyRef.current === "easy" ? 125 : 145, difficultyRef.current === "easy" ? 210 : 260);
    const map = activeBeatMapRef.current;
    let idx = nextEventIdxRef.current;
    const batch: Tile[] = [];

    if (!trackEnded) {
      while (idx < map.length) {
        const ev = map[idx]!;
        const tr = tileRect(ev.kind, ev.t, undefined, songTime, hitLineY, dur, v0);
        // Spawn only when tile top reaches the arena entry line, so notes always come from top.
        if (tr.top < SPAWN_TOP_Y) break;
        batch.push({
          id: tileId.current++,
          lane: ev.lane,
          beat: idx,
          kind: ev.kind,
          hitAtSec: ev.t,
          holdEndSec: undefined,
          y: tr.top,
          heightPx: tr.height,
        });
        idx += 1;
      }
    }
    nextEventIdxRef.current = idx;

    setTiles((prevTiles) => {
      let buf = [...prevTiles, ...batch];
      if (trackEnded) return buf;

      buf = buf.map((t) => {
        const tr = tileRect(t.kind, t.hitAtSec, t.holdEndSec, songTime, hitLineY, dur, v0);
        return { ...t, y: tr.top, heightPx: tr.height };
      });

      // Forgiving mode: do not fail run on late misses; just clear passed tiles.
      const graceElapsed =
        performance.now() - runStartMsRef.current >= START_GRACE_SEC * 1000;
      if (graceElapsed) {
        const before = buf.length;
        const lateCutoff = songTime - TIMING_BY_DIFF[difficultyRef.current].hitLate;
        buf = buf.filter((t) => t.kind !== "tap" || t.hitAtSec >= lateCutoff);
        if (buf.length < before) {
          comboRef.current = 0;
          setCombo(0);
        }
      }

      return buf.filter((t) => t.y < h + 2 && t.y + t.heightPx > -TILE_H - 8);
    });

    if (trackEnded && levelOutcomeRef.current === "none") {
      void completeLevelRef.current();
    }

    rafRef.current = requestAnimationFrame(() => tick());
  };

  useEffect(() => {
    if (screen !== "playing") {
      stopLoop();
      return;
    }
    rafRef.current = requestAnimationFrame(() => tick());
    return stopLoop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, difficulty, selectedSongId]);

  const beginRun = async () => {
    levelOutcomeRef.current = "none";
    setAudioStalled(false);
    holdPointerCleanupRef.current?.();
    holdPointerCleanupRef.current = null;
    holdActiveRef.current = null;
    holdStartedIdsRef.current.clear();
    lastSongTimeRef.current = 0;
    tileId.current = 1;
    nextEventIdxRef.current = 0;
    scoreRef.current = 0;
    comboRef.current = 0;
    musicPhaseRef.current = "intro";
    setMusicPhase("intro");
    setHitFx(null);
    setScore(0);
    setCombo(0);
    setTiles([]);
    runStartMsRef.current = performance.now();
    const ensured = await waitForYTPlayerRef(() => ytPlayerRef.current);
    if (ensured) ytPlayerRef.current = ensured;
    setScreen("playing");
    void startGameAudio();
    const raw = ytPlayerRef.current;
    const p = isYTPlayerLike(raw) ? raw : null;
    const ytApi = window.YT;
    if (p && ytApi) {
      const st = p.getPlayerState();
      const buf = ytApi.PlayerState.BUFFERING ?? 3;
      if (st !== ytApi.PlayerState.PLAYING && st !== buf) setAudioStalled(true);
    } else {
      setAudioStalled(true);
    }
  };

  const onLanePointerDown = (lane: number) => {
    if (screen !== "playing") return;
    if (audioStalled) void unlockGameAudio();
    const songTimeNow = getSongTimeSec(ytPlayerRef.current, ytReadyRef.current, lastSongTimeRef.current);

    const h = arenaH.current;
    const hitTop = h * HIT_TOP_RATIO;
    const hitBottom = h * HIT_BOTTOM_RATIO;

    let target: Tile | null = null;
    let nearest: Tile | null = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (const t of tilesRef.current) {
      if (t.lane !== lane) continue;
      const dist = Math.abs(songTimeNow - t.hitAtSec);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
      if (!(t.y < hitBottom && t.y + t.heightPx > hitTop)) continue;
      if (!target || t.y > target.y) target = t;
    }

    // Mistaps are ignored; the run fails only when a tile is truly missed by time.
    if (!target) {
      target = nearest;
    }
    if (!target) {
      return;
    }

    const inPerfectWindow = isWithinHitWindow(
      songTimeNow,
      target.hitAtSec,
      difficultyRef.current
    );
    // Always consume tapped tile in hit zone so a real tap never becomes a later "miss".
    setTiles((prev) => prev.filter((t) => t.id !== target!.id));
    if (!inPerfectWindow) {
      // Off-timing taps stay forgiving: keep run alive, reset combo, tiny score gain.
      comboRef.current = 0;
      scoreRef.current += 1;
      setCombo(0);
      setScore(scoreRef.current);
      return;
    }
    comboRef.current += 1;
    const gain = 10 + Math.floor(comboRef.current / 4) * 2;
    scoreRef.current += gain;
    setCombo(comboRef.current);
    setScore(scoreRef.current);
    const tier = Math.min(8, Math.floor(comboRef.current / 5));
    hitFxToken.current += 1;
    const tok = hitFxToken.current;
    setHitFx({ lane, token: tok, tier });
    window.setTimeout(() => {
      setHitFx((h) => (h?.token === tok ? null : h));
    }, 240);
  };

  const pauseResume = () => {
    const raw = ytPlayerRef.current;
    const p = isYTPlayerLike(raw) ? raw : null;
    if (!p) return;

    if (screen === "playing") {
      p.pauseVideo();
      setScreen("paused");
      return;
    }
    if (screen === "paused") {
      p.playVideo();
      setScreen("playing");
    }
  };

  const goDashboard = async () => {
    setAudioStalled(false);
    levelOutcomeRef.current = "none";
    holdPointerCleanupRef.current?.();
    holdPointerCleanupRef.current = null;
    holdActiveRef.current = null;
    holdStartedIdsRef.current.clear();
    stopLoop();
    setTiles([]);
    setCombo(0);
    setScore(0);
    scoreRef.current = 0;
    comboRef.current = 0;
    setScreen("menu");
    await gotoMenuAudio();
  };

  const toggleFavorite = (songId: string) => {
    setSave((prev) => {
      const has = prev.favorites.includes(songId);
      return {
        ...prev,
        favorites: has ? prev.favorites.filter((x) => x !== songId) : [...prev.favorites, songId],
      };
    });
  };

  const moodBg = MOOD_BG[selectedSong.mood];
  const arenaPalette = selectedSong.mood === "emotional" ? ARENA_PHASE_EMOTIONAL : ARENA_PHASE;
  const bgMood: Mood = screen === "menu" ? "emotional" : selectedSong.mood;
  const bgVideoSrc = BG_VIDEO_BY_MOOD[bgMood];
  const bgVideoToneClass =
    bgMood === "edm"
      ? "brightness-[0.42] blur-[2px] saturate-[1.45] contrast-[1.18] hue-rotate-[14deg]"
      : "brightness-[0.35] blur-[2px] saturate-[0.92]";

  useEffect(() => {
    setBgVideoOk(true);
  }, [bgVideoSrc]);

  useEffect(() => {
    const onVisibility = () => {
      const v = bgVideoRef.current;
      if (!v) return;
      if (document.hidden) {
        v.pause();
      } else {
        void v.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return (
    <div className={`relative min-h-screen overflow-hidden text-white`}>
      <div className="pointer-events-none fixed inset-0 z-0">
        <video
          key={bgVideoSrc}
          ref={bgVideoRef}
          className={`h-full w-full object-cover transition-opacity duration-500 ${bgVideoToneClass} ${bgVideoOk ? "opacity-100" : "opacity-0"}`}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          onError={() => setBgVideoOk(false)}
          aria-hidden
        >
          <source src={bgVideoSrc} type="video/mp4" />
        </video>
        <div
          className={`absolute -inset-8 ${
            bgMood === "edm"
              ? "neon-bg-flow bg-[radial-gradient(circle_at_20%_30%,rgba(34,211,238,0.45),transparent_46%),radial-gradient(circle_at_82%_70%,rgba(217,70,239,0.42),transparent_44%),radial-gradient(circle_at_52%_56%,rgba(56,189,248,0.36),transparent_56%)]"
              : "dreamy-bg-drift bg-[radial-gradient(circle_at_18%_24%,rgba(56,189,248,0.2),transparent_46%),radial-gradient(circle_at_82%_72%,rgba(217,70,239,0.2),transparent_44%),radial-gradient(circle_at_52%_52%,rgba(99,102,241,0.2),transparent_56%)]"
          }`}
        />
        <div className={`absolute inset-0 ${bgMood === "edm" ? "cinematic-glow bg-gradient-to-tr from-cyan-400/15 via-transparent to-fuchsia-500/18" : "bg-gradient-to-tr from-indigo-300/8 via-transparent to-fuchsia-300/10"}`} />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/65 via-black/60 to-black/78" />
        <div className={`absolute inset-0 bg-gradient-to-b ${moodBg} opacity-35`} />
      </div>
      {/* Avoid display:none — some browsers throttle or block audio in fully hidden embeds. */}
      <div
        id="yt-player-host"
        className="pointer-events-none fixed top-0 left-0 h-px w-px overflow-hidden opacity-0"
        aria-hidden
      />
      <main className="relative z-20 mx-auto w-full max-w-md px-4 py-5">
        <header className="mb-3 rounded-2xl border border-white/25 bg-white/10 p-4 backdrop-blur-xl shadow-[0_12px_42px_rgba(0,0,0,0.35),0_0_28px_rgba(34,211,238,0.16)]">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold tracking-wide">Beat Tiles Neon</h1>
            <button onClick={() => setShowSettings((s) => !s)} className="rounded-lg border border-white/25 px-3 py-1 text-sm">
              Settings
            </button>
          </div>
          <p className="mt-1 text-xs text-cyan-100/80">Magic Tiles–style · full song · chart-driven notes</p>
          <p className="mt-2 text-sm text-emerald-300">Global High Score: {globalBest}</p>
        </header>

        {showSettings && (
          <section className="mb-3 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl shadow-[0_12px_36px_rgba(0,0,0,0.28)]">
            <h2 className="mb-2 text-sm font-semibold">Audio</h2>
            <label className="block text-xs text-white/80">
              Dashboard Volume ({Math.round(save.dashboardVolume * 100)}%)
              <input
                className="mt-1 w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={save.dashboardVolume}
                onChange={(e) => setSave((p) => ({ ...p, dashboardVolume: Number(e.target.value) }))}
              />
            </label>
            <label className="mt-3 block text-xs text-white/80">
              Gameplay Volume ({Math.round(save.gameVolume * 100)}%)
              <input
                className="mt-1 w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={save.gameVolume}
                onChange={(e) => setSave((p) => ({ ...p, gameVolume: Number(e.target.value) }))}
              />
            </label>
          </section>
        )}

        {screen === "menu" && (
          <section className="mb-3 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl shadow-[0_12px_36px_rgba(0,0,0,0.3)]">
            <div className="mb-3 flex gap-2">
              {(["easy", "hard"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${difficulty === d ? "bg-cyan-500 text-black" : "bg-white/10"}`}
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>

            <h2 className="mb-2 text-sm font-semibold">Song Dashboard</h2>
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {sortedSongs.map((song) => {
                const fav = save.favorites.includes(song.id);
                const selected = song.id === selectedSongId;
                const best = save.bestBySong[song.id] ?? 0;
                return (
                  <div
                    key={song.id}
                    onClick={() => setSelectedSongId(song.id)}
                    className={`cursor-pointer rounded-xl border px-3 py-2 backdrop-blur-md ${selected ? "border-cyan-300/80 bg-cyan-400/18 shadow-[0_0_22px_rgba(34,211,238,0.2)]" : "border-white/20 bg-white/10"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{song.title}</p>
                        <p className="text-xs text-white/70">
                          {song.inspiredBy} · {song.bpm} BPM
                        </p>
                        <p className="text-[11px] text-emerald-300">High Score: {best}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(song.id);
                        }}
                        className="text-lg text-pink-300"
                        aria-label="favorite"
                      >
                        {fav ? "♥" : "♡"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <button onClick={() => void beginRun()} className="mt-4 w-full rounded-xl bg-cyan-400 py-3 font-bold text-black shadow-[0_0_20px_rgba(34,211,238,0.45)]">
              Play
            </button>
          </section>
        )}

        {screen !== "menu" && (
          <section className="mb-3 rounded-2xl border border-white/20 bg-white/10 p-3 backdrop-blur-xl shadow-[0_12px_36px_rgba(0,0,0,0.32)]">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{selectedSong.title}</p>
                <p className="text-xs text-white/70">{selectedSong.bpm} BPM · {difficulty.toUpperCase()} · smooth beat flow</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/70">Score</p>
                <p className="text-2xl font-bold text-cyan-300">{score}</p>
              </div>
            </div>

            <p className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-white/65">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm border border-cyan-300/70 bg-cyan-500/30 shadow-[0_0_10px_rgba(34,211,238,0.45)]" />
                Tap each tile on the beat
              </span>
            </p>
            <p className="mb-2 text-[10px] text-amber-200/80">One tile color only. Miss any tile and the run ends.</p>

            <div className="mb-2 flex items-center justify-between">
              <p
                className={`text-sm font-semibold transition-all duration-300 ${
                  combo >= 20
                    ? "text-fuchsia-200 drop-shadow-[0_0_14px_rgba(232,121,249,0.85)] scale-105"
                    : combo >= 10
                      ? "text-cyan-200 drop-shadow-[0_0_10px_rgba(34,211,238,0.7)]"
                      : "text-amber-300"
                }`}
              >
                Combo ×{combo}
              </p>
              <button
                onClick={pauseResume}
                disabled={screen === "gameover" || screen === "complete"}
                className="rounded-md border border-white/30 px-3 py-1 text-sm disabled:opacity-40"
              >
                {screen === "paused" ? "Resume" : "Pause"}
              </button>
            </div>

            <div
              ref={arenaRef}
              className={`relative h-[62vh] overflow-hidden rounded-xl border border-cyan-300/30 transition-[background,box-shadow] duration-[1200ms] ease-in-out ${arenaPalette[musicPhase].grad} ${arenaPalette[musicPhase].glow}`}
            >
              {musicPhase === "drop" && (
                <div
                  key={`pulse-${musicPhase}`}
                  className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-t from-fuchsia-500/25 via-transparent to-cyan-400/15 beat-tiles-bg-pulse"
                  aria-hidden
                />
              )}

              <div
                className="pointer-events-none absolute left-0 right-0 border border-cyan-300/50 bg-cyan-400/10 transition-opacity duration-700"
                style={{ top: `${HIT_TOP_RATIO * 100}%`, height: `${(HIT_BOTTOM_RATIO - HIT_TOP_RATIO) * 100}%` }}
              />

              {tiles.map((tile) => (
                <div
                  key={tile.id}
                  className="pointer-events-none absolute z-10 rounded-md border border-cyan-300/80 bg-gradient-to-b from-cyan-400/45 via-cyan-500/35 to-cyan-700/30 shadow-[inset_0_1px_8px_rgba(255,255,255,0.18),0_0_18px_rgba(34,211,238,0.38)]"
                  style={{
                    top: tile.y,
                    left: `${(tile.lane * 100) / LANES}%`,
                    width: `${100 / LANES}%`,
                    height: tile.heightPx,
                  }}
                />
              ))}

              {hitFx !== null && (
                <div className="pointer-events-none absolute inset-0 z-[18] flex" aria-hidden>
                  {Array.from({ length: LANES }).map((_, i) => (
                    <div key={i} className="relative h-full flex-1">
                      {hitFx.lane === i && (
                        <div
                          key={hitFx.token}
                          className="beat-tiles-lane-hit absolute inset-x-[2px]"
                          style={{
                            top: `${HIT_TOP_RATIO * 100}%`,
                            height: `${(HIT_BOTTOM_RATIO - HIT_TOP_RATIO) * 100}%`,
                            boxShadow:
                              hitFx.tier >= 4
                                ? `0 0 ${28 + hitFx.tier * 4}px rgba(236,72,153,0.45), 0 0 ${18 + hitFx.tier * 2}px rgba(34,211,238,0.5)`
                                : undefined,
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="absolute inset-0 z-20 flex">
                {Array.from({ length: LANES }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onLanePointerDown(i);
                    }}
                    onClick={() => onLanePointerDown(i)}
                    className="h-full flex-1 touch-none border-l border-white/10 first:border-l-0 active:bg-white/10"
                    disabled={screen !== "playing"}
                    aria-label={`lane-${i + 1}`}
                  />
                ))}
              </div>

              {screen === "paused" && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-sm">
                  <p className="text-xl font-semibold">Paused</p>
                </div>
              )}

              {screen === "playing" && audioStalled && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-[35] flex justify-center px-4">
                  <button
                    type="button"
                    onClick={() => void unlockGameAudio()}
                    className="pointer-events-auto max-w-sm rounded-xl border border-white/30 bg-black/55 px-5 py-3 text-center backdrop-blur-xl shadow-[0_0_24px_rgba(251,191,36,0.25)]"
                  >
                    <p className="text-lg font-semibold text-amber-200">Tap to start music</p>
                    <p className="mt-1 text-xs text-white/70">Your browser blocked autoplay. One tap unlocks the track.</p>
                  </button>
                </div>
              )}

              {screen === "gameover" && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
                  <div className="w-full rounded-xl border border-white/30 bg-white/12 p-4 text-center backdrop-blur-xl">
                    <p className="text-2xl font-bold text-red-300">Game Over</p>
                    <p className="mt-1 text-sm text-white/80">Score: {score}</p>
                    <p className="text-xs text-emerald-300">Best for song: {currentBest}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button onClick={() => void beginRun()} className="rounded-lg bg-cyan-400 py-2 font-semibold text-black">Restart</button>
                      <button onClick={() => void goDashboard()} className="rounded-lg border border-white/30 py-2">Dashboard</button>
                    </div>
                  </div>
                </div>
              )}

              {screen === "complete" && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
                  <div className="w-full rounded-xl border border-white/30 bg-white/12 p-4 text-center backdrop-blur-xl">
                    <p className="text-2xl font-bold text-emerald-300">Song Complete</p>
                    <p className="mt-1 text-sm text-white/80">You finished the track.</p>
                    <p className="mt-1 text-sm text-white/90">Score: {score}</p>
                    <p className="text-xs text-emerald-300">Best for song: {currentBest}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button onClick={() => void beginRun()} className="rounded-lg bg-cyan-400 py-2 font-semibold text-black">Play Again</button>
                      <button onClick={() => void goDashboard()} className="rounded-lg border border-white/30 py-2">Dashboard</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}




