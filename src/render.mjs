import { ownedClasses } from './owned.mjs';
import { ownedBase, MAX_MEMBERS } from './players.mjs';
import { MAX_PASSIVES } from './passives.mjs';
import { h, hidden } from './dom.mjs';
import { classIcon } from './icons.mjs';
import { buildEffectsPanel, teamMatrix, teamInputs } from './render-effects.mjs';
import { importPanel, replacesText, listOf } from './render-import.mjs';
import { cardsPanel, revealCard } from './render-people.mjs';
import { teamAddOffer, ME_ID } from './people.mjs';

// Renders from state only; all data text goes through textContent.
// Interactive elements carry data-fk so focus survives the full re-render.

const TAG_LABEL = { team: 'TEAM', master: 'MASTER' };
const SVG_NS = 'http://www.w3.org/2000/svg';

function diamond() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'diamond');
  svg.setAttribute('viewBox', '0 0 12 14');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M6 .5 11.5 7 6 13.5.5 7z');
  svg.append(path);
  return svg;
}

function diamonds(cls, tiers) {
  const color = cls.event ? 'orange' : tiers[cls.tier]?.color ?? 'white';
  return h(
    'span',
    { class: 'diamonds', 'data-color': color },
    ...Array.from({ length: cls.tier }, diamond),
    hidden(`Tier ${cls.tier}${cls.event ? ', event' : ''}`),
  );
}

function levelChip(level, index) {
  return h(
    'span',
    { class: 'level-chip' },
    h('span', { class: 'level-num', text: String(index + 1) }),
    level.tag ? h('span', { class: 'level-tag', text: TAG_LABEL[level.tag] ?? level.tag }) : null,
  );
}

function loadingPanel() {
  return h('section', { class: 'panel loading', role: 'status' }, h('p', { text: 'Loading classes' }));
}

function errorPanel(error, actions) {
  return h(
    'section',
    { class: 'panel error', role: 'alert' },
    h('p', { text: `Could not load ${error.url}` }),
    error.message ? h('p', { class: 'error-detail', text: error.message }) : null,
    h('button', { type: 'button', class: 'btn btn-green', 'data-fk': 'retry', onclick: actions.retry, text: 'Retry' }),
  );
}

function noticesBar(notices, actions) {
  if (!notices.length) return null;
  return h(
    'div',
    { class: 'notices' },
    notices.map((n, i) =>
      h(
        'p',
        { class: 'notice', role: 'status', 'data-reason': n.reason },
        h('span', { class: 'notice-text', text: n.message }),
        h('button', { type: 'button', class: 'btn btn-small', 'data-fk': `dismiss-${i}`, 'aria-label': `Dismiss notice for ${n.token}`, onclick: () => actions.dismissNotice(i), text: 'Dismiss' }),
      ),
    ),
  );
}

// "New here? See Help" pointer shown inside first-run empty states.
function helpLink(actions) {
  return h('p', { class: 'help-pointer' }, 'New here? ', h('a', { class: 'visitor-team-link', 'data-fk': 'help-link', href: new URL('help', document.baseURI).href, onclick: (e) => (e.preventDefault(), actions.setView('help')), text: 'See Help' }));
}

// "No saved players yet" sentence whose Import button opens the panel in place.
const noPlayersHint = (actions) => [
  'No saved players yet. ',
  h('button', { type: 'button', class: 'link-btn', 'data-fk': 'open-import', onclick: actions.openImport, text: 'Import' }),
  ' a link or code.',
];

function navButton(state, actions, view, text) {
  const current = state.view === view;
  return h('button', { type: 'button', class: `btn ${current ? 'btn-green' : 'btn-grey'}`, 'data-fk': `nav-${view}`, 'aria-current': current ? 'page' : null, onclick: () => actions.setView(view), text });
}

const notOwned = () => h('span', { class: 'not-owned', text: 'Not owned' });
const noClassesText = (player) => `${player.name || 'This player'} has no classes.`;


function copyButton(state, actions, { key, done, idle, doneText, primary, block, onclick, small = true }) {
  const isDone = state.copy === done;
  return h('button', { type: 'button', class: `btn ${primary ? 'btn-green' : 'btn-grey'}${small ? ' btn-small' : ''}${isDone ? ' is-done' : ''}`, 'data-fk': key, disabled: Boolean(block), 'aria-describedby': block ? 'share-hint' : null, onclick, text: isDone ? doneText : idle });
}

// Feedback shared by every copy action: a hint when sharing is unavailable, a live status, and a selectable field when the clipboard fails.
function copyFeedback(state, block) {
  return [
    block ? h('p', { class: 'share-hint', id: 'share-hint', text: block }) : null,
    h('span', { class: 'visually-hidden', role: 'status', text: state.copy === 'copied' ? 'Link copied' : state.copy === 'code-copied' ? 'Code copied' : '' }),
    state.copy === 'failed'
      ? h('input', { type: 'text', class: 'copy-fallback', readonly: true, 'aria-label': 'Text to copy', 'data-fk': 'link-field', value: state.copyText, onfocus: (e) => e.target.select() })
      : null,
  ];
}

function header(state, actions) {
  return h(
    'header',
    { class: 'app-header' },
    h('h1', { text: 'DTEC Build Tool' }),
    h(
      'nav',
      { class: 'app-nav', 'aria-label': 'Sections' },
      navButton(state, actions, 'builds', 'Builds'),
      navButton(state, actions, 'team', 'Team'),
      navButton(state, actions, 'help', 'Help'),
      h('button', { type: 'button', class: `btn ${state.importOpen ? 'btn-green' : 'btn-grey'}`, 'data-fk': 'nav-import', 'aria-expanded': String(state.importOpen), 'aria-controls': 'import-panel', onclick: actions.toggleImport, text: 'Import' }),
    ),
  );
}

