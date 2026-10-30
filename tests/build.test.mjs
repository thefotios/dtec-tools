import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const realData = fileURLToPath(new URL('../data', import.meta.url));

function run(out, env = {}) {
  const e = { ...process.env, ...env };
  if (!('BASE_PATH' in env)) delete e.BASE_PATH;
  return spawnSync(process.execPath, [build, out], { env: e, encoding: 'utf8' });
}

function tmp() {
  return mkdtempSync(join(tmpdir(), 'build-test-'));
}

test('BASE_PATH build: index and 404 identical with prefixed base href', () => {
  const root = tmp();
  try {
    const out = join(root, 'dist');
    const r = run(out, { BASE_PATH: '/dtec-tools/' });
    assert.equal(r.status, 0, r.stderr);
    const index = readFileSync(join(out, 'index.html'), 'utf8');
    assert.equal(index, readFileSync(join(out, '404.html'), 'utf8'));
    assert.match(index, /<base href="\/dtec-tools\/">/);
    assert.ok(existsSync(join(out, 'src/app.mjs')));
    assert.ok(existsSync(join(out, 'data/classes.json')));
    assert.ok(existsSync(join(out, 'data/effects.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('BASE_PATH is normalized to leading and trailing slash', () => {
  const root = tmp();
  try {
    const out = join(root, 'dist');
    assert.equal(run(out, { BASE_PATH: 'dtec-tools' }).status, 0);
    assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /<base href="\/dtec-tools\/">/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no env builds with base href "/"', () => {
  const root = tmp();
  try {
    const out = join(root, 'dist');
    assert.equal(run(out).status, 0);
    assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /<base href="\/">/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('output has no scripts, tests, docs, or codes.lock.json; stale files are cleaned', () => {
  const root = tmp();
  try {
    const out = join(root, 'dist');
    assert.equal(run(out).status, 0);
    writeFileSync(join(out, 'stale.txt'), 'x');
    assert.equal(run(out).status, 0);
    assert.ok(!existsSync(join(out, 'stale.txt')));
    assert.deepEqual(readdirSync(out).sort(), ['404.html', 'data', 'icons', 'index.html', 'src']);
    assert.ok(!readdirSync(join(out, 'data')).includes('codes.lock.json'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate code in data exits 1 with violations and writes nothing', () => {
  const root = tmp();
  try {
    const data = join(root, 'data');
    cpSync(realData, data, { recursive: true });
    const file = join(data, 'classes.json');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    json.classes.push({ ...json.classes[0] });
    writeFileSync(file, JSON.stringify(json));
    const out = join(root, 'dist');
    const r = run(out, { DATA_DIR: data });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /duplicate code/);
    assert.ok(!existsSync(out));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
