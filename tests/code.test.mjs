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
  parseImport,
  serializeShare,
} from '../src/code.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const reasons = (r) => r.notices.map((n) => n.reason);
const e = (...pairs) => pairs.map(([code, level]) => ({ code, level }));
const BASE_URI = 'https://example.com/dtec-tools/';

test('classByCode matches exact codes case-insensitively and nothing else', () => {
  assert.equal(classByCode(classes, 'cr').slug, 'crafter');
  assert.equal(classByCode(classes, 'SAL').slug, 'salvager');
  assert.equal(classByCode(classes, 'scout'), null);
  assert.equal(classByCode(classes, 'gun'), null);
});

test('tokenize splits greedy letters+digit groups and flags leftovers', () => {
  assert.deepEqual(tokenize('sa2sc1').map((g) => [g.token, g.level, g.valid]), [['sa', 2, true], ['sc', 1, true]]);
  assert.deepEqual(tokenize('re4').map((g) => g.valid), [false]);
  assert.deepEqual(tokenize('sa').map((g) => [g.raw, g.valid]), [['sa', false]]);
  assert.deepEqual(tokenize('sa23sc1').map((g) => [g.raw, g.token, g.level]), [['sa2', 'sa', 2], ['sa3', 'sa', 3], ['sc1', 'sc', 1]]);
  assert.deepEqual(tokenize('sa14').map((g) => [g.raw, g.valid]), [['sa1', true], ['sa4', false]]);
});

test('a class with several levels shares one code: sa23 equals sa2sa3', () => {
  const r = parseBuildCode(classes, 'cr5-sc1sa23');
  assert.deepEqual(r.slots, e(['sc', 1], ['sa', 2], ['sa', 3]));
  assert.deepEqual(r.notices, []);
  assert.deepEqual(parseBuildCode(classes, 'cr5-sa2sc1sa3').slots, r.slots);
  assert.equal(serializeBuildCode(classes, { base: 'cr', levels: { cr: 5 }, sets: { cr: e(['sa', 1], ['sa', 2], ['sa', 3]) } }), 'cr5-sa123');
  assert.deepEqual(parseBuildCode(classes, 'cr5-sa22').notices.map((n) => n.reason), ['duplicate']);
  assert.deepEqual(parseSets(classes, 'mi-sa13', 'cr').sets, { mi: e(['sa', 1], ['sa', 3]) });
});

test('1: cr5-sa2sa3sc1 parses to Crafter 5 with three passives and round-trips', () => {
  const r = parseBuildCode(classes, 'cr5-sa2sa3sc1');
  assert.equal(r.base, 'cr');
  assert.equal(r.level, 5);
  assert.deepEqual(r.slots, e(['sc', 1], ['sa', 2], ['sa', 3]));
  assert.deepEqual(r.slots.map((s) => classByCode(classes, s.code).slug), ['scout', 'salvager', 'salvager']);
  assert.deepEqual(r.notices, []);
  assert.equal(r.roster, null);
  assert.equal(serializeBuildCode(classes, { base: 'cr', levels: { cr: 5 }, sets: { cr: r.slots } }), 'cr5-sc1sa23');
});

test('1: serialization is canonical so the stated code round-trips in registry order', () => {
  const r = parseBuildCode(classes, 'cr5-sc1sa2sa3');
  assert.equal(serializeBuildCode(classes, { base: 'cr', levels: { cr: 5 }, sets: { cr: r.slots } }), 'cr5-sc1sa23');
});

test('2: any input order serializes in canonical registry-then-level order', () => {
  const r = parseBuildCode(classes, 'cr5-sc1sa3sa2');
  assert.equal(serializeBuildCode(classes, { base: 'cr', levels: { cr: 5 }, sets: { cr: r.slots } }), 'cr5-sc1sa23');
  const mi = parseBuildCode(classes, 'cr5-sa2mi1');
  assert.equal(serializeBuildCode(classes, { base: 'cr', levels: { cr: 5 }, sets: { cr: mi.slots } }), 'cr5-mi1sa2');
});

