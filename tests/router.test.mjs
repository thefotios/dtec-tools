import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseBuild,
  serializeBuild,
  relativePath,
  absoluteUrl,
  sortSlots,
  addSlot,
  removeSlot,
} from '../src/router.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));

// Splits a base-relative path into parseBuild's pre-split arguments.
const parseSplit = (classes, path) => {
  const [base = '', run = '', ...extras] = String(path).split('/').filter(Boolean);
  return parseBuild(classes, base, run, extras);
};

// Canonical base-relative path of a parsed build.
const canonical = (s) => {
  const { base, run } = serializeBuild(s);
  return !base ? '/' : run ? `/${base}/${run}` : `/${base}`;
};

// Summarises a parse as plain data for assertions.
const view = (path) => {
  const s = parseSplit(classes, path);
  return {
    base: s.base?.slug ?? null,
    slots: s.slots.map((x) => `${x.cls.slug}${x.level}`),
    notices: s.notices.map((n) => [n.token, n.reason]),
    canonical: canonical(s),
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

test('event class resolves by slug and by code', () => {
  assert.equal(view('/jackolantern/sc1').base, 'jackolantern');
  assert.deepEqual(view('/scout/j1').slots, ['jackolantern1']);
  assert.equal(view('/j').base, 'jackolantern');
});

test('serializeBuild gives slug and passive run', () => {
  const s = parseSplit(classes, '/scout/sal2sal3');
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
  assert.equal(relativePath('/dttec-tools/scout/sal2', '/dttec-tools/'), '/scout/sal2');
  assert.equal(relativePath('/dttec-tools/', '/dttec-tools/'), '/');
  assert.equal(relativePath('/dttec-tools', '/dttec-tools/'), '/');
});

test('absoluteUrl resolves canonical path against the base URI', () => {
  assert.equal(absoluteUrl('https://x.io/dttec-tools/', '/scout/sal2'), 'https://x.io/dttec-tools/scout/sal2');
  assert.equal(absoluteUrl('http://localhost:8080/', '/'), 'http://localhost:8080/');
});

test('teamSegment recognizes the /team prefix only', async () => {
  const { teamSegment } = await import('../src/router.mjs');
  assert.equal(teamSegment('/team'), '');
  assert.equal(teamSegment('/team/'), '/');
  assert.equal(teamSegment('/team/scout.sal2~miner'), '/scout.sal2~miner');
  assert.equal(teamSegment('/'), null);
  assert.equal(teamSegment('/scout/sal2'), null);
  assert.equal(teamSegment('/teamster'), null);
  assert.equal(teamSegment('/tea'), null);
});

test('history helpers push or replace an arbitrary canonical path (team URLs)', async () => {
  const { pushPath, replacePath } = await import('../src/router.mjs');
  const calls = [];
  const win = {
    document: { baseURI: 'https://x.io/dttec-tools/' },
    history: {
      pushState: (...a) => calls.push(['push', a[2]]),
      replaceState: (...a) => calls.push(['replace', a[2]]),
    },
  };
  pushPath(win, '/team/scout.sal2~miner');
  replacePath(win, '/team');
  assert.deepEqual(calls, [
    ['push', '/dttec-tools/team/scout.sal2~miner'],
    ['replace', '/dttec-tools/team'],
  ]);
});

test('duplicate passive is dropped with a notice; same class at another level is kept', () => {
  const v = view('/scout/sal2sal2sal3');
  assert.deepEqual(v.slots, ['salvager2', 'salvager3']);
  assert.deepEqual(v.notices, [['sal2', 'duplicate']]);
  assert.equal(v.canonical, '/scout/sal2sal3');
});

test('duplicates do not consume slots before the cap of three', () => {
  const v = view('/scout/sal1sal1sal2prie3');
  assert.deepEqual(v.slots, ['salvager1', 'salvager2', 'priest3']);
});

test('a passive of the base class is dropped with a notice', () => {
  const v = view('/salvager/sal2prie3');
  assert.deepEqual(v.slots, ['priest3']);
  assert.deepEqual(v.notices, [['sal2', 'self']]);
  assert.equal(v.canonical, '/salvager/prie3');
});

test('withoutBase drops passives of the base and all passives without a base', async () => {
  const { withoutBase } = await import('../src/router.mjs');
  const s = parseSplit(classes, '/scout/sal2prie3');
  const sal = classes.find((c) => c.slug === 'salvager');
  assert.deepEqual(withoutBase(s.slots, sal).map((x) => x.cls.slug), ['priest']);
  assert.deepEqual(withoutBase(s.slots, null), []);
});

test('passives canonicalize to registry order, then level', () => {
  const v = view('/scout/prie3sal3sal2');
  assert.deepEqual(v.slots, ['salvager2', 'salvager3', 'priest3']);
  assert.equal(v.canonical, '/scout/sal2sal3prie3');
});

test('addSlot inserts in canonical order and refuses duplicates and a fourth passive', () => {
  const by = (slug) => classes.find((c) => c.slug === slug);
  const str = (slots) => slots.map((x) => `${x.cls.slug}${x.level}`);
  let slots = addSlot(classes, [], by('priest'), 3);
  slots = addSlot(classes, slots, by('salvager'), 3);
  slots = addSlot(classes, slots, by('salvager'), 2);
  assert.deepEqual(str(slots), ['salvager2', 'salvager3', 'priest3']);
  assert.deepEqual(str(addSlot(classes, slots, by('scout'), 1)), str(slots));
  assert.deepEqual(str(addSlot(classes, slots.slice(0, 2), by('salvager'), 2)), ['salvager2', 'salvager3']);
});

test('removeSlot drops only the exact passive and keeps order', () => {
  const s = parseSplit(classes, '/scout/sal2sal3prie3');
  const sal = classes.find((c) => c.slug === 'salvager');
  assert.deepEqual(removeSlot(s.slots, sal, 2).map((x) => `${x.cls.slug}${x.level}`), ['salvager3', 'priest3']);
  assert.equal(sortSlots(classes, removeSlot(s.slots, sal, 1)).length, 3);
});
