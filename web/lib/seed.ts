import type { MediaItem, Source, ContentType, Team } from './types';
import { seasonForDate } from './seasons';

export const SEED_TEAMS: Team[] = [
  { number: '1234A', organization: 'Sage Robotics', region: 'California, USA', country: 'US', firstSeenAt: '2024-09-12T14:00:00Z' },
  { number: '7132A', organization: 'Aurora Engineering', region: 'Texas, USA', country: 'US', firstSeenAt: '2024-08-04T19:30:00Z' },
  { number: '99X', organization: 'Trinity Tigers', region: 'Massachusetts, USA', country: 'US', firstSeenAt: '2024-07-22T10:11:00Z' },
  { number: '2A', organization: 'Cypress Lake HS', region: 'Florida, USA', country: 'US', firstSeenAt: '2024-09-15T20:00:00Z' },
  { number: 'BCUZ', organization: 'BC Robotics Collective', region: 'British Columbia, Canada', country: 'CA', firstSeenAt: '2024-06-30T17:00:00Z' },
  { number: '4021X', organization: 'XLR8', region: 'Texas, USA', country: 'US', firstSeenAt: '2024-08-19T22:14:00Z' },
  { number: '8385B', organization: 'Westwood Tech', region: 'Ontario, Canada', country: 'CA', firstSeenAt: '2024-10-01T13:00:00Z' },
  { number: '6247Z', organization: 'Zenith Mechanics', region: 'New York, USA', country: 'US', firstSeenAt: '2024-08-11T18:30:00Z' },
  { number: '1908A', organization: 'Apex Robotics', region: 'Singapore', country: 'SG', firstSeenAt: '2024-09-25T03:00:00Z' },
  { number: '1114E', organization: 'Eagle Innovation', region: 'Auckland, New Zealand', country: 'NZ', firstSeenAt: '2024-07-08T05:00:00Z' },
  { number: '9100D', organization: 'Delta Force', region: 'London, UK', country: 'GB', firstSeenAt: '2024-09-04T11:30:00Z' },
  { number: '8675C', organization: 'Catalyst Robotics', region: 'Washington, USA', country: 'US', firstSeenAt: '2024-08-28T19:00:00Z' },
  { number: '12345A', organization: 'Pinnacle High School', region: 'Arizona, USA', country: 'US', firstSeenAt: '2024-10-12T22:00:00Z' },
  { number: '5588B', organization: '中山大学附属中学', region: 'Guangdong, China', country: 'CN', firstSeenAt: '2024-06-15T08:00:00Z' },
  { number: '7700H', organization: 'Hawking Academy', region: 'Beijing, China', country: 'CN', firstSeenAt: '2024-07-12T11:00:00Z' },
  { number: '3324T', organization: '台北市立第一女子高級中學', region: 'Taipei, Taiwan', country: 'TW', firstSeenAt: '2024-08-01T07:00:00Z' },
  { number: '9988M', organization: 'Mumbai Robotics Institute', region: 'Maharashtra, India', country: 'IN', firstSeenAt: '2024-07-30T14:00:00Z' },
  { number: '2025R', organization: 'Robolympus', region: 'São Paulo, Brazil', country: 'BR', firstSeenAt: '2024-09-20T20:00:00Z' },
  { number: '4567P', organization: 'Phoenix Engineering', region: 'Texas, USA', country: 'US', firstSeenAt: '2024-08-15T16:00:00Z' },
  { number: '8800V', organization: 'Vortex Robotics', region: 'Oregon, USA', country: 'US', firstSeenAt: '2024-09-02T13:00:00Z' },
  { number: '3141K', organization: 'Kepler Robotics', region: 'Illinois, USA', country: 'US', firstSeenAt: '2024-07-19T09:30:00Z' },
  { number: '1729Q', organization: 'Quantum Leap', region: 'Massachusetts, USA', country: 'US', firstSeenAt: '2024-08-22T17:30:00Z' },
  { number: '6543F', organization: 'Faraday Forge', region: 'Pennsylvania, USA', country: 'US', firstSeenAt: '2024-09-08T15:00:00Z' },
  { number: '9999W', organization: 'Westside Wolverines', region: 'Michigan, USA', country: 'US', firstSeenAt: '2024-10-03T19:30:00Z' },
  { number: '2718E', organization: 'Euler Engineers', region: 'Quebec, Canada', country: 'CA', firstSeenAt: '2024-07-25T12:00:00Z' },
  { number: '1618G', organization: 'Golden Ratio Robotics', region: 'California, USA', country: 'US', firstSeenAt: '2024-08-30T21:00:00Z' },
  { number: '5040N', organization: 'Newton North HS', region: 'Massachusetts, USA', country: 'US', firstSeenAt: '2024-09-18T10:30:00Z' },
  { number: '8128P', organization: 'Perfect Numbers', region: 'New Jersey, USA', country: 'US', firstSeenAt: '2024-07-14T16:30:00Z' },
  { number: '3030S', organization: 'Sigma Squad', region: 'Sydney, Australia', country: 'AU', firstSeenAt: '2024-08-09T05:00:00Z' },
  { number: '7777L', organization: 'Lambda Lions', region: 'Berlin, Germany', country: 'DE', firstSeenAt: '2024-07-02T13:00:00Z' },
];

const TITLES = [
  'Push Back early season reveal',
  'Push Back competition robot v2',
  'High Stakes worlds reveal',
  'Updated drivetrain showcase',
  'Mobile goal mech CAD render',
  'Driver skills run — 56 points',
  'Programming skills auton',
  'Iso view of the chassis',
  'New intake design — 4-bar lift',
  'Top mount claw geometry',
  'Wallstake mech — long bar',
  'V5 reveal — full robot walkaround',
  'Practice match vs 1234A',
  'Quals 7 vs 99X',
  'Worlds prep — final tune',
  'Programming skills 124pt run',
  '中山大学附属中学 V5 揭秘',
  'Final driver skills attempt before states',
  'Behind the scenes — assembly timelapse',
  'A really long title that goes on and on to test wrapping in the layout — please word-wrap nicely',
];

