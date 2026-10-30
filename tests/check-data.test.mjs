import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkData } from '../scripts/check-data.mjs';

const cli = new URL('../scripts/check-data.mjs', import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const fresh = () => [read('../data/classes.json'), read('../scripts/codes.lock.json'), read('../data/effects.json')];
const entry = (over) => ({ ...read('../data/classes.json').classes[0], ...over });
const withEntry = (over) => {
  const [data, registry, taxonomy] = fresh();
  data.classes.push(entry(over));
  return [data, registry, taxonomy];
};

test('shipped data and registry have no violations', () => {
  assert.deepEqual(checkData(...fresh()), []);
});

test('CLI exits 0 on shipped data', () => {
  execFileSync('node', [cli]);
});

test('CLI exits 1 when the data file is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-data-'));
  const file = join(dir, 'classes.json');
  const [data] = fresh();
  data.classes[0].tier = 6;
  writeFileSync(file, JSON.stringify(data));
  const r = spawnSync('node', [cli, file], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /tier/);
});

test('unregistered entry reports its expected code', () => {
  const v = checkData(...withEntry({ code: 'zz', slug: 'cannoneer', name: 'Cannoneer' }));
  assert.ok(v.some((m) => m.includes('"ca"')), v.join('\n'));
});

test('unregistered entry with the right code still fails until registered', () => {
  const v = checkData(...withEntry({ code: 'ca', slug: 'cannoneer', name: 'Cannoneer' }));
  assert.equal(v.length, 1);
  assert.match(v[0], /registry/);
});

test('registered entry with its code passes (registry stability)', () => {
  const [data, registry, taxonomy] = withEntry({ code: 'ca', slug: 'cannoneer', name: 'Cannoneer' });
  registry.ca = 'cannoneer';
  data.classes.push(entry({ code: 'car', slug: 'cart', name: 'Cart' }));
  registry.car = 'cart';
  assert.deepEqual(checkData(data, registry, taxonomy), []);
});

test('code differing from the registry is a violation', () => {
  const [data, registry, taxonomy] = fresh();
  data.classes[0].code = 'mn';
  assert.ok(checkData(data, registry, taxonomy).length > 0);
});

test('slug differing from the registry is a violation', () => {
  const [data, registry, taxonomy] = fresh();
  data.classes[0].slug = 'miners';
  assert.ok(checkData(data, registry, taxonomy).length > 0);
});

test('tier must be a key of tiers: 6 fails, 4 passes', () => {
  const [d6, r6, t6] = fresh();
  d6.classes[0].tier = 6;
  assert.ok(checkData(d6, r6, t6).some((m) => m.includes('tier')));
  const [d4, r4, t4] = fresh();
  d4.classes[0].tier = 4;
  assert.deepEqual(checkData(d4, r4, t4), []);
});

test('R2: levels 4 and 5 need team and master tags; others must be untagged', () => {
  const [d1, r1, t1] = fresh();
  delete d1.classes[0].levels[3].tag;
  assert.ok(checkData(d1, r1, t1).some((m) => m.includes('level 4')));
  const [d2, r2, t2] = fresh();
  d2.classes[0].levels[0].tag = 'team';
  assert.ok(checkData(d2, r2, t2).some((m) => m.includes('level 1')));
  const [d3, r3, t3] = fresh();
  d3.classes[0].levels.pop();
  assert.ok(checkData(d3, r3, t3).some((m) => m.includes('levels')));
});

test('R2: missing or mistyped fields are violations', () => {
  const [d1, r1, t1] = fresh();
  delete d1.classes[0].gear;
  assert.ok(checkData(d1, r1, t1).some((m) => m.includes('gear')));
  const [d2, r2, t2] = fresh();
  d2.classes[0].event = 'no';
  assert.ok(checkData(d2, r2, t2).some((m) => m.includes('event')));
});

test('R3: code must be lowercase letters, unique, and a prefix of its slug', () => {
  const [d1, r1, t1] = fresh();
  d1.classes[0].code = 'Mi';
  assert.ok(checkData(d1, r1, t1).length > 0);
  const [d2, r2, t2] = fresh();
  d2.classes[1].code = d2.classes[0].code;
  assert.ok(checkData(d2, r2, t2).some((m) => m.includes('duplicate')));
  const [d3, r3, t3] = fresh();
  d3.classes[0].code = 'x';
  r3.x = d3.classes[0].slug;
  assert.ok(checkData(d3, r3, t3).some((m) => m.includes('prefix')));
});

