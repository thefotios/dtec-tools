// Pure aggregation of class-level effects into the grouped "Combined effects" model.
// A source is { cls, level, kind: 'base'|'passive', effect, instance, rounded?, member? }; instance tells apart separate copies of one class.

const RECRUIT_MULT = 1.25;

export const SCOPES = ['self', 'team', 'nearby'];

// Base levels 1..ownedLevel plus each passive slot's single level. recruitMaster scales passive pct/flat values, rounded to 1 decimal per source.
export const isRecruitMaster = (base, level) => base?.code === 'rec' && level >= 5;

export function sourcesForBuild(base, ownedLevel, slots, { recruitMaster = isRecruitMaster(base, ownedLevel) } = {}) {
  const out = [];
  const add = (cls, level, kind, instance, scale) => {
    for (const e of cls.levels[level - 1]?.effects ?? []) {
      let effect = e;
      let rounded = false;
      if (scale && typeof e.value === 'number') {
        const exact = e.value * RECRUIT_MULT;
        // One decimal place; the inner rounding strips float noise so ties like 6.25 are decided on the intended value.
        effect = { ...e, value: Math.round(Math.round(e.value * RECRUIT_MULT * 10 * 1e6) / 1e6) / 10 };
        rounded = Math.abs(effect.value - exact) > 1e-9;
      }
      out.push({ cls, level, kind, effect, instance, ...(rounded && { rounded }) });
    }
  };
  for (let l = 1; l <= ownedLevel; l++) add(base, l, 'base', 'base', false);
  (slots ?? []).forEach((s, i) => add(s.cls, s.level, 'passive', `p${i}`, recruitMaster));
  return out;
}

// members: [{ player, base, level, slots, recruitMaster? }]; recruitMaster defaults to Recruit owned at L5.
export function teamSources(members) {
  return members.flatMap((m) =>
    sourcesForBuild(m.base, m.level, m.slots, { recruitMaster: m.recruitMaster ?? isRecruitMaster(m.base, m.level) }).map((s) => ({
      ...s,
      member: m.player,
      instance: `${m.player}|${s.instance}`,
    })),
  );
}

const labelOf = (s) => {
  const name = s.kind === 'base' ? `${s.cls.name} L${s.level}` : `${s.cls.name} ${s.level} (passive)`;
  return `${s.member ? `${s.member}: ` : ''}${name}${s.effect.scope === 'team' ? ' (team)' : ''}`;
};

// True when any one class contributes through more than one instance (separate copies of the class).
function hasSameClass(list) {
  const instances = new Map();
  for (const s of list) {
    if (!instances.has(s.cls.code)) instances.set(s.cls.code, new Set());
    instances.get(s.cls.code).add(s.instance);
  }
  return [...instances.values()].some((set) => set.size > 1);
}

// Which display section a source belongs to; the first matching rule wins.
function sectionOf(taxonomy, s) {
  if (s.effect.uncertain) return 'uncertain';
  if (s.effect.scope === 'nearby') return 'nearby';
  if (s.effect.when) return 'conditional';
  return taxonomy.stats[s.effect.stat].unit === 'flag' ? 'flags' : 'category';
}

