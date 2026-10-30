// Pure aggregation of class-level effects into the grouped "Combined effects" model.
// A source is { cls, level, kind: 'base'|'passive', effect, instance, rounded?, member? }; instance tells apart separate copies of one class.

const RECRUIT_MULT = 1.25;

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
    const instances = new Map();
    for (const s of list) {
      if (!instances.has(s.cls.code)) instances.set(s.cls.code, new Set());
      instances.get(s.cls.code).add(s.instance);
      row.sources.push({ label: labelOf(s), value: s.effect.value, cls: s.cls, kind: s.kind });
    }
    row.sameClass = [...instances.values()].some((set) => set.size > 1);
    if (withTotal && def.unit !== 'flag') row.total = list.reduce((sum, s) => sum + s.effect.value, 0);
    return row;
  });
}

const byStatOrder = (taxonomy) => {
  const order = Object.keys(taxonomy.stats);
  return (a, b) => order.indexOf(a.stat) - order.indexOf(b.stat);
};

// Keeps sources whose scope is in scopes; returns { categories, conditional, flags, nearby, uncertain }.
export function aggregate(taxonomy, sources, { scopes = ['self', 'team', 'nearby'] } = {}) {
  const kept = sources.filter((s) => scopes.includes(s.effect.scope) && taxonomy.stats[s.effect.stat]);
  const uncertain = kept.filter((s) => s.effect.uncertain);
  const rest = kept.filter((s) => !s.effect.uncertain);
  const nearby = rest.filter((s) => s.effect.scope === 'nearby');
  const own = rest.filter((s) => s.effect.scope !== 'nearby');
  const cond = own.filter((s) => s.effect.when);
  const plain = own.filter((s) => !s.effect.when);
  const flagSources = plain.filter((s) => taxonomy.stats[s.effect.stat].unit === 'flag');
  const valued = plain.filter((s) => taxonomy.stats[s.effect.stat].unit !== 'flag');
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
