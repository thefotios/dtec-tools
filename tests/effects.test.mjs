import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourcesForBuild, teamSources, aggregate, effectMatrix } from '../src/effects.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const taxonomy = JSON.parse(readFileSync(new URL('../data/effects.json', import.meta.url)));
const cls = (slug) => classes.find((c) => c.slug === slug);
const slot = (slug, level) => ({ cls: cls(slug), level });
const ALL = ['self', 'team', 'nearby'];
const build = (slug, level, slots = [], opts = {}) => sourcesForBuild(cls(slug), level, slots, opts);
const rowsOf = (model) => model.categories.flatMap((c) => c.subs.flatMap((s) => s.rows));
const row = (model, stat) => rowsOf(model).find((r) => r.stat === stat);
const group = (model, when) => model.conditional.find((g) => g.when === when);

const synth = {
  categories: [{ id: 'c', name: 'C', subs: [{ id: 's', name: 'S' }] }],
  stats: { a: { name: 'A', unit: 'pct', cat: 'c', sub: 's' } },
  whens: {},
  questions: {},
};
const synthClass = (code, value) => ({ code, name: code, levels: [{ effects: [{ stat: 'a', value, scope: 'self' }] }] });

test('Recruit L5 scales passive Salvager 2 to an exact 62.5 (not rounded); its own levels stay unscaled', () => {
  const m = aggregate(taxonomy, build('recruit', 5, [slot('salvager', 2)], { recruitMaster: true }), { scopes: ALL });
  const r = row(m, 'shred_cogs');
  assert.equal(r.total, 62.5);
  assert.equal(r.rounded, false);
  const gun = row(m, 'gun_damage');
  assert.equal(gun.sources[0].label, 'Recruit L1');
  assert.equal(gun.sources[0].value, 20);
  assert.equal(gun.rounded, false);
});

test('Recruit L4 leaves the passive unscaled', () => {
  const r = row(aggregate(taxonomy, build('recruit', 4, [slot('salvager', 2)]), { scopes: ALL }), 'shred_cogs');
  assert.equal(r.total, 50);
  assert.equal(r.rounded, false);
});

test('Recruit master rounds to one decimal: 50->62.5, 0.5->0.6, 2->2.5, 1->1.3, 40->50', () => {
  const rec = { code: 'rec', name: 'Rec', levels: [{ effects: [] }] };
  const one = (v) => sourcesForBuild(rec, 1, [{ cls: synthClass('x', v), level: 1 }], { recruitMaster: true })[0];
  for (const [v, want, rounded] of [[50, 62.5, false], [0.5, 0.6, true], [2, 2.5, false], [1, 1.3, true], [40, 50, false], [10, 12.5, false]]) {
    assert.equal(one(v).effect.value, want, String(v));
    assert.equal(one(v).rounded ?? false, rounded, String(v));
  }
  const src = [one(50)];
  assert.equal(aggregate(synth, src, { scopes: ALL }).categories[0].subs[0].rows[0].total, 62.5);
});

test('isRecruitMaster default: Recruit base at L5 scales passives without the option; L4 and non-Recruit L5 do not', () => {
  const val = (src) => src.find((s) => s.kind === 'passive').effect.value;
  const passive = [slot('salvager', 2)];
  assert.equal(val(build('recruit', 5, passive)), 62.5);
  assert.equal(val(build('recruit', 4, passive)), 50);
  assert.equal(val(build('salvager', 5, passive)), 50);
});

test('teamSources: member Recruit L5 without recruitMaster key scales passives', () => {
  const m = (base, level) => ({ player: 'Ann', base: cls(base), level, slots: [slot('salvager', 2)] });
  const val = (src) => src.find((s) => s.kind === 'passive').effect.value;
  assert.equal(val(teamSources([m('recruit', 5)])), 62.5);
  assert.equal(val(teamSources([m('recruit', 4)])), 50);
});