// The class levels the Builds page shows: the selected person's stored levels.
const levelsOf = (state) => state.shown.levels;

// One class in the list. Outside edit mode rows stay closed and tapping a row selects it as the base; in edit mode rows expand independently.
function ownRow(state, actions, cls) {
  const max = levelsOf(state)[cls.code] ?? 0;
  const editing = state.list.editing;
  const selected = state.build.base?.slug === cls.slug;
  const open = editing && state.expanded.has(cls.slug);
  const k = `own-${cls.slug}`;
  return h(
    'li',
    { class: `own-row${open ? ' is-open' : ''}${selected ? ' is-selected' : ''}`, 'data-class': cls.slug },
    h(
      'div',
      { class: 'own-head' },
      h(
        'button',
        { type: 'button', class: 'own-toggle', 'data-fk': k, 'aria-expanded': editing ? String(open) : null, 'aria-controls': editing ? `${k}-levels` : null, 'aria-pressed': editing ? null : String(selected), onclick: () => actions.selectClass(cls.slug) },
        classIcon(cls),
        h('span', { class: 'class-name' }, cls.name, selected && !max ? notOwned() : null),
        diamonds(cls, state.data.tiers),
        editing ? h('span', { class: 'own-chevron', 'aria-hidden': 'true', text: '\u25be' }) : null,
      ),
      max
        ? h('span', { class: 'own-pill is-owned', 'data-level': max }, `L${max}`, hidden(` owned, level ${max}`))
        : !editing
        ? null
        : h('button', { type: 'button', class: 'own-pill', 'data-fk': `${k}-buy`, 'aria-label': `Buy ${cls.name}`, onclick: () => actions.setLevel(cls.code, 1), text: '+' }),
    ),
    open
      ? h(
          'div',
          { class: 'own-body', id: `${k}-levels` },
          h(
            'ol',
            { class: 'levels' },
            cls.levels.map((level, i) => {
              const on = max >= i + 1;
              const parts = [levelChip(level, i), h('span', { class: 'level-text', text: level.text }), h('span', { class: 'own-check', 'aria-hidden': 'true', text: on ? '\u2713' : '' })];
              const cn = `level own-level${on ? ' is-unlocked' : ''}`;
              return h(
                'li',
                {},
                editing
                  ? h('button', { type: 'button', class: cn, 'data-level': i + 1, 'data-tag': level.tag, 'data-fk': `${k}-${i + 1}`, 'aria-pressed': String(on), onclick: () => actions.setLevel(cls.code, i + 1) }, parts)
                  : h('div', { class: `${cn} is-readonly`, 'data-level': i + 1, 'data-tag': level.tag }, parts, hidden(on ? ' unlocked' : ' locked')),
              );
            }),
          ),
          editing && max ? h('button', { type: 'button', class: 'btn btn-red btn-small own-remove', 'data-fk': `${k}-remove`, onclick: () => actions.setLevel(cls.code, 0) }, 'Remove class', hidden(` ${cls.name}`)) : null,
        )
      : null,
  );
}

