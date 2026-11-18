/**
 * Responses that hand an ERP document to the browser: a booklet's scanned answer
 * script and a circular's document. Shared by the Google routes (/api/erp/*) and the
 * no-Google ones (/api/local/*), so both pass through exactly the same bytes.
 */
import type { PaperKey } from './records';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

/**
 * A scan streamed through as a PDF. The ERP labels these files text/html, so the first
 * bytes are checked before committing to a response: only a real PDF passes.
 */
export async function scanResponse(scan: { body: ReadableStream<Uint8Array>; length: number | null } | null, key: PaperKey): Promise<Response> {
  if (!scan) return new Response('The ERP has no scan for that paper.', { status: 404 });
  const reader = scan.body.getReader();
  const first = await reader.read();
  const head = first.value ?? new Uint8Array();
  if (first.done || !PDF_MAGIC.every((b, i) => head[i] === b)) {
    await reader.cancel().catch(() => undefined);
    return new Response('The ERP didn’t hand over a readable scan for that paper.', { status: 502 });
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(head);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel() {
      void reader.cancel();
    },
  });
  const name = `${key.courseCode}-${key.exam.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.pdf`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      ...(scan.length ? { 'Content-Length': String(scan.length) } : {}),
    },
  });
}

/** A circular's document. Only PDFs and images pass: an HTML answer from the ERP must never render on this origin. */
export function circularResponse(doc: { bytes: Buffer; contentType: string; filename: string | null } | null, id: string): Response {
  if (!doc) return new Response('That circular has no document on the ERP.', { status: 404 });
  const type = doc.contentType.split(';')[0].trim().toLowerCase();
  if (!/^(application\/pdf|image\/(png|jpe?g|gif|webp))$/.test(type)) {
    return new Response('The ERP didn’t hand over a readable document for that circular.', { status: 502 });
  }
  const filename = (doc.filename ?? `circular-${id}${type === 'application/pdf' ? '.pdf' : ''}`).replace(/[^\w.\- ]+/g, '_');
  return new Response(new Uint8Array(doc.bytes), {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** The paper a booklet request names, or null when it doesn't name one properly. */
export function paperKeyFrom(get: (name: string) => string | null): PaperKey | null {
  const key = {
    courseCode: get('code') ?? '',
    exam: get('exam') ?? '',
    academicYear: get('ay') ?? '',
    semester: get('sem') ?? '',
  };
  if (!/^[A-Z0-9]{4,16}$/i.test(key.courseCode) || !key.exam || key.exam.length > 120 || !key.academicYear || !key.semester) return null;
  return key;
}
