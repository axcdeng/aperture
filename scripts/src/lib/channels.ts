// Hardcoded Discord channel config.
// Fill the <TODO_CHANNEL_ID> placeholders by following SETUP.md → step 6.
//
// `type` controls how team numbers are extracted from each channel's content.
// See ./team-extraction.ts for the priority chain.

export type ChannelType = 'admin-reposted-youtube' | 'self-posted';

export interface ChannelConfig {
  id: string;
  name: string;
  guild: string;
  type: ChannelType;
  description: string;
}

export const CHANNELS: ChannelConfig[] = [
  {
    id: '<TODO_CHANNEL_ID>',
    name: 'vex-reveals',
    guild: 'VEX Robotics Official',
    type: 'admin-reposted-youtube',
    description:
      "Admin-curated reveals channel. Reveals are posted as YouTube links by mods, not by the teams themselves. Don't trust the Discord poster's nickname — check video title and description instead.",
  },
  {
    id: '<TODO_CHANNEL_ID>',
    name: 'vex-cad-robots',
    guild: 'VEX CAD',
    type: 'self-posted',
    description: "Teams post their own CAD renders. Poster's nickname usually contains team number.",
  },
  {
    id: '<TODO_CHANNEL_ID>',
    name: 'robolytics-robots',
    guild: 'Robolytics',
    type: 'self-posted',
    description: "Teams post their own robot photos/videos. Poster's nickname usually contains team number.",
  },
];

export function isPlaceholder(id: string): boolean {
  return id === '<TODO_CHANNEL_ID>' || id.startsWith('<TODO');
}

export function configuredChannels(): ChannelConfig[] {
  return CHANNELS.filter((c) => !isPlaceholder(c.id));
}
