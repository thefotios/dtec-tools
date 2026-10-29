import { tokenize, resolve } from './resolve.mjs';

export const MAX_SLOTS = 3;

const REASON_TEXT = {
  unknown: 'unknown class',
  ambiguous: 'matches more than one class',
  level: 'level must be 1 to 3',
  malformed: 'not a class and level',
  extra: 'extra path ignored',
  duplicate: 'duplicate passive ignored',
  self: 'a class cannot be its own passive',
};

function notice(token, reason) {
  return { token, reason, message: `"${token}": ${REASON_TEXT[reason]}` };
}

// Why a token failed to resolve: several slug prefixes match, or none do.
function failReason(classes, token) {
  const t = token.toLowerCase();
  return classes.filter((c) => c.slug.startsWith(t)).length > 1 ? 'ambiguous' : 'unknown';
}

export const sameSlot = (a, b) => a.cls.slug === b.cls.slug && a.level === b.level;

// Canonical passive order: class registry order, then level. Returns a new array.
export function sortSlots(classes, slots) {
  const idx = (s) => classes.findIndex((c) => c.slug === s.cls.slug);
  return [...slots].sort((a, b) => idx(a) - idx(b) || a.level - b.level);
}

// Adds a passive in canonical order. No-op when it is already present or the build is full.
export function addSlot(classes, slots, cls, level) {
  const slot = { cls, level };
  if (slots.some((s) => sameSlot(s, slot)) || slots.length >= MAX_SLOTS) return sortSlots(classes, slots);
  return sortSlots(classes, [...slots, slot]);
}

// Drops passives of the base class itself.
export const withoutBase = (slots, base) => (base ? slots.filter((s) => s.cls.slug !== base.slug) : []);

// Removes one passive; the rest stay in canonical order.
export function removeSlot(slots, cls, level) {
  return slots.filter((s) => !sameSlot(s, { cls, level }));
}

// Parses one build: a base token plus a passive run. Pure; returns { base, slots, notices }.
// An invalid base drops the whole passive run. Groups are validated first, duplicates and passives of the base
// class are dropped with a notice,
// the first three are kept, and the result is in canonical order.
export function parseBuild(classes, baseToken, run = '', extras = []) {
  const notices = [];
  let base = null;
  if (baseToken) {
    base = resolve(classes, baseToken);
    if (!base) notices.push(notice(baseToken, failReason(classes, baseToken)));
  }
  const slots = [];
  if (base) {
    for (const g of tokenize(run)) {
      if (!g.token) {
        notices.push(notice(g.raw, 'malformed'));
      } else if (!g.valid) {
        notices.push(notice(g.raw, 'level'));
      } else {
        const cls = resolve(classes, g.token);
        if (!cls) notices.push(notice(g.token, failReason(classes, g.token)));
        else if (cls.slug === base.slug) notices.push(notice(g.raw, 'self'));
        else if (slots.some((s) => sameSlot(s, { cls, level: g.level }))) notices.push(notice(g.raw, 'duplicate'));
        else slots.push({ cls, level: g.level });
      }
    }
    slots.length = Math.min(slots.length, MAX_SLOTS);
    slots.splice(0, slots.length, ...sortSlots(classes, slots));
    for (const e of extras) notices.push(notice(e, 'extra'));
  }
  return { base, slots, notices };
}

export function serializeBuild({ base, slots }) {
  if (!base) return { base: '', run: '' };
  return { base: base.slug, run: slots.map((s) => `${s.cls.code}${s.level}`).join('') };
}

// Strips the base path (e.g. "/dttec-tools/") from a pathname; result always starts with "/".
export function relativePath(pathname, basePath) {
  const prefix = basePath.replace(/\/+$/, '');
  if (prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return pathname.slice(prefix.length) || '/';
  }
  return pathname || '/';
}

// Absolute URL of a canonical path under the document base URI.
export function absoluteUrl(baseURI, canonicalPath) {
  return new URL(canonicalPath.replace(/^\//, ''), baseURI).href;
}

const basePathOf = (win) => new URL(win.document.baseURI).pathname;
const pathUrl = (win, canonicalPath) => basePathOf(win).replace(/\/+$/, '') + canonicalPath;

// History helpers take a window-like object ({ document.baseURI, history }) and an already-canonical base-relative path.
export function pushPath(win, canonicalPath) {
  win.history.pushState(null, '', pathUrl(win, canonicalPath));
}

export function replacePath(win, canonicalPath) {
  win.history.replaceState(null, '', pathUrl(win, canonicalPath));
}

// The part of a base-relative path after "/team" ("" for "/team"), or null when it is not a team path.
export function teamSegment(path) {
  const m = /^\/team(\/.*)?$/.exec(String(path));
  return m ? (m[1] ?? '') : null;
}

// Current base-relative path of a window-like object.
export function currentPath(win) {
  return relativePath(win.location.pathname, basePathOf(win));
}
