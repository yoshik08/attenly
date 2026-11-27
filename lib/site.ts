/**
 * Where this deployment is served, read from NEXTAUTH_URL when next.config.ts loads (build time).
 * One codebase, one branch, two Vercel projects:
 *
 *   attenly      NEXTAUTH_URL=https://yoshik.xyz/attenly/api/auth     → app under /attenly
 *                (yoshik.xyz/attenly/* is rewritten to it by the main site)
 *   attenly-kl   NEXTAUTH_URL=https://attenly-kl.vercel.app/api/auth  → app at the root
 *
 * Both share the database, the Google client and the secrets; only NEXTAUTH_URL differs.
 * Unset (local builds, tests) means the yoshik.xyz layout. No imports: next.config.ts loads this.
 */
export const DEFAULT_BASE_PATH = '/attenly';
export const DEFAULT_AUTH_ORIGIN = 'https://yoshik.xyz';

const AUTH_SUFFIX = '/api/auth';

export interface Site {
  /** '' (root) or '/attenly'. */
  basePath: string;
  /** The origin Google sign-in completes on, e.g. https://attenly-kl.vercel.app */
  authOrigin: string;
}

export function siteOf(authUrl: string | undefined): Site {
  if (!authUrl) return { basePath: DEFAULT_BASE_PATH, authOrigin: DEFAULT_AUTH_ORIGIN };
  const url = new URL(authUrl);
  const path = url.pathname.replace(/\/+$/, '');
  // A wrong value must fail the build (the live deployment stays up), never ship a broken sign-in.
  if (!path.endsWith(AUTH_SUFFIX)) {
    throw new Error(`NEXTAUTH_URL must end in ${AUTH_SUFFIX}; its path is "${url.pathname}".`);
  }
  return { basePath: path.slice(0, -AUTH_SUFFIX.length), authOrigin: url.origin };
}