const DESCRIPTIONS = [
  'Built around a 4-bar with passive intake. Drive on 360rpm direct drive 4-motor.',
  'Updated from worlds — added active redirect to claw and reworked elevator gearing.',
  'Reveal video for our Push Back robot. Going to states next month.',
  'CAD render attached. Full BOM in the comments thread.',
  'First time running this design in a real match. Lots of iterations to come.',
];

const DISCORD_CHANNELS = ['vex-reveals', 'vex-cad-robots', 'robolytics-robots', 'match-notes'];
const YOUTUBE_CHANNELS = ['VEX Robotics Official', 'BLRS', 'Aura Robotics', 'JarTeam', 'Tate Robotics'];

const NOW = new Date('2026-05-02T16:00:00Z');

function isoMinusMinutes(min: number): string {
  return new Date(NOW.getTime() - min * 60 * 1000).toISOString();
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function buildItem(opts: {
  id: string;
  teamNumber: string | null;
  source: Source;
  contentType: ContentType;
  minutesAgo: number;
  titleIdx: number;
  authorIdx: number;
  thumbSeed: string;
}): MediaItem {
  const { id, teamNumber, source, contentType, minutesAgo, titleIdx, authorIdx, thumbSeed } = opts;
  const postedAt = isoMinusMinutes(minutesAgo);
  const sourceChannel =
    source === 'discord'
      ? pick(DISCORD_CHANNELS, titleIdx)
      : source === 'youtube'
        ? pick(YOUTUBE_CHANNELS, titleIdx)
        : undefined;

  let originalUrl = 'https://discord.com/channels/000/000/' + id;
  let fullUrl = `https://picsum.photos/seed/${thumbSeed}/1600/1200`;
  if (source === 'youtube') {
    const ytId = ('aperture' + thumbSeed).slice(0, 11);
    originalUrl = `https://www.youtube.com/watch?v=${ytId}`;
    fullUrl = `https://www.youtube.com/embed/${ytId}`;
  }

  return {
    id,
    teamNumber,
    source,
    sourceChannel,
    contentType,
    postedAt,
    seasonId: seasonForDate(postedAt),
    thumbnailUrl: `https://picsum.photos/seed/${thumbSeed}/800/600`,
    fullUrl,
    title: pick(TITLES, titleIdx),
    description: pick(DESCRIPTIONS, titleIdx),
    width: 800,
    height: 600,
    durationSeconds: contentType === 'image' ? undefined : 30 + (titleIdx % 5) * 12,
    originalUrl,
    authorDisplayName: pick(['mech_lead', 'cad_jay', 'driver42', 'team_captain', '陳宥任'], authorIdx),
  };
}

function buildAll(): MediaItem[] {
  const items: MediaItem[] = [];
  let id = 0;
  // Distribute 150 items across 30 teams. Some teams get many, some get few.
  // First, give each team a base number of items proportional to a power-law.
  const counts: number[] = [];
  for (let i = 0; i < SEED_TEAMS.length; i++) {
    if (i < 4) counts.push(15 + (i % 3));
    else if (i < 12) counts.push(6 + (i % 3));
    else counts.push(1 + (i % 4));
  }

  for (let t = 0; t < SEED_TEAMS.length; t++) {
    const team = SEED_TEAMS[t];
    const n = counts[t];
    for (let k = 0; k < n; k++) {
      const r = (id * 7 + t * 3 + k) % 100;
      let source: Source;
      if (r < 60) source = 'discord';
      else if (r < 95) source = 'youtube';
      else source = (r < 98 ? 'vex-cad' : 'robolytics');

      let contentType: ContentType;
      if (source === 'youtube') contentType = 'youtube';
      else {
        const cr = (id * 5 + k) % 10;
        contentType = cr < 6 ? 'image' : 'video';
      }

      const minutesAgo = 10 + id * 73 + k * 31 + t * 211;

      items.push(
        buildItem({
          id: `m${id.toString().padStart(4, '0')}`,
          teamNumber: team.number,
          source,
          contentType,
          minutesAgo,
          titleIdx: id + t,
          authorIdx: id + k,
          thumbSeed: `${team.number}-${k}`,
        }),
      );
      id++;
    }
  }

  // Untagged
  for (let u = 0; u < 7; u++) {
    items.push(
      buildItem({
        id: `u${u.toString().padStart(3, '0')}`,
        teamNumber: null,
        source: 'discord',
        contentType: u % 2 === 0 ? 'image' : 'video',
        minutesAgo: 60 + u * 1300,
        titleIdx: u + 3,
        authorIdx: u,
        thumbSeed: `untagged-${u}`,
      }),
    );
  }

  // Sort newest first
  items.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  return items;
}

// Albums carry no seed/demo content — real albums come from the local
// importer (scripts/src/import-album.ts). SEED_EVENTS stays exported (empty)
// so the album data-layer fallbacks resolve to "no albums" under
// USE_SEED_DATA without special-casing.
export interface SeedEvent {
  id: string;
  name: string;
  slug: string;
  date?: string;
  location?: string;
  coverOriginalFilename?: string;
}

export const SEED_EVENTS: SeedEvent[] = [];

export const SEED_MEDIA: MediaItem[] = buildAll();

export const SEED_LAST_SYNC = isoMinusMinutes(4);
