/** App subpath — must match `basePath` in next.config.ts. */
export const BASE_PATH = '/attenly';

/** Build a same-origin API URL that respects the subpath. */
export function api(path: string): string {
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}
