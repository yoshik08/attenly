'use client';

import { useEffect } from 'react';

/**
 * Starts the Liquid Glass runtime in the browser. The script touches window and
 * navigator, so it loads after hydration; it guards itself, so Strict Mode's
 * second effect run (and any later mount) is a no-op.
 */
export function LiquidGlass() {
  useEffect(() => {
    void import('@/lib/liquid-glass.js');
  }, []);
  return null;
}
