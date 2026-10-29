// Per-class passive sets: every base class keeps its own set of up to 3 passives, plus the last selected base and picker preferences.
// Entries are { code, level } so the store holds plain data; slots are { cls, level }.

const STORAGE_KEY = 'class-combo-viewer:passives';
const STORE_VERSION = 1;
export const MAX_PASSIVES = 3;

// Canonical set for one base: known classes only, levels 1-3, no self passive, no duplicates, registry order then level, at most 3.
export function normalizeSet(classes, baseSlug, entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const idx = classes.findIndex((c) => c.code === e?.code);
    const level = e?.level;
    if (idx < 0 || classes[idx].slug === baseSlug || !Number.isInteger(level) || level < 1 || level > 3) continue;
    const key = `${e.code}${level}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: e.code, level, idx });
  }
  out.sort((a, b) => a.idx - b.idx || a.level - b.level);
  return out.slice(0, MAX_PASSIVES).map(({ code, level }) => ({ code, level }));
}

export const toSlots = (classes, entries) => entries.map((e) => ({ cls: classes.find((c) => c.code === e.code), level: e.level }));
export const fromSlots = (slots) => slots.map((s) => ({ code: s.cls.code, level: s.level }));

function load(storage, classes) {
  const empty = { sets: {}, last: null, unlockedOnly: false };
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY));
    if (parsed?.v !== STORE_VERSION || typeof parsed.sets !== 'object' || parsed.sets === null) return empty;
    const sets = {};
    for (const c of classes) {
      const set = normalizeSet(classes, c.slug, parsed.sets[c.slug]);
      if (set.length) sets[c.slug] = set;
    }
    const last = classes.some((c) => c.slug === parsed.last) ? parsed.last : null;
    return { sets, last, unlockedOnly: parsed.unlockedOnly === true };
  } catch {
    return empty;
  }
}

// Reads and writes never throw: a blocked store degrades to in-memory state.
export function createPassiveStore(storage, classes) {
  let { sets, last, unlockedOnly } = load(storage, classes);
  const save = () => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ v: STORE_VERSION, sets, last, unlockedOnly }));
    } catch {
      /* in-memory only */
    }
  };
  return {
    // Saved set for a base slug as slots; empty when none is saved.
    get: (slug) => toSlots(classes, sets[slug] ?? []),
    // Saves the set for a base slug; an empty set removes it.
    set(slug, slots) {
      const set = normalizeSet(classes, slug, fromSlots(slots));
      const next = { ...sets };
      if (set.length) next[slug] = set;
      else delete next[slug];
      sets = next;
      save();
    },
    // Every saved set keyed by base class code, as entries; empty sets are omitted.
    all() {
      const out = {};
      for (const c of classes) if (sets[c.slug]?.length) out[c.code] = sets[c.slug].map((e) => ({ ...e }));
      return out;
    },
    get last() {
      return last;
    },
    setLast(slug) {
      const next = classes.some((c) => c.slug === slug) ? slug : null;
      if (next === last) return;
      last = next;
      save();
    },
    get unlockedOnly() {
      return unlockedOnly;
    },
    setUnlockedOnly(value) {
      const next = Boolean(value);
      if (next === unlockedOnly) return;
      unlockedOnly = next;
      save();
    },
  };
}
