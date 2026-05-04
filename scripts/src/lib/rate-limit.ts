// Rate-limit helpers shared by the Discord clients.

export const DEFAULT_INTERCALL_DELAY_MS = 200;

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
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
