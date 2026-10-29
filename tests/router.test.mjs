import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parsePath,
  parseBuild,
  serializePath,
  serializeBuild,
  relativePath,
  absoluteUrl,
  pushBuild,
  replaceBuild,
} from '../src/router.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));

// Summarises a parse as plain data for assertions.
const view = (path) => {
  const s = parsePath(classes, path);
  return {
    base: s.base?.slug ?? null,
    slots: s.slots.map((x) => `${x.cls.slug}${x.level}`),
    notices: s.notices.map((n) => [n.token, n.reason]),
    canonical: serializePath(s),
  };
};

test('root: no base, empty slots, no notices', () => {
  assert.deepEqual(view('/'), { base: null, slots: [], notices: [], canonical: '/' });
  assert.deepEqual(view(''), { base: null, slots: [], notices: [], canonical: '/' });
});

test('base by slug or prefix canonicalizes to slug', () => {
  for (const p of ['/scout', '/sc']) {
    assert.deepEqual(view(p), { base: 'scout', slots: [], notices: [], canonical: '/scout' });
  }
});

test('full canonical build round-trips', () => {
  const v = view('/scout/sal2sal3prie3');
  assert.equal(v.base, 'scout');
  assert.deepEqual(v.slots, ['salvager2', 'salvager3', 'priest3']);
  assert.deepEqual(v.notices, []);
  assert.equal(v.canonical, '/scout/sal2sal3prie3');
});

test('case, slug tokens, and trailing slash canonicalize', () => {
  const v = view('/Sc/salvager2PRIE3/');
  assert.deepEqual(v.notices, []);
  assert.equal(v.canonical, '/scout/sal2prie3');
});

test('ambiguous passive is dropped with a notice naming the token', () => {
  const v = view('/scout/sal2pri3');
  assert.deepEqual(v.slots, ['salvager2']);
  assert.deepEqual(v.notices, [['pri', 'ambiguous']]);
  assert.equal(v.canonical, '/scout/sal2');
});

test('more than three groups keeps the first three', () => {
  const v = view('/scout/sal1sal2sal3prie1');
  assert.deepEqual(v.slots, ['salvager1', 'salvager2', 'salvager3']);
  assert.equal(v.canonical, '/scout/sal1sal2sal3');
});

test('unknown base: no base, notice, passives dropped, canonical root', () => {
  const v = view('/zzz/sal2');
  assert.deepEqual(v, { base: null, slots: [], notices: [['zzz', 'unknown']], canonical: '/' });
});

test('ambiguous base is reported as ambiguous', () => {
  const v = view('/pri/sal2');
  assert.equal(v.base, null);
  assert.deepEqual(v.notices, [['pri', 'ambiguous']]);
});

test('sal22: valid sal2 kept, stray 2 is malformed', () => {
  const v = view('/scout/sal22');
  assert.deepEqual(v.slots, ['salvager2']);
  assert.deepEqual(v.notices, [['2', 'malformed']]);
  assert.equal(v.canonical, '/scout/sal2');
});

test('trailing letters without a level are malformed', () => {
  const v = view('/scout/sal2prie');
  assert.deepEqual(v.slots, ['salvager2']);
  assert.deepEqual(v.notices, [['prie', 'malformed']]);
});

test('level outside 1 to 3 is a bad level', () => {
  const v = view('/scout/sal4prie3');
  assert.deepEqual(v.slots, ['priest3']);
  assert.deepEqual(v.notices, [['sal4', 'level']]);
});

test('unknown passive token is dropped with an unknown notice', () => {
  const v = view('/scout/zzz2sal1');
  assert.deepEqual(v.slots, ['salvager1']);
  assert.deepEqual(v.notices, [['zzz', 'unknown']]);
});

test('extra path segments are ignored with a notice', () => {
  const v = view('/scout/sal2/extra');
  assert.deepEqual(v.slots, ['salvager2']);
  assert.deepEqual(v.notices, [['extra', 'extra']]);
  assert.equal(v.canonical, '/scout/sal2');
});

test('invalid groups are dropped before the three-group cap applies', () => {
  const v = view('/scout/pri3sal1sal2sal3');
  assert.deepEqual(v.slots, ['salvager1', 'salvager2', 'salvager3']);
  assert.deepEqual(v.notices, [['pri', 'ambiguous']]);
});

test('passive of the base class is allowed', () => {
  const v = view('/scout/sc1');
  assert.deepEqual(v.slots, ['scout1']);
  assert.deepEqual(v.notices, []);
});

test('event class resolves by slug and by code', () => {
  assert.equal(view('/jackolantern/j1').base, 'jackolantern');
  assert.deepEqual(view('/jackolantern/j1').slots, ['jackolantern1']);
  assert.equal(view('/j').base, 'jackolantern');
});

test('serializing base Scout with Salvager 2 and 3', () => {
  const s = parsePath(classes, '/scout/sal2sal3');
  assert.equal(serializePath({ base: s.base, slots: s.slots }), '/scout/sal2sal3');
  assert.equal(serializePath({ base: null, slots: s.slots }), '/');
});

test('serializeBuild gives slug and passive run', () => {
  const s = parsePath(classes, '/scout/sal2sal3');
  assert.deepEqual(serializeBuild(s), { base: 'scout', run: 'sal2sal3' });
  assert.deepEqual(serializeBuild({ base: null, slots: [] }), { base: '', run: '' });
});

test('parseBuild takes pre-split tokens and runs', () => {
  const s = parseBuild(classes, 'sc', 'sal2');
  assert.equal(s.base.slug, 'scout');
  assert.equal(s.slots[0].cls.slug, 'salvager');
});

test('relativePath strips the base path', () => {
  assert.equal(relativePath('/scout/sal2', '/'), '/scout/sal2');
  assert.equal(relativePath('/drill-dashboard/scout/sal2', '/drill-dashboard/'), '/scout/sal2');
  assert.equal(relativePath('/drill-dashboard/', '/drill-dashboard/'), '/');
  assert.equal(relativePath('/drill-dashboard', '/drill-dashboard/'), '/');
});

test('absoluteUrl resolves canonical path against the base URI', () => {
  assert.equal(absoluteUrl('https://x.io/drill-dashboard/', '/scout/sal2'), 'https://x.io/drill-dashboard/scout/sal2');
  assert.equal(absoluteUrl('http://localhost:8080/', '/'), 'http://localhost:8080/');
});

test('history helpers push or replace the base-prefixed canonical path', () => {
  const calls = [];
  const win = {
    document: { baseURI: 'https://x.io/drill-dashboard/' },
    history: {
      pushState: (...a) => calls.push(['push', a[2]]),
      replaceState: (...a) => calls.push(['replace', a[2]]),
    },
  };
  const s = parsePath(classes, '/scout/sal2');
  pushBuild(win, s);
  replaceBuild(win, s);
  assert.deepEqual(calls, [
    ['push', '/drill-dashboard/scout/sal2'],
    ['replace', '/drill-dashboard/scout/sal2'],
  ]);
});
