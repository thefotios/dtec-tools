import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  tokenize,
  classByCode,
  parseBuildCode,
  serializeBuildCode,
  parseSets,
  serializeSets,
  parseShare,
  serializeShare,
} from '../src/code.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const reasons = (r) => r.notices.map((n) => n.reason);
const e = (...pairs) => pairs.map(([code, level]) => ({ code, level }));
const BASE_URI = 'https://example.com/dttec-tools/';

test('classByCode matches exact codes case-insensitively and nothing else', () => {
  assert.equal(classByCode(classes, 'c').slug, 'crafter');
  assert.equal(classByCode(classes, 'SAL').slug, 'salvager');
  assert.equal(classByCode(classes, 'scout'), null);
  assert.equal(classByCode(classes, 'gun'), null);
});

test('tokenize splits greedy letters+digit groups and flags leftovers', () => {
  assert.deepEqual(tokenize('sal2sc1').map((g) => [g.token, g.level, g.valid]), [['sal', 2, true], ['sc', 1, true]]);
  assert.deepEqual(tokenize('rec4').map((g) => g.valid), [false]);
  assert.deepEqual(tokenize('sal').map((g) => [g.raw, g.valid]), [['sal', false]]);
});

test('1: c5-sal2sal3sc1 parses to Crafter 5 with three passives and round-trips', () => {
  const r = parseBuildCode(classes, 'c5-sal2sal3sc1');
  assert.equal(r.base, 'c');
  assert.equal(r.level, 5);
  assert.deepEqual(r.slots, e(['sc', 1], ['sal', 2], ['sal', 3]));
  assert.deepEqual(r.slots.map((s) => classByCode(classes, s.code).slug), ['scout', 'salvager', 'salvager']);
  assert.deepEqual(r.notices, []);
  assert.equal(r.roster, null);
  assert.equal(serializeBuildCode(classes, { base: 'c', levels: { c: 5 }, sets: { c: r.slots } }), 'c5-sc1sal2sal3');
});

test('1: serialization is canonical so the stated code round-trips in registry order', () => {
  const r = parseBuildCode(classes, 'c5-sc1sal2sal3');
  assert.equal(serializeBuildCode(classes, { base: 'c', levels: { c: 5 }, sets: { c: r.slots } }), 'c5-sc1sal2sal3');
});

test('2: any input order serializes in canonical registry-then-level order', () => {
  const r = parseBuildCode(classes, 'c5-sc1sal3sal2');
  assert.equal(serializeBuildCode(classes, { base: 'c', levels: { c: 5 }, sets: { c: r.slots } }), 'c5-sc1sal2sal3');
  const mi = parseBuildCode(classes, 'c5-sal2mi1');
  assert.equal(serializeBuildCode(classes, { base: 'c', levels: { c: 5 }, sets: { c: mi.slots } }), 'c5-mi1sal2');
});

test('3: codes are case-insensitive; c0 and c6 give a level notice and no base', () => {
  const r = parseBuildCode(classes, 'C5-SAL2');
  assert.equal(r.base, 'c');
  assert.deepEqual(r.slots, e(['sal', 2]));
  for (const code of ['c0', 'c6']) {
    const bad = parseBuildCode(classes, `${code}-sal2`);
    assert.equal(bad.base, null);
    assert.deepEqual(reasons(bad), ['level']);
    assert.deepEqual(bad.slots, []);
  }
});

test('4: roster-only, run and roster in either order, canonical build-run-roster output', () => {
  const only = parseBuildCode(classes, 'c5-15XF5XD');
  assert.deepEqual(only.slots, []);
  assert.deepEqual(only.roster, { c: 4, sal: 3 });
  assert.deepEqual(only.notices, []);
  for (const text of ['c5-sal2-15XF5XD', 'c5-15XF5XD-sal2']) {
    const r = parseBuildCode(classes, text);
    assert.deepEqual(r.slots, e(['sal', 2]));
    assert.deepEqual(r.roster, { c: 4, sal: 3 });
    const player = { base: r.base, levels: { ...r.roster, [r.base]: r.level }, sets: { c: r.slots } };
    assert.equal(serializeBuildCode(classes, player, { roster: true }), 'c5-sal2-15XG5XD');
  }
});

