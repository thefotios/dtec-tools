import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTeam, serializeTeam, MAX_PLAYERS } from '../src/team.mjs';

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
