import { notFound } from 'next/navigation';
import { getTeam, getTeamMedia } from '@/lib/data';
import { TeamPageClient } from '@/components/vex/team-page-client';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ teamNumber: string }>;
}) {
  const { teamNumber } = await params;
  const team = await getTeam(teamNumber);
  if (!team) return { title: `${teamNumber} not found — Aperture` };
  return {
    title: `${team.number} · ${team.organization} — Aperture`,
    description: `Reveals, photos, and CAD for VEX team ${team.number} (${team.organization}).`,
  };
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ teamNumber: string }>;
}) {
  const { teamNumber } = await params;
  const team = await getTeam(teamNumber);
  if (!team) notFound();
  const media = await getTeamMedia(teamNumber);
  return <TeamPageClient team={team} media={media} />;
}
