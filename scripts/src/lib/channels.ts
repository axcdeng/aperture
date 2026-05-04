// Hardcoded Discord channel config.
// `type` controls how team numbers are extracted from each channel's content.
// See ./team-extraction.ts for the priority chain.

export type ChannelType = 'admin-reposted-youtube' | 'self-posted';

export interface ChannelConfig {
  id: string;
  name: string;
  guildId: string;
  guild: string;
  type: ChannelType;
  description: string;
}

export const CHANNELS: ChannelConfig[] = [
  {
    id: '358443347515539457', // VEX Robotics Competition guild · #reveals
    name: 'vex-reveals',
    guildId: '169024416602685440',
    guild: 'VEX Robotics Competition',
    type: 'admin-reposted-youtube',
    description:
      "Admin-curated reveals channel. Reveals are posted as YouTube links by mods, not by the teams themselves. Don't trust the Discord poster's nickname — check video title and description instead.",
  },
  {
    id: '900591595315929098', // VEX CAD guild · #robots
    name: 'vex-cad-robots',
    guildId: '703422250212261939',
    guild: 'VEX CAD',
    type: 'self-posted',
    description: "Teams post their own CAD renders. Poster's nickname usually contains team number.",
  },
  {
    id: '703422828917162014', // VEX CAD guild · #renders
    name: 'vex-cad-renders',
    guildId: '703422250212261939',
    guild: 'VEX CAD',
    type: 'self-posted',
    description: "Teams post additional CAD render screenshots. Same per-poster heuristics as #robots.",
  },
  // ----------------------------------------------------------------------
  // Disabled: throwaway lacks role/perms to read this channel. Restore once
  // a Robolytics admin grants read access — no other code change required.
  // ----------------------------------------------------------------------
  // {
  //   id: '1273071672760467623', // Robolytics guild · #robot-ratings
  //   name: 'robolytics-robots',
  //   guildId: '<TODO_GUILD_ID>',
  //   guild: 'Robolytics',
  //   type: 'self-posted',
  //   description: "Teams post their own robot photos/videos.",
  // },
];

export function isPlaceholder(id: string): boolean {
  return id === '<TODO_CHANNEL_ID>' || id.startsWith('<TODO');
}

export function configuredChannels(): ChannelConfig[] {
  return CHANNELS.filter((c) => !isPlaceholder(c.id));
}
