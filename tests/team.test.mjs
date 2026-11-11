import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTeamLink, serializeTeamLink, sameTeam } from '../src/team.mjs';
import { MAX_MEMBERS, MAX_TEAM_NAME } from '../src/players.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));

const rec = (name, base, level, set = []) => ({ name, base, levels: { [base]: level }, sets: { [base]: set } });
const link = (segment, search = '') => {
  const t = parseTeamLink(classes, segment, search);
  return { name: t.name, members: t.members.map((m) => [m.name, m.player.base, m.player.levels, m.player.sets[m.player.base].map((e) => `${e.code}${e.level}`)]), notices: t.notices };
};

test('team link: name from n and members with base, level, and set', () => {
  const t = link('/bob.cr5-sa2sa3~ann.mi3', '?n=Raid%20A');
  assert.equal(t.name, 'Raid A');
  assert.deepEqual(t.members, [
    ['bob', 'cr', { cr: 5 }, ['sa2', 'sa3']],
    ['ann', 'mi', { mi: 3 }, []],
  ]);
  assert.deepEqual(t.notices, []);
});

test('team link: name is trimmed and capped', () => {
  assert.equal(parseTeamLink(classes, '', `?n=${encodeURIComponent(`  ${'a'.repeat(50)}  `)}`).name, 'a'.repeat(MAX_TEAM_NAME));
  assert.equal(parseTeamLink(classes, '', '').name, '');
});

test('team link: round-trips to the same path and search', () => {
  const players = { bob: rec('bob', 'cr', 5, [{ code: 'sa', level: 2 }, { code: 'sa', level: 3 }]), ann: rec('ann', 'mi', 3) };
  const parsed = parseTeamLink(classes, '/bob.cr5-sa2sa3~ann.mi3', '?n=Raid%20A');
  const team = { name: parsed.name, members: parsed.members.map((m) => ({ name: m.name, base: m.player.base })) };
  assert.deepEqual(serializeTeamLink(classes, team, (n) => players[n]), { path: '/team/bob.cr5-sa23~ann.mi3', search: '?n=Raid%20A' });
});

test('team link: empty name gives empty search; unresolved members are skipped', () => {
  const team = { name: ' ', members: [{ name: 'bob', base: 'cr' }, { name: 'ghost', base: 'cr' }] };
  assert.deepEqual(serializeTeamLink(classes, team, (n) => (n === 'bob' ? rec('bob', 'cr', 4) : null)), { path: '/team/bob.cr4', search: '' });
  assert.deepEqual(serializeTeamLink(classes, { name: '', members: [] }, () => null), { path: '/team', search: '' });
});

test('team link: later case-insensitive duplicate member names are dropped with a notice', () => {
  const t = link('/bob.cr5~ann.mi3~Bob.mi2');
  assert.deepEqual(t.members.map((m) => m[0]), ['bob', 'ann']);
  assert.deepEqual(t.notices.map((n) => n.reason), ['duplicate']);
});

test('team link: bad members are dropped with a notice naming them', () => {
  for (const bad of ['bob', 'b.o.b.cr5', 'bob.scout-sa2', 'bob.cr9']) {
    const t = link(`/ann.mi3~${bad}~cat.cr2`);
    assert.deepEqual(t.members.map((m) => m[0]), ['ann', 'cat'], bad);
    assert.equal(t.notices.length, 1, bad);
    assert.equal(t.notices[0].token, bad);
  }
});

test('team link: members past the eighth are dropped with a notice', () => {
  const nine = Array.from({ length: 9 }, (_, i) => `pl${i + 1}x.cr5`).join('~');
  const t = link(`/${nine}`);
  assert.equal(t.members.length, MAX_MEMBERS);
  assert.equal(t.members.at(-1)[0], 'pl8x');
  assert.deepEqual(t.notices.map((n) => n.reason), ['extra']);
});

