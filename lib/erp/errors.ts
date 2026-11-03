/** An Error carrying a machine-readable code (e.g. 'bad_captcha'). */
export function coded(message: string, code: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}
