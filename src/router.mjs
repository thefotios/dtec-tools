import { tokenize, resolve } from './resolve.mjs';

export const MAX_SLOTS = 3;

const REASON_TEXT = {
  unknown: 'unknown class',
  ambiguous: 'matches more than one class',
  level: 'level must be 1 to 3',
  malformed: 'not a class and level',
  extra: 'extra path ignored',
};

function notice(token, reason) {
  return { token, reason, message: `"${token}": ${REASON_TEXT[reason]}` };
}

// Why a token failed to resolve: several slug prefixes match, or none do.
function failReason(classes, token) {
  const t = token.toLowerCase();
  return classes.filter((c) => c.slug.startsWith(t)).length > 1 ? 'ambiguous' : 'unknown';
}

// Parses one build: a base token plus a passive run. Pure; returns { base, slots, notices }.
// An invalid base drops the whole passive run. Groups are validated first, then the first three are kept.
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
        if (cls) slots.push({ cls, level: g.level });
        else notices.push(notice(g.token, failReason(classes, g.token)));
      }
    }
    slots.length = Math.min(slots.length, MAX_SLOTS);
    for (const e of extras) notices.push(notice(e, 'extra'));
  }
  return { base, slots, notices };
}

// Parses a base-relative path such as "/scout/sal2sal3".
export function parsePath(classes, path) {
  const [baseToken = '', run = '', ...extras] = String(path).split('/').filter(Boolean);
  return parseBuild(classes, baseToken, run, extras);
}

export function serializeBuild({ base, slots }) {
  if (!base) return { base: '', run: '' };
  return { base: base.slug, run: slots.map((s) => `${s.cls.code}${s.level}`).join('') };
}

// Canonical base-relative path: "/", "/scout", or "/scout/sal2sal3".
export function serializePath(state) {
  const { base, run } = serializeBuild(state);
  if (!base) return '/';
  return run ? `/${base}/${run}` : `/${base}`;
}

// Strips the base path (e.g. "/drill-dashboard/") from a pathname; result always starts with "/".
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
const historyUrl = (win, state) => basePathOf(win).replace(/\/+$/, '') + serializePath(state);

// History helpers take a window-like object ({ document.baseURI, history }).
export function pushBuild(win, state) {
  win.history.pushState(null, '', historyUrl(win, state));
}

export function replaceBuild(win, state) {
  win.history.replaceState(null, '', historyUrl(win, state));
}

const pathUrl = (win, canonicalPath) => basePathOf(win).replace(/\/+$/, '') + canonicalPath;

// Same as the build helpers, for an already-canonical path such as a team URL.
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
