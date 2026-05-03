import type { ChannelType } from './channels';

const PRIMARY_RE = /\b\d{1,5}[A-Z]\b/g;
// Bare-digit fallback: 3–5 digits only. The spec allowed 1–5 but in practice
// 1–2 digit bare numbers ("4", "10", "v2") are virtually all noise — real
// VEX teams of those sizes always carry a letter suffix and are caught by
// the primary regex.
const ORG_FALLBACK_RE = /\b\d{3,5}\b/g;

export interface ExtractContext {
  channelType: ChannelType;
  messageContent?: string;
  posterNickname?: string;
  posterUsername?: string;
  // Only relevant for admin-reposted-youtube channels:
  youtubeTitle?: string;
  youtubeDescription?: string;
  youtubeChannelName?: string;
}

function looksLikeTeam(token: string): boolean {
  // Drop tokens whose numeric prefix is all zeros: "0", "0Z", "000", etc.
  // No real VEX team number starts with zero (0Z would be team-zero).
  const numericPart = token.match(/^\d+/)?.[0] ?? '';
  if (numericPart === '' || /^0+$/.test(numericPart)) return false;
  return true;
}

function uniqueMatches(re: RegExp, ...sources: (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const s of sources) {
    if (!s) continue;
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) {
      const tok = m[0].toUpperCase();
      if (looksLikeTeam(tok)) out.add(tok);
    }
  }
  return Array.from(out);
}

function firstHit(
  re: RegExp,
  ...sources: (string | undefined)[]
): string[] {
  for (const s of sources) {
    const hits = uniqueMatches(re, s);
    if (hits.length > 0) return hits;
  }
  return [];
}

/**
 * extractTeams returns an array of VEX team numbers found in the given
 * context, applying a per-channel priority chain. An empty array means
 * "untagged" and the scraper should write a single media row with team_number = null.
 *
 * TODO: when RobotEvents API is integrated, validate each returned team
 * number against the registered-teams list and discard hallucinated matches
 * (e.g. random year numbers). For v1 we trust the regex.
 */
export function extractTeams(ctx: ExtractContext): string[] {
  if (ctx.channelType === 'self-posted') {
    // 1-3: primary regex on nickname → message → username
    const primary = firstHit(
      new RegExp(PRIMARY_RE.source, 'g'),
      ctx.posterNickname,
      ctx.messageContent,
      ctx.posterUsername,
    );
    if (primary.length) return primary;
    // 4: org fallback (bare digits) on the same fields
    const fallback = firstHit(
      new RegExp(ORG_FALLBACK_RE.source, 'g'),
      ctx.posterNickname,
      ctx.messageContent,
      ctx.posterUsername,
    );
    return fallback;
  }

  // admin-reposted-youtube
  // 1: YouTube title — return ALL matches as multi-team reveal
  const titleMatches = uniqueMatches(
    new RegExp(PRIMARY_RE.source, 'g'),
    ctx.youtubeTitle,
  );
  if (titleMatches.length) return titleMatches;

  // 2: first 500 chars of description
  const descSnippet = (ctx.youtubeDescription ?? '').slice(0, 500);
  const descMatches = uniqueMatches(new RegExp(PRIMARY_RE.source, 'g'), descSnippet);
  if (descMatches.length) return descMatches;

  // 3: YouTube channel name
  const chanMatches = uniqueMatches(
    new RegExp(PRIMARY_RE.source, 'g'),
    ctx.youtubeChannelName,
  );
  if (chanMatches.length) return chanMatches;

  // 4: org fallback in title only
  const titleFallback = uniqueMatches(
    new RegExp(ORG_FALLBACK_RE.source, 'g'),
    ctx.youtubeTitle,
  );
  if (titleFallback.length) return titleFallback;

  // 5: last resort — Discord nickname/username (rare)
  const lastResort = firstHit(
    new RegExp(PRIMARY_RE.source, 'g'),
    ctx.posterNickname,
    ctx.posterUsername,
  );
  if (lastResort.length) return lastResort;

  return [];
}

/**
 * Lightweight YouTube link extractor used by the Discord scraper to populate
 * the youtube_enrichment_queue. Matches the four canonical URL forms.
 */
const YOUTUBE_PATTERNS: RegExp[] = [
  /youtube\.com\/watch\?[^\s]*v=([A-Za-z0-9_-]{11})/g,
  /youtu\.be\/([A-Za-z0-9_-]{11})/g,
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/g,
  /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/g,
];

export function extractYoutubeVideoIds(text: string): string[] {
  const out = new Set<string>();
  for (const re of YOUTUBE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) out.add(m[1]);
  }
  return Array.from(out);
}
