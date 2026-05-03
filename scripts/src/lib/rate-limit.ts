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
