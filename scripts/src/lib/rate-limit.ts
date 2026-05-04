// Rate-limit helpers shared by the Discord clients.
//
// Tunable via env (all optional, sensible defaults baked in):
//   HUMAN_BASE_MS          base delay between Discord calls (default 1000)
//   HUMAN_JITTER_MS        +/- random jitter on top of base       (default 600)
//   HUMAN_LONG_PAUSE_EVERY trigger a longer pause every N calls   (default 35)
//   HUMAN_LONG_PAUSE_MIN   long pause min seconds                  (default 6)
//   HUMAN_LONG_PAUSE_MAX   long pause max seconds                  (default 18)

function num(envName: string, fallback: number): number {
  const v = parseFloat(process.env[envName] ?? '');
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

const HUMAN_BASE_MS = num('HUMAN_BASE_MS', 1000);
const HUMAN_JITTER_MS = num('HUMAN_JITTER_MS', 600);
const HUMAN_LONG_PAUSE_EVERY = Math.max(1, num('HUMAN_LONG_PAUSE_EVERY', 35));
const HUMAN_LONG_PAUSE_MIN_S = num('HUMAN_LONG_PAUSE_MIN', 6);
const HUMAN_LONG_PAUSE_MAX_S = num('HUMAN_LONG_PAUSE_MAX', 18);

// Kept for backwards compatibility with old code; new callers should use
// humanDelay() so they get jitter + occasional long pauses.
export const DEFAULT_INTERCALL_DELAY_MS = HUMAN_BASE_MS;

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

let _callCount = 0;

/**
 * Sleep for a randomized duration that approximates a real user scrolling.
 * Most calls wait base±jitter; every Nth call we take a multi-second pause
 * to break up the request stream. Returns the actual ms slept.
 */
export async function humanDelay(): Promise<number> {
  _callCount++;
  let ms: number;
  if (_callCount % HUMAN_LONG_PAUSE_EVERY === 0) {
    const longSec =
      HUMAN_LONG_PAUSE_MIN_S +
      Math.random() * Math.max(0, HUMAN_LONG_PAUSE_MAX_S - HUMAN_LONG_PAUSE_MIN_S);
    ms = Math.round(longSec * 1000);
  } else {
    const jitter = (Math.random() * 2 - 1) * HUMAN_JITTER_MS;
    ms = Math.max(50, Math.round(HUMAN_BASE_MS + jitter));
  }
  await sleep(ms);
  return ms;
}

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Rate limited. Retry after ${retryAfterSeconds}s`);
    this.name = 'RateLimitError';
  }
}

export class GiveUpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GiveUpError';
  }
}

// Distinguishes "we don't have permission to read this resource" from a real
// API failure. Used to mark a channel as skipped without failing the whole
// workflow run (e.g. role-gated Discord channels).
export class NoAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoAccessError';
  }
}