test('exact scaled values are not marked rounded', () => {
  const rec = { code: 'rec', name: 'Rec', levels: [] };
  assert.equal(sourcesForBuild(rec, 0, [{ cls: synthClass('x', 40), level: 1 }], { recruitMaster: true })[0].rounded, undefined);
});

test('same stat from two passive instances of one class sums and warns; the real Salvager 2 + 3 pair has no shared stat', () => {
  const src = [
    ...sourcesForBuild({ code: 'b', name: 'B', levels: [] }, 0, [
      { cls: synthClass('sal', 10), level: 1 },
      { cls: synthClass('sal', 5), level: 1 },
    ]),
  ];
  const r = aggregate(synth, src, { scopes: ALL }).categories[0].subs[0].rows[0];
  assert.equal(r.total, 15);
  assert.equal(r.sameClass, true);
  const real = aggregate(taxonomy, build('recruit', 1, [slot('salvager', 2), slot('salvager', 3)]), { scopes: ALL });
  assert.equal(rowsOf(real).filter((x) => x.sources.some((s) => s.cls.code === 'sal')).some((x) => x.sameClass), false);
});

test('Nightcrawler 1 passive: conditional rows stay apart from the unconditional melee_damage', () => {
  const m = aggregate(taxonomy, build('recruit', 3, [slot('nightcrawler', 1)]), { scopes: ALL });
  assert.equal(row(m, 'melee_damage').total, 20);
  const g = group(m, 'in_darkness');
  assert.equal(g.label, 'In darkness');
  assert.equal(g.rows.find((r) => r.stat === 'melee_damage').total, 30);
  assert.equal(g.rows.find((r) => r.stat === 'move_speed').total, 30);
});

test('Mercenary L3: per_consecutive_hit goes to uncertain with the question text, L1 still totals', () => {
  const m = aggregate(taxonomy, build('mercenary', 3), { scopes: ALL });
  assert.equal(row(m, 'melee_attack_speed').total, 30);
  const g = m.uncertain.find((u) => u.question === 'consecutive-hit-scaling');
  assert.equal(g.q, taxonomy.questions['consecutive-hit-scaling'].q);
  assert.ok(g.rows.length > 0);
  assert.equal(g.rows.every((r) => r.total === undefined), true);
  assert.equal(m.conditional.some((c) => c.when === 'per_consecutive_hit'), false);
  assert.equal(rowsOf(m).some((r) => r.when === 'per_consecutive_hit'), false);
});

test('flags, nearby and conditional flags have no total and land in their groups', () => {
  const sal = aggregate(taxonomy, build('salvager', 5), { scopes: ALL });
  const f = sal.flags.find((r) => r.stat === 'shred_also_coins');
  assert.equal(f.total, undefined);
  assert.deepEqual(f.sources.map((s) => s.label), ['Salvager L5']);
  const heal = aggregate(taxonomy, build('healer', 3), { scopes: ALL });
  const n = heal.nearby.find((r) => r.stat === 'heal_items_share');
  assert.ok(n);
  assert.equal(n.total, undefined);
  assert.equal(rowsOf(heal).some((r) => r.stat === 'heal_items_share'), false);
  const nc = aggregate(taxonomy, build('nightcrawler', 2), { scopes: ALL });
  const d = group(nc, 'in_darkness').rows.find((r) => r.stat === 'darkness_stealth');
  assert.ok(d);
  assert.equal(d.total, undefined);
});

test('Samurai L4 merges self and team into one row; team-only scope shows 10; Tank levels sum without warning', () => {
  const src = build('samurai', 4);
  const both = row(aggregate(taxonomy, src, { scopes: ['self', 'team'] }), 'melee_crit_chance');
  assert.equal(both.total, 30);
  assert.equal(both.sameClass, false);
  assert.deepEqual(both.sources.map((s) => s.label), ['Samurai L1', 'Samurai L4 (team)']);
  assert.equal(row(aggregate(taxonomy, src, { scopes: ['team'] }), 'melee_crit_chance').total, 10);
  const tank = row(aggregate(taxonomy, build('tank', 3), { scopes: ALL }), 'max_health');
  assert.equal(tank.sameClass, false);
  assert.ok(tank.sources.length >= 2);
});

