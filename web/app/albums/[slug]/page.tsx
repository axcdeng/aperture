import { notFound } from 'next/navigation';
import { getAlbum, getAlbumPhotos } from '@/lib/data';
import { AlbumDetailClient } from '@/components/vex/album-detail-client';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const album = await getAlbum(slug);
  if (!album) return { title: 'Album not found — Aperture' };
  return {
    title: `${album.name} — Aperture`,
    description: `${album.photoCount} photos from ${album.name}, tagged by VEX team.`,
  };
}

export const revalidate = 60;

export default async function AlbumPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const album = await getAlbum(slug);
  if (!album) notFound();
  const photos = await getAlbumPhotos(album.id);
  return <AlbumDetailClient album={album} photos={photos} />;
}
