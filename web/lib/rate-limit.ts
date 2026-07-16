// Best-effort in-memory rate limiter for the public/unauthenticated album
// endpoints. It keeps a fixed-window counter per key (usually a client IP) in
// module memory.
//
// Caveat: serverless deployments run many isolated instances, so this bounds
// abuse *per instance*, not globally. That's deliberately "low-effort but
// something" — enough to blunt a naive loop without standing up Redis/KV. If a
// hard global limit is ever needed, back this with Vercel KV / Upstash.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Opportunistic sweep so the map can't grow unbounded across many keys.
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/**
 * Returns whether the request is allowed, plus headers to echo back.
 * @param key    identifier to limit on (e.g. `${ip}:${route}`)
 * @param limit  max requests per window
 * @param windowMs  window length in ms
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt };
  }
  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);
  return { ok: existing.count <= limit, remaining, resetAt: existing.resetAt };
}

/** Extract a best-guess client IP from proxy headers. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/** Build 429 headers (+ optional Retry-After) from a rateLimit result. */
export function rateLimitHeaders(r: { remaining: number; resetAt: number }): Record<string, string> {
  return {
    'X-RateLimit-Remaining': String(r.remaining),
    'X-RateLimit-Reset': String(Math.ceil(r.resetAt / 1000)),
    'Retry-After': String(Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000))),
  };
}
