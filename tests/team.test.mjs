import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTeam, serializeTeam, parseTeamLink, serializeTeamLink, MAX_PLAYERS } from '../src/team.mjs';
import { MAX_MEMBERS, MAX_TEAM_NAME } from '../src/players.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));

const view = (segment) => {
  const t = parseTeam(classes, segment);
  return {
    builds: t.builds.map((b) => [b.base?.slug ?? null, b.slots.map((s) => `${s.cls.slug}${s.level}`)]),
    notices: t.notices.map((n) => n.token),
    canonical: serializeTeam(t.builds),
  };
};

test('empty team: /team and /team/', () => {
  for (const s of ['', '/', '/team'.slice(5)]) {
    assert.deepEqual(view(s), { builds: [], notices: [], canonical: '/team' });
  }
});

test('two builds parse to bases and slots', () => {
  const v = view('/scout.sal2sal3prie3~miner.rec1c2');
  assert.deepEqual(v.builds, [
    ['scout', ['salvager2', 'salvager3', 'priest3']],
    ['miner', ['recruit1', 'crafter2']],
  ]);
  assert.deepEqual(v.notices, []);
});

test('base-only build needs no dot', () => {
  assert.deepEqual(view('/scout~miner').builds, [['scout', []], ['miner', []]]);
});

test('serialization is canonical and round-trips', () => {
  const t = parseTeam(classes, '/sc.sal2~miner');
  assert.equal(serializeTeam(t.builds), '/team/scout.sal2~miner');
  assert.equal(serializeTeam(parseTeam(classes, '/scout.sal2sal3prie3~miner.rec1').builds), '/team/scout.sal2sal3prie3~miner.rec1');
});

test('invalid build is dropped with a notice naming it', () => {
  const t = parseTeam(classes, '/scout.sal2~zzz.sal2~miner');
  assert.deepEqual(t.builds.map((b) => b.base.slug), ['scout', 'miner']);
  assert.equal(t.notices.length, 1);
  assert.ok(t.notices[0].message.includes('zzz.sal2'));
});

test('bad passive group keeps the build and notes the group', () => {
  const t = parseTeam(classes, '/scout.sal9');
  assert.equal(t.builds.length, 1);
  assert.equal(t.builds[0].slots.length, 0);
  assert.equal(t.notices.length, 1);
});

test('more than 8 builds keeps the first 8 with a notice', () => {
  const segment = '/' + Array(MAX_PLAYERS + 2).fill('scout').join('~');
  const t = parseTeam(classes, segment);
  assert.equal(MAX_PLAYERS, 8);
  assert.equal(t.builds.length, 8);
  assert.equal(t.notices.length, 1);
  assert.equal(t.notices[0].reason, 'extra');
});

test('blank card round-trips as an underscore', () => {
  const t = parseTeam(classes, '/_~scout');
  assert.equal(t.builds.length, 2);
  assert.equal(t.builds[0].base, null);
  assert.equal(serializeTeam(t.builds), '/team/_~scout');
  assert.equal(serializeTeam([{ base: null, slots: [] }]), '/team/_');
});

test('team store persists labels and rosters by position and survives blocked storage', async () => {
  const { createTeamStore } = await import('../src/team.mjs');
  const mem = {};
  const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v) };
  const a = createTeamStore(storage);
  a.setLabel(1, 'Bob');
  a.setRoster(1, 'ABC');
  a.setLabel(2, 'Cy');
  assert.equal(a.label(0), '');
  const b = createTeamStore(storage);
  assert.deepEqual([b.label(1), b.roster(1), b.label(2)], ['Bob', 'ABC', 'Cy']);
  b.remove(1);
  assert.equal(createTeamStore(storage).label(1), 'Cy');
  const blocked = createTeamStore({ getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } });
  blocked.setLabel(0, 'Z');
  assert.equal(blocked.label(0), 'Z');
  assert.equal(createTeamStore({ getItem: () => 'not json', setItem() {} }).label(0), '');
});

test('team builds drop duplicate passives with a player notice and sort canonically', () => {
  const t = parseTeam(classes, '/scout.prie3sal3sal3sal2');
  assert.deepEqual(t.builds[0].slots.map((s) => `${s.cls.slug}${s.level}`), ['salvager2', 'salvager3', 'priest3']);
  assert.equal(t.notices.length, 1);
  assert.equal(t.notices[0].reason, 'duplicate');
  assert.match(t.notices[0].message, /^Player 1: /);
  assert.equal(serializeTeam(t.builds), '/team/scout.sal2sal3prie3');
});

