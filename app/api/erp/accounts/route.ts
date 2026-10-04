import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByGoogleId, getAccounts } from '@/lib/db/users';

export const dynamic = 'force-dynamic';

/**
 * GET /api/erp/accounts
 * Lists the user's linked ERP accounts (universityId + label, no secrets).
 */
export async function GET() {
  const gsession = await getServerSession(authOptions);
  const googleId = (gsession?.user as { id?: string } | undefined)?.id;
  if (!googleId) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const user = await getUserByGoogleId(googleId);
  if (!user) {
    return Response.json({ accounts: [] });
  }

  const accounts = getAccounts(user).map(a => ({
    universityId: a.universityId,
    label: a.label || a.universityId,
  }));

  return Response.json({ accounts });
}
