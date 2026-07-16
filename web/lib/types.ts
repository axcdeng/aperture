export type Source = 'discord' | 'youtube' | 'vex-cad' | 'robolytics' | 'album';

export type ContentType = 'image' | 'video' | 'youtube';

export type SeasonId = 'high-stakes' | 'push-back' | 'unknown';

export interface Season {
  id: SeasonId;
  name: string;
  startDate: string;
  endDate: string;
  color: string;
}

export interface Team {
  number: string;
  organization: string;
  region: string;
  country: string;
  firstSeenAt: string;
}

export interface MediaItem {
  id: string;
  teamNumber: string | null;
  source: Source;
  sourceChannel?: string;
  contentType: ContentType;
  postedAt: string;
  seasonId: SeasonId;

  thumbnailUrl: string;
  fullUrl: string;
  title?: string;
  description?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;

  originalUrl: string;
  authorDisplayName?: string;

  attachmentCount?: number;
  attachments?: MediaItem[];
  teamNumbers?: string[];

  // Album photos (source='album')
  eventId?: string;
  originalFilename?: string;
}

export interface SearchSuggestion {
  team: Team;
  contentCount: number;
}

// A competition photo album (the `events` table), summarized for the
// Albums index. `coverUrl` is the R2 thumb of the cover photo.
export interface AlbumSummary {
  id: string;
  name: string;
  slug: string;
  date?: string;
  location?: string;
  note?: string;
  coverUrl?: string;
  photoCount: number;
  teamCount: number;
}

export interface FeedCursor {
  postedBefore: string;
}
