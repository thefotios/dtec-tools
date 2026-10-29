import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { newCode } from './codes.mjs';

const LETTERS = /^[a-z]+$/;
const TAGS = [undefined, undefined, undefined, 'team', 'master'];
const isStr = (v) => typeof v === 'string' && v !== '';

// Returns a list of violation messages; empty when data and registry agree.
export function checkData(data, registry) {
  const out = [];
  const { tiers, classes } = data;
  const seenCodes = new Set();
  const seenSlugs = new Set();
  const bySlug = new Map(Object.entries(registry).map(([code, slug]) => [slug, code]));
  const registered = Object.entries(registry).map(([code, slug]) => ({ code, slug }));

  for (const c of classes) {
    const id = c.slug ?? c.code ?? '(unnamed)';
    const bad = (msg) => out.push(`${id}: ${msg}`);

    for (const f of ['code', 'slug', 'name', 'source']) if (!isStr(c[f])) bad(`${f} must be a non-empty string`);
    if (typeof c.event !== 'boolean') bad('event must be a boolean');
    if (typeof c.tier !== 'number' || !Object.hasOwn(tiers, String(c.tier))) bad(`tier ${c.tier} is not a key of tiers`);
    if (!Array.isArray(c.gear) || !c.gear.every(isStr)) bad('gear must be an array of non-empty strings');
    if (!Array.isArray(c.levels) || c.levels.length !== 5) bad('levels must have 5 entries');
    else
      c.levels.forEach((l, i) => {
        if (!isStr(l?.text)) bad(`level ${i + 1} needs text`);
        if (l?.tag !== TAGS[i]) bad(`level ${i + 1} tag must be ${TAGS[i] ?? 'absent'}`);
      });

    if (isStr(c.code)) {
      if (!LETTERS.test(c.code)) bad('code must be lowercase letters only');
      if (seenCodes.has(c.code)) bad(`duplicate code ${c.code}`);
      seenCodes.add(c.code);
      if (isStr(c.slug) && !c.slug.startsWith(c.code)) bad(`code ${c.code} must be a prefix of its slug`);
    }
    if (isStr(c.slug)) {
      if (!LETTERS.test(c.slug)) bad('slug must be lowercase letters only');
      if (seenSlugs.has(c.slug)) bad(`duplicate slug ${c.slug}`);
      seenSlugs.add(c.slug);
    }

    if (!isStr(c.code) || !isStr(c.slug)) continue;
    if (Object.hasOwn(registry, c.code)) {
      if (registry[c.code] !== c.slug) bad(`registry pins code ${c.code} to slug ${registry[c.code]}`);
    } else if (bySlug.has(c.slug)) {
      bad(`registry pins slug ${c.slug} to code ${bySlug.get(c.slug)}, not ${c.code}`);
    } else {
      const others = classes.filter((o) => o !== c && isStr(o.slug)).map((o) => ({ code: '', slug: o.slug }));
      const expected = newCode(c.slug, [...registered, ...others]);
      bad(`not in the registry; expected code "${expected}"${c.code === expected ? '' : ` (has "${c.code}")`}`);
    }
  }

  // Roster codes depend on class order: data order must equal the append-only registry order.
  const dataSlugs = classes.map((c) => c.slug).filter((s) => bySlug.has(s));
  const registrySlugs = registered.map((r) => r.slug).filter((s) => dataSlugs.includes(s));
  if (dataSlugs.some((s, i) => s !== registrySlugs[i])) {
    out.push(`class order: data order must match registry order (${registrySlugs.join(', ')})`);
  }
  return out;
}

const here = (p) => new URL(p, import.meta.url);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataPath = process.argv[2] ?? here('../data/classes.json');
  const violations = checkData(JSON.parse(readFileSync(dataPath)), JSON.parse(readFileSync(here('./codes.lock.json'))));
  for (const v of violations) console.error(v);
  if (violations.length) process.exit(1);
  console.log('data ok');
}