function makeRows(taxonomy, sources, withTotal) {
  const groups = new Map();
  for (const s of sources) {
    const key = `${s.effect.stat}|${s.effect.when ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return [...groups.values()].map((list) => {
    const { stat, when } = list[0].effect;
    const def = taxonomy.stats[stat];
    const row = { stat, name: def.name, unit: def.unit, when, rounded: list.some((s) => s.rounded), sameClass: false, sources: [] };
    for (const s of list) row.sources.push({ label: labelOf(s), value: s.effect.value, cls: s.cls, kind: s.kind });
    row.sameClass = hasSameClass(list);
    if (withTotal && def.unit !== 'flag') row.total = list.reduce((sum, s) => sum + s.effect.value, 0);
    return row;
  });
}

const byStatOrder = (taxonomy) => {
  const order = Object.keys(taxonomy.stats);
  return (a, b) => order.indexOf(a.stat) - order.indexOf(b.stat);
};

// Keeps sources whose scope is in scopes; returns { categories, conditional, flags, nearby, uncertain }.
export function aggregate(taxonomy, sources, { scopes = SCOPES } = {}) {
  const kept = sources.filter((s) => scopes.includes(s.effect.scope) && taxonomy.stats[s.effect.stat]);
  const inSection = (section) => kept.filter((s) => sectionOf(taxonomy, s) === section);
  const uncertain = inSection('uncertain');
  const nearby = inSection('nearby');
  const cond = inSection('conditional');
  const flagSources = inSection('flags');
  const valued = inSection('category');
  const cmp = byStatOrder(taxonomy);
  const rowsOf = (list, withTotal = true) => makeRows(taxonomy, list, withTotal).sort(cmp);

  const rows = rowsOf(valued);
  const categories = taxonomy.categories
    .map((c) => ({
      id: c.id,
      name: c.name,
      subs: c.subs
        .map((sub) => ({ id: sub.id, name: sub.name, rows: rows.filter((r) => taxonomy.stats[r.stat].cat === c.id && taxonomy.stats[r.stat].sub === sub.id) }))
        .filter((sub) => sub.rows.length),
    }))
    .filter((c) => c.subs.length);

  const whenIds = Object.keys(taxonomy.whens);
  const conditional = whenIds
    .map((when) => ({ when, label: taxonomy.whens[when], rows: rowsOf(cond.filter((s) => s.effect.when === when)) }))
    .filter((g) => g.rows.length);

  const uncertainGroups = Object.keys(taxonomy.questions)
    .map((question) => ({ question, q: taxonomy.questions[question].q, rows: rowsOf(uncertain.filter((s) => s.effect.uncertain === question), false) }))
    .filter((g) => g.rows.length);

  return { categories, conditional, flags: rowsOf(flagSources), nearby: rowsOf(nearby, false), uncertain: uncertainGroups };
}

// Per-member matrix of every scope. members: the teamSources input in column order (a member with base null has no effects).
// Returns { members: [name], groups: [{ section, title, sub, rows }] }; a row is { stat, name, unit, when, whenLabel (outside the conditional section), scope, cells, total, rounded,
// sameClass, sharedBy, shared } with cells per member: null, { value } (that member's sum) or { flag: true }. Total is true for a team flag row,
// the cell sum for a team numeric row in the category and conditional sections, else null.
export function effectMatrix(taxonomy, members) {
  const sources = teamSources(members.filter((m) => m.base)).filter((s) => taxonomy.stats[s.effect.stat]);
  const groupKey = (section, s) => {
    const def = taxonomy.stats[s.effect.stat];
    if (section === 'category') return `category|${def.cat}|${def.sub}`;
    if (section === 'conditional') return `conditional|${s.effect.when}`;
    if (section === 'uncertain') return `uncertain|${s.effect.uncertain}`;
    return section;
  };
  const buckets = new Map();
  for (const s of sources) {
    const section = sectionOf(taxonomy, s);
    const key = groupKey(section, s);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ ...s, section });
  }

  const names = members.map((m) => m.player);
  const statOrder = Object.keys(taxonomy.stats);
  const rowsOf = (list) => {
    const rows = new Map();
    for (const s of list) {
      const key = `${s.effect.stat}|${s.effect.when ?? ''}|${s.effect.scope}`;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(s);
    }
    return [...rows.values()]
      .map((rowSources) => {
        const { stat, when, scope } = rowSources[0].effect;
        const section = rowSources[0].section;
        const def = taxonomy.stats[stat];
        const cells = names.map((player) => {
          const mine = rowSources.filter((s) => s.member === player);
          if (!mine.length) return null;
          return def.unit === 'flag' ? { flag: true } : { value: mine.reduce((sum, s) => sum + s.effect.value, 0) };
        });
        const sharedBy = cells.filter(Boolean).length;
        let total = null;
        if (scope === 'team') {
          if (def.unit === 'flag') total = true;
          else if (section === 'category' || section === 'conditional') total = cells.reduce((sum, c) => sum + (c?.value ?? 0), 0);
        }
        return {
          stat,
          name: def.name,
          unit: def.unit,
          when,
          ...(when && section !== 'conditional' ? { whenLabel: taxonomy.whens[when] ?? when } : {}),
          scope,
          cells,
          total,
          rounded: rowSources.some((s) => s.rounded),
          sameClass: hasSameClass(rowSources),
          sharedBy,
          shared: sharedBy >= 2,
        };
      })
      .sort((a, b) => statOrder.indexOf(a.stat) - statOrder.indexOf(b.stat) || SCOPES.indexOf(a.scope) - SCOPES.indexOf(b.scope));
  };

  const groups = [];
  const push = (key, section, title, sub = null) => {
    const list = buckets.get(key);
    if (list) groups.push({ section, title, sub, rows: rowsOf(list) });
  };
  for (const c of taxonomy.categories) for (const sub of c.subs) push(`category|${c.id}|${sub.id}`, 'category', c.name, sub.name);
  for (const when of Object.keys(taxonomy.whens)) push(`conditional|${when}`, 'conditional', taxonomy.whens[when]);
  push('flags', 'flags', 'Flags');
  push('nearby', 'nearby', 'Nearby');
  for (const question of Object.keys(taxonomy.questions)) push(`uncertain|${question}`, 'uncertain', taxonomy.questions[question].q);
  return { members: names, groups };
}
