import { h } from './dom.mjs';
import { toSlots } from './passives.mjs';
import { sourcesForBuild, teamSources, aggregate, isRecruitMaster } from './effects.mjs';

// Combined effects: shared by the Classes panel, the Team panel and each team card's "Own effects" disclosure.
export const RECRUIT_NOTE = 'Passives scaled ×1.25 (Recruit L5); values rounded to 1 decimal';

export function formatEffect(row) {
  if (row.unit === 'flag' || row.total == null) return '';
  const n = Number(row.total.toFixed(2));
  return `${n > 0 ? '+' : ''}${n}${row.unit === 'pct' ? '%' : ''}`;
}

function effectRow(row, { withTotal = true } = {}) {
  const total = withTotal ? formatEffect(row) : '';
  return h(
    'li',
    { class: 'effect-row', 'data-stat': row.stat },
    h(
      'div',
      { class: 'effect-main' },
      h('span', { class: 'effect-name', text: row.name }),
      row.rounded ? h('span', { class: 'effect-mark', text: 'rounded' }) : null,
      row.sameClass ? h('span', { class: 'effect-warn', text: 'stacking unconfirmed' }) : null,
      total ? h('span', { class: 'effect-total', text: total }) : null,
    ),
    h('p', { class: 'effect-sources', text: row.sources.map((src) => src.label).join(', ') }),
  );
}

const effectList = (rows, opts) => h('ul', { class: 'effect-rows' }, rows.map((r) => effectRow(r, opts)));

const effectsEmpty = (m) => !m.categories.length && !m.conditional.length && !m.flags.length && !m.nearby.length && !m.uncertain.length;

function effectGroups(m) {
  const group = (cls, title, ...body) => h('div', { class: `effect-group ${cls}`, role: cls === 'effect-nearby' ? 'note' : null }, h('h3', { class: 'effect-group-title', text: title }), ...body);
  return [
    m.categories.map((c) =>
      group('effect-cat', c.name, c.subs.map((sub) => h('div', { class: 'effect-sub' }, h('h4', { class: 'effect-sub-title', text: sub.name }), effectList(sub.rows)))),
    ),
    m.conditional.length ? group('effect-conditional', 'Conditional', m.conditional.map((g) => h('div', { class: 'effect-sub' }, h('h4', { class: 'effect-sub-title', text: g.label }), effectList(g.rows)))) : null,
    m.flags.length ? group('effect-flags', 'Flags', effectList(m.flags)) : null,
    m.nearby.length ? group('effect-nearby', 'Nearby', h('p', { class: 'effect-callout', text: 'Close players get a higher bonus' }), effectList(m.nearby, { withTotal: false })) : null,
    m.uncertain.length ? group('effect-uncertain', 'Uncertain', m.uncertain.map((g) => h('div', { class: 'effect-sub' }, h('h4', { class: 'effect-sub-title', text: g.q }), effectList(g.rows, { withTotal: false })))) : null,
  ].flat();
}

// section.panel.effects: model is aggregate() output; empty is the text shown when every group is empty.
function effectsPanel(title, model, { note = null, empty = 'No effects yet', key = null } = {}) {
  return h(
    'section',
    { class: 'panel effects', 'aria-label': title, 'data-fk': key },
    h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title', text: title })),
    note ? h('p', { class: 'effect-note', text: note }) : null,
    model && !effectsEmpty(model) ? effectGroups(model) : h('p', { class: 'empty', text: empty }),
  );
}

// Collapsed per-card disclosure; open state lives in state.openEffects because every paint rebuilds the DOM.
export function ownEffectsDetails(state, actions, name, model) {
  const key = name.toLowerCase();
  return h(
    'details',
    { class: 'own-effects', open: state.openEffects.has(key), ontoggle: (e) => actions.setEffectsOpen(key, e.target.open) },
    h('summary', { 'data-fk': `member-${key}-effects`, text: 'Own effects' }),
    effectsEmpty(model) ? h('p', { class: 'card-empty', text: 'No own effects' }) : effectGroups(model),
  );
}

// A build's effects for one base at an owned level with its passive slots.
export function buildEffects(state, base, level, slots, scopes) {
  const sources = sourcesForBuild(base, level, slots);
  return aggregate(state.data.effects, sources, { scopes });
}

export function buildEffectsPanel(state, base, level, slots) {
  const model = buildEffects(state, base, level, slots, ['self', 'team', 'nearby']);
  return effectsPanel('Combined effects', model, { note: isRecruitMaster(base, level) ? RECRUIT_NOTE : null, key: 'effects-panel' });
}

// Member inputs for teamSources; members without a base class are skipped.
export function teamInputs(state, members) {
  return members
    .map(({ name, player, base }) => (base ? { player: name, base, level: player.levels[base.code] ?? 0, slots: toSlots(state.data.classes, player.sets[base.code] ?? []) } : null))
    .filter(Boolean);
}

export function teamEffectsPanel(state, inputs) {
  if (!inputs.length) return effectsPanel('Team effects', null, { empty: 'Add players to see team effects', key: 'team-effects' });
  const model = aggregate(state.data.effects, teamSources(inputs), { scopes: ['team', 'nearby'] });
  return effectsPanel('Team effects', model, { empty: 'No team effects', key: 'team-effects' });
}
