/** Types for lib/liquid-glass.js: a self-running browser script with no exports. Importing it starts the runtime. */
export {};

declare global {
  interface Window {
    LiquidGlass?: {
      /** Re-scan the page for glass elements (the runtime's observers normally make this unnecessary). */
      refresh: () => void;
      /** True where real refraction runs (Chromium); elsewhere glass is the CSS frosted fallback. */
      refracts: boolean;
    };
  }
}
