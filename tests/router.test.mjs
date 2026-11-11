import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relativePath, absoluteUrl, sortSlots, addSlot, removeSlot, teamSegment, pushPath, replacePath } from '../src/router.mjs';
import { MAX_PASSIVES } from '../src/passives.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const by = (slug) => classes.find((c) => c.slug === slug);
const str = (slots) => slots.map((x) => `${x.cls.slug}${x.level}`);
const slot = (slug, level) => ({ cls: by(slug), level });

test('relativePath strips the base path', () => {
  assert.equal(relativePath('/cr5-sa2', '/'), '/cr5-sa2');
  assert.equal(relativePath('/dtec-tools/cr5-sa2', '/dtec-tools/'), '/cr5-sa2');
  assert.equal(relativePath('/dtec-tools/', '/dtec-tools/'), '/');
  assert.equal(relativePath('/dtec-tools', '/dtec-tools/'), '/');
});

test('absoluteUrl resolves canonical path against the base URI', () => {
  assert.equal(absoluteUrl('https://x.io/dtec-tools/', '/cr5-sa2'), 'https://x.io/dtec-tools/cr5-sa2');
  assert.equal(absoluteUrl('http://localhost:8080/', '/'), 'http://localhost:8080/');
});

test('teamSegment recognizes the /team prefix only', () => {
  assert.equal(teamSegment('/team'), '');
  assert.equal(teamSegment('/team/'), '/');
  assert.equal(teamSegment('/team/bob.cr5-sa2~ann.mi3'), '/bob.cr5-sa2~ann.mi3');
  assert.equal(teamSegment('/'), null);
  assert.equal(teamSegment('/cr5-sa2'), null);
  assert.equal(teamSegment('/teamster'), null);
  assert.equal(teamSegment('/tea'), null);
});

test('history helpers push or replace an arbitrary canonical path', () => {
  const calls = [];
  const win = {
    document: { baseURI: 'https://x.io/dtec-tools/' },
    history: {
      pushState: (...a) => calls.push(['push', a[2]]),
      replaceState: (...a) => calls.push(['replace', a[2]]),
    },
  };
  pushPath(win, '/team');
  replacePath(win, '/cr5-sa2');
  assert.deepEqual(calls, [
    ['push', '/dtec-tools/team'],
    ['replace', '/dtec-tools/cr5-sa2'],
  ]);
});

test('history helpers store the given state object, or null without one', () => {
  const calls = [];
  const win = {
    document: { baseURI: 'https://x.io/' },
    history: {
      pushState: (state, _t, url) => calls.push(['push', state, url]),
      replaceState: (state, _t, url) => calls.push(['replace', state, url]),
    },
  };
  pushPath(win, '/sc3', { person: 'p2', base: 'sc' });
  replacePath(win, '/sc3', { target: 'p1' });
  pushPath(win, '/team');
  replacePath(win, '/');
  assert.deepEqual(calls, [
    ['push', { person: 'p2', base: 'sc' }, '/sc3'],
    ['replace', { target: 'p1' }, '/sc3'],
    ['push', null, '/team'],
    ['replace', null, '/'],
  ]);
});

test('sortSlots orders by registry order, then level', () => {
  const slots = sortSlots(classes, [slot('priest', 3), slot('salvager', 3), slot('salvager', 2)]);
  assert.deepEqual(str(slots), ['salvager2', 'salvager3', 'priest3']);
});

test('addSlot inserts in canonical order and refuses duplicates and a fourth passive', () => {
  let slots = addSlot(classes, [], by('priest'), 3);
  slots = addSlot(classes, slots, by('salvager'), 3);
  slots = addSlot(classes, slots, by('salvager'), 2);
  assert.deepEqual(str(slots), ['salvager2', 'salvager3', 'priest3']);
  assert.equal(slots.length, MAX_PASSIVES);
  assert.deepEqual(str(addSlot(classes, slots, by('scout'), 1)), str(slots));
  assert.deepEqual(str(addSlot(classes, slots.slice(0, 2), by('salvager'), 2)), ['salvager2', 'salvager3']);
});

test('removeSlot drops only the exact passive and keeps order', () => {
  const slots = [slot('salvager', 2), slot('salvager', 3), slot('priest', 3)];
  assert.deepEqual(str(removeSlot(slots, by('salvager'), 2)), ['salvager3', 'priest3']);
  assert.equal(removeSlot(slots, by('salvager'), 1).length, 3);
});