test('4: a roster of only the base is omitted when it would encode as X', () => {
  assert.equal(serializeBuildCode(classes, { base: 'c', levels: {}, sets: {} }, { roster: true }), '');
  assert.equal(serializeBuildCode(classes, { base: 'c', levels: { c: 5 }, sets: {} }, { roster: false }), 'c5');
});

test('5: a second run is extra; a fourth group is dropped; self, duplicate, unknown, malformed', () => {
  const two = parseBuildCode(classes, 'c5-sal2-sal3');
  assert.deepEqual(two.slots, e(['sal', 2]));
  assert.deepEqual(reasons(two), ['extra']);

  const four = parseBuildCode(classes, 'c5-mi1rec1h1sc1');
  assert.deepEqual(four.slots, e(['mi', 1], ['rec', 1], ['h', 1]));
  assert.deepEqual(reasons(four), ['extra']);

  assert.deepEqual(reasons(parseBuildCode(classes, 'c5-c2')), ['self']);
  assert.deepEqual(reasons(parseBuildCode(classes, 'c5-sal2sal2')), ['duplicate']);
  assert.deepEqual(parseBuildCode(classes, 'c5-sal2sal2').slots, e(['sal', 2]));
  assert.deepEqual(reasons(parseBuildCode(classes, 'c5-zz1')), ['unknown']);
  assert.deepEqual(reasons(parseBuildCode(classes, 'c5-sal')), ['malformed']);
  assert.deepEqual(reasons(parseBuildCode(classes, 'c5-sal4')), ['level']);
});

test('5: a segment ending in a roster letter that fails to decode is dropped as malformed', () => {
  const r = parseBuildCode(classes, 'c5-sal2sc');
  assert.equal(r.roster, null);
  assert.deepEqual(r.slots, []);
  assert.deepEqual(reasons(r), ['malformed']);
  assert.match(r.notices[0].message, /Invalid character/);
});

test('5: a second roster is extra and the roster notice for extra classes is kept', () => {
  assert.deepEqual(reasons(parseBuildCode(classes, 'c5-X-D')), ['extra']);
  assert.deepEqual(reasons(parseBuildCode(classes, 'c5-33D')), ['extra']);
});

test('5a: ?s= without u parses the set and an empty name', () => {
  const r = parseShare(classes, '/c5-sal2?s=mi-rec1');
  assert.equal(r.player.name, '');
  assert.deepEqual(r.player.sets, { c: e(['sal', 2]), mi: e(['rec', 1]) });
});

test('6: slug bases and slug paths are unknown base errors', () => {
  assert.equal(parseBuildCode(classes, 'scout-sal2').base, null);
  assert.deepEqual(reasons(parseBuildCode(classes, 'scout')), ['unknown']);
  assert.ok(parseShare(classes, 'scout-sal2').error);
  assert.ok(parseShare(classes, 'scout').error);
  assert.ok(parseShare(classes, '/scout/sal2').error);
});

test('7: parseShare accepts URLs, paths, and bare codes, with a base path', () => {
  const inputs = [
    ['https://example.com/c5-sal2?u=Bob', '/', 'Bob'],
    ['/c5-sal2?u=Bob', '/', 'Bob'],
    ['c5-sal2', '/', ''],
    ['https://host/dttec-tools/c5-sal2', '/dttec-tools/', ''],
    ['  https://host/dttec-tools/c5-sal2?u=%20Bob%20 ', '/dttec-tools/', 'Bob'],
  ];
  for (const [text, basePath, name] of inputs) {
    const r = parseShare(classes, text, basePath);
    assert.equal(r.player.base, 'c', text);
    assert.equal(r.player.name, name, text);
    assert.deepEqual(r.player.sets.c, e(['sal', 2]), text);
  }
});