const rec = (name, base, level, set = []) => ({ name, base, levels: { [base]: level }, sets: { [base]: set } });
const link = (segment, search = '') => {
  const t = parseTeamLink(classes, segment, search);
  return { name: t.name, members: t.members.map((m) => [m.name, m.player.base, m.player.levels, m.player.sets[m.player.base].map((e) => `${e.code}${e.level}`)]), notices: t.notices };
};

test('team link: name from n and members with base, level, and set', () => {
  const t = link('/bob.c5-sal2sal3~ann.mi3', '?n=Raid%20A');
  assert.equal(t.name, 'Raid A');
  assert.deepEqual(t.members, [
    ['bob', 'c', { c: 5 }, ['sal2', 'sal3']],
    ['ann', 'mi', { mi: 3 }, []],
  ]);
  assert.deepEqual(t.notices, []);
});

test('team link: name is trimmed and capped', () => {
  assert.equal(parseTeamLink(classes, '', `?n=${encodeURIComponent(`  ${'a'.repeat(50)}  `)}`).name, 'a'.repeat(MAX_TEAM_NAME));
  assert.equal(parseTeamLink(classes, '', '').name, '');
});

test('team link: round-trips to the same path and search', () => {
  const players = { bob: rec('bob', 'c', 5, [{ code: 'sal', level: 2 }, { code: 'sal', level: 3 }]), ann: rec('ann', 'mi', 3) };
  const parsed = parseTeamLink(classes, '/bob.c5-sal2sal3~ann.mi3', '?n=Raid%20A');
  const team = { name: parsed.name, members: parsed.members.map((m) => ({ name: m.name, base: m.player.base })) };
  assert.deepEqual(serializeTeamLink(classes, team, (n) => players[n]), { path: '/team/bob.c5-sal2sal3~ann.mi3', search: '?n=Raid%20A' });
});

test('team link: empty name gives empty search; unresolved members are skipped', () => {
  const team = { name: ' ', members: [{ name: 'bob', base: 'c' }, { name: 'ghost', base: 'c' }] };
  assert.deepEqual(serializeTeamLink(classes, team, (n) => (n === 'bob' ? rec('bob', 'c', 4) : null)), { path: '/team/bob.c4', search: '' });
  assert.deepEqual(serializeTeamLink(classes, { name: '', members: [] }, () => null), { path: '/team', search: '' });
});

test('team link: bad members are dropped with a notice naming them', () => {
  for (const bad of ['bob', 'b.o.b.c5', 'bob.scout-sal2', 'bob.c9']) {
    const t = link(`/ann.mi3~${bad}~cat.c2`);
    assert.deepEqual(t.members.map((m) => m[0]), ['ann', 'cat'], bad);
    assert.equal(t.notices.length, 1, bad);
    assert.equal(t.notices[0].token, bad);
  }
});

test('team link: members past the eighth are dropped with a notice', () => {
  const nine = Array.from({ length: 9 }, (_, i) => `pl${i + 1}x.c5`).join('~');
  const t = link(`/${nine}`);
  assert.equal(t.members.length, MAX_MEMBERS);
  assert.equal(t.members.at(-1)[0], 'pl8x');
  assert.deepEqual(t.notices.map((n) => n.reason), ['extra']);
});

test('team link: /team and /team/ are empty; extra path gives a notice', () => {
  for (const s of ['', '/']) assert.deepEqual(link(s), { name: '', members: [], notices: [] });
  const t = link('/bob.c5/extra');
  assert.equal(t.members.length, 1);
  assert.deepEqual(t.notices.map((n) => [n.token, n.reason]), [['extra', 'extra']]);
});

test('team link: a stored base the player no longer owns falls back to the player base', () => {
  const player = { name: 'bob', base: 'mi', levels: { mi: 2, c: 0 }, sets: { mi: [{ code: 'sal', level: 1 }], c: [{ code: 'sal', level: 2 }] } };
  const team = { name: 'T', members: [{ name: 'bob', base: 'c' }] };
  assert.equal(serializeTeamLink(classes, team, () => player).path, '/team/bob.mi2-sal1');
  const owned = { ...player, levels: { mi: 2, c: 4 } };
  assert.equal(serializeTeamLink(classes, team, () => owned).path, '/team/bob.c4-sal2');
});
