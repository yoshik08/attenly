import { getServerSession, type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { BASE_PATH } from './api';

/**
 * Google sign-in (NextAuth v4). The Google account is the user's identity;
 * their ERP accounts are stored against it in the `users` collection.
 *
 * Required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET and
 * NEXTAUTH_URL (https://yoshik.xyz/attenly/api/auth in production).
 * Google Cloud redirect URI: https://yoshik.xyz/attenly/api/auth/callback/google
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  // Failures and stray visits to NextAuth's own pages land back in the app,
  // which explains the problem in its own words.
  pages: { signIn: BASE_PATH, error: BASE_PATH },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
};

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export interface GoogleUser {
  googleId: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/** The signed-in Google user, or null. */
export async function getGoogleUser(): Promise<GoogleUser | null> {
  const session = await getServerSession(authOptions);
  const googleId = (session?.user as { id?: string } | undefined)?.id;
  if (!googleId) return null;
  return {
    googleId,
    name: session?.user?.name ?? null,
    email: session?.user?.email ?? null,
    image: session?.user?.image ?? null,
  };
}

export function unauthorized(): Response {
  return Response.json({ ok: false, error: 'Sign in with Google first.', code: 'auth_required' }, { status: 401 });
}