// Every passive at once: one row per class (tier order), one toggle cell per level.
// The base class is never listed: a class cannot be its own passive.
// opts: { noTitle (omit the heading), levels (owned levels by class code; levelRows only), unknownRoster (omit the "Not owned" pill: no roster to judge by), levelRows (render owned classes as ownership-style level rows; locked levels shown gray unless unlockedOnly), unlockedOnly, onUnlockedOnly, base, slots, has(code, level), ownedOnly (list only owned levels, plus selected), emptyText (shown when ownedOnly leaves nothing), flag(code, level), filter, filterKey, keyPrefix, label, onFilter, onToggle, onClear }
function passivePicker(state, actions, opts) {
  const { classes, tiers } = state.data;
  const { slots } = opts;
  const full = slots.length >= MAX_PASSIVES;
  const picked = (c, n) => slots.some((s) => s.cls.slug === c.slug && s.level === n);
  const f = opts.filter.trim().toLowerCase();
  const ordered = Object.keys(tiers).flatMap((tier) => classes.filter((c) => String(c.tier) === tier));
  const visibleLevels = (c) => [1, 2, 3].filter((n) => picked(c, n) || !opts.ownedOnly || opts.has(c.code, n));
  const hasPicked = (c) => slots.some((s) => s.cls.slug === c.slug);
  const levelRowsVisible = (c) => [1, 2, 3].filter((n) => picked(c, n) || !opts.unlockedOnly || opts.has(c.code, n));
  const rows = opts.levelRows
    ? ordered.filter((c) => c.slug !== opts.base?.slug && c.name.toLowerCase().includes(f) && (opts.has(c.code, 1) || hasPicked(c)) && levelRowsVisible(c).length)
    : ordered.filter((c) => c.slug !== opts.base?.slug && c.name.toLowerCase().includes(f) && visibleLevels(c).length);
  const k = opts.keyPrefix;
  const cell = (c, n) => {
    const on = picked(c, n);
    const blocked = full && !on;
    return h(
      'button',
      {
        type: 'button',
        class: `passive-cell${on ? ' is-selected' : ''}${blocked ? ' is-disabled' : ''}`,
        'data-fk': `${k}-${c.slug}-${n}`,
        'data-level': n,
        'aria-pressed': String(on),
        'aria-disabled': blocked ? 'true' : null,
        'aria-label': `${c.name} level ${n}`,
        onclick: () => (blocked ? null : opts.onToggle(c, n)),
      },
      h('span', { class: 'cell-badge' }, on ? h('span', { class: 'cell-check', 'aria-hidden': 'true', text: '\u2713' }) : null, h('span', { class: 'level-num', text: String(n) })),
      h('span', { class: 'level-text', text: c.levels[n - 1].text }),
      opts.flag(c.code, n) ? notOwned() : null,
    );
  };
  // Ownership-style row: all levels written out; locked levels (above the owned max) are gray and not selectable.
  const levelRow = (c) => {
    const max = opts.levels[c.code] ?? 0;
    return h(
      'li',
      { class: 'own-row passive-own', 'data-class': c.slug },
      h(
        'div',
        { class: 'own-head' },
        h('span', { class: 'own-toggle passive-own-name' }, classIcon(c, { size: 24 }), h('span', { class: 'class-name', text: c.name }), diamonds(c, tiers)),
        max ? h('span', { class: 'own-pill is-owned', 'data-level': max }, `L${max}`, hidden(` owned, level ${max}`)) : opts.unknownRoster ? null : notOwned(),
      ),
      h(
        'div',
        { class: 'own-body' },
        h(
          'ol',
          { class: 'levels' },
          levelRowsVisible(c).map((n) => {
            const on = picked(c, n);
            const locked = !opts.has(c.code, n);
            const blocked = !on && (locked || full);
            return h(
              'li',
              {},
              h(
                'button',
                {
                  type: 'button',
                  class: `level own-level passive-level${on ? ' is-selected' : ''}${locked ? ' is-locked' : ' is-unlocked'}${!locked && blocked ? ' is-disabled' : ''}`,
                  'data-level': n,
                  'data-fk': `${k}-${c.slug}-${n}`,
                  'aria-pressed': String(on),
                  'aria-disabled': blocked ? 'true' : null,
                  'aria-label': `${c.name} level ${n}${locked ? ', locked' : ''}`,
                  onclick: () => (blocked ? null : opts.onToggle(c, n)),
                },
                levelChip(c.levels[n - 1], n - 1),
                h('span', { class: 'level-text', text: c.levels[n - 1].text }),
                locked ? (on ? notOwned() : h('span', { class: 'lock-hint', title: `Own ${c.name} at level ${n} to unlock`, text: 'Locked' })) : null,
                h('span', { class: 'own-check', 'aria-hidden': 'true', text: on ? '\u2713' : '' }),
              ),
            );
          }),
        ),
      ),
    );
  };
  return h(
    'div',
    { class: 'passive-picker' },
    h(
      'div',
      { class: 'passive-head' },
      opts.noTitle ? null : h('h2', { class: 'panel-title', text: `Passives (${slots.length}/${MAX_PASSIVES})` }),
      opts.levelRows
        ? h(
            'label',
            { class: 'unlocked-only' },
            h('input', { type: 'checkbox', 'data-fk': `${k}-unlocked-only`, checked: opts.unlockedOnly, onchange: (e) => opts.onUnlockedOnly(e.target.checked) }),
            h('span', { text: 'Unlocked only' }),
          )
        : null,
      h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': `${k}-clear`, disabled: !slots.length, onclick: opts.onClear }, 'Clear', hidden(' passives')),
    ),
    h(
      'div',
      { class: 'passive-selected', 'aria-label': 'Selected passives' },
      h('span', { class: 'passive-selected-label', text: 'Selected' }),
      slots.length
        ? h(
            'ul',
            { class: 'sel-chips' },
            slots.map((sl) =>
              h(
                'li',
                { class: 'sel-chip', 'data-level': sl.level },
                h('span', { class: 'sel-chip-name', text: `${sl.cls.name} ${sl.level}` }),
                opts.flag(sl.cls.code, sl.level) ? notOwned() : null,
                h('button', { type: 'button', class: 'sel-chip-x', 'data-fk': `${k}-remove-${sl.cls.slug}-${sl.level}`, 'aria-label': `Remove ${sl.cls.name} ${sl.level}`, onclick: () => opts.onToggle(sl.cls, sl.level), text: '\u00d7' }),
              ),
            ),
          )
        : h('span', { class: 'passive-none', text: 'None' }),
    ),
    h('input', { type: 'search', class: 'picker-filter', 'data-fk': opts.filterKey, 'aria-label': 'Filter passives by class', placeholder: 'Filter passives', value: opts.filter, oninput: (e) => opts.onFilter(e.target.value) }),
    rows.length
      ? h(
          'ul',
          { class: opts.levelRows ? 'own-list' : 'passive-rows' },
          rows.map((c) =>
            opts.levelRows ? levelRow(c) : h(
              'li',
              { class: 'passive-row', 'data-class': c.slug },
              h('div', { class: 'passive-name' }, classIcon(c, { size: 24 }), h('span', { class: 'class-name', text: c.name }), diamonds(c, tiers)),
              h('div', { class: 'passive-cells' }, visibleLevels(c).map((n) => cell(c, n))),
            ),
          ),
        )
      : h('p', { class: 'empty', text: !f && opts.ownedOnly && opts.emptyText ? opts.emptyText : 'No passives match' }),
  );
}

