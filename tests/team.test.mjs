import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTeamLink, serializeTeamLink } from '../src/team.mjs';
import { MAX_MEMBERS, MAX_TEAM_NAME } from '../src/players.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));

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