test('3: codes are case-insensitive; cr0 and cr6 give a level notice and no base', () => {
  const r = parseBuildCode(classes, 'C5-SAL2');
  assert.equal(r.base, 'cr');
  assert.deepEqual(r.slots, e(['sa', 2]));
  for (const code of ['cr0', 'cr6']) {
    const bad = parseBuildCode(classes, `${code}-sa2`);
    assert.equal(bad.base, null);
    assert.deepEqual(reasons(bad), ['level']);
    assert.deepEqual(bad.slots, []);
  }
});

test('4: roster-only, run and roster in either order, canonical build-run-roster output', () => {
  const only = parseBuildCode(classes, 'cr5-15XF5XD');
  assert.deepEqual(only.slots, []);
  assert.deepEqual(only.roster, { cr: 4, sa: 3 });
  assert.deepEqual(only.notices, []);
  for (const text of ['cr5-sa2-15XF5XD', 'cr5-15XF5XD-sa2']) {
    const r = parseBuildCode(classes, text);
    assert.deepEqual(r.slots, e(['sa', 2]));
    assert.deepEqual(r.roster, { cr: 4, sa: 3 });
    const player = { base: r.base, levels: { ...r.roster, [r.base]: r.level }, sets: { cr: r.slots } };
    assert.equal(serializeBuildCode(classes, player, { roster: true }), 'cr5-sa2-15XG5XD');
  }
});

test('4: a roster of only the base is omitted when it would encode as X', () => {
  assert.equal(serializeBuildCode(classes, { base: 'cr', levels: {}, sets: {} }, { roster: true }), '');
  assert.equal(serializeBuildCode(classes, { base: 'cr', levels: { cr: 5 }, sets: {} }, { roster: false }), 'cr5');
});

test('5: a second run is extra; a fourth group is dropped; self, duplicate, unknown, malformed', () => {
  const two = parseBuildCode(classes, 'cr5-sa2-sa3');
  assert.deepEqual(two.slots, e(['sa', 2]));
  assert.deepEqual(reasons(two), ['extra']);

  const four = parseBuildCode(classes, 'cr5-mi1re1he1sc1');
  assert.deepEqual(four.slots, e(['mi', 1], ['re', 1], ['he', 1]));
  assert.deepEqual(reasons(four), ['extra']);

  assert.deepEqual(reasons(parseBuildCode(classes, 'cr5-cr2')), ['self']);
  assert.deepEqual(reasons(parseBuildCode(classes, 'cr5-sa2sa2')), ['duplicate']);
  assert.deepEqual(parseBuildCode(classes, 'cr5-sa2sa2').slots, e(['sa', 2]));
  assert.deepEqual(reasons(parseBuildCode(classes, 'cr5-zz1')), ['unknown']);
  assert.deepEqual(reasons(parseBuildCode(classes, 'cr5-sa')), ['malformed']);
  assert.deepEqual(reasons(parseBuildCode(classes, 'cr5-sa4')), ['level']);
});

test('5: a segment ending in a roster letter that fails to decode is dropped as malformed', () => {
  const r = parseBuildCode(classes, 'cr5-sa2sc');
  assert.equal(r.roster, null);
  assert.deepEqual(r.slots, []);
  assert.deepEqual(reasons(r), ['malformed']);
  assert.match(r.notices[0].message, /Invalid character/);
});

test('5: a second roster is extra and the roster notice for extra classes is kept', () => {
  assert.deepEqual(reasons(parseBuildCode(classes, 'cr5-X-D')), ['extra']);
  assert.deepEqual(reasons(parseBuildCode(classes, 'cr5-35D')), ['extra']);
});

test('5a: ?s= without u parses the set and an empty name', () => {
  const r = parseShare(classes, '/cr5-sa2?s=mi-re1');
  assert.equal(r.player.name, '');
  assert.deepEqual(r.player.sets, { cr: e(['sa', 2]), mi: e(['re', 1]) });
});