// The passive picker for the selected person. A person whose roster is not known has levels 1 to 3 of every class unlocked.
function pickerEditor(state, actions) {
  const person = state.shown;
  const levels = levelsOf(state);
  const has = person.rosterKnown ? (code, n) => (levels[code] ?? 0) >= n : (code, n) => n <= 3;
  return passivePicker(state, actions, {
    noTitle: true,
    base: state.build.base,
    slots: state.build.slots,
    levels,
    unknownRoster: !person.rosterKnown,
    has,
    ownedOnly: true,
    levelRows: true,
    unlockedOnly: state.people.unlockedOnly,
    onUnlockedOnly: actions.setUnlockedOnly,
    flag: (code, n) => !has(code, n),
    emptyText: 'No owned passives to pick. Mark classes in the class list.',
    filter: state.passiveFilter,
    filterKey: 'passive-filter',
    keyPrefix: 'passive',
    onFilter: actions.setPassiveFilter,
    onToggle: (c, n) => actions.toggleSlot(c.slug, n),
    onClear: actions.clearSlots,
  });
}

// A selected passive written out like a level row, headed by its class. `owned` is the levels it is judged against, or null for no judgement.
function passiveRow(slot, owned) {
  const { cls, level } = slot;
  return h(
    'li',
    { class: 'level passive-read', 'data-level': level },
    levelChip(cls.levels[level - 1], level - 1),
    h(
      'span',
      { class: 'level-text' },
      h('span', { class: 'passive-line' }, h('span', { class: 'row-from' }, classIcon(cls, { size: 24 }), cls.name, !owned || (owned[cls.code] ?? 0) >= level ? null : notOwned()), h('span', { text: cls.levels[level - 1].text })),
    ),
  );
}

// A class's five levels, unlocked ones in color and locked ones dimmed.
function levelList(base, owned) {
  return h(
    'ol',
    { class: 'levels' },
    base.levels.map((level, i) => {
      const on = (owned[base.code] ?? 0) >= i + 1;
      return h(
        'li',
        {},
        h(
          'div',
          { class: `level own-level is-readonly${on ? ' is-unlocked' : ''}`, 'data-level': i + 1, 'data-tag': level.tag },
          levelChip(level, i),
          h('span', { class: 'level-text', text: level.text }),
          on ? null : h('span', { class: 'lock-hint', text: 'Locked' }),
        ),
      );
    }),
  );
}

// What Save would raise, in words with the class shown first: "Bounty Hunter 5 and Miner 3".
function raisesText(state) {
  const first = state.build.base.code;
  const ordered = [...state.unsavedRaises.filter((r) => r.code === first), ...state.unsavedRaises.filter((r) => r.code !== first)];
  const named = ordered.map((r) => `${state.data.classes.find((c) => c.code === r.code).name} ${r.level}`);
  return named.length ? listOf(named) : `${state.build.base.name} passives`;
}

// Save and its label replace the copy actions while the shown build is not what the person has stored.
function saveControls(state, actions) {
  return [
    h('span', { class: 'unsaved-label', text: `Unsaved build: ${raisesText(state)}` }),
    h('button', { type: 'button', class: 'btn btn-green btn-small', 'data-fk': 'build-save', onclick: actions.saveBuild, text: 'Save' }),
  ];
}

// The selected class's five levels; with actions (a saved person's build) its header carries the share buttons, or Save for an unsaved build.
function basePanel(state, base, owned, actions = null) {
  const title = h('h2', { class: 'panel-title' }, classIcon(base), h('span', { text: base.name }), diamonds(base, state.data.tiers), (owned[base.code] ?? 0) > 0 ? null : notOwned());
  const unsaved = Boolean(state.unsaved);
  const shareBlock = actions && !unsaved ? actions.shareBlock() : null;
  return h(
    'section',
    { class: 'panel base-levels', 'aria-label': `${base.name} levels` },
    actions
      ? h(
          'div',
          { class: 'panel-head' },
          title,
          h(
            'div',
            { class: 'head-actions' },
            unsaved
              ? saveControls(state, actions)
              : [
                  copyButton(state, actions, { key: 'copy', done: 'copied', idle: 'Copy link', doneText: 'Link copied', primary: true, block: shareBlock, onclick: actions.copyLink }),
                  copyButton(state, actions, { key: 'copy-code', done: 'code-copied', idle: 'Copy code', doneText: 'Code copied', primary: false, block: shareBlock, onclick: actions.copyCode }),
                ],
          ),
        )
      : title,
    actions && !unsaved ? copyFeedback(state, shareBlock) : null,
    levelList(base, owned),
  );
}

// The Update banner above the loadout: a link for a saved person (or Me) that differs from what is stored, applied only on Yes.
function updateBanner(state, actions) {
  const { id, incoming } = state.pending;
  const person = state.people.get(id);
  const own = id === ME_ID;
  const replaces = replacesText(state, incoming, actions.pendingSummary(), own ? 'your' : `${person.name}'s`);
  const who = own ? 'you' : person.name;
  return h(
    'section',
    { class: 'panel update-banner', role: 'group', 'aria-label': 'Update from link' },
    h('p', { class: 'update-text', text: `This link differs from what is saved for ${who}${replaces ? ` and replaces ${replaces}` : ''}. Update ${own ? 'your build' : person.name}?` }),
    h(
      'div',
      { class: 'roster-row' },
      h('button', { type: 'button', class: 'btn btn-green btn-small', 'data-fk': 'update-yes', onclick: actions.applyPending, text: 'Yes' }),
      h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'update-dismiss', onclick: actions.dismissPending, text: 'Dismiss' }),
    ),
  );
}