test('7: extra path segments are dropped with a notice', () => {
  const r = parseShare(classes, '/c5-sal2/extra');
  assert.equal(r.player.base, 'c');
  assert.deepEqual(reasons(r), ['extra']);
});

test('8: ?s= items yield sets; invalid items drop with notices; the base item is ignored', () => {
  const ok = parseSets(classes, 'mi-rec1sc2.sal-c2', 'c');
  assert.deepEqual(ok.sets, { mi: e(['rec', 1], ['sc', 2]), sal: e(['c', 2]) });
  assert.deepEqual(ok.notices, []);

  const bad = parseSets(classes, 'zz-rec1.mi-mi1', 'c');
  assert.deepEqual(bad.sets, {});
  assert.deepEqual(reasons(bad), ['unknown', 'self']);

  assert.deepEqual(reasons(parseSets(classes, 'mi', 'c')), ['malformed']);
  assert.deepEqual(reasons(parseSets(classes, 'mi-rec1.mi-sc1', 'c')), ['duplicate']);
  assert.deepEqual(parseSets(classes, 'c-sal1', 'c'), { sets: {}, notices: [] });
  assert.deepEqual(parseSets(classes, null, 'c'), { sets: {}, notices: [] });

  const r = parseShare(classes, '/c5-sal2?s=c-sc1.mi-rec1');
  assert.deepEqual(r.player.sets, { c: e(['sal', 2]), mi: e(['rec', 1]) });
});

test('8: serializeSets writes registry order and skips the base and empty sets', () => {
  const player = { base: 'c', sets: { c: e(['sal', 2]), sal: e(['c', 2]), mi: e(['sc', 2], ['rec', 1]), h: [] } };
  assert.equal(serializeSets(classes, player), 'mi-rec1sc2.sal-c2');
  assert.equal(serializeSets(classes, { base: 'c', sets: { c: e(['sal', 2]) } }), '');
});

test('9: roster levels fill the record and the code wins for the base; no roster gives only the base', () => {
  const r = parseShare(classes, '/c5-sal2-15XF5XD');
  assert.deepEqual(r.player.levels, { c: 5, sal: 3 });
  const bare = parseShare(classes, '/c5-sal2');
  assert.deepEqual(bare.player.levels, { c: 5 });
});

test('10: serializeShare emits u and s only when present and re-parses to an equal record', () => {
  const bare = { name: '', base: 'c', levels: { c: 5 }, sets: { c: e(['sal', 2]) } };
  const bareUrl = new URL(serializeShare(classes, bare, BASE_URI));
  assert.equal(bareUrl.pathname, '/dttec-tools/c5-sal2-15XG');
  assert.equal(bareUrl.search, '');

  const full = {
    name: 'Bob',
    base: 'c',
    levels: { c: 5, sal: 3, mi: 2 },
    sets: { c: e(['sc', 1], ['sal', 2]), mi: e(['rec', 1]) },
  };
  const url = new URL(serializeShare(classes, full, BASE_URI));
  assert.equal(url.searchParams.get('u'), 'Bob');
  assert.equal(url.searchParams.get('s'), 'mi-rec1');
  const back = parseShare(classes, url.href, '/dttec-tools/');
  assert.deepEqual(back.notices, []);
  assert.deepEqual(back.player, full);
  assert.deepEqual(parseShare(classes, serializeShare(classes, bare, BASE_URI), '/dttec-tools/').player, bare);
});

test('11: team links and empty text are errors', () => {
  assert.equal(parseShare(classes, '/team/bob.c5-sal2').error, 'Open a team link to save its players');
  assert.equal(parseShare(classes, 'https://x.test/team/bob.c5-sal2~amy.mi1?n=A').error, 'Open a team link to save its players');
  assert.ok(parseShare(classes, '').error);
  assert.ok(parseShare(classes, '   ').error);
  assert.ok(parseShare(classes, '/').error);
});
