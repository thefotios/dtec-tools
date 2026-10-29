// Ownership: roster code codec (pure) and a persisted store with injectable storage.

const SYMBOLS = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
const LEVELS = [1, 2, 3, 4, 5];
const STORAGE_KEY = 'class-combo-viewer:owned';
const STORE_VERSION = 1;
const ALIASES = { O: '0', I: '1', L: '1' };

const levelsToValue = (levels) => levels.reduce((v, n) => v | (1 << (n - 1)), 0);
const valueToLevels = (v) => LEVELS.filter((n) => v & (1 << (n - 1)));

// owned: { [classCode]: number[] }. Classes in registry order, trailing empty characters trimmed.
export function encodeRoster(classes, owned) {
  const chars = classes.map((c) => SYMBOLS[levelsToValue(owned[c.code] ?? [])]);
  while (chars.length && chars[chars.length - 1] === SYMBOLS[0]) chars.pop();
  return SYMBOLS[0] + chars.join('');
}

// Returns { owned, notices } or { error }.
export function decodeRoster(classes, text) {
  const clean = String(text).toUpperCase().replace(/[\s-]+/g, '');
  const chars = [...clean].map((ch) => ALIASES[ch] ?? ch);
  if (!chars.length) return { error: 'Enter a roster code' };
  if (chars[0] !== SYMBOLS[0]) return { error: `Unknown roster code version "${chars[0]}"` };
  const bad = chars.find((ch) => !SYMBOLS.includes(ch));
  if (bad) return { error: `Invalid character "${bad}" in roster code` };
  const body = chars.slice(1);
  const owned = {};
  classes.forEach((c, i) => {
    const levels = valueToLevels(i < body.length ? SYMBOLS.indexOf(body[i]) : 0);
    if (levels.length) owned[c.code] = levels;
  });
  const notices = [];
  const extra = body.length - classes.length;
  if (extra > 0) notices.push(`Ignored ${extra} extra character${extra === 1 ? '' : 's'} beyond the class list`);
  return { owned, notices };
}

export function groupCode(code) {
  return code.match(/.{1,4}/g)?.join('-') ?? '';
}

function load(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY));
    if (parsed?.v !== STORE_VERSION) return { owned: {}, ownedOnly: false };
    const owned = {};
    for (const [code, levels] of Object.entries(parsed.owned ?? {})) {
      const clean = LEVELS.filter((n) => Array.isArray(levels) && levels.includes(n));
      if (clean.length) owned[code] = clean;
    }
    return { owned, ownedOnly: parsed.ownedOnly === true };
  } catch {
    return { owned: {}, ownedOnly: false };
  }
}

// Reads and writes never throw: a blocked store degrades to in-memory state.
export function createStore(storage) {
  let { owned, ownedOnly } = load(storage);
  const save = () => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ v: STORE_VERSION, owned, ownedOnly }));
    } catch {
      /* in-memory only */
    }
  };
  const set = (code, levels) => {
    const next = { ...owned };
    if (levels.length) next[code] = LEVELS.filter((n) => levels.includes(n));
    else delete next[code];
    owned = next;
    save();
  };
  return {
    get owned() {
      return owned;
    },
    get ownedOnly() {
      return ownedOnly;
    },
    has: (code, level) => (owned[code] ?? []).includes(level),
    hasAny: () => Object.keys(owned).length > 0,
    hasClass: (code) => (owned[code] ?? []).length > 0,
    toggleLevel(code, level) {
      const cur = owned[code] ?? [];
      set(code, cur.includes(level) ? cur.filter((n) => n !== level) : [...cur, level]);
    },
    toggleClass(code) {
      set(code, (owned[code] ?? []).length ? [] : [1]);
    },
    replace(map) {
      owned = map;
      save();
    },
    setOwnedOnly(value) {
      ownedOnly = Boolean(value);
      save();
    },
  };
}
