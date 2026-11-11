import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSet, toSlots, fromSlots } from '../src/passives.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const cls = (slug) => classes.find((c) => c.slug === slug);
const slot = (slug, level) => ({ cls: cls(slug), level });
const summary = (slots) => slots.map((s) => `${s.cls.slug}${s.level}`);

test('normalizeSet drops self, duplicates, unknown classes, bad levels, and caps at 3', () => {
  const entries = [
    { code: cls('scout').code, level: 1 },
    { code: cls('salvager').code, level: 2 },
    { code: cls('salvager').code, level: 2 },
    { code: 'nope', level: 1 },
    { code: cls('priest').code, level: 4 },
    { code: cls('priest').code, level: 0 },
    { code: cls('priest').code, level: '2' },
    { code: cls('crafter').code, level: 1 },
    { code: cls('priest').code, level: 1 },
    { code: cls('crafter').code, level: 2 },
  ];
  const out = normalizeSet(classes, 'scout', entries);
  assert.equal(out.length, 3);
  assert.ok(out.every((e) => e.code !== cls('scout').code));
  assert.equal(new Set(out.map((e) => `${e.code}${e.level}`)).size, 3);
});

test('toSlots and fromSlots are inverse', () => {
  const entries = [{ code: cls('salvager').code, level: 2 }];
  assert.deepEqual(fromSlots(toSlots(classes, entries)), entries);
});

