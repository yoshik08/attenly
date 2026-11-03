'use client';

import { SessionProvider } from 'next-auth/react';
import { BASE_PATH } from '@/lib/api';

/**
 * Gives next-auth's signIn()/signOut() the subpath of the auth API. The app
 * reads who is signed in from /api/data, so the provider never fetches the
 * session itself (session={null}, no refetching).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath={`${BASE_PATH}/api/auth`} session={null} refetchOnWindowFocus={false} refetchInterval={0}>
      {children}
    </SessionProvider>
  );
}