test('team: two Samurai L4 warn with member-prefixed labels; a Samurai L3 contributes no team effects', () => {
  const sam = cls('samurai');
  const src = teamSources([
    { player: 'Bob', base: sam, level: 4, slots: [] },
    { player: 'Amy', base: sam, level: 4, slots: [] },
    { player: 'Cy', base: sam, level: 3, slots: [] },
  ]);
  const r = row(aggregate(taxonomy, src, { scopes: ['team', 'nearby'] }), 'melee_crit_chance');
  assert.equal(r.total, 20);
  assert.equal(r.sameClass, true);
  assert.deepEqual(r.sources.map((s) => s.label), ['Bob: Samurai L4 (team)', 'Amy: Samurai L4 (team)']);
  assert.equal(src.some((s) => s.member === 'Cy' && s.effect.scope === 'team'), false);
});

test('passive labels read "<Class> <n> (passive)"', () => {
  const r = row(aggregate(taxonomy, build('recruit', 1, [slot('salvager', 2)]), { scopes: ALL }), 'shred_cogs');
  assert.deepEqual(r.sources.map((s) => s.label), ['Salvager 2 (passive)']);
});

test('empty sources give empty groups', () => {
  assert.deepEqual(aggregate(taxonomy, [], { scopes: ALL }), { categories: [], conditional: [], flags: [], nearby: [], uncertain: [] });
});

test('category, sub and stat order follow the taxonomy; conditional groups follow whens order', () => {
  const m = aggregate(taxonomy, build('recruit', 3, [slot('nightcrawler', 1)]), { scopes: ALL });
  const catIds = taxonomy.categories.map((c) => c.id);
  const got = m.categories.map((c) => c.id);
  assert.deepEqual(got, catIds.filter((id) => got.includes(id)));
  for (const c of m.categories) for (const sub of c.subs) {
    const idx = sub.rows.map((r) => Object.keys(taxonomy.stats).indexOf(r.stat));
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
  }
  const whens = Object.keys(taxonomy.whens);
  const gw = aggregate(taxonomy, build('mercenary', 1).concat(build('nightcrawler', 2)), { scopes: ALL }).conditional.map((c) => whens.indexOf(c.when));
  assert.deepEqual(gw, [...gw].sort((a, b) => a - b));
});

const mx = {
  categories: [{ id: 'c', name: 'Combat', subs: [{ id: 's1', name: 'Damage' }, { id: 's2', name: 'Defense' }] }],
  stats: {
    dmg: { name: 'Damage', unit: 'pct', cat: 'c', sub: 's1' },
    hp: { name: 'HP', unit: 'flat', cat: 'c', sub: 's2' },
    fly: { name: 'Fly', unit: 'flag', cat: 'c', sub: 's2' },
  },
  whens: { night: 'At night' },
  questions: { q1: { q: 'Does it stack?' } },
};
const fx = (stat, value, scope, extra = {}) => ({ stat, value, scope, ...extra });
const mxClass = (code, ...effects) => ({ code, name: code, levels: [{ effects }] });
const mxMember = (player, cls, level = 1, slots = []) => ({ player, base: cls, level, slots });
const flatRows = (m) => m.groups.flatMap((g) => g.rows);
const find = (m, stat, scope) => flatRows(m).find((r) => r.stat === stat && r.scope === scope);

