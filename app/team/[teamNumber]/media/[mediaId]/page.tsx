import { notFound } from 'next/navigation';
import { getMediaItem, getTeam, getTeamMedia } from '@/lib/data';
import { TeamPageClient } from '@/components/vex/team-page-client';

export default async function TeamMediaPage({
  params,
}: {
  params: Promise<{ teamNumber: string; mediaId: string }>;
}) {
  const { teamNumber, mediaId } = await params;
  const team = await getTeam(teamNumber);
  if (!team) notFound();
  const [media, m] = await Promise.all([getTeamMedia(teamNumber), getMediaItem(mediaId)]);
  if (!m || m.teamNumber !== team.number) notFound();
  return <TeamPageClient team={team} media={media} initialMediaId={mediaId} />;
}
