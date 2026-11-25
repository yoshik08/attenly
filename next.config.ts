import type { NextConfig } from "next";
import { BASE_PATH } from "./lib/api";

/**
 * The built-in captcha reader (lib/erp/solve.ts) loads its model and onnxruntime-web's
 * WASM from disk at run time, which file tracing can't see. Ship them with every route
 * that can log in to the ERP on its own (and with /api/health, which checks they shipped).
 * Keys are route paths without the basePath.
 */
const CAPTCHA_READER_FILES = [
  './lib/erp/model/crnn.onnx',
  './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
  './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
];
/**
 * File tracing also follows solve.ts's paths and would pull in onnxruntime-web's whole dist
 * (four WASM builds and the browser bundles, ~130 MB). Only the Node entry, its loader and
 * the plain SIMD WASM are used.
 */
const ORT_DIST = './node_modules/onnxruntime-web/dist';
const ORT_UNUSED = [
  `${ORT_DIST}/*.map`,
  `${ORT_DIST}/ort-wasm-simd-threaded.{asyncify,jsep,jspi}.*`,
  `${ORT_DIST}/ort.{all,bundle,jspi,wasm,webgl,webgpu}.*`,
  `${ORT_DIST}/ort.{js,mjs}`,
  `${ORT_DIST}/ort.min.{js,mjs}`,
];
/** Routes that import the sync code (and so solve.ts) but never read a captcha themselves. */
const ROUTES_THAT_NEVER_SOLVE = ['/api/data', '/api/erp/link-and-sync', '/api/local/login'];
const ROUTES_THAT_LOG_IN = [
  '/api/cron/sync',
  '/api/erp/auto-captcha',
  '/api/erp/hard-sync',
  '/api/erp/records',
  '/api/erp/booklet',
  '/api/erp/circular',
  '/api/erp/fee-receipt',
  '/api/erp/feedback',
  '/api/health',
  // Signed in without Google: each logs in again (reading the captcha) when the ERP session it is handed has expired.
  '/api/local/sync',
  '/api/local/records',
  '/api/local/booklet',
  '/api/local/circular',
  '/api/local/fee-receipt',
  '/api/local/feedback',
];

const nextConfig: NextConfig = {
  // Served at yoshik.xyz/attenly via a rewrite on the main site — all routes
  // and assets live under the subpath. Client API calls use api() from lib/api.
  basePath: BASE_PATH,
  // Loaded with Node's own import at run time (it finds its WASM next to itself).
  serverExternalPackages: ['onnxruntime-web'],
  outputFileTracingIncludes: Object.fromEntries(ROUTES_THAT_LOG_IN.map((route) => [route, CAPTCHA_READER_FILES])),
  outputFileTracingExcludes: {
    ...Object.fromEntries(ROUTES_THAT_LOG_IN.map((route) => [route, ORT_UNUSED])),
    ...Object.fromEntries(ROUTES_THAT_NEVER_SOLVE.map((route) => [route, [...ORT_UNUSED, ...CAPTCHA_READER_FILES, `${ORT_DIST}/**`]])),
  },
  experimental: {
    // Icons are imported by name from the package entry; keep only the ones used.
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  async redirects() {
    return [
      // With a basePath nothing answers at "/", so the bare deployment URL
      // (attenly-pi.vercel.app) used to 404. Send it to the app instead.
      { source: "/", destination: BASE_PATH, basePath: false, permanent: false },
    ];
  },
};

export default nextConfig;