test('5b: parseShare reports whether a roster segment and a non-empty s were present', () => {
  const flags = (text) => {
    const r = parseShare(classes, text);
    return [r.hasRoster, r.hasSets];
  };
  assert.deepEqual(flags('cr5'), [false, false]);
  assert.deepEqual(flags('cr5-sa2'), [false, false]);
  assert.deepEqual(flags('cr5-sa2?s='), [false, false]);
  assert.deepEqual(flags('cr5-sa2-15XG5XD'), [true, false]);
  assert.deepEqual(flags('cr5-sa2?s=mi-re1'), [false, true]);
  assert.deepEqual(flags('/cr5-X-D?u=bob&s=mi-re1'), [true, true]);
});

test('6: slug bases and slug paths are unknown base errors', () => {
  assert.equal(parseBuildCode(classes, 'scout-sa2').base, null);
  assert.deepEqual(reasons(parseBuildCode(classes, 'scout')), ['unknown']);
  assert.ok(parseShare(classes, 'scout-sa2').error);
  assert.ok(parseShare(classes, 'scout').error);
});

test('7: parseShare accepts URLs, paths, and bare codes, with a base path', () => {
  const inputs = [
    ['https://example.com/cr5-sa2?u=Bob', '/', 'Bob'],
    ['/cr5-sa2?u=Bob', '/', 'Bob'],
    ['cr5-sa2', '/', ''],
    ['https://host/dtec-tools/cr5-sa2', '/dtec-tools/', ''],
    ['  https://host/dtec-tools/cr5-sa2?u=%20Bob%20 ', '/dtec-tools/', 'Bob'],
  ];
  for (const [text, basePath, name] of inputs) {
    const r = parseShare(classes, text, basePath);
    assert.equal(r.player.base, 'cr', text);
    assert.equal(r.player.name, name, text);
    assert.deepEqual(r.player.sets.cr, e(['sa', 2]), text);
  }
});

test('7: extra path segments are dropped with a notice', () => {
  const r = parseShare(classes, '/cr5-sa2/extra');
  assert.equal(r.player.base, 'cr');
  assert.deepEqual(reasons(r), ['extra']);
});

test('8: ?s= items yield sets; invalid items drop with notices; the base item is ignored', () => {
  const ok = parseSets(classes, 'mi-re1sc2.sa-cr2', 'cr');
  assert.deepEqual(ok.sets, { mi: e(['re', 1], ['sc', 2]), sa: e(['cr', 2]) });
  assert.deepEqual(ok.notices, []);

  const bad = parseSets(classes, 'zz-re1.mi-mi1', 'cr');
  assert.deepEqual(bad.sets, {});
  assert.deepEqual(reasons(bad), ['unknown', 'self']);

  assert.deepEqual(reasons(parseSets(classes, 'mi', 'cr')), ['malformed']);
  assert.deepEqual(reasons(parseSets(classes, 'mi-re1.mi-sc1', 'cr')), ['duplicate']);
  assert.deepEqual(parseSets(classes, 'cr-sa1', 'cr'), { sets: {}, notices: [] });
  assert.deepEqual(parseSets(classes, null, 'cr'), { sets: {}, notices: [] });

  const r = parseShare(classes, '/cr5-sa2?s=cr-sc1.mi-re1');
  assert.deepEqual(r.player.sets, { cr: e(['sa', 2]), mi: e(['re', 1]) });
});

test('8: serializeSets writes registry order and skips the base and empty sets', () => {
  const player = { base: 'cr', sets: { cr: e(['sa', 2]), sa: e(['cr', 2]), mi: e(['sc', 2], ['re', 1]), he: [] } };
  assert.equal(serializeSets(classes, player), 'mi-re1sc2.sa-cr2');
  assert.equal(serializeSets(classes, { base: 'cr', sets: { cr: e(['sa', 2]) } }), '');
});

test('9: roster levels fill the record and the code wins for the base; no roster gives only the base', () => {
  const r = parseShare(classes, '/cr5-sa2-15XF5XD');
  assert.deepEqual(r.player.levels, { cr: 5, sa: 3 });
  const bare = parseShare(classes, '/cr5-sa2');
  assert.deepEqual(bare.player.levels, { cr: 5 });
});