function loadout(state, actions) {
  const { base, slots } = state.build;
  const person = state.shown;
  const readOnly = Boolean(state.temp);
  const banner = state.pending ? updateBanner(state, actions) : null;
  if (!base) {
    const empty = h('section', { class: 'panel loadout', id: 'loadout', 'aria-label': 'Loadout' }, h('p', { class: 'empty', text: readOnly ? noClassesText(person) : 'Pick a class to see its loadout.' }));
    return banner ? h('div', { class: 'loadout-col' }, banner, empty) : empty;
  }
  const editing = state.loadoutEditing;
  const owned = levelsOf(state);
  // Passives are judged against the person's stored levels, unless their roster is not known.
  const passiveOwners = person.rosterKnown ? owned : null;
  const offerEdit = !readOnly && !state.unsaved;
  return h(
    'div',
    { class: 'loadout-col' },
    banner,
    basePanel(state, base, owned, actions),
    h(
      'section',
      { class: 'panel loadout', id: 'loadout', 'aria-label': 'Loadout' },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', { class: 'panel-title', text: `${base.name} passives (${slots.length}/${MAX_PASSIVES})` }),
        offerEdit ? h('div', { class: 'head-actions' }, h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'loadout-edit', 'aria-pressed': String(editing), onclick: () => actions.setLoadoutEditing(!editing), text: editing ? 'Done' : 'Edit' })) : null,
      ),
      editing && offerEdit
        ? pickerEditor(state, actions)
        : h(
            'div',
            { class: 'loadout-read' },
            slots.length
              ? h('ol', { class: 'levels' }, slots.map((sl) => passiveRow(sl, passiveOwners)))
              : h('p', { class: 'empty', text: offerEdit ? 'No passives yet. Tap Edit to pick up to 3.' : 'No passives in this build.' }),
          ),
    ),
    buildEffectsPanel(state, base, owned[base.code] ?? 0, slots),
  );
}

// The empty class list's sentence: yours, or the selected person's.
const emptyClassesText = (state) => (state.shown.id === ME_ID ? "You haven't marked any classes yet. Tap Edit to add some." : `${state.shown.name} has no classes yet. Tap Edit to add some.`);

function classesView(state, actions) {
  const { classes } = state.data;
  const { list, build } = state;
  const hasClasses = Object.keys(levelsOf(state)).length > 0;
  const f = list.filter.trim().toLowerCase();
  const visible = list.editing ? classes : ownedClasses(classes, levelsOf(state), build.base ? [build.base.slug] : []);
  const rows = visible.filter((c) => c.name.toLowerCase().includes(f)).sort((a, b) => a.tier - b.tier);
  return h(
    'main',
    { class: 'classes' },
    h(
      'div',
      { class: 'classes-side' },
      cardsPanel(state, actions),
      h(
        'section',
        { class: 'panel classes-panel', 'aria-label': 'Classes' },
        h(
          'div',
          { class: 'panel-head' },
          h('h2', { class: 'panel-title', text: 'Classes' }),
          h(
            'div',
            { class: 'head-actions' },
            build.base ? h('button', { type: 'button', class: 'btn btn-green btn-small jump-loadout', 'data-fk': 'jump-loadout', onclick: actions.jumpToLoadout, text: 'Loadout' }) : null,
            state.temp ? null : h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'list-edit', 'aria-pressed': String(list.editing), onclick: () => actions.setEditing(!list.editing), text: list.editing ? 'Done' : 'Edit' }),
          ),
        ),
        h(
          'div',
          { class: 'list-controls' },
          h('input', { type: 'search', class: 'picker-filter', 'data-fk': 'list-filter', 'aria-label': 'Filter classes', placeholder: 'Filter classes', value: list.filter, oninput: (e) => actions.setListFilter(e.target.value) }),
        ),
        rows.length
          ? h('ul', { class: 'own-list' }, rows.map((c) => ownRow(state, actions, c)))
          : h('p', { class: 'empty', text: state.temp && !f ? noClassesText(state.shown) : !list.editing && !hasClasses ? emptyClassesText(state) : 'No classes match' }),
        !rows.length && !state.temp && !list.editing && !hasClasses ? helpLink(actions) : null,
      ),
    ),
    loadout(state, actions),
  );
}

// Pieces shared by library rows and the team matrix.
function memberBase(state, player, stored) {
  const code = ownedBase(state.data.classes, player, stored);
  return state.data.classes.find((c) => c.code === code) ?? null;
}

function libraryRow(state, actions, player, { me }) {
  const base = memberBase(state, player, player.base);
  const sets = Object.keys(player.sets).length;
  const marker = me ? 'live' : player.rosterKnown ? 'roster' : 'code';
  return h(
    'li',
    { class: `player-row${me ? ' is-me' : ''}`, 'data-player': player.name },
    h('span', { class: 'player-name', text: me ? `${player.name} (you)` : player.name }),
    h('span', { class: 'player-base' }, base ? [classIcon(base, { size: 24 }), `${base.name} L${player.levels[base.code]}`] : 'No classes'),
    h('span', { class: 'player-marker', text: marker }),
    h('span', { class: 'player-sets', text: `${sets} ${sets === 1 ? 'set' : 'sets'}` }),
  );
}

function meRow(state, actions) {
  if (state.people.me.name) return libraryRow(state, actions, state.people.me, { me: true });
  return h(
    'li',
    { class: 'player-row is-me' },
    h('span', { class: 'player-name', text: 'Me' }),
    h('a', { class: 'player-setname', 'data-fk': 'set-name', href: new URL('.', document.baseURI).href, onclick: (e) => (e.preventDefault(), actions.setView('builds')), text: 'Name yourself with Rename on your card' }),
  );
}

