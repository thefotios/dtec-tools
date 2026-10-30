import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkData } from './check-data.mjs';

// Usage: node scripts/build.mjs [outDir]; env BASE_PATH (default "/") and DATA_DIR (default ./data).
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(process.argv[2] ?? join(repoRoot, 'dist'));
const dataDir = resolve(process.env.DATA_DIR ?? join(repoRoot, 'data'));
const base = `/${(process.env.BASE_PATH ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');

const data = JSON.parse(readFileSync(join(dataDir, 'classes.json'), 'utf8'));
const taxonomy = JSON.parse(readFileSync(join(dataDir, 'effects.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(repoRoot, 'scripts/codes.lock.json'), 'utf8'));
const violations = checkData(data, registry, taxonomy);
if (violations.length) {
  for (const v of violations) console.error(v);
  process.exit(1);
}

const BASE_TAG = '<base href="/">';
const source = readFileSync(join(repoRoot, 'index.html'), 'utf8');
if (!source.includes(BASE_TAG)) {
  console.error(`index.html must contain ${BASE_TAG}`);
  process.exit(1);
}
const html = source.replace(BASE_TAG, `<base href="${base}">`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(repoRoot, 'src'), join(out, 'src'), { recursive: true });
cpSync(dataDir, join(out, 'data'), { recursive: true });
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, '404.html'), html);
console.log(`built ${out} (base ${base})`);
