// Renders from state only; all data text goes through textContent.
// Interactive elements carry data-fk so focus survives the full re-render.

const MAX_SLOTS = 3;
const TAG_LABEL = { team: 'TEAM', master: 'MASTER' };
const SVG_NS = 'http://www.w3.org/2000/svg';

// Phone picker disclosure: null = automatic (open until a base is chosen).
let pickerOpen = null;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const hidden = (text) => h('span', { class: 'visually-hidden', text });

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

function levelRow(level, index) {
  return h(
    'li',
    { class: 'level', 'data-level': index + 1, 'data-tag': level.tag },
    h(
      'span',
      { class: 'level-chip' },
      h('span', { class: 'level-num', text: String(index + 1) }),
      level.tag ? h('span', { class: 'level-tag', text: TAG_LABEL[level.tag] ?? level.tag }) : null,
    ),
    h('span', { class: 'level-text', text: level.text }),
  );
}

function matches(cls, filter) {
  if (!filter) return true;
  const f = filter.toLowerCase();
  return cls.name.toLowerCase().includes(f) || cls.levels.some((l) => l.text.toLowerCase().includes(f));
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

function header(state, actions) {
  const copied = state.copy === 'copied';
  return h(
    'header',
    { class: 'app-header' },
    h('h1', { text: 'Class Combo Viewer' }),
    // Future navigation (My classes, Team) renders into this slot.
    h('nav', { class: 'app-nav', 'aria-label': 'Sections' }),
    h(
      'div',
      { class: 'copy-link' },
      h('button', { type: 'button', class: `btn btn-green${copied ? ' is-done' : ''}`, 'data-fk': 'copy', onclick: actions.copyLink, text: copied ? 'Link copied' : 'Copy link' }),
      h('span', { class: 'visually-hidden', role: 'status', text: copied ? 'Link copied' : '' }),
    ),
    state.copy === 'failed'
      ? h('input', { type: 'text', class: 'copy-fallback', readonly: true, 'aria-label': 'Build link', 'data-fk': 'link-field', value: actions.currentUrl(), onfocus: (e) => e.target.select() })
      : null,
  );
}

function picker(state, actions) {
  const { classes, tiers } = state.data;
  const open = pickerOpen ?? !state.build.base;
  const groups = Object.keys(tiers)
    .map((tier) => ({ tier, items: classes.filter((c) => String(c.tier) === tier && matches(c, state.filter)) }))
    .filter((g) => g.items.length);
  const panel = h('section', { class: `panel picker${open ? '' : ' is-collapsed'}`, 'aria-label': 'Classes' });
  const toggle = h('button', {
    type: 'button',
    class: 'btn btn-grey picker-toggle',
    'data-fk': 'toggle-picker',
    'aria-expanded': String(open),
    'aria-controls': 'picker-body',
    onclick: () => {
      const next = panel.classList.contains('is-collapsed');
      pickerOpen = next;
      panel.classList.toggle('is-collapsed', !next);
      toggle.setAttribute('aria-expanded', String(next));
    },
    text: 'Change class',
  });
  panel.append(
    h('h2', { class: 'panel-title picker-title', text: 'Classes' }),
    toggle,
    h(
      'div',
      { class: 'picker-body', id: 'picker-body' },
      h('input', { type: 'search', class: 'picker-filter', 'data-fk': 'filter', 'aria-label': 'Filter classes', placeholder: 'Filter classes', value: state.filter, oninput: (e) => actions.setFilter(e.target.value) }),
      groups.length
        ? groups.map((g) =>
            h(
              'div',
              { class: 'tier', 'data-tier': g.tier },
              h('h3', { text: `Tier ${g.tier}` }),
              h(
                'ul',
                { class: 'class-list' },
                g.items.map((c) =>
                  h(
                    'li',
                    {},
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'class-button',
                        'data-fk': `class-${c.slug}`,
                        'aria-pressed': state.build.base?.slug === c.slug ? 'true' : 'false',
                        onclick: () => {
                          pickerOpen = null;
                          actions.setBase(c.slug);
                        },
                      },
                      h('span', { class: 'class-name', text: c.name }),
                      diamonds(c, tiers),
                    ),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'empty', text: 'No classes match' }),
    ),
  );
  return panel;
}

function baseLevels(state, actions) {
  const base = state.build.base;
  if (!base) {
    return h('section', { class: 'panel base', 'aria-label': 'Base class' }, h('p', { class: 'empty', text: 'Choose a base class' }));
  }
  return h(
    'section',
    { class: 'panel base', 'aria-label': 'Base class' },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', { class: 'panel-title' }, h('span', { text: base.name }), diamonds(base, state.data.tiers)),
      h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': 'clear-base', onclick: () => actions.setBase(null) }, 'Clear', hidden(` base ${base.name}`)),
    ),
    h('ol', { class: 'levels' }, base.levels.map(levelRow)),
  );
}

function slotView(state, actions, index) {
  const slot = state.build.slots[index];
  const { classes } = state.data;
  const select = h(
    'select',
    { class: 'slot-select', 'data-fk': `slot-${index}-select`, 'aria-label': `Slot ${index + 1} class`, onchange: (e) => actions.setSlot(index, e.target.value || null, 1) },
    h('option', { value: '', text: 'Choose class' }),
    classes.map((c) => h('option', { value: c.slug, selected: slot?.cls.slug === c.slug, text: c.name })),
  );
  const label = h('span', { class: 'slot-label', text: `Slot ${index + 1}` });
  if (!slot) return h('li', { class: 'slot empty', 'data-slot': index + 1 }, h('div', { class: 'slot-head' }, label), select);
  return h(
    'li',
    { class: 'slot filled', 'data-slot': index + 1, 'data-level': slot.level },
    h('div', { class: 'slot-head' }, label, h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': `clear-slot-${index}`, onclick: () => actions.clearSlot(index) }, 'Clear', hidden(` slot ${index + 1}`))),
    select,
    h(
      'div',
      { class: 'slot-levels', role: 'group', 'aria-label': `Slot ${index + 1} level` },
      [1, 2, 3].map((n) =>
        h('button', {
          type: 'button',
          class: 'level-button',
          'data-fk': `slot-${index}-lv-${n}`,
          'data-level': n,
          'aria-pressed': slot.level === n ? 'true' : 'false',
          'aria-label': `Level ${n}`,
          onclick: () => actions.setSlot(index, slot.cls.slug, n),
          text: String(n),
        }),
      ),
    ),
    h('p', { class: 'slot-text', text: slot.cls.levels[slot.level - 1].text }),
  );
}

function slotsPanel(state, actions) {
  if (!state.build.base) return null;
  return h(
    'section',
    { class: 'panel slots', 'aria-label': 'Passive slots' },
    h('h2', { class: 'panel-title', text: 'Passive Slots' }),
    h('ol', { class: 'slot-list' }, Array.from({ length: MAX_SLOTS }, (_, i) => slotView(state, actions, i))),
  );
}

function combined(state) {
  const { base, slots } = state.build;
  if (!base) return null;
  const rows = [
    ...base.levels.map((l, i) => ({ label: `Base ${i + 1}`, level: i + 1, text: l.text })),
    ...slots.map((s, i) => ({ label: `Slot ${i + 1}`, level: s.level, text: s.cls.levels[s.level - 1].text, from: `${s.cls.name} ${s.level}` })),
  ];
  return h(
    'section',
    { class: 'panel combined', 'aria-label': 'Combined effects' },
    h('h2', { class: 'panel-title', text: 'Combined Effects' }),
    base.slug === 'recruit' ? h('p', { class: 'recruit-note', text: base.levels[4].text }) : null,
    h(
      'ul',
      { class: 'combined-rows' },
      rows.map((r) =>
        h(
          'li',
          { class: 'row', 'data-level': r.level },
          h('span', { class: 'row-label', text: r.label }),
          h('span', { class: 'row-body' }, r.from ? h('span', { class: 'row-from', text: r.from }) : null, h('span', { class: 'level-text', text: r.text })),
        ),
      ),
    ),
  );
}

function focusKey(root) {
  const active = document.activeElement;
  return active && root.contains(active) ? active.getAttribute('data-fk') : null;
}

function restoreFocus(root, key) {
  if (!key) return;
  const next = [...root.querySelectorAll('[data-fk]')].find((el) => el.getAttribute('data-fk') === key);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (next.type === 'search') next.setSelectionRange(next.value.length, next.value.length);
}

// Replaces root's content from state. state.status is 'loading' | 'error' | 'ready'.
export function render(root, state, actions) {
  const key = focusKey(root);
  root.replaceChildren();
  if (state.status === 'loading') return void root.append(loadingPanel());
  if (state.status === 'error') return void root.append(errorPanel(state.error, actions));
  root.append(
    header(state, actions),
    ...[noticesBar(state.notices, actions)].filter(Boolean),
    h(
      'main',
      { class: 'layout' },
      picker(state, actions),
      baseLevels(state, actions),
      h('div', { class: 'build' }, slotsPanel(state, actions), combined(state)),
    ),
  );
  if (state.copy === 'failed') root.querySelector('.copy-fallback')?.select();
  else restoreFocus(root, key);
}