function libraryPanel(state, actions) {
  const players = state.people.people.slice(1);
  return h(
    'section',
    { class: 'panel library', 'aria-label': 'Players' },
    h('h2', { class: 'panel-title', text: 'Players' }),
    h(
      'ul',
      { class: 'player-list' },
      meRow(state, actions),
      players.map((p) => libraryRow(state, actions, p, { me: false })),
    ),
    players.length
      ? null
      : h(
          'p',
          { class: 'empty' },
          noPlayersHint(actions),
        ),
    players.length ? null : helpLink(actions),
  );
}

// Team matrix header: name, class select and remove for my team; name and class text for a link.
function memberHeader(state, actions, { id, name, player, base }, { readOnly }) {
  const isMe = state.people.isMe(name);
  const title = h('span', { class: 'member-name', text: isMe ? `${name} (you)` : name });
  if (readOnly) return [title, base ? h('span', { class: 'member-base' }, classIcon(base, { size: 24 }), h('span', { text: base.name }), diamonds(base, state.data.tiers)) : h('span', { class: 'card-empty', text: 'No classes owned' })];
  const k = `member-${name.toLowerCase()}`;
  const owned = state.data.classes.filter((c) => (player.levels[c.code] ?? 0) > 0);
  return [
    title,
    owned.length
      ? h(
          'span',
          { class: 'member-base' },
          base ? classIcon(base, { size: 24 }) : null,
          h(
            'select',
            { class: 'slot-select', 'data-fk': `${k}-base`, 'aria-label': `${name} class`, onchange: (e) => actions.setMemberBase(id, e.target.value) },
            owned.map((c) => h('option', { value: c.code, selected: base?.code === c.code, text: `${c.name} (L${player.levels[c.code]})` })),
          ),
        )
      : h('span', { class: 'card-empty', text: 'No classes owned' }),
    h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': `${k}-remove`, onclick: () => actions.removeMember(id) }, 'Remove', hidden(` ${name} from team`)),
  ];
}

// The "+" header cell: a native select listing named people who own a class and are not on the team.
function teamAddSelect(state, actions, team, candidates) {
  const full = team.members.length >= MAX_MEMBERS;
  const disabled = full || !candidates.length;
  const reason = full ? 'Team is full (8)' : 'All players added';
  return {
    nobody: !candidates.length,
    el: h(
      'select',
      { class: 'slot-select matrix-add-select', 'data-fk': 'team-add', 'aria-label': 'Add player', title: disabled ? reason : 'Add player', disabled, onchange: (e) => actions.addMember(e.target.value) },
      h('option', { value: '', text: disabled ? reason : '+' }),
      disabled ? null : candidates.map((p) => h('option', { value: p.id, text: p.name })),
    ),
  };
}

function teamPanel(state, actions, members) {
  const team = state.people.team;
  const teamBlock = actions.teamShareBlock();
  const offer = teamAddOffer(state.people.people, team);
  const add = teamAddSelect(state, actions, team, offer.candidates);
  const leftOut = offer.left;
  const empty = h(
    'p',
    { class: 'empty' },
    add.nobody
      ? noPlayersHint(actions)
      : 'Add players with the + column to see who contributes which effects',
  );
  return h(
    'section',
    { class: 'panel team-panel', 'aria-label': 'Team' },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', { class: 'panel-title', text: `Team (${team.members.length}/${MAX_MEMBERS})` }),
      h(
        'div',
        { class: 'head-actions' },
        copyButton(state, actions, { key: 'copy', done: 'copied', idle: 'Copy team link', doneText: 'Link copied', primary: true, block: teamBlock, onclick: actions.copyLink }),
      ),
    ),
    copyFeedback(state, teamBlock),
    h(
      'div',
      { class: 'team-controls' },
      h('label', { class: 'field-label', for: 'team-name', text: 'Team name' }),
      h('input', { type: 'text', id: 'team-name', class: 'roster-field', 'data-fk': 'team-name', autocomplete: 'off', maxlength: '40', value: team.name, oninput: (e) => actions.setTeamNameDraft(e.target.value), onchange: (e) => actions.renameTeam(e.target.value) }),
    ),
    teamMatrix(state, teamInputs(state, members), members.map((m) => memberHeader(state, actions, m, { readOnly: false })), { add: add.el, empty }),
    leftOut.length ? h('p', { class: 'roster-notice team-left-out', text: `Not offered by the + column: ${leftOut.map((p) => `${p.label} (${p.reason})`).join(', ')}.` }) : null,
  );
}

// What replacing my team does, in words: it replaces a non-empty team, and updates every linked person (other than me) already saved.
function replaceText(state, actions) {
  const updates = actions.linkUpdatesSaved();
  const replaces = state.people.team.members.length > 0;
  const tail = 'saved players with the classes, levels and passives in this link';
  return `This ${replaces ? `replaces your team${updates ? ` and updates ${tail}` : ''}` : `updates ${tail}`}. Continue?`;
}

// The "Replace my team" action and its inline confirm; an equal link shows "This is your team" instead.
function replaceControls(state, actions, mine) {
  const link = state.team.link;
  if (mine) {
    return h(
      'div',
      { class: 'claim-prompt', role: 'status' },
      h('p', { class: 'field-msg', text: 'This is your team' }),
      h('div', { class: 'roster-row' }, h('button', { type: 'button', class: 'btn btn-green btn-small', 'data-fk': 'open-my-team', onclick: actions.openMyTeam, text: 'Open my team' })),
    );
  }
  if (link.confirming) {
    return h(
      'div',
      { class: 'claim-prompt', role: 'alert' },
      h('p', { class: 'roster-error', text: replaceText(state, actions) }),
      h(
        'div',
        { class: 'roster-row' },
        h('button', { type: 'button', class: 'btn btn-green btn-small', 'data-fk': 'replace-yes', onclick: actions.confirmReplaceTeam, text: 'Yes' }),
        h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'replace-no', onclick: actions.cancelReplaceTeam, text: 'No' }),
      ),
    );
  }
  return null;
}

