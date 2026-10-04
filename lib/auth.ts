import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

/**
 * Google sign-in (NextAuth v4). The Google account becomes the user's identity;
 * their sealed ERP credentials are stored against it in the `users` collection.
 *
 * Required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET.
 * NEXTAUTH_URL must be the canonical app URL: https://yoshik.xyz/attenly
 * Google Cloud redirect URI: https://yoshik.xyz/attenly/api/auth/callback/google
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      // Expose the Google account id (sub) on the session for server lookups.
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
