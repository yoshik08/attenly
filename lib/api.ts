import { DEFAULT_AUTH_ORIGIN, DEFAULT_BASE_PATH } from './site';

/**
 * App subpath: '/attenly' on the yoshik.xyz project, '' on attenly-kl (lib/site.ts).
 * next.config.ts inlines ATTENLY_BASE_PATH from NEXTAUTH_URL, so it always matches `basePath`.
 */
export const BASE_PATH: string = process.env.ATTENLY_BASE_PATH ?? DEFAULT_BASE_PATH;

/** The app's home URL path ('/attenly', or '/' at the root). */
export const HOME: string = BASE_PATH || '/';

/** The canonical origin of this deployment. Google sign-in only completes here (NEXTAUTH_URL). */
export const CANONICAL_ORIGIN: string = process.env.ATTENLY_AUTH_ORIGIN ?? DEFAULT_AUTH_ORIGIN;

/** Build a same-origin API URL that respects the subpath. */
export function api(path: string): string {
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}