// An opened team link: the read-only matrix and a Replace my team action. Nothing is imported until confirmed.
function teamLinkView(state, actions) {
  const link = state.team.link;
  const classes = state.data.classes;
  const same = actions.linkIsMyTeam();
  const members = link.members.map(({ name, player }) => ({ name, player, base: classes.find((c) => c.code === player.base) ?? null }));
  return h(
    'main',
    { class: 'team' },
    h(
      'section',
      { class: 'panel team-panel', 'aria-label': 'Team link' },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', { class: 'panel-title', text: link.name ? `${link.name} (${link.members.length}/${MAX_MEMBERS})` : `Shared team (${link.members.length}/${MAX_MEMBERS})` }),
        h(
          'div',
          { class: 'head-actions' },
          same ? null : h('button', { type: 'button', class: 'btn btn-green', 'data-fk': 'replace-team', disabled: !link.members.length, onclick: actions.replaceTeamFromLink, text: 'Replace my team' }),
          copyButton(state, actions, { key: 'copy', done: 'copied', idle: 'Copy link', doneText: 'Link copied', primary: false, block: null, onclick: actions.copyLink, small: false }),
        ),
      ),
      copyFeedback(state, null),
      replaceControls(state, actions, same),
      link.members.length
        ? teamMatrix(state, teamInputs(state, members), members.map((m) => memberHeader(state, actions, m, { readOnly: true })))
        : h('p', { class: 'empty', text: 'No valid players in this link.' }),
    ),
  );
}

function teamView(state, actions) {
  if (state.team.link) return teamLinkView(state, actions);
  const team = state.people.team;
  const members = team.members.map((m) => {
    const player = state.people.get(m.id);
    return { id: m.id, name: player.name, player, base: memberBase(state, player, m.base) };
  });
  return h('main', { class: 'team' }, teamPanel(state, actions, members), libraryPanel(state, actions));
}

const HELP_SAMPLE = 'c5-sc1sal23-D5XB8XG5XD';

