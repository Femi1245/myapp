export type TileKind = "tap";

/**
 * Chart events in seconds. `t` = instant the note head crosses the hit line.
 * Hold: keep finger down until `end` crosses the line.
 */
export type BeatEvent =
  | { t: number; lane: number; kind: "tap" };

const LANES = 4;

function clampLane(lane: number): number {
  const x = Math.round(lane);
  return ((x % LANES) + LANES) % LANES;
}

/**
 * Deterministic chart on a strict beat grid: one main note every 60/BPM seconds, starting at `beatOffsetSec`.
 * Gameplay uses the YouTube `currentTime` clock so tiles cross the hit line exactly at each `t` (when BPM matches the track).
 */
export function buildBpmLaneMap(
  durationSec: number,
  bpm: number,
  beatOffsetSec: number,
  lanePattern: readonly number[],
  opts?: {
    /** 1 = note on every beat; 2 = every other beat (more space between tiles). */
    beatStride?: number;
  },
): BeatEvent[] {
  if (!(durationSec > 0) || !Number.isFinite(durationSec) || !(bpm > 0)) return [];
  const beatDur = 60 / bpm;
  const beatStride = Math.max(1, Math.floor(opts?.beatStride ?? 1));
  const events: BeatEvent[] = [];
  let beatIndex = 0;
  for (let t = beatOffsetSec; t < durationSec - 0.06; t += beatDur) {
    if (beatIndex % beatStride !== 0) {
      beatIndex += 1;
      continue;
    }
    const lane = clampLane(lanePattern[beatIndex % lanePattern.length]!);
    events.push({ t, lane, kind: "tap" });
    beatIndex += 1;
  }
  return events.sort((a, b) => a.t - b.t || a.lane - b.lane);
}

export function filterDifficulty(events: BeatEvent[]): BeatEvent[] {
  return events;
}

export function mergeBeatMaps(base: BeatEvent[], extra: BeatEvent[]): BeatEvent[] {
  return [...base, ...extra].sort((a, b) => a.t - b.t || a.lane - b.lane);
}
