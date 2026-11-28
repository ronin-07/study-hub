import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const target = fileURLToPath(new URL('../public/pdfjs/', import.meta.url));
await mkdir(target, { recursive: true });
await Promise.all([
  ['build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['web/images', 'images'],
  ['LICENSE', 'LICENSE'],
  ['cmaps', 'cmaps'],
  ['iccs', 'iccs'],
  ['standard_fonts', 'standard_fonts'],
  ['wasm', 'wasm'],
].map(([from, to]) => cp(join(source, from), join(target, to), { recursive: true })));
