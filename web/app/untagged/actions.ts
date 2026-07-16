'use server';

import { revalidatePath } from 'next/cache';
import { assignMediaToTeam, dismissMedia } from '@/lib/data';

// NOTE: the /untagged route is intended to be admin-only (see the banner on
// the page). There is no auth system yet, so these Server Actions are reachable
// by anyone who can reach the page — gate them behind an auth check when auth
// lands. Server Actions are callable via direct POST, not just through the UI.

export type ActionResult = { ok: true } | { ok: false; error: string };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export async function assignMediaAction(
  mediaId: string,
  teamNumber: string,
): Promise<ActionResult> {
  try {
    await assignMediaToTeam(mediaId, teamNumber);
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
  revalidatePath('/untagged');
  revalidatePath('/browse');
  return { ok: true };
}

export async function dismissMediaAction(mediaId: string): Promise<ActionResult> {
  try {
    await dismissMedia(mediaId);
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
  revalidatePath('/untagged');
  revalidatePath('/browse');
  return { ok: true };
}
