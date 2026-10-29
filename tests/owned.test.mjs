import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeRoster, decodeRoster, createStore, ownedClasses } from '../src/owned.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const decoded = (text, list = classes) => decodeRoster(list, text);
const memory = (initial) => {
  const data = new Map(initial ? Object.entries(initial) : []);
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)), data };
};
const throwing = (which) => ({
  getItem: () => {
    if (which === 'read') throw new Error('blocked');
    return null;
  },
  setItem: () => {
    if (which === 'write') throw new Error('blocked');
  },
});
// Ownership for the first classes.length slots: level at the given indexes, others unowned.
const at = (levels) => Object.fromEntries(Object.entries(levels).map(([i, n]) => [classes[i].code, n]));
const MIXED = at({ 16: 4, 22: 3 });
const KEY = 'class-combo-viewer:owned';

test('fixture assumes 31 classes', () => {
  assert.equal(classes.length, 31);
});

test('empty roster encodes to X and decodes to an empty map', () => {
  assert.equal(encodeRoster(classes, {}), 'X');
  assert.deepEqual(decoded('X'), { owned: {}, notices: [] });
});

test('examples: sparse roster is 16XF5XD, all classes at level 3 is 31D', () => {
  assert.equal(encodeRoster(classes, MIXED), '16XF5XD');
  assert.deepEqual(decoded('16XF5XD'), { owned: MIXED, notices: [] });
  const all = Object.fromEntries(classes.map((c) => [c.code, 3]));
  assert.equal(encodeRoster(classes, all), '31D');
  assert.deepEqual(decoded('31D').owned, all);
});

test('legacy A-prefixed codes are rejected as an invalid character', () => {
  assert.match(decoded('AAAA-AAAA-AAAA-AAAA-SAAA-AAH').error, /Invalid character "A"/);
  assert.match(decoded('AB').error, /Invalid character "A"/);
});

test('each level symbol maps X B C D F G to 0 to 5', () => {
  [...'XBCDFG'].forEach((s, n) => {
    assert.equal(encodeRoster(classes, at({ 0: n })), s);
    assert.deepEqual(decoded(s).owned, n ? at({ 0: n }) : {});
  });
});

test('run-length boundaries: 1 and 2 are literal, 3 and more use a count', () => {
  assert.equal(encodeRoster(classes, at({ 0: 3 })), 'D');
  assert.equal(encodeRoster(classes, at({ 0: 3, 1: 3 })), 'DD');
  assert.equal(encodeRoster(classes, at({ 0: 3, 1: 3, 2: 3 })), '3D');
  assert.equal(encodeRoster(classes, at({ 2: 1 })), 'XXB');
  assert.equal(encodeRoster(classes, at({ 3: 1 })), '3XB');
});

test('trailing unowned classes are trimmed', () => {
  assert.equal(encodeRoster(classes, at({ 1: 2 })), 'XC');
});

test('round trip over a pseudo-random ownership map', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 50; k++) {
    const owned = {};
    for (const c of classes) {
      const n = Math.floor(rnd() * 6);
      if (n) owned[c.code] = n;
    }
    assert.deepEqual(decoded(encodeRoster(classes, owned)).owned, owned);
  }
});

test('decoding ignores case and spaces but not hyphens', () => {
  const want = decoded('16XF5XD');
  assert.deepEqual(decoded('16xf5xd'), want);
  assert.match(decoded('16X-F5X-D').error, /Invalid character "-"/);
  assert.match(decoded('15X-F').error, /Invalid character "-"/);
  assert.deepEqual(decoded('16X F5X D'), want);
});

test('aliases: O is 0, I and L are 1', () => {
  assert.deepEqual(decoded('1OX'), decoded('10X'));
  assert.deepEqual(decoded('IXB'), decoded('1XB'));
  assert.deepEqual(decoded('LXB'), decoded('1XB'));
});

test('positions beyond the class list are ignored with a notice; a shorter code leaves later classes unowned', () => {
  const r = decoded('33D');
  assert.equal(Object.keys(r.owned).length, classes.length);
  assert.equal(r.notices.length, 1);
  assert.match(r.notices[0], /2 extra classes/);
  assert.deepEqual(decoded('D').owned, at({ 0: 3 }));
  assert.deepEqual(decoded('D').notices, []);
  assert.equal(decoded('999999999D').notices.length, 1);
});