test('10: serializeShare emits u and s only when present and re-parses to an equal record', () => {
  const bare = { name: '', base: 'cr', levels: { cr: 5 }, sets: { cr: e(['sa', 2]) } };
  const bareUrl = new URL(serializeShare(classes, bare, BASE_URI));
  assert.equal(bareUrl.pathname, '/dtec-tools/cr5-sa2-15XG');
  assert.equal(bareUrl.search, '');

  const full = {
    name: 'Bob',
    base: 'cr',
    levels: { cr: 5, sa: 3, mi: 2 },
    sets: { cr: e(['sc', 1], ['sa', 2]), mi: e(['re', 1]) },
  };
  const url = new URL(serializeShare(classes, full, BASE_URI));
  assert.equal(url.searchParams.get('u'), 'Bob');
  assert.equal(url.searchParams.get('s'), 'mi-re1');
  const back = parseShare(classes, url.href, '/dtec-tools/');
  assert.deepEqual(back.notices, []);
  assert.deepEqual(back.player, full);
  assert.deepEqual(parseShare(classes, serializeShare(classes, bare, BASE_URI), '/dtec-tools/').player, bare);
});

test('11: team links and empty text are errors', () => {
  assert.equal(parseShare(classes, '/team/bob.cr5-sa2').error, 'Open a team link to save its players');
  assert.equal(parseShare(classes, 'https://x.test/team/bob.cr5-sa2~amy.mi1?n=A').error, 'Open a team link to save its players');
  assert.ok(parseShare(classes, '').error);
  assert.ok(parseShare(classes, '   ').error);
  assert.ok(parseShare(classes, '/').error);
});

test('parseShare on a team path keeps its error and adds the team marker with the base-relative path and query', () => {
  const r = parseShare(classes, 'https://x.test/team/bob.cr5-sa2~amy.mi1?n=A');
  assert.equal(r.error, 'Open a team link to save its players');
  assert.equal(r.team, true);
  assert.equal(r.path, '/team/bob.cr5-sa2~amy.mi1?n=A');
  assert.equal(parseShare(classes, 'cr5').team, undefined);
  assert.equal(parseShare(classes, '').team, undefined);
});

test('parseImport: a full link with u and s is a build with both flags and isLink', () => {
  const r = parseImport(classes, '  https://example.com/dtec-tools/cr5-sa2-15XG5XD?u=Ann&s=mi-re1\n', '/dtec-tools/');
  assert.equal(r.kind, 'build');
  assert.equal(r.isLink, true);
  assert.equal(r.hasRoster, true);
  assert.equal(r.hasSets, true);
  assert.equal(r.player.name, 'Ann');
  assert.deepEqual(r.player.sets, { cr: e(['sa', 2]), mi: e(['re', 1]) });
});

test('parseImport: a Copy code text is a nameless build with a roster; a path and a bare build are not links', () => {
  const code = serializeBuildCode(classes, { base: 'mi', levels: { mi: 1, re: 2, sc: 3 }, sets: { mi: e(['re', 2]) } }, { roster: true });
  const r = parseImport(classes, code);
  assert.equal(r.kind, 'build');
  assert.equal(r.player.name, '');
  assert.equal(r.hasRoster, true);
  assert.equal(r.isLink, false);
  assert.equal(parseImport(classes, '/cr5-sa2?u=bob').isLink, false);
  const bare = parseImport(classes, 'mi3');
  assert.deepEqual([bare.kind, bare.hasRoster, bare.hasSets, bare.isLink, bare.player.base, bare.player.levels], ['build', false, false, false, 'mi', { mi: 3 }]);
});

