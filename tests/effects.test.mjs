import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourcesForBuild, teamSources, aggregate } from '../src/effects.mjs';

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