test('errors: reserved vowel version, bad character, zero count, dangling digits, empty', () => {
  assert.match(decoded('E5X').error, /Unknown roster code version "E"/);
  assert.match(decoded('U').error, /Unknown roster code version "U"/);
  assert.match(decoded('5H').error, /Invalid character "H"/);
  assert.match(decoded('X!').error, /Invalid character "!"/);
  assert.match(decoded('0X').error, /at least 1/);
  assert.match(decoded('3X16').error, /"16" has no level symbol/);
  assert.match(decoded('16').error, /no level symbol/);
  assert.ok(decoded('').error);
  assert.equal(decoded('0X').owned, undefined);
});

test('appending a class keeps existing codes decoding to the same map', () => {
  const owned = at({ 0: 3, 5: 4 });
  const code = encodeRoster(classes, owned);
  const grown = [...classes, { code: 'zz', slug: 'zzclass' }];
  assert.deepEqual(decoded(code, grown).owned, owned);
  assert.equal(encodeRoster(grown, owned), code);
});

test('store: storage that throws on read yields an empty map', () => {
  const store = createStore(throwing('read'));
  assert.deepEqual(store.owned, {});
});

test('store: storage that throws on write keeps the in-memory map', () => {
  const store = createStore(throwing('write'));
  store.setLevel('mi', 2);
  assert.deepEqual(store.owned, { mi: 2 });
});

test('store: persists the map as v2, and reloads them', () => {
  const storage = memory();
  const a = createStore(storage);
  a.setLevel('mi', 3);
  const saved = JSON.parse(storage.data.get(KEY));
  assert.equal(saved.v, 2);
  assert.equal('ownedOnly' in saved, false);
  const b = createStore(storage);
  assert.deepEqual(b.owned, { mi: 3 });
});

test('store: a v1 payload is ignored', () => {
  const v1 = JSON.stringify({ v: 1, owned: { mi: [1, 3], sc: 5 } });
  assert.deepEqual(createStore(memory({ [KEY]: v1 })).owned, {});
});

test('store: setLevel sets the max, and clicking the current max steps back one', () => {
  const store = createStore(memory());
  store.setLevel('mi', 3);
  assert.deepEqual(store.owned, { mi: 3 });
  store.setLevel('mi', 5);
  assert.deepEqual(store.owned, { mi: 5 });
  store.setLevel('mi', 2);
  assert.deepEqual(store.owned, { mi: 2 });
  store.setLevel('mi', 2);
  assert.deepEqual(store.owned, { mi: 1 });
  store.setLevel('mi', 1);
  assert.deepEqual(store.owned, {});
});

test('store: has is cumulative; hasAny follows the map', () => {
  const store = createStore(memory());
  assert.equal(store.hasAny(), false);
  store.setLevel('mi', 3);
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => store.has('mi', n)), [true, true, true, false, false]);
  assert.equal(store.hasAny(), true);
});

test('store: corrupt or unknown-version storage yields an empty map', () => {
  assert.deepEqual(createStore(memory({ [KEY]: '{nope' })).owned, {});
  assert.deepEqual(createStore(memory({ [KEY]: '{"v":99,"owned":{"mi":1}}' })).owned, {});
});

test('store: replace sets the whole map', () => {
  const store = createStore(memory());
  store.replace({ mi: 2 });
  assert.deepEqual(store.owned, { mi: 2 });
  assert.equal(store.has('mi', 2), true);
  assert.equal(store.has('mi', 3), false);
});

test('store: setLevel 0 removes the class', () => {
  const store = createStore(memory());
  store.setLevel('mi', 3);
  store.setLevel('mi', 0);
  assert.deepEqual(store.owned, {});
  store.setLevel('mi', 0);
  assert.deepEqual(store.owned, {});
});

test('ownedClasses: owned plus kept slugs, nothing when nothing is owned', () => {
  const list = [{ code: 'a', slug: 'aa' }, { code: 'b', slug: 'bb' }, { code: 'c', slug: 'cc' }];
  assert.deepEqual(ownedClasses(list, { b: 2 }).map((c) => c.slug), ['bb']);
  assert.deepEqual(ownedClasses(list, { b: 2 }, ['cc']).map((c) => c.slug), ['bb', 'cc']);
  assert.deepEqual(ownedClasses(list, {}).map((c) => c.slug), []);
  assert.deepEqual(ownedClasses(list, {}, ['cc']).map((c) => c.slug), ['cc']);
});
