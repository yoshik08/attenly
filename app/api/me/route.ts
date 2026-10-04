import { getServerSession } from 'next-auth';
import { authOptions, isGoogleConfigured } from '@/lib/auth';
import { getUserByGoogleId } from '@/lib/db/users';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me — who is signed in, and is an ERP login remembered for them?
 * Never returns credentials — only linkage metadata.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const googleId = (session?.user as { id?: string } | undefined)?.id;
  if (!googleId) {
    return Response.json({
      signedIn: false,
      googleConfigured: isGoogleConfigured(),
    });
  }
  try {
    const user = await getUserByGoogleId(googleId);
    const suser = session?.user;
    return Response.json({
      signedIn: true,
      googleConfigured: true,
      name: suser?.name ?? user?.name ?? null,
      email: suser?.email ?? user?.email ?? null,
      linked: Boolean(user?.creds && user?.universityId),
      universityId: user?.universityId ?? null,
    });
  } catch (e) {
    console.error('[api/me]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Could not load profile.' }, { status: 502 });
  }
}
