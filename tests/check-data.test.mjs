import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkData } from '../scripts/check-data.mjs';

const cli = new URL('../scripts/check-data.mjs', import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const fresh = () => [read('../data/classes.json'), read('../scripts/codes.lock.json')];
const entry = (over) => ({ ...read('../data/classes.json').classes[0], ...over });
const withEntry = (over) => {
  const [data, registry] = fresh();
  data.classes.push(entry(over));
  return [data, registry];
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
  const [data, registry] = withEntry({ code: 'ca', slug: 'cannoneer', name: 'Cannoneer' });
  registry.ca = 'cannoneer';
  data.classes.push(entry({ code: 'car', slug: 'cart', name: 'Cart' }));
  registry.car = 'cart';
  assert.deepEqual(checkData(data, registry), []);
});

test('code differing from the registry is a violation', () => {
  const [data, registry] = fresh();
  data.classes[0].code = 'mn';
  assert.ok(checkData(data, registry).length > 0);
});

test('slug differing from the registry is a violation', () => {
  const [data, registry] = fresh();
  data.classes[0].slug = 'miners';
  assert.ok(checkData(data, registry).length > 0);
});

test('tier must be a key of tiers: 6 fails, 4 passes', () => {
  const [d6, r6] = fresh();
  d6.classes[0].tier = 6;
  assert.ok(checkData(d6, r6).some((m) => m.includes('tier')));
  const [d4, r4] = fresh();
  d4.classes[0].tier = 4;
  assert.deepEqual(checkData(d4, r4), []);
});

test('R2: levels 4 and 5 need team and master tags; others must be untagged', () => {
  const [d1, r1] = fresh();
  delete d1.classes[0].levels[3].tag;
  assert.ok(checkData(d1, r1).some((m) => m.includes('level 4')));
  const [d2, r2] = fresh();
  d2.classes[0].levels[0].tag = 'team';
  assert.ok(checkData(d2, r2).some((m) => m.includes('level 1')));
  const [d3, r3] = fresh();
  d3.classes[0].levels.pop();
  assert.ok(checkData(d3, r3).some((m) => m.includes('levels')));
});

test('R2: missing or mistyped fields are violations', () => {
  const [d1, r1] = fresh();
  delete d1.classes[0].gear;
  assert.ok(checkData(d1, r1).some((m) => m.includes('gear')));
  const [d2, r2] = fresh();
  d2.classes[0].event = 'no';
  assert.ok(checkData(d2, r2).some((m) => m.includes('event')));
});

test('R3: code must be lowercase letters, unique, and a prefix of its slug', () => {
  const [d1, r1] = fresh();
  d1.classes[0].code = 'Mi';
  assert.ok(checkData(d1, r1).length > 0);
  const [d2, r2] = fresh();
  d2.classes[1].code = d2.classes[0].code;
  assert.ok(checkData(d2, r2).some((m) => m.includes('duplicate')));
  const [d3, r3] = fresh();
  d3.classes[0].code = 'x';
  r3.x = d3.classes[0].slug;
  assert.ok(checkData(d3, r3).some((m) => m.includes('prefix')));
});

test('R3: slugs must be unique lowercase letters', () => {
  const [d1, r1] = fresh();
  d1.classes[0].slug = 'Miner2';
  assert.ok(checkData(d1, r1).length > 0);
  const [d2, r2] = fresh();
  d2.classes[1].slug = d2.classes[0].slug;
  assert.ok(checkData(d2, r2).some((m) => m.includes('duplicate')));
});
