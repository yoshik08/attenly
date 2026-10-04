'use client';

import { SessionProvider } from 'next-auth/react';
import { BASE_PATH } from '@/lib/api';

/** Client boundary for NextAuth — required because next-auth/react ships
 *  without a 'use client' directive and the root layout is a server component. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider basePath={`${BASE_PATH}/api/auth`}>{children}</SessionProvider>;
}
