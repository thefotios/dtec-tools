import { h, hidden } from './dom.mjs';
import { savedSlots } from './passives.mjs';
import { sourcesForBuild, aggregate, isRecruitMaster, effectMatrix, SCOPES } from './effects.mjs';

// Combined effects panel (Builds page) and the team effect matrix (Team page).
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

// A build's effects for one base at an owned level with its passive slots.
function buildEffects(state, base, level, slots, scopes) {
  const sources = sourcesForBuild(base, level, slots);
  return aggregate(state.data.effects, sources, { scopes });
}

export function buildEffectsPanel(state, base, level, slots) {
  const model = buildEffects(state, base, level, slots, SCOPES);
  return effectsPanel('Combined effects', model, { note: isRecruitMaster(base, level) ? RECRUIT_NOTE : null, key: 'effects-panel' });
}

// Member inputs for effectMatrix, one per header column in member order; a member without a base class gets an empty column.
export function teamInputs(state, members) {
  return members.map(({ name, player, base }) =>
    base ? { player: name, base, level: player.levels[base.code] ?? 0, slots: savedSlots(state.data.classes, player, base.code) } : { player: name, base: null, level: 0, slots: [] },
  );
}

const check = () => [h('span', { 'aria-hidden': 'true', text: '\u2713' }), hidden('yes')];

function matrixCell(row, cell) {
  if (!cell) return h('td', { class: 'matrix-cell' });
  return h('td', { class: 'matrix-cell' }, cell.flag ? check() : formatEffect({ unit: row.unit, total: cell.value }));
}

function matrixRow(row, hasAdd) {
  return h(
    'tr',
    { class: `matrix-row${row.shared ? ' is-shared' : ''}`, 'data-stat': row.stat, 'data-scope': row.scope },
    h(
      'th',
      { scope: 'row', class: 'matrix-stat' },
      h('span', { class: 'effect-name', text: row.name }),
      row.whenLabel ? h('span', { class: 'effect-when', text: row.whenLabel }) : null,
      h('span', { class: `scope-tag scope-${row.scope}`, text: row.scope }),
      row.shared ? [h('span', { class: 'shared-mark', 'aria-hidden': 'true', text: `\u00d7${row.sharedBy}` }), hidden(`shared by ${row.sharedBy} players`)] : null,
      row.rounded ? h('span', { class: 'effect-mark', text: 'rounded' }) : null,
      row.sameClass ? h('span', { class: 'effect-warn', text: 'stacking unconfirmed' }) : null,
    ),
    row.cells.map((c) => matrixCell(row, c)),
    hasAdd ? h('td', { class: 'matrix-add-cell' }) : null,
    h('td', { class: 'matrix-cell matrix-total' }, row.total === true ? check() : row.total == null ? null : formatEffect({ unit: row.unit, total: row.total })),
  );
}

// The team as a table: stat, one column per input, an optional "+" add cell, Team total.
// headers[i] is the header content of inputs[i]; empty is shown when there are no members.
export function teamMatrix(state, inputs, headers, { add = null, empty = null } = {}) {
  const wrap = (...body) => h('div', { class: 'matrix-scroll' }, h('table', { class: 'matrix' }, ...body));
  if (!inputs.length) {
    return [wrap(h('thead', {}, h('tr', {}, add ? h('th', { scope: 'col', class: 'matrix-add' }, add) : null))), empty];
  }
  const model = effectMatrix(state.data.effects, inputs);
  const cols = inputs.length + (add ? 1 : 0) + 2;
  const head = h(
    'thead',
    {},
    h(
      'tr',
      {},
      h('th', { scope: 'col', class: 'matrix-stat', text: 'Effect' }),
      headers.map((cell) => h('th', { scope: 'col', class: 'matrix-member' }, cell)),
      add ? h('th', { scope: 'col', class: 'matrix-add' }, add) : null,
      h('th', { scope: 'col', class: 'matrix-total', text: 'Team total' }),
    ),
  );
  const bodies = model.groups.map((g) =>
    h(
      'tbody',
      { class: `matrix-group matrix-${g.section}` },
      h('tr', { class: 'matrix-group-row' }, h('th', { scope: 'rowgroup', colspan: String(cols) }, h('span', { class: 'matrix-group-title', text: g.sub ? `${g.title} \u00b7 ${g.sub}` : g.title }))),
      g.rows.map((r) => matrixRow(r, Boolean(add))),
    ),
  );
  const recruit = inputs.some((i) => isRecruitMaster(i.base, i.level));
  return [
    wrap(head, bodies.length ? bodies : h('tbody', {}, h('tr', {}, h('td', { class: 'matrix-empty', colspan: String(cols), text: 'No effects from the selected classes' })))),
    recruit ? h('p', { class: 'effect-note', text: RECRUIT_NOTE }) : null,
  ];
}