test('team link: /team and /team/ are empty; extra path gives a notice', () => {
  for (const s of ['', '/']) assert.deepEqual(link(s), { name: '', members: [], notices: [] });
  const t = link('/bob.cr5/extra');
  assert.equal(t.members.length, 1);
  assert.deepEqual(t.notices.map((n) => [n.token, n.reason]), [['extra', 'extra']]);
});

test('team link: a stored base the player no longer owns falls back to the player base', () => {
  const player = { name: 'bob', base: 'mi', levels: { mi: 2, cr: 0 }, sets: { mi: [{ code: 'sa', level: 1 }], cr: [{ code: 'sa', level: 2 }] } };
  const team = { name: 'T', members: [{ name: 'bob', base: 'cr' }] };
  assert.equal(serializeTeamLink(classes, team, () => player).path, '/team/bob.mi2-sa1');
  const owned = { ...player, levels: { mi: 2, cr: 4 } };
  assert.equal(serializeTeamLink(classes, team, () => owned).path, '/team/bob.cr4-sa2');
});

const library = {
  bob: { name: 'bob', base: 'cr', levels: { cr: 5, mi: 2 }, sets: { cr: [{ code: 'sa', level: 2 }], mi: [{ code: 'sc', level: 1 }] } },
  ann: { name: 'ann', base: 'mi', levels: { mi: 3 }, sets: {} },
};
const resolve = (name) => library[name] ?? null;
const mine = (extra = {}) => ({ name: 'Raid A', members: [{ name: 'bob', base: 'cr' }, { name: 'ann', base: 'mi' }], ...extra });
const linkFor = (team, lib = resolve) => {
  const { path, search } = serializeTeamLink(classes, team, lib);
  return parseTeamLink(classes, path.replace(/^\/team/, ''), search);
};

test('sameTeam: a team equals the parsed form of its own serialized link', () => {
  assert.equal(sameTeam(classes, mine(), linkFor(mine()), resolve), true);
  assert.equal(sameTeam(classes, { name: '', members: [] }, linkFor({ name: '', members: [] }), resolve), true);
});

test('sameTeam: differs when the name, a member, the order, or a member base differs', () => {
  assert.equal(sameTeam(classes, mine(), linkFor(mine({ name: 'Raid B' })), resolve), false);
  assert.equal(sameTeam(classes, mine(), linkFor(mine({ members: [mine().members[0]] })), resolve), false);
  assert.equal(sameTeam(classes, mine(), linkFor(mine({ members: [...mine().members].reverse() })), resolve), false);
  assert.equal(sameTeam(classes, mine(), linkFor(mine({ members: [{ name: 'bob', base: 'mi' }, mine().members[1]] })), resolve), false);
});

test('sameTeam: differs when a member level or passives for that class differ', () => {
  const changed = (patch) => (name) => (name === 'bob' ? { ...library.bob, ...patch } : library[name]);
  const link = linkFor(mine());
  assert.equal(sameTeam(classes, mine(), link, changed({ levels: { cr: 4, mi: 2 } })), false);
  assert.equal(sameTeam(classes, mine(), link, changed({ sets: { cr: [{ code: 'sa', level: 3 }] } })), false);
  assert.equal(sameTeam(classes, mine(), link, changed({ sets: { cr: [{ code: 'sa', level: 2 }], mi: [] } })), true);
});

test('sameTeam: member names match case-insensitively', () => {
  const link = linkFor({ name: 'Raid A', members: [{ name: 'Bob', base: 'cr' }, { name: 'ANN', base: 'mi' }] }, (n) => library[n.toLowerCase()]);
  assert.equal(sameTeam(classes, mine(), link, resolve), true);
});

test('sameTeam: members the library cannot resolve are skipped on my side', () => {
  const link = linkFor({ name: 'Raid A', members: [{ name: 'ann', base: 'mi' }] });
  assert.equal(sameTeam(classes, mine(), link, resolve), false);
  assert.equal(sameTeam(classes, mine(), link, (n) => (n === 'bob' ? null : library[n])), true);
});