test('parseImport: a bare roster code is a roster; spaces, lower case and aliases decode', () => {
  const r = parseImport(classes, 'BCDFG');
  assert.deepEqual([r.kind, r.owned], ['roster', { mi: 1, re: 2, he: 3, me: 4, mr: 5 }]);
  assert.deepEqual(parseImport(classes, ' b c  dfg ').owned, r.owned);
  assert.deepEqual(parseImport(classes, 'bcdfg').owned, r.owned);
  assert.deepEqual(parseImport(classes, 'XXBcl').owned, parseImport(classes, 'XXBC1').owned);
});

test('parseImport: roster notices are carried as notice objects', () => {
  const r = parseImport(classes, `${'B'.repeat(classes.length + 2)}`);
  assert.equal(r.kind, 'roster');
  assert.equal(r.notices.length, 1);
  assert.equal(r.notices[0].reason, 'extra');
  assert.match(r.notices[0].message, /extra/);
});

test('parseImport: team URL and path give kind team with the base-relative path and query', () => {
  assert.deepEqual(parseImport(classes, 'https://x.test/team/bob.cr5-sa2~amy.mi1?n=A'), { kind: 'team', path: '/team/bob.cr5-sa2~amy.mi1?n=A' });
  assert.deepEqual(parseImport(classes, '/team/bob.cr5'), { kind: 'team', path: '/team/bob.cr5' });
  assert.deepEqual(parseImport(classes, ' https://x.test/dtec-tools/team/bob.cr5?n=A ', '/dtec-tools/'), { kind: 'team', path: '/team/bob.cr5?n=A' });
  assert.deepEqual(parseImport(classes, 'https://x.test/team'), { kind: 'team', path: '/team' });
});

test('parseImport: a team path in any case yields a lower-case team segment, keeping the rest and the query', () => {
  assert.deepEqual(parseImport(classes, 'https://x.test/Team/Bob.cr5-sa2?n=A'), { kind: 'team', path: '/team/Bob.cr5-sa2?n=A' });
  assert.deepEqual(parseImport(classes, 'TEAM/bob.cr5'), { kind: 'team', path: '/team/bob.cr5' });
  assert.deepEqual(parseImport(classes, 'https://x.test/Team'), { kind: 'team', path: '/team' });
});

test('parseImport: empty text, share garbage and roster-alphabet garbage return the documented errors', () => {
  assert.deepEqual(parseImport(classes, ''), { error: 'Paste a link or code' });
  assert.deepEqual(parseImport(classes, '   \n '), { error: 'Paste a link or code' });
  const share = parseImport(classes, 'hello world');
  assert.equal(share.error, parseShare(classes, 'hello world').error);
  const roster = parseImport(classes, 'BC3');
  assert.equal(roster.error, 'Run count "3" has no level symbol in roster code');
  assert.equal(parseImport(classes, 'EBC').error, parseShare(classes, 'EBC').error);
  assert.ok(parseImport(classes, 'https://x.test/scout-sa2').error);
  assert.equal(parseImport(classes, 'hello world').kind, undefined);
});

test('former codes parse to current codes and serialize back with the new ones', () => {
  const r = parseBuildCode(classes, 'c5-sal23sc1');
  assert.equal(r.base, 'cr');
  assert.deepEqual(r.slots, e(['sc', 1], ['sa', 2], ['sa', 3]));
  assert.deepEqual(r.notices, []);
  assert.equal(serializeBuildCode(classes, { base: 'cr', levels: { cr: 5 }, sets: { cr: r.slots } }), 'cr5-sc1sa23');
  assert.equal(classByCode(classes, 'rec').code, 're');
  assert.equal(classByCode(classes, 'c').slug, 'crafter');
  const s = parseShare(classes, '/c5-sal2?s=mi-rec1');
  assert.deepEqual(s.player.sets, { cr: e(['sa', 2]), mi: e(['re', 1]) });
  assert.deepEqual(parseSets(classes, 'mi-rec1', 'cr').sets, { mi: e(['re', 1]) });
  const url = new URL(serializeShare(classes, s.player, BASE_URI));
  assert.equal(url.pathname, '/dtec-tools/cr5-sa2-15XG');
  assert.equal(url.searchParams.get('s'), 'mi-re1');
});