test('effectMatrix: two members with a team value give filled cells, a total, shared, and null for a third member', () => {
  const a = mxClass('a', fx('dmg', 5, 'team'));
  const b = mxClass('b', fx('dmg', 10, 'team'));
  const c = mxClass('c', fx('hp', 3, 'self'));
  const m = effectMatrix(mx, [mxMember('Ann', a), mxMember('Bob', b), mxMember('Cy', c)]);
  assert.deepEqual(m.members, ['Ann', 'Bob', 'Cy']);
  const r = find(m, 'dmg', 'team');
  assert.deepEqual(r.cells, [{ value: 5 }, { value: 10 }, null]);
  assert.equal(r.total, 15);
  assert.equal(r.shared, true);
  assert.equal(r.name, 'Damage');
  assert.equal(r.unit, 'pct');
  const hp = find(m, 'hp', 'self');
  assert.deepEqual(hp.cells, [null, null, { value: 3 }]);
  assert.equal(hp.shared, false);
});

test('effectMatrix: a stat with self and team effects yields two rows, self first and without a total', () => {
  const a = mxClass('a', fx('dmg', 5, 'team'), fx('dmg', 7, 'self'));
  const m = effectMatrix(mx, [mxMember('Ann', a)]);
  const rows = flatRows(m).filter((r) => r.stat === 'dmg');
  assert.deepEqual(rows.map((r) => [r.scope, r.total]), [['self', null], ['team', 5]]);
});

test('effectMatrix: groups follow taxonomy order, rows follow stat order, with titles and subs', () => {
  const a = mxClass('a', fx('hp', 1, 'team'), fx('dmg', 1, 'team'), fx('fly', true, 'self'), fx('dmg', 1, 'nearby'), fx('dmg', 1, 'self', { uncertain: 'q1' }), fx('dmg', 2, 'self', { when: 'night' }));
  const m = effectMatrix(mx, [mxMember('Ann', a)]);
  assert.deepEqual(m.groups.map((g) => [g.section, g.title, g.sub ?? null]), [
    ['category', 'Combat', 'Damage'],
    ['category', 'Combat', 'Defense'],
    ['conditional', 'At night', null],
    ['flags', 'Flags', null],
    ['nearby', 'Nearby', null],
    ['uncertain', 'Does it stack?', null],
  ]);
  assert.deepEqual(m.groups[0].rows.map((r) => r.stat), ['dmg']);
  assert.deepEqual(m.groups[1].rows.map((r) => r.stat), ['hp']);
});

test('effectMatrix: a when on a non-conditional row carries its label; conditional rows have none', () => {
  const a = mxClass('a', fx('dmg', 1, 'self', { uncertain: 'q1' }), fx('dmg', 2, 'self', { uncertain: 'q1', when: 'night' }), fx('dmg', 3, 'self', { when: 'night' }));
  const m = effectMatrix(mx, [mxMember('Ann', a)]);
  const unc = m.groups.find((g) => g.section === 'uncertain').rows;
  assert.deepEqual(unc.map((r) => r.whenLabel ?? null), [null, 'At night']);
  const cond = m.groups.find((g) => g.section === 'conditional').rows;
  assert.deepEqual(cond.map((r) => r.whenLabel ?? null), [null]);
});

test('effectMatrix: a flag yields a flag cell and no numeric total; a team flag totals true; a conditional team flag too', () => {
  const a = mxClass('a', fx('fly', true, 'self'), fx('fly', true, 'team'), fx('fly', true, 'team', { when: 'night' }));
  const b = mxClass('b', fx('fly', true, 'team'));
  const m = effectMatrix(mx, [mxMember('Ann', a), mxMember('Bob', b)]);
  const flags = m.groups.find((g) => g.section === 'flags');
  assert.deepEqual(flags.rows.map((r) => [r.scope, r.cells, r.total]), [
    ['self', [{ flag: true }, null], null],
    ['team', [{ flag: true }, { flag: true }], true],
  ]);
  const cond = m.groups.find((g) => g.section === 'conditional');
  assert.deepEqual(cond.rows.map((r) => [r.scope, r.cells, r.total]), [['team', [{ flag: true }, null], true]]);
});