function helpView(state) {
  const section = (title, ...body) => h('section', { class: 'panel help-panel', 'aria-label': title }, h('h2', { class: 'panel-title', text: title }), ...body);
  const code = (text) => h('code', { text });
  return h(
    'main',
    { class: 'help' },
    section(
      'Getting started',
      h(
        'ol',
        { class: 'help-list' },
        h('li', {}, 'Open Builds and tap Edit in the Classes list. Mark the classes you own and unlock their levels. Levels are cumulative: unlocking level 3 unlocks levels 1 and 2.'),
        h('li', {}, 'Tap Done, then tap a class to make it your base class.'),
        h('li', {}, 'In the base class passives panel, tap Edit and pick up to 3 passives (levels 1 to 3). You can only pick levels you have unlocked, and a class can never be its own passive. Each class keeps its own set of passives.'),
      ),
    ),
    section(
      'People',
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, 'The cards at the top left of Builds are the people you keep: Me first, then everyone saved from A to Z, then a + card. Tap a card to see that person\'s classes and loadout; the choice is remembered.'),
        h('li', {}, 'The + card creates a person from just a name. Fill in their classes with Edit, the same way as your own.'),
        h('li', {}, 'On the selected card, the edit button offers Rename and Delete. Me can be renamed but not deleted. Deleting a person also removes them from your team and cannot be undone.'),
        h('li', {}, 'Everyone is edited like you: class levels, the selected class and the passives of each class are saved to that person only.'),
      ),
    ),
    section(
      'Sharing a build',
      h('p', {}, 'Name the person with Rename on their card first. Then use the buttons on the base class panel:'),
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, h('strong', { text: 'Copy link' }), ' shares everything: the build, the classes, the name, and the passives for every class. Best for Discord and similar.'),
        h('li', {}, h('strong', { text: 'Copy code' }), ' is a short code that fits in Roblox chat, such as ', code(HELP_SAMPLE), '.'),
      ),
      h('p', {}, 'Opening a link from someone you have not saved shows a temporary card with their name. Tap Save on it to keep them. Opening a link for someone you have saved selects them, and an Update banner offers to apply the newer data.'),
      h('p', {}, 'A build code typed into the address bar with no name, such as ', code('bo5-mi3'), ', shows that build on the selected person. Save raises their classes to what the build uses (here Bounty Hunter 5 and Miner 3) and keeps any higher level.'),
    ),
    section(
      'Importing',
      h('p', {}, 'The Import button in the header opens a paste panel on every page. It takes a share link, a build code, a bare roster code or a team link. Here is what each one does:'),
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, 'A link or code with your own name updates your build. If that would replace classes or passives you already have, you confirm first. A full link replaces all your passive sets; a code replaces only the passives of its base class unless it carries the other sets.'),
        h('li', {}, 'A link or code with a saved person\'s name updates that person at once, with no question. A name you have not saved is added as a new person once you have a name yourself. Each shows a message with a View button that opens Builds.'),
        h('li', {}, 'A code with no name, or a name that is not valid, asks Whose build is this? Choose Mine to update your build (this also names you if you have no name), or Save as to keep it under a name.'),
        h('li', {}, 'A bare roster code, the letters after the last dash, replaces only the classes you own.'),
        h('li', {}, 'A team link opens that team on the Team page. Nothing is saved until you tap Replace my team.'),
      ),
      h('p', {}, 'Escape or Close shuts the panel.'),
    ),
    section(
      'Team',
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, 'The Team page holds one team of up to 8 people, with a name you can edit. Below it, the Players panel shows you and everyone you have saved. To delete a person, use the edit menu on their card on Builds.'),
        h('li', {}, 'In the team table, each person is a column. The class select in the column header lists the classes that person owns, and Remove takes them off the team. The + column adds a person who has a name and owns a class, using their saved class.'),
        h('li', {}, 'Passives can\'t be changed on the Team page, because re-rolling costs in game. Each column uses the passives that person saved for the selected class.'),
        h('li', {}, 'Copy team link shares the team. Opening a team link shows its table read-only. Tap Replace my team to use it (you confirm first when your team has people), or This is your team when it already matches. Replacing also updates your saved people\'s class, level and passives for that class.'),
      ),
    ),
    section(
      'Combined effects',
      h('p', {}, 'The Combined effects panel on the Builds page adds up everything your unlocked base levels and chosen passives give. The same stat from different sources adds together, grouped by category with a list of where each part comes from. Level 4 team bonuses also count for you.'),
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, h('strong', { text: 'rounded' }), ': a Recruit level 5 build scales passive values by 1.25 and rounds each one to 1 decimal, so the total may be off by a little.'),
        h('li', {}, h('strong', { text: 'stacking unconfirmed' }), ': the stat comes from more than one copy of the same class, and it is not known whether those copies add up.'),
        h('li', {}, h('strong', { text: 'Conditional' }), ': bonuses that only apply in a situation, such as while driving. They are totaled per situation and never added to the main totals.'),
        h('li', {}, h('strong', { text: 'Nearby' }), ': bonuses that are higher when players are close together. They are listed without a total.'),
        h('li', {}, h('strong', { text: 'Flags' }), ': on or off abilities with no number.'),
        h('li', {}, h('strong', { text: 'Uncertain' }), ': effects whose exact behavior is not confirmed yet, listed under the open question and left out of totals.'),
      ),
      h('p', {}, 'The team table on the Team page uses the same grouping with one column per player, so you can see who contributes what.'),
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, 'Each row is an effect with a tag: self applies to that player only, team is a level 4 bonus for the whole team, nearby applies when players are close together.'),
        h('li', {}, 'A player\'s column shows what their selected class gives for that effect. An empty cell means they do not contribute.'),
        h('li', {}, 'The Team total column adds up the team rows that have a number. Self, nearby and uncertain rows have no total.'),
        h('li', {}, 'A row marked ×N is shared by N players, which shows where skills overlap.'),
        h('li', {}, 'Recruit at level 5 scales passive values by 1.25; a note under the table says when that applies.'),
      ),
    ),
    section(
      'Reading a code',
      h('p', {}, code(HELP_SAMPLE), ' breaks down like this:'),
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, code('c5'), ': base class Crafter at level 5.'),
        h('li', {}, code('sc1sal23'), ': passives, each a class code plus its levels: Scout 1, Salvager 2, Salvager 3. Levels of one class share its code, so sal23 is sal2sal3.'),
        h('li', {}, code('D5XB8XG5XD'), ': the classes you own, one symbol per class in list order. The symbol is the highest level unlocked and a number repeats it.'),
      ),
      h('p', {}, 'Class codes:'),
      h(
        'table',
        { class: 'code-table' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Code' }), h('th', { scope: 'col', text: 'Class' }))),
        h('tbody', {}, state.data.classes.map((c) => h('tr', {}, h('td', {}, code(c.code)), h('td', { text: c.name })))),
      ),
    ),
    section('Your data', h('p', {}, 'Everything is stored in this browser only. Nothing is uploaded, and clearing site data removes it. Nothing syncs between devices: on a new device, tap Import in the header and paste your own link or code to restore your classes and passives.')),
  );
}

function focusKey(root) {
  const active = document.activeElement;
  if (!active || !root.contains(active)) return null;
  const text = active.type === 'text' || active.type === 'search';
  return { key: active.getAttribute('data-fk'), start: text ? active.selectionStart : null, end: text ? active.selectionEnd : null };
}

function restoreFocus(root, saved) {
  if (!saved?.key) return;
  const next = [...root.querySelectorAll('[data-fk]')].find((el) => el.getAttribute('data-fk') === saved.key);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (next.type === 'search') next.setSelectionRange(next.value.length, next.value.length);
  else if (next.type === 'text' && saved.start != null) next.setSelectionRange(saved.start, saved.end);
}

// Replaces root's content from state. state.status is 'loading' | 'error' | 'ready'.
export function render(root, state, actions) {
  const key = focusKey(root);
  root.replaceChildren();
  if (state.status === 'loading') return void root.append(loadingPanel());
  if (state.status === 'error') return void root.append(errorPanel(state.error, actions));
  root.append(
    header(state, actions),
    ...(state.importOpen ? [importPanel(state, actions)] : []),
    ...[noticesBar(state.notices, actions)].filter(Boolean),
    state.view === 'help' ? helpView(state) : state.view === 'team' ? teamView(state, actions) : classesView(state, actions),
  );
  if (state.copyFocus) {
    state.copyFocus = false;
    root.querySelector('.copy-fallback')?.select();
  } else restoreFocus(root, key);
  if (state.view === 'builds') revealCard(root);
}
