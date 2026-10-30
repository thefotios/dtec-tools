import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { newCode } from './codes.mjs';

const LETTERS = /^[a-z]+$/;
const SCOPES = ['self', 'nearby', 'team'];
const UNITS = ['pct', 'flat', 'flag'];
const TAGS = [undefined, undefined, undefined, 'team', 'master'];
const isStr = (v) => typeof v === 'string' && v !== '';

// Returns a list of violation messages; empty when data and registry agree.
export function checkData(data, registry, taxonomy) {
  const out = [];
  const { categories, stats, whens, questions } = taxonomy;
  const subsByCat = new Map(categories.map((c) => [c.id, new Set(c.subs.map((s) => s.id))]));
  for (const [qid, q] of Object.entries(questions)) {
    if (!isStr(q?.q)) out.push(`taxonomy: question ${qid} needs a non-empty string q`);
  }
  for (const [wid, label] of Object.entries(whens)) {
    if (!isStr(label)) out.push(`taxonomy: when ${wid} needs a non-empty string label`);
  }
  for (const [sid, s] of Object.entries(stats)) {
    if (!isStr(s?.name)) out.push(`taxonomy: stat ${sid} needs a non-empty string name`);
    if (!UNITS.includes(s?.unit)) out.push(`taxonomy: stat ${sid} unit ${s?.unit} must be pct, flat or flag`);
    if (!subsByCat.get(s?.cat)?.has(s?.sub)) out.push(`taxonomy: stat ${sid} has cat/sub ${s?.cat}/${s?.sub} missing from categories`);
  }
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
        if (!Array.isArray(l?.effects) || l.effects.length === 0) return bad(`level ${i + 1} has no effects`);
        l.effects.forEach((e, k) => {
          const at = (msg) => bad(`level ${i + 1} effect ${k + 1} ${msg}`);
          const st = Object.hasOwn(stats, e?.stat) ? stats[e.stat] : undefined;
          if (!st) at(`stat ${e?.stat} is not in the taxonomy`);
          else if (st.unit === 'flag') {
            if (e.value !== undefined) at(`flag stat ${e.stat} must not carry a value`);
          } else if (typeof e.value !== 'number' || !Number.isFinite(e.value)) at(`${st.unit} stat ${e.stat} needs a numeric value`);
          if (!SCOPES.includes(e?.scope)) at(`scope ${e?.scope} must be self, nearby or team`);
          else if (i === 3 && e.scope === 'self') at('is level 4 (team) and cannot be self-scoped');
          if (e?.uncertain !== undefined && !Object.hasOwn(questions, e.uncertain)) at(`uncertain ${e.uncertain} is not a question`);
          if (e?.when !== undefined && !Object.hasOwn(whens, e.when)) at(`when ${e.when} is not in whens`);
        });
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

// Every class needs icons/<code>.png; kept apart from checkData so that stays pure.
export function checkIcons(data, iconsDir) {
  return data.classes.filter((c) => !existsSync(join(iconsDir, `${c.code}.png`))).map((c) => `${c.slug ?? c.code}: missing icons/${c.code}.png`);
}

const here = (p) => new URL(p, import.meta.url);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataPath = process.argv[2] ?? here('../data/classes.json');
  const data = JSON.parse(readFileSync(dataPath));
  const violations = [
    ...checkData(data, JSON.parse(readFileSync(here('./codes.lock.json'))), JSON.parse(readFileSync(here('../data/effects.json')))),
    ...checkIcons(data, here('../icons').pathname),
  ];
  for (const v of violations) console.error(v);
  if (violations.length) process.exit(1);
  console.log('data ok');
}
