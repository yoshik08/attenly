/**
 * The ERP captcha reader, in-process. A TypeScript port of klu-captcha-solver/app.py
 * (the CRNN from the KLU ERP captcha extension), so logging in needs no outside service:
 *
 *   - Decode the PNG to RGBA, take the ALPHA channel / 255 → float32 [1,1,50,120].
 *   - Run the ONNX model on CPU (onnxruntime-web's WASM build, single-threaded).
 *   - CTC greedy decode: per-timestep argmax, collapse repeats, drop blank 0;
 *     class c > 0 is alphabet[c - 1].
 *
 * Output is identical to app.py. ERP captchas are 120×50, where app.py's resize is a
 * no-op copy; any other size is refused with a coded error instead of being resampled
 * (an exact port of PIL's antialiased bilinear filter is not worth the risk of silently
 * different inputs).
 *
 * Server-side only. The model and onnxruntime-web's .wasm ship with the routes that log
 * in (next.config.ts, outputFileTracingIncludes). The session is loaded once per server
 * instance; only the first solve on a fresh instance pays for it.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import type * as Ort from 'onnxruntime-web';
import { coded } from './errors';
import spec from './model/crnn.json';

const ALPHABET: string = spec.alphabet; // "abcdefghijklmnopqrstuvwxyz"
const IMG_W: number = spec.img_w; // 120
const IMG_H: number = spec.img_h; // 50
const BLANK: number = spec.blank_idx ?? 0;

/** Where the model and the WASM runtime live, relative to the project root (process.cwd() on Vercel too). */
export const MODEL_PATH = path.join(process.cwd(), 'lib', 'erp', 'model', 'crnn.onnx');
const ORT_DIST = path.join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist');

type Loaded = { ort: typeof Ort; session: Ort.InferenceSession };
let loaded: Promise<Loaded> | null = null;

/**
 * onnxruntime-web is imported here, not at the top: routes like /api/data import the
 * sync code but never read a captcha, and shouldn't pay for the runtime on cold start.
 */
function loadSession(): Promise<Loaded> {
  if (!loaded) {
    loaded = Promise.all([import('onnxruntime-web'), readFile(MODEL_PATH)])
      .then(async ([ort, bytes]) => {
        // One thread: no worker threads inside a serverless function. The WASM is read
        // from node_modules (traced into the function), never fetched.
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.wasmPaths = pathToFileURL(ORT_DIST).href + '/';
        const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
        return { ort, session };
      })
      .catch((e: unknown) => {
        loaded = null; // a failed load is retried on the next solve
        throw e;
      });
  }
  return loaded;
}

/** "data:image/png;base64,…" or bare base64 → PNG bytes. */
function pngBytes(image: string): Buffer {
  const b64 = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64.trim())) throw coded('The captcha is not valid base64.', 'solve_failed');
  return Buffer.from(b64.trim(), 'base64');
}

/** PNG → float32 [1,1,50,120] of alpha / 255 (app.py's preprocess). */
export function preprocess(png: Buffer): Float32Array {
  let img: PNG;
  try {
    img = PNG.sync.read(png); // always RGBA, 8 bits per channel (palette + tRNS expanded)
  } catch (e) {
    throw coded(`The captcha is not a readable PNG: ${e instanceof Error ? e.message : String(e)}`, 'solve_failed');
  }
  if (img.width !== IMG_W || img.height !== IMG_H) {
    throw coded(`The captcha is ${img.width}×${img.height}; the reader expects ${IMG_W}×${IMG_H}.`, 'solve_failed');
  }
  const out = new Float32Array(IMG_W * IMG_H);
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4 + 3] / 255;
  return out;
}

/** logits [1,T,C] → text: argmax per step (first max wins, like numpy), collapse repeats, drop blank. */
export function ctcGreedyDecode(logits: Float32Array, steps: number, classes: number): string {
  let out = '';
  let last = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestVal = logits[t * classes];
    for (let c = 1; c < classes; c++) {
      const v = logits[t * classes + c];
      if (v > bestVal) {
        bestVal = v;
        best = c;
      }
    }
    if (best !== last && best !== BLANK) out += ALPHABET[best - 1];
    last = best;
  }
  return out;
}

/** Reads an ERP captcha (data URL or base64 PNG). Coded error 'solve_failed' when it can't. */
export async function solveCaptcha(image: string): Promise<string> {
  const tensor = preprocess(pngBytes(image));
  let ort: typeof Ort;
  let s: Ort.InferenceSession;
  try {
    ({ ort, session: s } = await loadSession());
  } catch (e) {
    throw coded(`The captcha reader could not load: ${e instanceof Error ? e.message : String(e)}`, 'solve_failed');
  }
  try {
    const input = new ort.Tensor('float32', tensor, [1, 1, IMG_H, IMG_W]);
    const result = await s.run({ [s.inputNames[0]]: input });
    const logits = result[s.outputNames[0]];
    const [, steps, classes] = logits.dims;
    return ctcGreedyDecode(logits.data as Float32Array, steps, classes);
  } catch (e) {
    throw coded(`The captcha reader failed: ${e instanceof Error ? e.message : String(e)}`, 'solve_failed');
  }
}
