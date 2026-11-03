/** App subpath — must match `basePath` in next.config.ts. */
export const BASE_PATH = '/attenly';

/** The canonical origin. Google sign-in only completes here (NEXTAUTH_URL). */
export const CANONICAL_ORIGIN = 'https://yoshik.xyz';

/** Build a same-origin API URL that respects the subpath. */
export function api(path: string): string {
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}