test('R3: slugs must be unique lowercase letters', () => {
  const [d1, r1, t1] = fresh();
  d1.classes[0].slug = 'Miner2';
  assert.ok(checkData(d1, r1, t1).length > 0);
  const [d2, r2, t2] = fresh();
  d2.classes[1].slug = d2.classes[0].slug;
  assert.ok(checkData(d2, r2, t2).some((m) => m.includes('duplicate')));
});

test('KTD16: data order must match registry insertion order', () => {
  const [data, registry, taxonomy] = fresh();
  [data.classes[0], data.classes[1]] = [data.classes[1], data.classes[0]];
  assert.ok(checkData(data, registry, taxonomy).some((m) => m.includes('order')));
});

test('KTD16: appending a registered class at the end keeps the order valid', () => {
  const [data, registry, taxonomy] = fresh();
  data.classes.push(entry({ code: 'ca', slug: 'cannoneer', name: 'Cannoneer' }));
  registry.ca = 'cannoneer';
  assert.deepEqual(checkData(data, registry, taxonomy), []);
});

const withEffects = (level, effects) => {
  const [data, registry, taxonomy] = fresh();
  data.classes[0].levels[level - 1].effects = effects;
  return checkData(data, registry, taxonomy);
};
const hit = (v, re) => assert.ok(v.some((m) => re.test(m)), v.join('\n'));

test('effects: unknown stat and bad cat/sub are violations', () => {
  hit(withEffects(1, [{ stat: 'nope', scope: 'self' }]), /level 1 effect 1.*nope/);
  const [data, registry, taxonomy] = fresh();
  taxonomy.stats.pickaxe_damage = { ...taxonomy.stats.pickaxe_damage, cat: 'gather', sub: 'zzz' };
  hit(checkData(data, registry, taxonomy), /taxonomy.*pickaxe_damage.*zzz/);
});

test('effects: flag carries no value; pct and flat need a number', () => {
  hit(withEffects(1, [{ stat: 'shred_also_coins', value: 5, scope: 'self' }]), /flag stat/);
  hit(withEffects(1, [{ stat: 'pickaxe_damage', scope: 'self' }]), /numeric value/);
  hit(withEffects(1, [{ stat: 'pickaxe_damage', value: '50', scope: 'self' }]), /numeric value/);
});

test('effects: scope, uncertain and when must be known keys', () => {
  hit(withEffects(1, [{ stat: 'pickaxe_damage', value: 1, scope: 'friend' }]), /scope/);
  hit(withEffects(1, [{ stat: 'pickaxe_damage', value: 1, scope: 'self', uncertain: 'no-such' }]), /uncertain/);
  hit(withEffects(1, [{ stat: 'pickaxe_damage', value: 1, scope: 'self', when: 'while_flying' }]), /when/);
});

test('effects: empty effects fail; L4 self fails and L4 nearby passes', () => {
  hit(withEffects(2, []), /level 2 has no effects/);
  hit(withEffects(4, [{ stat: 'pickaxe_damage', value: 1, scope: 'self' }]), /level 4.*self/);
  assert.deepEqual(withEffects(4, [{ stat: 'pickaxe_damage', value: 1, scope: 'nearby' }]), []);
});

const taxonomyCase = (mutate, re) => {
  const [data, registry, taxonomy] = fresh();
  mutate(taxonomy);
  const v = checkData(data, registry, taxonomy);
  assert.ok(v.some((m) => re.test(m)), v.join('\n'));
};
const firstStat = (t) => Object.keys(t.stats)[0];
const firstKey = (o) => Object.keys(o)[0];

test('taxonomy: null question is a violation', () => taxonomyCase((t) => (t.questions[firstKey(t.questions)] = null), /question .* non-empty string q/));
test('taxonomy: question without q is a violation', () => taxonomyCase((t) => (t.questions[firstKey(t.questions)] = {}), /question .* non-empty string q/));
test("taxonomy: unit 'percent' is a violation", () => taxonomyCase((t) => (t.stats[firstStat(t)].unit = 'percent'), /unit percent must be pct, flat or flag/));
test('taxonomy: stat without name is a violation', () => taxonomyCase((t) => delete t.stats[firstStat(t)].name, /stat .* non-empty string name/));
test('taxonomy: empty when label is a violation', () => taxonomyCase((t) => (t.whens[firstKey(t.whens)] = ''), /when .* non-empty string label/));
