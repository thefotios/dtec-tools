// Ownership: roster code codec (pure) and a persisted store with injectable storage.

// Level n is cumulative, so a class is owned up to a max level 0-5. Consonants only, so codes can't spell words.
const LEVEL_SYMBOLS = 'XBCDFG';
const LEGACY_SYMBOLS = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
const STORAGE_KEY = 'class-combo-viewer:owned';
const STORE_VERSION = 2;
const ALIASES = { O: '0', I: '1', L: '1' };

const cleanMax = (n) => (Number.isInteger(n) && n >= 1 && n <= 5 ? n : 0);
const maxOf = (levels) => (Array.isArray(levels) ? Math.max(0, ...levels.map(cleanMax)) : cleanMax(levels));

// owned: { [classCode]: maxLevel }. Classes in registry order; runs of 3+ are written as count + symbol, trailing unowned classes trimmed.
export function encodeRoster(classes, owned) {
  const symbols = classes.map((c) => LEVEL_SYMBOLS[owned[c.code] ?? 0]);
  while (symbols.length && symbols[symbols.length - 1] === LEVEL_SYMBOLS[0]) symbols.pop();
  if (!symbols.length) return LEVEL_SYMBOLS[0];
  let out = '';
  for (let i = 0; i < symbols.length; ) {
    let j = i;
    while (symbols[j] === symbols[i]) j++;
    out += j - i >= 3 ? `${j - i}${symbols[i]}` : symbols[i].repeat(j - i);
    i = j;
  }
  return out;
}

// Legacy codes: 'A' then one Crockford symbol per class holding five level bits; the highest set bit is the max level.
function decodeLegacy(chars) {
  const bad = chars.find((ch) => !LEGACY_SYMBOLS.includes(ch));
  if (bad) return { error: `Invalid character "${bad}" in roster code` };
  const levels = chars.slice(1).map((ch) => 32 - Math.clz32(LEGACY_SYMBOLS.indexOf(ch)));
  return { levels, total: levels.length };
}

// Expands runs only up to the class list; total counts every position so extras can be reported.
function decodeRuns(chars, limit) {
  const levels = [];
  let total = 0;
  for (let i = 0; i < chars.length; ) {
    let digits = '';
    while (/\d/.test(chars[i] ?? '')) digits += chars[i++];
    if (i >= chars.length) return { error: `Run count "${digits}" has no level symbol in roster code` };
    const level = LEVEL_SYMBOLS.indexOf(chars[i]);
    if (level < 0) return { error: `Invalid character "${chars[i]}" in roster code` };
    const count = digits ? Number(digits) : 1;
    if (count < 1) return { error: 'Run count must be at least 1 in roster code' };
    for (let k = 0; k < count && levels.length < limit; k++) levels.push(level);
    total += count;
    i++;
  }
  return { levels, total };
}

// Returns { owned, notices } or { error }.
export function decodeRoster(classes, text) {
  const chars = [...String(text).toUpperCase().replace(/[\s-]+/g, '')].map((ch) => ALIASES[ch] ?? ch);
  if (!chars.length) return { error: 'Enter a roster code' };
  if ('EU'.includes(chars[0])) return { error: `Unknown roster code version "${chars[0]}"` };
  const r = chars[0] === 'A' ? decodeLegacy(chars) : decodeRuns(chars, classes.length);
  if (r.error) return r;
  const owned = {};
  classes.forEach((c, i) => {
    if (r.levels[i] > 0) owned[c.code] = r.levels[i];
  });
  const notices = [];
  const extra = r.total - classes.length;
  if (extra > 0) notices.push(`Ignored ${extra} extra class${extra === 1 ? '' : 'es'} beyond the class list`);
  return { owned, notices };
}

// Extra fields in older payloads (such as the retired ownedOnly flag) are ignored.
// Classes to list when filtering by ownership: owned ones plus any in keep (slugs).
export function ownedClasses(classes, owned, keep = []) {
  return classes.filter((c) => (owned[c.code] ?? 0) > 0 || keep.includes(c.slug));
}

function load(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY));
    if (parsed?.v !== 1 && parsed?.v !== STORE_VERSION) return {};
    const owned = {};
    for (const [code, value] of Object.entries(parsed.owned ?? {})) {
      const max = maxOf(value);
      if (max) owned[code] = max;
    }
    return owned;
  } catch {
    return {};
  }
}

// Reads and writes never throw: a blocked store degrades to in-memory state.
export function createStore(storage) {
  let owned = load(storage);
  const save = () => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ v: STORE_VERSION, owned }));
    } catch {
      /* in-memory only */
    }
  };
  const set = (code, max) => {
    const next = { ...owned };
    if (max > 0) next[code] = max;
    else delete next[code];
    owned = next;
    save();
  };
  return {
    get owned() {
      return owned;
    },
    has: (code, level) => (owned[code] ?? 0) >= level,
    hasAny: () => Object.keys(owned).length > 0,
    hasClass: (code) => (owned[code] ?? 0) > 0,
    // Clicking the current max steps back one level, so a class can return to unowned; 0 removes the class.
    setLevel(code, n) {
      set(code, n <= 0 ? 0 : (owned[code] ?? 0) === n ? n - 1 : n);
    },
    toggleClass(code) {
      set(code, owned[code] ? 0 : 1);
    },
    replace(map) {
      owned = map;
      save();
    },
  };
}
