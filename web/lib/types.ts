export type Source = 'discord' | 'youtube' | 'vex-cad' | 'robolytics';

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
}

export interface SearchSuggestion {
  team: Team;
  contentCount: number;
}

export interface FeedCursor {
  postedBefore: string;
}
