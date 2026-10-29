import { MAX_PASSIVES } from './passives.mjs';

export const sameSlot = (a, b) => a.cls.slug === b.cls.slug && a.level === b.level;

// Canonical passive order: class registry order, then level. Returns a new array.
export function sortSlots(classes, slots) {
  const idx = (s) => classes.findIndex((c) => c.slug === s.cls.slug);
  return [...slots].sort((a, b) => idx(a) - idx(b) || a.level - b.level);
}

// Adds a passive in canonical order. No-op when it is already present or the build is full.
export function addSlot(classes, slots, cls, level) {
  const slot = { cls, level };
  if (slots.some((s) => sameSlot(s, slot)) || slots.length >= MAX_PASSIVES) return sortSlots(classes, slots);
  return sortSlots(classes, [...slots, slot]);
}

// Removes one passive; the rest stay in canonical order.
export function removeSlot(slots, cls, level) {
  return slots.filter((s) => !sameSlot(s, { cls, level }));
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
