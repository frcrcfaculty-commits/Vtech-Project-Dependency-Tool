// Loads the embedded Unicode fonts (Noto Sans Latin subset + Noto Sans Devanagari, SIL OFL 1.1 — see fonts/OFL.txt).
// Read from disk once per server instance. The path uses process.cwd() so Next's output file tracing ships the files.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PdfFonts } from './pendingReport';

let cache: Promise<PdfFonts> | null = null;

export function loadPdfFonts(): Promise<PdfFonts> {
  cache ??= (async () => {
    const dir = path.join(process.cwd(), 'lib', 'pdf', 'fonts');
    const [latin, latinBold, deva, devaBold] = await Promise.all(
      ['NotoSansLatin-Regular.ttf', 'NotoSansLatin-Bold.ttf', 'NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari-Bold.ttf']
        .map((f) => readFile(path.join(dir, f)).then((b) => new Uint8Array(b))),
    );
    return { latin, latinBold, deva, devaBold };
  })();
  cache.catch(() => { cache = null; });
  return cache;
}
