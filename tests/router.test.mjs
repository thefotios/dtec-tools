import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relativePath, absoluteUrl, sortSlots, addSlot, removeSlot, teamSegment, pushPath, replacePath, MAX_SLOTS } from '../src/router.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const by = (slug) => classes.find((c) => c.slug === slug);
const str = (slots) => slots.map((x) => `${x.cls.slug}${x.level}`);
const slot = (slug, level) => ({ cls: by(slug), level });

test('relativePath strips the base path', () => {
  assert.equal(relativePath('/c5-sal2', '/'), '/c5-sal2');
  assert.equal(relativePath('/dttec-tools/c5-sal2', '/dttec-tools/'), '/c5-sal2');
  assert.equal(relativePath('/dttec-tools/', '/dttec-tools/'), '/');
  assert.equal(relativePath('/dttec-tools', '/dttec-tools/'), '/');
});

test('absoluteUrl resolves canonical path against the base URI', () => {
  assert.equal(absoluteUrl('https://x.io/dttec-tools/', '/c5-sal2'), 'https://x.io/dttec-tools/c5-sal2');
  assert.equal(absoluteUrl('http://localhost:8080/', '/'), 'http://localhost:8080/');
});

test('teamSegment recognizes the /team prefix only', () => {
  assert.equal(teamSegment('/team'), '');
  assert.equal(teamSegment('/team/'), '/');
  assert.equal(teamSegment('/team/bob.c5-sal2~ann.mi3'), '/bob.c5-sal2~ann.mi3');
  assert.equal(teamSegment('/'), null);
  assert.equal(teamSegment('/c5-sal2'), null);
  assert.equal(teamSegment('/teamster'), null);
  assert.equal(teamSegment('/tea'), null);
});

test('history helpers push or replace an arbitrary canonical path', () => {
  const calls = [];
  const win = {
    document: { baseURI: 'https://x.io/dttec-tools/' },
    history: {
      pushState: (...a) => calls.push(['push', a[2]]),
      replaceState: (...a) => calls.push(['replace', a[2]]),
    },
  };
  pushPath(win, '/team');
  replacePath(win, '/c5-sal2');
  assert.deepEqual(calls, [
    ['push', '/dttec-tools/team'],
    ['replace', '/dttec-tools/c5-sal2'],
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
  assert.equal(slots.length, MAX_SLOTS);
  assert.deepEqual(str(addSlot(classes, slots, by('scout'), 1)), str(slots));
  assert.deepEqual(str(addSlot(classes, slots.slice(0, 2), by('salvager'), 2)), ['salvager2', 'salvager3']);
});

test('removeSlot drops only the exact passive and keeps order', () => {
  const slots = [slot('salvager', 2), slot('salvager', 3), slot('priest', 3)];
  assert.deepEqual(str(removeSlot(slots, by('salvager'), 2)), ['salvager3', 'priest3']);
  assert.equal(removeSlot(slots, by('salvager'), 1).length, 3);
});
