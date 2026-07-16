import { notFound } from 'next/navigation';
import { getAlbum } from '@/lib/data';
import { AlbumImportClient } from '@/components/vex/album-import-client';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const album = await getAlbum(slug);
  return { title: album ? `Import — ${album.name}` : 'Import — Aperture' };
}

// Uploads write to R2/DB at request time; nothing to cache here.
export const dynamic = 'force-dynamic';

export default async function AlbumImportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const album = await getAlbum(slug);
  if (!album) notFound();
  return <AlbumImportClient slug={album.slug} name={album.name} />;
}
