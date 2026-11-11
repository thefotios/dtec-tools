// Passive sets: a set holds up to 3 passives for one base class.
// Entries are { code, level } so stored data stays plain; slots are { cls, level }.

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
// The player's saved passive slots for a base class code.
export const savedSlots = (classes, player, baseCode) => toSlots(classes, player.sets[baseCode] ?? []);
export const fromSlots = (slots) => slots.map((s) => ({ code: s.cls.code, level: s.level }));