test('effectMatrix: nearby and uncertain rows have no total; conditional numeric team rows sum', () => {
  const a = mxClass('a', fx('dmg', 4, 'nearby'), fx('dmg', 6, 'team', { uncertain: 'q1' }), fx('dmg', 2, 'team', { when: 'night' }));
  const b = mxClass('b', fx('dmg', 3, 'team', { when: 'night' }));
  const m = effectMatrix(mx, [mxMember('Ann', a), mxMember('Bob', b)]);
  assert.equal(m.groups.find((g) => g.section === 'nearby').rows[0].total, null);
  assert.equal(m.groups.find((g) => g.section === 'uncertain').rows[0].total, null);
  assert.equal(m.groups.find((g) => g.section === 'conditional').rows[0].total, 5);
});

test('effectMatrix: a member without a base gets null cells and the other columns keep their positions', () => {
  const a = mxClass('a', fx('dmg', 5, 'team'));
  const m = effectMatrix(mx, [{ player: 'Ann', base: null, level: 0, slots: [] }, mxMember('Bob', a)]);
  assert.deepEqual(m.members, ['Ann', 'Bob']);
  assert.deepEqual(find(m, 'dmg', 'team').cells, [null, { value: 5 }]);
  assert.equal(find(m, 'dmg', 'team').total, 5);
  assert.equal(find(m, 'dmg', 'team').shared, false);
});

test('effectMatrix: no members, or none contributing, gives no groups', () => {
  assert.deepEqual(effectMatrix(mx, []), { members: [], groups: [] });
  assert.deepEqual(effectMatrix(mx, [{ player: 'Ann', base: null, level: 0, slots: [] }]), { members: ['Ann'], groups: [] });
});

test('effectMatrix: Recruit L5 marks a row rounded only when a value was actually rounded', () => {
  const rec = { code: 'rec', name: 'Recruit', levels: [{ effects: [] }, { effects: [] }, { effects: [] }, { effects: [] }, { effects: [] }] };
  const odd = mxClass('x', fx('dmg', 7, 'team')); // 8.75 rounds to 8.8
  const even = mxClass('y', fx('hp', 8, 'team')); // 10 exact
  const m = effectMatrix(mx, [mxMember('Ann', rec, 5, [{ cls: odd, level: 1 }, { cls: even, level: 1 }]), mxMember('Bob', mxClass('z'), 1)]);
  const dmg = find(m, 'dmg', 'team');
  assert.equal(dmg.cells[0].value, 8.8);
  assert.equal(dmg.rounded, true);
  assert.equal(find(m, 'hp', 'team').cells[0].value, 10);
  assert.equal(find(m, 'hp', 'team').rounded, false);
});

test('effectMatrix: two passive levels of one class on one member mark the row sameClass and sum into the cell', () => {
  const x = { code: 'x', name: 'X', levels: [{ effects: [fx('dmg', 5, 'team')] }, { effects: [fx('dmg', 10, 'team')] }] };
  const base = mxClass('b');
  const m = effectMatrix(mx, [mxMember('Ann', base, 1, [{ cls: x, level: 1 }, { cls: x, level: 2 }])]);
  const r = find(m, 'dmg', 'team');
  assert.equal(r.sameClass, true);
  assert.deepEqual(r.cells, [{ value: 15 }]);
  const single = effectMatrix(mx, [mxMember('Ann', base, 1, [{ cls: x, level: 1 }])]);
  assert.equal(find(single, 'dmg', 'team').sameClass, false);
});

test('effectMatrix: unknown stats are skipped and the input is not required to be in any stat order', () => {
  const a = mxClass('a', fx('nope', 1, 'team'), fx('hp', 1, 'self'), fx('dmg', 1, 'self'));
  const m = effectMatrix(mx, [mxMember('Ann', a)]);
  assert.deepEqual(flatRows(m).map((r) => r.stat), ['dmg', 'hp']);
});
